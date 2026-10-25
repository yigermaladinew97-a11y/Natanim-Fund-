const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const {
  registerMember,
  deactivateMember,
  getAllInactiveMembers,
  getMemberPurgeSummary,
  purgeMemberHistory,
} = require('../src/services/memberService');
const { recordPayment, reversePayment } = require('../src/services/accounting');
const { createPaymentSubmission } = require('../src/services/accounting');

test('Deactivated Member History Purge Unit Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_purge_member.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  };

  await t.test('1. Cannot purge history of an active member', async () => {
    const member = registerMember({
      fullName: 'Active Student',
      phone: '+251911000001',
      telegramId: '111001',
      actorTelegramId: '999999',
    });

    assert.strictEqual(member.status, 'active');

    assert.throws(() => {
      purgeMemberHistory({
        memberId: member.id,
        actorTelegramId: '999999',
        deleteMemberRecord: false,
      });
    }, /must deactivate the member before deleting their history/i);
  });

  await t.test('2. getMemberPurgeSummary accurately aggregates member financial records', async () => {
    // Record payment for member
    const obl = db.prepare('SELECT id FROM obligations WHERE member_id = 1').get();
    recordPayment({
      memberId: 1,
      obligationId: obl.id,
      amountCents: 50000,
      paymentMethod: 'bank_transfer',
      referenceNumber: 'REF-PURGE-1',
      recordedBy: 'ADMIN_TEST',
    });

    // Create a submission
    createPaymentSubmission({
      memberId: 1,
      telegramId: '111001',
      yearMonth: '2026-10',
      amountCents: 50000,
      paymentMethod: 'bank_transfer',
      referenceNumber: 'REF-PURGE-1',
      fileId: 'photo_file_123',
    });

    const summary = getMemberPurgeSummary(1);
    assert.strictEqual(summary.member.id, 1);
    assert.strictEqual(summary.paymentsCount, 1);
    assert.strictEqual(summary.paymentsTotalCents, 50000);
    assert.strictEqual(summary.obligationsCount, 1);
    assert.strictEqual(summary.submissionsCount, 1);
  });

  await t.test('3. Deactivating member updates status and allows history purge (history only)', async () => {
    deactivateMember({
      memberId: 1,
      reason: 'Graduated / Left Fellowship',
      actorTelegramId: '999999',
    });

    const inactiveList = getAllInactiveMembers();
    assert.strictEqual(inactiveList.length, 1);
    assert.strictEqual(inactiveList[0].id, 1);

    const res = purgeMemberHistory({
      memberId: 1,
      actorTelegramId: '999999',
      deleteMemberRecord: false,
    });

    assert.strictEqual(res.deletedPaymentsCount, 1);
    assert.strictEqual(res.deletedPaymentsTotalCents, 50000);
    assert.strictEqual(res.deletedObligationsCount, 1);
    assert.strictEqual(res.deletedSubmissionsCount, 1);
    assert.strictEqual(res.memberRecordDeleted, false);

    // Verify payments, obligations, submissions are gone
    const payments = db.prepare('SELECT COUNT(*) as count FROM payments WHERE member_id = 1').get().count;
    const obligations = db.prepare('SELECT COUNT(*) as count FROM obligations WHERE member_id = 1').get().count;
    const submissions = db.prepare('SELECT COUNT(*) as count FROM payment_submissions WHERE member_id = 1').get().count;
    const memberRow = db.prepare('SELECT * FROM members WHERE id = 1').get();

    assert.strictEqual(payments, 0);
    assert.strictEqual(obligations, 0);
    assert.strictEqual(submissions, 0);
    assert.ok(memberRow);
    assert.strictEqual(memberRow.status, 'inactive');

    // Verify audit log
    const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'PURGE_MEMBER_HISTORY'").get();
    assert.ok(audit);
    assert.strictEqual(audit.entity_id, '1');
    const details = JSON.parse(audit.details_json);
    assert.strictEqual(details.deletedPaymentsCount, 1);
    assert.strictEqual(details.deletedPaymentsTotalCents, 50000);
  });

  await t.test('4. Purge with deleteMemberRecord: true wipes member and all references', async () => {
    const member2 = registerMember({
      fullName: 'Test Dummy Account',
      phone: '+251911000002',
      telegramId: '111002',
      actorTelegramId: '999999',
    });

    deactivateMember({
      memberId: member2.id,
      reason: 'Created for testing only',
      actorTelegramId: '999999',
    });

    const res = purgeMemberHistory({
      memberId: member2.id,
      actorTelegramId: '999999',
      deleteMemberRecord: true,
    });

    assert.strictEqual(res.memberRecordDeleted, true);
    const memberRow = db.prepare('SELECT * FROM members WHERE id = ?').get(member2.id);
    assert.strictEqual(memberRow, undefined);
  });

  await t.test('5. Handles payment reversals cleanly during purge without foreign key errors', async () => {
    const member3 = registerMember({
      fullName: 'Student With Reversal',
      phone: '+251911000003',
      telegramId: '111003',
      actorTelegramId: '999999',
    });

    const obl = db.prepare('SELECT id FROM obligations WHERE member_id = ?').get(member3.id);
    const pmtResult = recordPayment({
      memberId: member3.id,
      obligationId: obl.id,
      amountCents: 20000,
      paymentMethod: 'bank_transfer',
      referenceNumber: 'REF-REV-1',
      recordedBy: 'ADMIN_TEST',
    });

    const payment = pmtResult.payment;

    reversePayment({
      paymentId: payment.id,
      reason: 'Entered wrong bank reference',
      reversedBy: 'ADMIN_TEST',
    });

    deactivateMember({
      memberId: member3.id,
      reason: 'Testing reversal cascade',
      actorTelegramId: '999999',
    });

    const res = purgeMemberHistory({
      memberId: member3.id,
      actorTelegramId: '999999',
      deleteMemberRecord: true,
    });

    assert.ok(res);
    assert.strictEqual(res.memberRecordDeleted, true);
    const reversals = db.prepare('SELECT COUNT(*) as count FROM payment_reversals WHERE tx_id = ?').get(payment.tx_id).count;
    assert.strictEqual(reversals, 0);
  });

  cleanup();
});
