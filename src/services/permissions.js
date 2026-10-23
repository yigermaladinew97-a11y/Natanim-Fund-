const { getDatabase } = require('../db');
const { config } = require('../config');

function getUserRole(telegramId) {
  if (!telegramId) return null;
  const tid = String(telegramId).trim();

  // Super admin from config always has admin role
  if (config.adminTelegramId && tid === String(config.adminTelegramId).trim()) {
    return 'admin';
  }

  const db = getDatabase();
  const row = db.prepare('SELECT role FROM roles WHERE telegram_id = ?').get(tid);
  return row ? row.role : null;
}

function isAdmin(telegramId) {
  return getUserRole(telegramId) === 'admin';
}

function isTreasurer(telegramId) {
  return getUserRole(telegramId) === 'treasurer';
}

function isStaff(telegramId) {
  const role = getUserRole(telegramId);
  return role === 'admin' || role === 'treasurer';
}

function getMemberByTelegramId(telegramId) {
  if (!telegramId) return null;
  const db = getDatabase();
  return db.prepare('SELECT * FROM members WHERE telegram_id = ?').get(String(telegramId).trim());
}

function assignRole(telegramId, role, assignedBy) {
  const db = getDatabase();
  if (!['admin', 'treasurer'].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }

  const existing = db.prepare('SELECT role FROM roles WHERE telegram_id = ?').get(String(telegramId));
  if (existing) {
    db.prepare('UPDATE roles SET role = ?, assigned_by = ?, updated_at = datetime("now") WHERE telegram_id = ?')
      .run(role, String(assignedBy), String(telegramId));
  } else {
    db.prepare('INSERT INTO roles (telegram_id, role, assigned_by) VALUES (?, ?, ?)')
      .run(String(telegramId), role, String(assignedBy));
  }

  // Audit
  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('ASSIGN_ROLE', 'roles', String(telegramId), String(assignedBy), JSON.stringify({ role }));
}

function revokeRole(telegramId, revokedBy) {
  const db = getDatabase();
  const tid = String(telegramId);

  // Prevent revoking super admin configured in .env
  if (config.adminTelegramId && tid === String(config.adminTelegramId).trim()) {
    throw new Error('Cannot revoke primary administrator configured in environment.');
  }

  db.prepare('DELETE FROM roles WHERE telegram_id = ?').run(tid);

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('REVOKE_ROLE', 'roles', tid, String(revokedBy), JSON.stringify({ revoked: true }));
}

function listRoles() {
  const db = getDatabase();
  return db.prepare(`
    SELECT r.telegram_id, r.role, r.assigned_by, r.created_at, m.full_name
    FROM roles r
    LEFT JOIN members m ON r.telegram_id = m.telegram_id
    ORDER BY r.role ASC, r.created_at ASC
  `).all();
}

function getAdminTelegramIds() {
  const db = getDatabase();
  const rows = db.prepare("SELECT telegram_id FROM roles WHERE role = 'admin'").all();
  const ids = new Set(rows.map((r) => String(r.telegram_id).trim()));
  if (config.adminTelegramId) {
    ids.add(String(config.adminTelegramId).trim());
  }
  return Array.from(ids);
}

function getStaffTelegramIds() {
  const db = getDatabase();
  const rows = db.prepare("SELECT telegram_id FROM roles WHERE role IN ('admin', 'treasurer')").all();
  const ids = new Set(rows.map((r) => String(r.telegram_id).trim()));
  if (config.adminTelegramId) {
    ids.add(String(config.adminTelegramId).trim());
  }
  return Array.from(ids);
}

module.exports = {
  getUserRole,
  isAdmin,
  isTreasurer,
  isStaff,
  getMemberByTelegramId,
  assignRole,
  revokeRole,
  listRoles,
  getAdminTelegramIds,
  getStaffTelegramIds,
};

