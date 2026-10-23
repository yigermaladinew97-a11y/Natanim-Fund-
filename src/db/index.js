const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { SCHEMA_SQL } = require('./schema');
const { config } = require('../config');

let dbInstance = null;

function initDatabase(customPath) {
  const dbPath = customPath || config.databasePath;

  // Ensure parent directory exists for file-based databases
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Execute schema creation
  db.exec(SCHEMA_SQL);

  // Auto-migration for existing databases
  try {
    const subCols = db.prepare('PRAGMA table_info(payment_submissions)').all();
    if (subCols.length > 0 && !subCols.some((c) => c.name === 'months_count')) {
      db.prepare('ALTER TABLE payment_submissions ADD COLUMN months_count INTEGER NOT NULL DEFAULT 1').run();
    }
  } catch (_) {}

  // Seed default settings if not existing
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  insertSetting.run('currency', config.defaultCurrency);
  insertSetting.run('standard_amount_cents', String(config.defaultMonthlyAmountCents));
  insertSetting.run('due_day_of_month', String(config.dueDayOfMonth));
  insertSetting.run('timezone', config.timezone);
  insertSetting.run('reminder_schedule', config.reminderCronSchedule);

  // Seed Super Administrator from environment if configured
  if (config.adminTelegramId) {
    const existingAdmin = db.prepare(`SELECT role FROM roles WHERE telegram_id = ?`).get(config.adminTelegramId);
    if (!existingAdmin) {
      db.prepare(`
        INSERT INTO roles (telegram_id, role, assigned_by)
        VALUES (?, 'admin', 'SYSTEM_ENV')
      `).run(config.adminTelegramId);

      // Also record in audit log
      db.prepare(`
        INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
        VALUES (?, ?, ?, ?, ?)
      `).run('INITIALIZE_SUPERADMIN', 'roles', config.adminTelegramId, 'SYSTEM', JSON.stringify({ role: 'admin' }));
    }

  // Auto-register Super Admin as a contributing church member in real database so /mystatus, /history, and testing work right away
  if (!customPath && config.adminTelegramId) {
    const existingMember = db.prepare('SELECT id FROM members WHERE telegram_id = ?').get(config.adminTelegramId);
    if (!existingMember) {
      const today = new Date().toISOString().slice(0, 10);
      const res = db.prepare(`
        INSERT OR IGNORE INTO members (telegram_id, full_name, phone, status, joined_date, notes)
        VALUES (?, 'Church Administrator', '', 'active', ?, 'Initial Church Team Leader')
      `).run(config.adminTelegramId, today);

      if (res.changes > 0) {
        const memberId = res.lastInsertRowid;
        const currentMonth = today.slice(0, 7);
        const dueDay = config.dueDayOfMonth || 10;
        const dueDate = `${currentMonth}-${String(dueDay).padStart(2, '0')}`;
        const stdAmountRow = db.prepare("SELECT value FROM settings WHERE key = 'standard_amount_cents'").get();
        const stdAmount = stdAmountRow ? parseInt(stdAmountRow.value, 10) : 50000;

        db.prepare(`
          INSERT OR IGNORE INTO obligations (member_id, year_month, amount_due_cents, amount_paid_cents, status, due_date)
          VALUES (?, ?, ?, 0, 'UNPAID', ?)
        `).run(memberId, currentMonth, stdAmount, dueDate);
      }
    }
  }
  }

  dbInstance = db;
  return db;
}

function getDatabase() {
  if (!dbInstance) {
    dbInstance = initDatabase();
  }
  return dbInstance;
}

function closeDatabase() {
  if (dbInstance && dbInstance.open) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
};

