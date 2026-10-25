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

      // Ensure current month obligation exists
      const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'standard_amount_cents'").get();
      const standardAmount = settingRow ? parseInt(settingRow.value, 10) : 50000;
      const dueDayRow = db.prepare("SELECT value FROM settings WHERE key = 'due_day_of_month'").get();
      const dueDay = dueDayRow ? parseInt(dueDayRow.value, 10) : 10;
      const currentMonth = getCurrentYearMonth();
      const dueDate = getDueDateForMonth(currentMonth, dueDay);

      db.prepare(`
        INSERT OR IGNORE INTO obligations (member_id, year_month, amount_due_cents, amount_paid_cents, status, due_date)
        VALUES (?, ?, ?, 0, 'UNPAID', ?)
      `).run(existing.id, currentMonth, standardAmount, dueDate);

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

function getAllInactiveMembers() {
  const db = getDatabase();
  return db.prepare("SELECT * FROM members WHERE status = 'inactive' ORDER BY full_name COLLATE NOCASE ASC").all();
}

/**
 * Get statistical summary of records associated with a member before purging
 */
function getMemberPurgeSummary(memberId) {
  const db = getDatabase();
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) {
    throw new Error('Member not found.');
  }

  const paymentsStat = db.prepare(`
    SELECT
      COUNT(id) AS count,
      COALESCE(SUM(amount_cents), 0) AS total_cents
    FROM payments
    WHERE member_id = ?
  `).get(memberId);

  const obligationsCount = db.prepare('SELECT COUNT(*) AS count FROM obligations WHERE member_id = ?').get(memberId).count;
  const submissionsCount = db.prepare('SELECT COUNT(*) AS count FROM payment_submissions WHERE member_id = ?').get(memberId).count;

  return {
    member,
    paymentsCount: paymentsStat.count,
    paymentsTotalCents: paymentsStat.total_cents,
    obligationsCount,
    submissionsCount,
  };
}

/**
 * Permanently purge payment records, obligations, and submission history for a deactivated member.
 * Only allowed for members with status = 'inactive'.
 */
function purgeMemberHistory({ memberId, actorTelegramId, deleteMemberRecord = false }) {
  const db = getDatabase();
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) {
    throw new Error('Member not found.');
  }

  if (member.status !== 'inactive') {
    throw new Error(`Member "${member.full_name}" is currently active. You must deactivate the member before deleting their history.`);
  }

  const summary = getMemberPurgeSummary(memberId);

  const purgeTx = db.transaction(() => {
    // 1. Delete payment reversals associated with this member's payments
    db.prepare('DELETE FROM payment_reversals WHERE payment_id IN (SELECT id FROM payments WHERE member_id = ?)').run(memberId);

    // 2. Delete payment submissions
    db.prepare('DELETE FROM payment_submissions WHERE member_id = ?').run(memberId);

    // 3. Delete payments
    db.prepare('DELETE FROM payments WHERE member_id = ?').run(memberId);

    // 4. Delete obligations
    db.prepare('DELETE FROM obligations WHERE member_id = ?').run(memberId);

    // 5. Delete reminder logs
    db.prepare('DELETE FROM reminder_log WHERE member_id = ?').run(memberId);

    // 6. Delete member record if requested
    if (deleteMemberRecord) {
      db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
    }

    // 7. Write permanent audit log entry
    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('PURGE_MEMBER_HISTORY', 'members', String(memberId), String(actorTelegramId), JSON.stringify({
      fullName: member.full_name,
      telegramId: member.telegram_id,
      deletedPaymentsCount: summary.paymentsCount,
      deletedPaymentsTotalCents: summary.paymentsTotalCents,
      deletedObligationsCount: summary.obligationsCount,
      deletedSubmissionsCount: summary.submissionsCount,
      memberRecordDeleted: Boolean(deleteMemberRecord),
    }));
  });

  purgeTx();

  return {
    member,
    deletedPaymentsCount: summary.paymentsCount,
    deletedPaymentsTotalCents: summary.paymentsTotalCents,
    deletedObligationsCount: summary.obligationsCount,
    deletedSubmissionsCount: summary.submissionsCount,
    memberRecordDeleted: Boolean(deleteMemberRecord),
  };
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

function createRegistrationRequest({ telegramId, username, fullName, phone }) {
  const tid = String(telegramId).trim();
  if (!isValidTelegramId(tid)) {
    throw new Error('Invalid Telegram ID.');
  }

  const cleanName = sanitizeText(fullName, 100);
  if (!cleanName || cleanName.length < 2) {
    throw new Error('Full name is required (at least 2 characters).');
  }

  const cleanPhone = sanitizeText(phone, 30);
  const cleanUsername = username ? sanitizeText(username, 50) : null;

  const db = getDatabase();

  const existingMember = db.prepare('SELECT * FROM members WHERE telegram_id = ?').get(tid);
  if (existingMember && existingMember.status === 'active') {
    throw new Error(`You are already registered as an active member (${existingMember.full_name}).`);
  }

  const existingPending = db.prepare("SELECT * FROM registration_requests WHERE telegram_id = ? AND status = 'PENDING'").get(tid);
  if (existingPending) {
    throw new Error('You already have a pending registration request under review.');
  }

  const res = db.prepare(`
    INSERT INTO registration_requests (telegram_id, username, full_name, phone, status)
    VALUES (?, ?, ?, ?, 'PENDING')
  `).run(tid, cleanUsername, cleanName, cleanPhone);

  const requestId = res.lastInsertRowid;

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('SUBMIT_REGISTRATION', 'registration_requests', String(requestId), tid, JSON.stringify({
    fullName: cleanName,
    phone: cleanPhone,
    username: cleanUsername,
  }));

  return db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(requestId);
}

function getPendingRegistrationRequests() {
  const db = getDatabase();
  return db.prepare("SELECT * FROM registration_requests WHERE status = 'PENDING' ORDER BY created_at ASC").all();
}

function getRegistrationRequestById(id) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(id);
}

function getPendingRequestByTelegramId(telegramId) {
  const db = getDatabase();
  return db.prepare("SELECT * FROM registration_requests WHERE telegram_id = ? AND status = 'PENDING' ORDER BY id DESC LIMIT 1").get(String(telegramId).trim());
}

function approveRegistrationRequest(requestId, adminTelegramId) {
  const db = getDatabase();
  const req = db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(requestId);
  if (!req) {
    throw new Error('Registration request not found.');
  }

  if (req.status !== 'PENDING') {
    throw new Error(`This request has already been ${req.status.toLowerCase()}.`);
  }

  const tx = db.transaction(() => {
    const member = registerMember({
      telegramId: req.telegram_id,
      fullName: req.full_name,
      phone: req.phone,
      actorTelegramId: adminTelegramId,
    });

    db.prepare(`
      UPDATE registration_requests
      SET status = 'APPROVED', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(String(adminTelegramId), requestId);

    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('APPROVE_REGISTRATION', 'registration_requests', String(requestId), String(adminTelegramId), JSON.stringify({
      memberId: member.id,
      fullName: member.full_name,
      telegramId: member.telegram_id,
    }));

    return {
      member,
      request: db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(requestId),
    };
  });

  return tx();
}

function rejectRegistrationRequest(requestId, adminTelegramId, reason = 'Declined by administrator') {
  const db = getDatabase();
  const req = db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(requestId);
  if (!req) {
    throw new Error('Registration request not found.');
  }

  if (req.status !== 'PENDING') {
    throw new Error(`This request has already been ${req.status.toLowerCase()}.`);
  }

  const cleanReason = sanitizeText(reason, 255) || 'Declined by administrator';

  db.prepare(`
    UPDATE registration_requests
    SET status = 'REJECTED', reviewed_by = ?, reviewed_at = datetime('now'), rejection_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(String(adminTelegramId), cleanReason, requestId);

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('REJECT_REGISTRATION', 'registration_requests', String(requestId), String(adminTelegramId), JSON.stringify({
    telegramId: req.telegram_id,
    fullName: req.full_name,
    reason: cleanReason,
  }));

  return db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(requestId);
}

async function notifyAdminsNewRegistration(telegram, request) {
  const { getAdminTelegramIds } = require('./permissions');
  const { Markup } = require('telegraf');
  const { escapeHtml } = require('../utils/formatters');

  const adminIds = getAdminTelegramIds();
  const db = getDatabase();
  const existingMember = db.prepare('SELECT * FROM members WHERE telegram_id = ?').get(String(request.telegram_id));
  const isReactivation = existingMember && existingMember.status === 'inactive';

  const title = isReactivation
    ? '🔄 <b>Member Re-activation Request!</b>'
    : '📥 <b>New Member Registration Request!</b>';

  const note = isReactivation
    ? '\n⚠️ <i>Applicant was previously deactivated. Approving will re-activate their membership.</i>\n'
    : '';

  const text =
    `${title}\n\n` +
    `• <b>Full Name:</b> ${escapeHtml(request.full_name)}\n` +
    `• <b>Phone:</b> ${escapeHtml(request.phone || 'Not provided')}\n` +
    `• <b>Telegram ID:</b> <code>${escapeHtml(request.telegram_id)}</code>\n` +
    (request.username ? `• <b>Username:</b> @${escapeHtml(request.username)}\n` : '') +
    `• <b>Submitted:</b> ${escapeHtml(request.created_at)}\n` +
    note +
    `\nReview and choose an action:`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve Member', `reg_approve_${request.id}`),
      Markup.button.callback('❌ Reject', `reg_reject_${request.id}`),
    ],
  ]);

  for (const adminId of adminIds) {
    try {
      await telegram.sendMessage(adminId, text, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (err) {
      console.warn(`[Registration] Could not send notification to admin ${adminId}:`, err.message);
    }
  }
}

module.exports = {
  registerMember,
  deactivateMember,
  getMemberById,
  getMemberByTelegramId,
  listActiveMembers,
  getAllActiveMembers,
  getAllInactiveMembers,
  getMemberPurgeSummary,
  purgeMemberHistory,
  seedDemoMembers,
  createRegistrationRequest,
  getPendingRegistrationRequests,
  getRegistrationRequestById,
  getPendingRequestByTelegramId,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  notifyAdminsNewRegistration,
};
