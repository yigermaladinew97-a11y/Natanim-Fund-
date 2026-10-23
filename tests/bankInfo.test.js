const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const {
  getBankInfo,
  getCbeAccountNumber,
  getCbeAccountName,
  setCbeAccountDetails,
  DEFAULT_CBE_ACCOUNT_NUMBER,
  DEFAULT_CBE_ACCOUNT_NAME,
} = require('../src/services/accounting');

test('Church Bank Accounts & Info Management Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_bank_info.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  };

  await t.test('1. Default CBE account number and name are returned when not configured', () => {
    assert.strictEqual(getCbeAccountNumber(), DEFAULT_CBE_ACCOUNT_NUMBER);
    assert.strictEqual(getCbeAccountName(), DEFAULT_CBE_ACCOUNT_NAME);

    const info = getBankInfo();
    assert.ok(info.includes('Commercial Bank of Ethiopia'));
    assert.ok(info.includes(DEFAULT_CBE_ACCOUNT_NUMBER));
    assert.ok(info.includes(DEFAULT_CBE_ACCOUNT_NAME));
    assert.strictEqual(info.includes('Telebirr'), false);
    assert.strictEqual(info.includes('Awash'), false);
  });

  await t.test('2. Admin can update both CBE account number and account name', () => {
    const updated = setCbeAccountDetails({
      accountNumber: '1000999888777',
      accountName: 'St. George Church Fund / የቅዱስ ጊዮርጊስ ፈንድ',
      actorTelegramId: '999000111',
    });

    assert.strictEqual(updated.accountNumber, '1000999888777');
    assert.strictEqual(updated.accountName, 'St. George Church Fund / የቅዱስ ጊዮርጊስ ፈንድ');

    assert.strictEqual(getCbeAccountNumber(), '1000999888777');
    assert.strictEqual(getCbeAccountName(), 'St. George Church Fund / የቅዱስ ጊዮርጊስ ፈንድ');

    const info = getBankInfo();
    assert.ok(info.includes('1000999888777'));
    assert.ok(info.includes('St. George Church Fund / የቅዱስ ጊዮርጊስ ፈንድ'));

    // Check audit log for both settings
    const numLog = db.prepare("SELECT * FROM audit_log WHERE entity_id = 'cbe_account_number'").get();
    assert.ok(numLog);
    assert.strictEqual(numLog.action, 'UPDATE_SETTING');

    const nameLog = db.prepare("SELECT * FROM audit_log WHERE entity_id = 'cbe_account_name'").get();
    assert.ok(nameLog);
    assert.strictEqual(nameLog.action, 'UPDATE_SETTING');
  });

  await t.test('3. Setting invalid account number or name throws error', () => {
    // Too short account number
    assert.throws(
      () => setCbeAccountDetails({ accountNumber: '12345', accountName: 'Valid Name', actorTelegramId: '1' }),
      /at least 8 digits/
    );

    // Too short account name
    assert.throws(
      () => setCbeAccountDetails({ accountNumber: '1000123456789', accountName: 'A', actorTelegramId: '1' }),
      /at least 2 characters/
    );
  });

  cleanup();
});
