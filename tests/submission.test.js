const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { registerMember } = require('../src/services/memberService');
const {
  createPaymentSubmission,
  getPendingPaymentSubmissions,
  getPaymentSubmissionById,
  approvePaymentSubmission,
  rejectPaymentSubmission,
  getOrCreateObligation,
} = require('../src/services/accounting');
const { assignRole, getStaffTelegramIds } = require('../src/services/permissions');

const TEST_DB_PATH = path.join(__dirname, 'test_submission.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

test('Payment Screenshot Submission & Staff Verification Workflow Tests', async (t) => {
  cleanup();
  initDatabase(TEST_DB_PATH);

  const adminId = '900000001';
  const treasurerId = '900000002';
  assignRole(adminId, 'admin', 'SYSTEM');
  assignRole(treasurerId, 'treasurer', 'SYSTEM');

  const member = registerMember({
    telegramId: '300000001',
    fullName: 'Derartu Tulu',
    phone: '+251911998877',
    actorTelegramId: adminId,
  });

  await t.test('1. Member creates a PENDING payment submission with receipt file_id', () => {
    const sub = createPaymentSubmission({
      memberId: member.id,
      telegramId: '300000001',
      yearMonth: '2026-10',
      amountCents: 50000, // 500.00 ETB
      paymentMethod: 'mobile_money',
      referenceNumber: 'CBE-12345678',
      fileId: 'AgACAgIAAxkBAAIFZ2...sample_photo_file_id',
      fileUniqueId: 'AQADsample_unique',
      caption: 'CBE Birr transfer confirmation',
    });

    assert.ok(sub);
    assert.strictEqual(sub.member_id, member.id);
    assert.strictEqual(sub.full_name, 'Derartu Tulu');
    assert.strictEqual(sub.year_month, '2026-10');
    assert.strictEqual(sub.amount_cents, 50000);
    assert.strictEqual(sub.payment_method, 'mobile_money');
    assert.strictEqual(sub.reference_number, 'CBE-12345678');
    assert.strictEqual(sub.file_id, 'AgACAgIAAxkBAAIFZ2...sample_photo_file_id');
    assert.strictEqual(sub.status, 'PENDING');
  });

  await t.test('2. Staff queries pending payment receipts', () => {
    const pendingList = getPendingPaymentSubmissions();
    assert.strictEqual(pendingList.length, 1);
    assert.strictEqual(pendingList[0].member_id, member.id);
    assert.strictEqual(pendingList[0].full_name, 'Derartu Tulu');

    const singleSub = getPaymentSubmissionById(pendingList[0].id);
    assert.ok(singleSub);
    assert.strictEqual(singleSub.status, 'PENDING');
  });

  await t.test('3. Staff approves payment submission -> records payment & updates obligation', () => {
    const pending = getPendingPaymentSubmissions()[0];
    const { payment, submission } = approvePaymentSubmission(pending.id, treasurerId);

    assert.ok(payment);
    assert.ok(payment.tx_id.startsWith('TX-'));
    assert.strictEqual(payment.amount_cents, 50000);
    assert.strictEqual(payment.member_id, member.id);

    assert.strictEqual(submission.status, 'APPROVED');
    assert.strictEqual(submission.reviewed_by, treasurerId);
    assert.strictEqual(submission.payment_id, payment.id);

    // Verify obligation is updated to FULLY_PAID
    const obl = getOrCreateObligation(member.id, '2026-10');
    assert.strictEqual(obl.status, 'FULLY_PAID');
    assert.strictEqual(obl.amount_paid_cents, 50000);
  });

  await t.test('4. Re-approving an already approved submission throws an error', () => {
    assert.throws(() => {
      approvePaymentSubmission(1, adminId);
    }, /already been approved/i);
  });

  await t.test('5. Rejecting a payment submission marks it REJECTED without recording payment', () => {
    const sub2 = createPaymentSubmission({
      memberId: member.id,
      telegramId: '300000001',
      yearMonth: '2026-11',
      amountCents: 50000,
      paymentMethod: 'bank_transfer',
      referenceNumber: 'INVALID_REF',
      fileId: 'AgACAgIAAxkBAAIF...rejected_photo',
      fileUniqueId: 'AQAD_rejected',
      caption: 'Bank slip',
    });

    assert.strictEqual(sub2.status, 'PENDING');

    const rejected = rejectPaymentSubmission(sub2.id, adminId, 'Slip blurred and unreadable');
    assert.strictEqual(rejected.status, 'REJECTED');
    assert.strictEqual(rejected.reviewed_by, adminId);
    assert.strictEqual(rejected.rejection_reason, 'Slip blurred and unreadable');
    assert.strictEqual(rejected.payment_id, null);

    // Obligation for 2026-11 remains UNPAID
    const oblNov = getOrCreateObligation(member.id, '2026-11');
    assert.strictEqual(oblNov.status, 'UNPAID');
    assert.strictEqual(oblNov.amount_paid_cents, 0);
  });

  await t.test('6. Staff notification recipients include both admin and treasurer', () => {
    const staffIds = getStaffTelegramIds();
    assert.ok(staffIds.includes(adminId));
    assert.ok(staffIds.includes(treasurerId));
  });

  await t.test('7. Multi-month payment approval covers selected consecutive months', () => {
    const multiSub = createPaymentSubmission({
      memberId: member.id,
      telegramId: '300000001',
      yearMonth: '2026-12',
      amountCents: 20000, // 200 ETB = 4 months at 50 ETB/mo
      paymentMethod: 'bank_transfer',
      referenceNumber: 'MULTI_MONTH_REF_123',
      monthsCount: 4,
      fileId: 'photo_multi_month',
      fileUniqueId: 'unique_multi_month',
      caption: 'Paid for 4 months',
    });

    assert.strictEqual(multiSub.months_count, 4);

    // When staff approves without passing explicit monthsCount, it respects submission's months_count (4)
    const approved = approvePaymentSubmission(multiSub.id, adminId);
    assert.strictEqual(approved.submission.status, 'APPROVED');
    assert.strictEqual(approved.monthsCovered.length, 4);
    assert.deepStrictEqual(approved.monthsCovered, ['2026-12', '2027-01', '2027-02', '2027-03']);

    // Check all 4 obligations are FULLY_PAID
    for (const m of ['2026-12', '2027-01', '2027-02', '2027-03']) {
      const obl = getOrCreateObligation(member.id, m);
      assert.strictEqual(obl.status, 'FULLY_PAID');
      assert.strictEqual(obl.amount_paid_cents, 5000);
    }
  });

  cleanup();
});
