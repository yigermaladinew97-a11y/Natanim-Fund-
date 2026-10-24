// Database schema definitions and initialization DDL

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Registered church fund members
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  joined_date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Authorized system roles (admin, treasurer)
CREATE TABLE IF NOT EXISTS roles (
  telegram_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('admin', 'treasurer')),
  assigned_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bot & fund configuration settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Monthly obligations per member
CREATE TABLE IF NOT EXISTS obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  year_month TEXT NOT NULL,
  amount_due_cents INTEGER NOT NULL CHECK(amount_due_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_paid_cents >= 0),
  status TEXT NOT NULL DEFAULT 'UNPAID' CHECK(status IN ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID', 'OVERDUE')),
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, year_month)
);

-- Financial payment transactions
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id TEXT UNIQUE NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  obligation_id INTEGER NOT NULL REFERENCES obligations(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank_transfer', 'mobile_money')),
  reference_number TEXT,
  notes TEXT,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_reversed INTEGER NOT NULL DEFAULT 0 CHECK(is_reversed IN (0, 1)),
  reversed_at TEXT,
  reversed_by TEXT,
  reversal_reason TEXT
);

-- Audit table for payment reversals
CREATE TABLE IF NOT EXISTS payment_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  tx_id TEXT NOT NULL,
  reversed_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- System audit trail for security and modifications
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  actor_telegram_id TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Log of sent and attempted payment reminders
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  telegram_id TEXT NOT NULL,
  year_month TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SENT', 'FAILED', 'BLOCKED')),
  error_message TEXT,
  sent_by TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Member self-registration requests awaiting administrator approval
CREATE TABLE IF NOT EXISTS registration_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  username TEXT,
  full_name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Member payment receipt / screenshot submissions awaiting staff verification
CREATE TABLE IF NOT EXISTS payment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  telegram_id TEXT NOT NULL,
  year_month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank_transfer', 'mobile_money')),
  reference_number TEXT,
  months_count INTEGER NOT NULL DEFAULT 1,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  rejection_reason TEXT,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User interface preferences (language selection)
CREATE TABLE IF NOT EXISTS user_preferences (
  telegram_id TEXT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT 'am' CHECK(language IN ('am', 'en')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance and Integrity Indexes
CREATE INDEX IF NOT EXISTS idx_members_telegram_id ON members(telegram_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_registration_requests_tg ON registration_requests(telegram_id);
CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_member ON payment_submissions(member_id);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_status ON payment_submissions(status);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_month ON payment_submissions(year_month);
CREATE INDEX IF NOT EXISTS idx_obligations_lookup ON obligations(member_id, year_month);
CREATE INDEX IF NOT EXISTS idx_obligations_status ON obligations(status);
CREATE INDEX IF NOT EXISTS idx_obligations_month ON obligations(year_month);
CREATE INDEX IF NOT EXISTS idx_payments_obligation ON payments(obligation_id);
CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_tx_id ON payments(tx_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_telegram_id);
CREATE INDEX IF NOT EXISTS idx_reminder_log_lookup ON reminder_log(member_id, year_month, sent_at);
`;

module.exports = {
  SCHEMA_SQL,
};

