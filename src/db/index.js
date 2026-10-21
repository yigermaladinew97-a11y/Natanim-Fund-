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

