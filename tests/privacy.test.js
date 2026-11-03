process.env.DEFAULT_MONTHLY_AMOUNT_CENTS = '50000';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { registerMember } = require('../src/services/memberService');
const { recordPayment, listMemberPayments, listMemberObligations, getMemberOutstandingTotal } = require('../src/services/accounting');
const { getCurrentYearMonth } = require('../src/utils/formatters');

const PRIVACY_DB_PATH = path.join(__dirname, 'test_privacy.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(PRIVACY_DB_PATH)) fs.unlinkSync(PRIVACY_DB_PATH);
  if (fs.existsSync(`${PRIVACY_DB_PATH}-wal`)) fs.unlinkSync(`${PRIVACY_DB_PATH}-wal`);
  if (fs.existsSync(`${PRIVACY_DB_PATH}-shm`)) fs.unlinkSync(`${PRIVACY_DB_PATH}-shm`);
}

test('Cross-Member Privacy & Data Isolation Tests', async (t) => {
  cleanup();
  initDatabase(PRIVACY_DB_PATH);

  const month = getCurrentYearMonth();

  // Create Alice and Bob
  const alice = registerMember({
    telegramId: '100000010',
    fullName: 'Alice Walker',
    actorTelegramId: '1000',
  });

  const bob = registerMember({
    telegramId: '100000020',
    fullName: 'Bob Smith',
    actorTelegramId: '1000',
  });

  // Record payment for Alice
  recordPayment({
    memberId: alice.id,
    yearMonth: month,
    amountCents: 50000,
    paymentMethod: 'cash',
    referenceNumber: 'ALICE-CASH-01',
    recordedBy: '1000',
  });

  // Record partial payment for Bob
  recordPayment({
    memberId: bob.id,
    yearMonth: month,
    amountCents: 15000,
    paymentMethod: 'mobile_money',
    referenceNumber: 'BOB-CBE-01',
    recordedBy: '1000',
  });

  await t.test('1. Member payment queries are strictly isolated by memberId', () => {
    const alicePayments = listMemberPayments(alice.id);
    const bobPayments = listMemberPayments(bob.id);

    assert.strictEqual(alicePayments.length, 1);
    assert.strictEqual(alicePayments[0].member_id, alice.id);
    assert.strictEqual(alicePayments[0].reference_number, 'ALICE-CASH-01');

    assert.strictEqual(bobPayments.length, 1);
    assert.strictEqual(bobPayments[0].member_id, bob.id);
    assert.strictEqual(bobPayments[0].reference_number, 'BOB-CBE-01');

    // Alice payments must not contain Bob's transactions
    assert.strictEqual(alicePayments.some(p => p.member_id === bob.id), false);
    assert.strictEqual(bobPayments.some(p => p.member_id === alice.id), false);
  });

  await t.test('2. Member obligations and balances are strictly isolated', () => {
    const aliceObl = listMemberObligations(alice.id);
    const bobObl = listMemberObligations(bob.id);

    assert.strictEqual(aliceObl[0].status, 'FULLY_PAID');
    assert.strictEqual(bobObl[0].status, 'PARTIALLY_PAID');

    assert.strictEqual(getMemberOutstandingTotal(alice.id), 0);
    assert.strictEqual(getMemberOutstandingTotal(bob.id), 35000);
  });

  cleanup();
});

