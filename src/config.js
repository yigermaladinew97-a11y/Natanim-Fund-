const path = require('node:path');
require('dotenv').config();

function getEnvNumber(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  const num = Number(val);
  if (Number.isNaN(num)) {
    throw new Error(`Invalid numeric environment variable for ${key}: "${val}"`);
  }
  return num;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  botToken: process.env.BOT_TOKEN || '',
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID ? String(process.env.ADMIN_TELEGRAM_ID).trim() : '',
  databasePath: process.env.DATABASE_PATH 
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : path.resolve(process.cwd(), 'data', 'natanim_fund.db'),
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'ETB',
  defaultMonthlyAmountCents: getEnvNumber('DEFAULT_MONTHLY_AMOUNT_CENTS', 5000), // Default 50.00 ETB
  dueDayOfMonth: getEnvNumber('DUE_DAY_OF_MONTH', 30),
  timezone: process.env.TIMEZONE || 'Africa/Addis_Ababa',
  reminderCronSchedule: process.env.REMINDER_CRON_SCHEDULE || '0 9 5 * *',
  reminderCooldownHours: getEnvNumber('REMINDER_COOLDOWN_HOURS', 72),
  staffGroupId: process.env.STAFF_GROUP_ID ? String(process.env.STAFF_GROUP_ID).trim() : '',
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL ? String(process.env.TURSO_DATABASE_URL).trim() : '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN ? String(process.env.TURSO_AUTH_TOKEN).trim() : '',
};

function validateConfig() {
  if (config.isTest) return; // Skip strict token checks in tests

  if (!config.botToken) {
    throw new Error('Missing required environment variable: BOT_TOKEN. Please set it in .env');
  }

  if (!config.adminTelegramId || !/^\d+$/.test(config.adminTelegramId)) {
    throw new Error('ADMIN_TELEGRAM_ID must be a non-empty numeric Telegram user ID.');
  }

  if (config.dueDayOfMonth < 1 || config.dueDayOfMonth > 31) {
    throw new Error('DUE_DAY_OF_MONTH must be between 1 and 31.');
  }

  if (config.defaultMonthlyAmountCents <= 0) {
    throw new Error('DEFAULT_MONTHLY_AMOUNT_CENTS must be greater than 0.');
  }
}

module.exports = {
  config,
  validateConfig,
};

