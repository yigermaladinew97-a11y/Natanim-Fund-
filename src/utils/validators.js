/**
 * Input validation and sanitization utilities
 */

function isValidTelegramId(id) {
  if (!id) return false;
  const str = String(id).trim();
  // Telegram user IDs are positive integers up to ~64-bit integer
  return /^\d{5,15}$/.test(str);
}

function isValidYearMonth(str) {
  if (!str || typeof str !== 'string') return false;
  const match = str.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  return year >= 2020 && year <= 2099;
}

function isValidPaymentMethod(method) {
  return ['cash', 'bank_transfer', 'mobile_money'].includes(method);
}

function sanitizeText(str, maxLength = 255) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove control chars
    .trim()
    .slice(0, maxLength);
}

module.exports = {
  isValidTelegramId,
  isValidYearMonth,
  isValidPaymentMethod,
  sanitizeText,
};

