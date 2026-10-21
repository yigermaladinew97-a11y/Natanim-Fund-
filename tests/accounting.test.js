const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { registerMember } = require('../src/services/memberService');
const {
  recordPayment,
  reversePayment,
  getMemberObligation,
  getMemberOutstandingTotal,
  setStandardAmountCents,
  getStandardAmountCents,
} = require('../src/services/accounting');

const TEST_DB_PATH = path.join(__dirname, 'test_accounting.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

test('Accounting & Member Service Unit Tests', async (t) => {
  cleanup();
  initDatabase(TEST_DB_PATH);

  let member1 = null;
  let member2 = null;

  await t.test('1. Register member creates member and default obligation', () => {
    member1 = registerMember({
      telegramId: '100000001',
      fullName: 'Abebe Bikila',
      phone: '+251911000001',
      actorTelegramId: '999999999',
    });

    assert.ok(member1.id);
    assert.strictEqual(member1.full_name, 'Abebe Bikila');
    assert.strictEqual(member1.status, 'active');

    // Should create obligation for current month
    const currentMonth = new Date().toISOString().slice(0, 7);
    const obl = getMemberObligation(member1.id, currentMonth);
    assert.ok(obl);
    assert.strictEqual(obl.status, 'UNPAID');
    assert.strictEqual(obl.amount_due_cents, 50000); // 500.00 ETB
    assert.strictEqual(obl.amount_paid_cents, 0);
  });

  await t.test('2. Duplicate registration of active member is rejected', () => {
    assert.throws(() => {
      registerMember({
        telegramId: '100000001',
        fullName: 'Abebe Duplicate',
        actorTelegramId: '999999999',
      });
    }, /already registered and active/);
  });

  await t.test('3. Partial payment updates obligation to PARTIALLY_PAID', () => {
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Pay 200.00 ETB (20000 cents) out of 500.00 ETB
    const res = recordPayment({
      memberId: member1.id,
      yearMonth: currentMonth,
      amountCents: 20000,
      paymentMethod: 'mobile_money',
      referenceNumber: 'MM12345',
      notes: 'First partial payment',
      recordedBy: '999999999',
    });

    assert.ok(res.payment.tx_id.startsWith('TX-'));
    assert.strictEqual(res.payment.amount_cents, 20000);
    assert.strictEqual(res.obligation.amount_paid_cents, 20000);
    assert.strictEqual(res.obligation.status, 'PARTIALLY_PAID');

    const outstanding = getMemberOutstandingTotal(member1.id);
    assert.strictEqual(outstanding, 30000); // 300.00 ETB remaining
  });

  await t.test('4. Second partial payment completes obligation to FULLY_PAID', () => {
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Pay remaining 300.00 ETB (30000 cents)
    const res = recordPayment({
      memberId: member1.id,
      yearMonth: currentMonth,
      amountCents: 30000,
      paymentMethod: 'bank_transfer',
      referenceNumber: 'CBE-9876',
      notes: 'Final installment',
      recordedBy: '999999999',
    });

    assert.strictEqual(res.obligation.amount_paid_cents, 50000);
    assert.strictEqual(res.obligation.status, 'FULLY_PAID');

    const outstanding = getMemberOutstandingTotal(member1.id);
    assert.strictEqual(outstanding, 0);
  });

  await t.test('5. Payment reversal restores balance and preserves history', () => {
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Register a second member to test reversal
    member2 = registerMember({
      telegramId: '100000002',
      fullName: 'Sara Tesfaye',
      actorTelegramId: '999999999',
    });

    const paymentRes = recordPayment({
      memberId: member2.id,
      yearMonth: currentMonth,
      amountCents: 50000,
      paymentMethod: 'cash',
      recordedBy: '999999999',
    });

    assert.strictEqual(paymentRes.obligation.status, 'FULLY_PAID');

    // Now reverse this payment due to bank bounce or error
    const revRes = reversePayment({
      txId: paymentRes.payment.tx_id,
      reason: 'Check bounced or entered by error',
      reversedBy: '999999999',
    });

    assert.strictEqual(revRes.payment.is_reversed, 1);
    assert.strictEqual(revRes.payment.reversal_reason, 'Check bounced or entered by error');
    assert.strictEqual(revRes.obligation.amount_paid_cents, 0);
    assert.ok(['UNPAID', 'OVERDUE'].includes(revRes.obligation.status));

    const outstanding = getMemberOutstandingTotal(member2.id);
    assert.strictEqual(outstanding, 50000);

    // Cannot reverse twice
    assert.throws(() => {
      reversePayment({
        txId: paymentRes.payment.tx_id,
        reason: 'Duplicate reversal attempt',
        reversedBy: '999999999',
      });
    }, /already reversed/);
  });

  await t.test('6. Changing standard amount does not affect existing historical obligations', () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const existingObl = getMemberObligation(member1.id, currentMonth);
    const originalDue = existingObl.amount_due_cents;

    // Admin updates future standard amount to 750.00 ETB
    setStandardAmountCents(75000, '999999999');
    assert.strictEqual(getStandardAmountCents(), 75000);

    // Existing obligation for current month must remain unaffected
    const checkObl = getMemberObligation(member1.id, currentMonth);
    assert.strictEqual(checkObl.amount_due_cents, originalDue);
  });

  cleanup();
});
