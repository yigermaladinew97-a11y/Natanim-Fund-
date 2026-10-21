const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase, getDatabase } = require('../src/db');
const { registerMember } = require('../src/services/memberService');
const { recordPayment, getMemberObligation, getStandardAmountCents } = require('../src/services/accounting');

const PERSIST_DB_PATH = path.join(__dirname, 'test_persistence.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(PERSIST_DB_PATH)) fs.unlinkSync(PERSIST_DB_PATH);
  if (fs.existsSync(`${PERSIST_DB_PATH}-wal`)) fs.unlinkSync(`${PERSIST_DB_PATH}-wal`);
  if (fs.existsSync(`${PERSIST_DB_PATH}-shm`)) fs.unlinkSync(`${PERSIST_DB_PATH}-shm`);
}

test('Database Persistence Across Application Restarts', async (t) => {
  cleanup();

  let memberId = null;
  let paymentTxId = null;
  const month = '2026-10';

  await t.test('1. Session 1: Create member, record payment, and close database', () => {
    initDatabase(PERSIST_DB_PATH);

    const member = registerMember({
      telegramId: '987654321',
      fullName: 'Teshome Wolde',
      phone: '+251912345678',
      actorTelegramId: '1000',
    });
    memberId = member.id;

    const payResult = recordPayment({
      memberId: member.id,
      yearMonth: month,
      amountCents: 50000,
      paymentMethod: 'bank_transfer',
      referenceNumber: 'REF-RESTART-01',
      notes: 'Testing DB persistence',
      recordedBy: '1000',
    });
    paymentTxId = payResult.payment.tx_id;

    assert.ok(memberId);
    assert.ok(paymentTxId);

    // Close the database to simulate process exit / bot restart
    closeDatabase();
  });

  await t.test('2. Session 2: Reopen database and verify all data persisted intact', () => {
    // Re-initialize database using the same on-disk file
    initDatabase(PERSIST_DB_PATH);
    const db = getDatabase();

    // Verify member exists
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
    assert.ok(member);
    assert.strictEqual(member.full_name, 'Teshome Wolde');
    assert.strictEqual(member.telegram_id, '987654321');

    // Verify obligation persisted
    const obl = getMemberObligation(memberId, month);
    assert.ok(obl);
    assert.strictEqual(obl.status, 'FULLY_PAID');
    assert.strictEqual(obl.amount_paid_cents, 50000);

    // Verify payment persisted
    const payment = db.prepare('SELECT * FROM payments WHERE tx_id = ?').get(paymentTxId);
    assert.ok(payment);
    assert.strictEqual(payment.amount_cents, 50000);
    assert.strictEqual(payment.payment_method, 'bank_transfer');
    assert.strictEqual(payment.reference_number, 'REF-RESTART-01');

    closeDatabase();
  });

  cleanup();
});

