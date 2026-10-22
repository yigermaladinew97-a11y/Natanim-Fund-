const { getDatabase } = require('../db');
const { isValidTelegramId, sanitizeText } = require('../utils/validators');
const { getCurrentYearMonth, getDueDateForMonth } = require('../utils/formatters');

function registerMember({ telegramId, fullName, phone, joinedDate, notes, actorTelegramId }) {
  let tid = telegramId ? String(telegramId).trim() : null;

  if (!tid || tid.toLowerCase() === 'skip' || tid.toLowerCase() === 'none') {
    // Generate a unique church membership identifier if Telegram ID is not yet known
    const cleanDigits = phone ? phone.replace(/\D/g, '') : '';
    const rand = Math.floor(100000 + Math.random() * 900000);
    tid = cleanDigits.length >= 7 ? `CHURCH_${cleanDigits}` : `CHURCH_${Date.now()}_${rand}`;
  } else if (!isValidTelegramId(tid) && !tid.startsWith('CHURCH_') && !tid.startsWith('PHONE_')) {
    throw new Error('Invalid Telegram ID. It must be a positive numeric ID (e.g. 123456789) or "skip".');
  }

  const cleanName = sanitizeText(fullName, 100);
  if (!cleanName || cleanName.length < 2) {
    throw new Error('Full name is required and must be at least 2 characters.');
  }

  const cleanPhone = sanitizeText(phone, 30);
  const cleanNotes = sanitizeText(notes, 255);
  const joinDate = joinedDate || new Date().toISOString().slice(0, 10);

  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM members WHERE telegram_id = ?').get(tid);
  if (existing) {
    if (existing.status === 'active') {
      throw new Error(`Member "${existing.full_name}" is already registered and active.`);
    } else {
      // Re-activate previously inactive member
      db.prepare(`
        UPDATE members
        SET full_name = ?, phone = ?, status = 'active', notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(cleanName, cleanPhone || existing.phone, cleanNotes || existing.notes, existing.id);

      db.prepare(`
        INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
        VALUES (?, ?, ?, ?, ?)
      `).run('REACTIVATE_MEMBER', 'members', String(existing.id), String(actorTelegramId), JSON.stringify({
        fullName: cleanName,
        phone: cleanPhone,
      }));

      return db.prepare('SELECT * FROM members WHERE id = ?').get(existing.id);
    }
  }

  // Create new member inside transaction to also setup their initial monthly obligation
  const insertTx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO members (telegram_id, full_name, phone, status, joined_date, notes)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(tid, cleanName, cleanPhone, joinDate, cleanNotes);

    const memberId = result.lastInsertRowid;

    // Get current standard contribution amount
    const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'standard_amount_cents'").get();
    const standardAmount = settingRow ? parseInt(settingRow.value, 10) : 50000;
    const dueDayRow = db.prepare("SELECT value FROM settings WHERE key = 'due_day_of_month'").get();
    const dueDay = dueDayRow ? parseInt(dueDayRow.value, 10) : 10;

    const currentMonth = getCurrentYearMonth();
    const dueDate = getDueDateForMonth(currentMonth, dueDay);

    // Create current month obligation
    db.prepare(`
      INSERT OR IGNORE INTO obligations (member_id, year_month, amount_due_cents, amount_paid_cents, status, due_date)
      VALUES (?, ?, ?, 0, 'UNPAID', ?)
    `).run(memberId, currentMonth, standardAmount, dueDate);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('REGISTER_MEMBER', 'members', String(memberId), String(actorTelegramId), JSON.stringify({
      telegramId: tid,
      fullName: cleanName,
      phone: cleanPhone,
      joinedDate: joinDate,
    }));

    return db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  });

  return insertTx();
}

function deactivateMember({ memberId, reason, actorTelegramId }) {
  const db = getDatabase();
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) {
    throw new Error('Member not found.');
  }

  if (member.status === 'inactive') {
    throw new Error(`Member "${member.full_name}" is already inactive.`);
  }

  const cleanReason = sanitizeText(reason, 255) || 'Deactivated by administrator';

  db.prepare(`
    UPDATE members
    SET status = 'inactive', notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(cleanReason, memberId);

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('DEACTIVATE_MEMBER', 'members', String(memberId), String(actorTelegramId), JSON.stringify({
    fullName: member.full_name,
    reason: cleanReason,
  }));

  return db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
}

function getMemberById(id) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
}

function getMemberByTelegramId(telegramId) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM members WHERE telegram_id = ?').get(String(telegramId));
}

function listActiveMembers(page = 1, pageSize = 10) {
  const db = getDatabase();
  const offset = (page - 1) * pageSize;
  const countRow = db.prepare("SELECT COUNT(*) as count FROM members WHERE status = 'active'").get();
  const total = countRow.count;
  const members = db.prepare(`
    SELECT * FROM members
    WHERE status = 'active'
    ORDER BY full_name COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset);

  return {
    members,
    total,
    page,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

function getAllActiveMembers() {
  const db = getDatabase();
  return db.prepare("SELECT * FROM members WHERE status = 'active' ORDER BY full_name COLLATE NOCASE ASC").all();
}

function seedDemoMembers(actorTelegramId) {
  const samples = [
    { fullName: 'Yohannes Girma', phone: '+251911112233', telegramId: '987000101' },
    { fullName: 'Marta Haile', phone: '+251922334455', telegramId: '987000102' },
    { fullName: 'Dawit Tadesse', phone: '+251933445566', telegramId: '987000103' },
  ];

  const added = [];
  for (const s of samples) {
    try {
      const m = registerMember({
        telegramId: s.telegramId,
        fullName: s.fullName,
        phone: s.phone,
        notes: 'Demo test member',
        actorTelegramId,
      });
      added.push(m);
    } catch (_) {}
  }
  return added;
}

module.exports = {
  registerMember,
  deactivateMember,
  getMemberById,
  getMemberByTelegramId,
  listActiveMembers,
  getAllActiveMembers,
  seedDemoMembers,
};
