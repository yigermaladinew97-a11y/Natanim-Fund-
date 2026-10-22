process.env.DEFAULT_MONTHLY_AMOUNT_CENTS = '50000';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { registerMember } = require('../src/services/memberService');
const { recordPayment, reversePayment } = require('../src/services/accounting');
const { getMonthlyReportSummary, exportMonthlyReportCsv } = require('../src/services/reporting');
const { sanitizeForCsv } = require('../src/utils/csv');

const TEST_DB_PATH = path.join(__dirname, 'test_reporting.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

test('Reporting and CSV Export Tests', async (t) => {
  cleanup();
  initDatabase(TEST_DB_PATH);

  const month = '2026-10';

  // 1. Setup 3 members
  const m1 = registerMember({ telegramId: '200000001', fullName: 'Member One', actorTelegramId: '999999999' });
  const m2 = registerMember({ telegramId: '200000002', fullName: 'Member Two', actorTelegramId: '999999999' });
  const m3 = registerMember({ telegramId: '200000003', fullName: 'Member Three', actorTelegramId: '999999999' });

  // m1 pays 500.00 ETB (fully paid) via bank transfer
  recordPayment({
    memberId: m1.id,
    yearMonth: month,
    amountCents: 50000,
    paymentMethod: 'bank_transfer',
    recordedBy: '1',
  });

  // m2 pays 200.00 ETB (partially paid) via cash
  recordPayment({
    memberId: m2.id,
    yearMonth: month,
    amountCents: 20000,
    paymentMethod: 'cash',
    recordedBy: '1',
  });

  // m3 pays 500.00 ETB via mobile money, but this payment gets reversed!
  const p3 = recordPayment({
    memberId: m3.id,
    yearMonth: month,
    amountCents: 50000,
    paymentMethod: 'mobile_money',
    recordedBy: '1',
  });

  reversePayment({
    txId: p3.payment.tx_id,
    reason: 'Mistakenly recorded for wrong account',
    reversedBy: '1',
  });

  await t.test('1. Monthly report calculates correct financial sums', () => {
    const summary = getMonthlyReportSummary(month);

    assert.strictEqual(summary.activeMembersCount, 3);
    assert.strictEqual(summary.fullyPaidCount, 1);
    assert.strictEqual(summary.partiallyPaidCount, 1);
    assert.strictEqual(summary.unpaidCount, 1); // m3 is unpaid after reversal

    // Expected: 3 members * 500.00 ETB = 1500.00 ETB (150000 cents)
    assert.strictEqual(summary.totalExpectedCents, 150000);

    // Collected: 50000 (m1) + 20000 (m2) = 70000 cents (p3 was reversed and must NOT count)
    assert.strictEqual(summary.totalCollectedCents, 70000);

    // Outstanding: 150000 - 70000 = 80000 cents
    assert.strictEqual(summary.totalOutstandingCents, 80000);

    // Reversals
    assert.strictEqual(summary.reversals.count, 1);
    assert.strictEqual(summary.reversals.totalCents, 50000);
  });

  await t.test('2. CSV export generates valid RFC-4180 format with formula injection protection', () => {
    // Test formula injection sanitizer
    assert.strictEqual(sanitizeForCsv('=SUM(A1:A10)'), "'=SUM(A1:A10)");
    assert.strictEqual(sanitizeForCsv('+12345'), "'+12345");
    assert.strictEqual(sanitizeForCsv('-cmd|...'), "'-cmd|...");
    assert.strictEqual(sanitizeForCsv('@something'), "'@something");
    assert.strictEqual(sanitizeForCsv('Normal Text'), 'Normal Text');

    // Test CSV buffer generation
    const csvBuffer = exportMonthlyReportCsv(month);
    assert.ok(csvBuffer instanceof Buffer);
    const csvString = csvBuffer.toString('utf-8');

    assert.ok(csvString.includes('Member ID,Full Name'));
    assert.ok(csvString.includes('Member One'));
    assert.ok(csvString.includes('Member Two'));
    assert.ok(csvString.includes('Member Three'));
    assert.ok(csvString.includes('FULLY_PAID'));
    assert.ok(csvString.includes('PARTIALLY_PAID'));
    assert.ok(csvString.includes('OVERDUE') || csvString.includes('UNPAID'));
  });

  cleanup();
});
