const test = require('node:test');
const assert = require('node:assert');
const {
  isValidTelegramId,
  isValidYearMonth,
  isValidPaymentMethod,
  sanitizeText,
} = require('../src/utils/validators');
const { parseMoneyToCents, formatMoney } = require('../src/utils/formatters');

test('Validation and Formatter Utilities Tests', async (t) => {
  await t.test('1. Telegram ID validation', () => {
    assert.strictEqual(isValidTelegramId('123456789'), true);
    assert.strictEqual(isValidTelegramId(123456789), true);
    assert.strictEqual(isValidTelegramId('abc12345'), false);
    assert.strictEqual(isValidTelegramId('-12345'), false);
    assert.strictEqual(isValidTelegramId(''), false);
    assert.strictEqual(isValidTelegramId(null), false);
    assert.strictEqual(isValidTelegramId('12'), false); // Too short
  });

  await t.test('2. Year-Month (YYYY-MM) validation', () => {
    assert.strictEqual(isValidYearMonth('2026-10'), true);
    assert.strictEqual(isValidYearMonth('2025-01'), true);
    assert.strictEqual(isValidYearMonth('2026-13'), false); // Invalid month
    assert.strictEqual(isValidYearMonth('2026-00'), false);
    assert.strictEqual(isValidYearMonth('2026/10'), false);
    assert.strictEqual(isValidYearMonth('invalid'), false);
  });

  await t.test('3. Money parsing to integer cents', () => {
    assert.strictEqual(parseMoneyToCents('500'), 50000);
    assert.strictEqual(parseMoneyToCents('500.50'), 50050);
    assert.strictEqual(parseMoneyToCents('1,000.00'), 100000);
    assert.strictEqual(parseMoneyToCents(500), 50000);
    assert.strictEqual(parseMoneyToCents('-50'), null); // Negative rejected
    assert.strictEqual(parseMoneyToCents('0'), null); // Zero rejected
    assert.strictEqual(parseMoneyToCents('abc'), null); // Non-numeric rejected
  });

  await t.test('4. Currency formatting', () => {
    assert.strictEqual(formatMoney(50000, 'ETB'), '500.00 ETB');
    assert.strictEqual(formatMoney(125050, 'ETB'), '1,250.50 ETB');
    assert.strictEqual(formatMoney(0, 'USD'), '0.00 USD');
  });

  await t.test('5. Payment method validation', () => {
    assert.strictEqual(isValidPaymentMethod('cash'), true);
    assert.strictEqual(isValidPaymentMethod('bank_transfer'), true);
    assert.strictEqual(isValidPaymentMethod('mobile_money'), true);
    assert.strictEqual(isValidPaymentMethod('crypto'), false);
    assert.strictEqual(isValidPaymentMethod(''), false);
  });

  await t.test('6. Text sanitization removes control characters', () => {
    const dirty = 'Hello\x00World\x07!\r\n';
    const clean = sanitizeText(dirty);
    assert.strictEqual(clean.includes('\x00'), false);
    assert.strictEqual(clean.includes('\x07'), false);
  });
});

