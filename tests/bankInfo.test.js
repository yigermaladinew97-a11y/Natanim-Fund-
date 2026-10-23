const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { getBankInfo, setBankInfo, DEFAULT_BANK_INFO } = require('../src/services/accounting');

test('Church Bank Accounts & Info Management Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_bank_info.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  };

  await t.test('1. Default bank info is returned when not configured (CBE only)', () => {
    const info = getBankInfo();
    assert.strictEqual(info, DEFAULT_BANK_INFO);
    assert.ok(info.includes('Commercial Bank of Ethiopia'));
    assert.ok(info.includes('1000123456789'));
    assert.strictEqual(info.includes('Telebirr'), false);
    assert.strictEqual(info.includes('Awash'), false);
  });

  await t.test('2. Admin can update church bank accounts', () => {
    const customBankInfo =
      '🏦 <b>Updated Church CBE Account</b>\n\n' +
      '• <b>CBE:</b> <code>1000999888777</code>\n' +
      'Account Name: Holy Trinity Church';

    setBankInfo(customBankInfo, '999000111');
    const updated = getBankInfo();
    assert.strictEqual(updated, customBankInfo);
    assert.ok(updated.includes('1000999888777'));

    // Check audit log
    const log = db.prepare("SELECT * FROM audit_log WHERE entity_id = 'bank_info'").get();
    assert.ok(log);
    assert.strictEqual(log.action, 'UPDATE_SETTING');
    assert.strictEqual(log.actor_telegram_id, '999000111');
  });

  await t.test('3. Setting empty or too short bank info throws error', () => {
    assert.throws(() => setBankInfo('', '999000111'), /at least 10 characters/);
    assert.throws(() => setBankInfo('short', '999000111'), /at least 10 characters/);
  });

  cleanup();
});
