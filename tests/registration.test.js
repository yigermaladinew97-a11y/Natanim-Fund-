const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const {
  registerMember,
  createRegistrationRequest,
  getPendingRegistrationRequests,
  getPendingRequestByTelegramId,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  getMemberByTelegramId,
} = require('../src/services/memberService');
const { getAdminTelegramIds, assignRole } = require('../src/services/permissions');
const { getOrCreateObligation } = require('../src/services/accounting');
const { getCurrentYearMonth } = require('../src/utils/formatters');

const TEST_DB_PATH = path.join(__dirname, 'test_registration.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

test('Self-Registration & Admin Approval Workflow Tests', async (t) => {
  cleanup();
  initDatabase(TEST_DB_PATH);

  const adminId = '999888777';
  assignRole(adminId, 'admin', 'SYSTEM');

  await t.test('1. Submitting a new self-registration request creates PENDING record', () => {
    const req = createRegistrationRequest({
      telegramId: '200000001',
      username: 'haile_g',
      fullName: 'Haile Gebreselassie',
      phone: '+251911223344',
    });

    assert.ok(req);
    assert.strictEqual(req.telegram_id, '200000001');
    assert.strictEqual(req.full_name, 'Haile Gebreselassie');
    assert.strictEqual(req.phone, '+251911223344');
    assert.strictEqual(req.username, 'haile_g');
    assert.strictEqual(req.status, 'PENDING');
  });

  await t.test('2. Querying pending requests returns active submissions', () => {
    const pendingList = getPendingRegistrationRequests();
    assert.strictEqual(pendingList.length, 1);
    assert.strictEqual(pendingList[0].telegram_id, '200000001');

    const singlePending = getPendingRequestByTelegramId('200000001');
    assert.ok(singlePending);
    assert.strictEqual(singlePending.full_name, 'Haile Gebreselassie');
  });

  await t.test('3. Submitting duplicate pending request is prevented', () => {
    assert.throws(() => {
      createRegistrationRequest({
        telegramId: '200000001',
        fullName: 'Haile G',
        phone: '+251911223344',
      });
    }, /pending registration request under review/i);
  });

  await t.test('4. Admin approving request creates active member & obligation', () => {
    const pending = getPendingRequestByTelegramId('200000001');
    const { member, request } = approveRegistrationRequest(pending.id, adminId);

    assert.ok(member);
    assert.strictEqual(member.full_name, 'Haile Gebreselassie');
    assert.strictEqual(member.status, 'active');
    assert.strictEqual(request.status, 'APPROVED');
    assert.strictEqual(request.reviewed_by, adminId);

    // Verify member exists in database
    const dbMember = getMemberByTelegramId('200000001');
    assert.ok(dbMember);
    assert.strictEqual(dbMember.id, member.id);

    // Verify current month obligation was initialized
    const curMonth = getCurrentYearMonth();
    const obl = getOrCreateObligation(member.id, curMonth);
    assert.ok(obl);
    assert.strictEqual(obl.status, 'UNPAID');
    assert.ok(obl.amount_due_cents > 0);
  });

  await t.test('5. Re-approving an already approved request is rejected', () => {
    const pending = getPendingRequestByTelegramId('200000001');
    assert.strictEqual(pending, undefined); // No longer pending

    const reqList = getPendingRegistrationRequests();
    assert.strictEqual(reqList.length, 0);

    assert.throws(() => {
      approveRegistrationRequest(1, adminId);
    }, /already been approved/i);
  });

  await t.test('6. Already registered member cannot create registration request', () => {
    assert.throws(() => {
      createRegistrationRequest({
        telegramId: '200000001',
        fullName: 'Haile Gebreselassie',
        phone: '+251911223344',
      });
    }, /already registered as an active member/i);
  });

  await t.test('7. Admin rejecting request sets status to REJECTED', () => {
    const req2 = createRegistrationRequest({
      telegramId: '200000002',
      username: 'kenenisa_b',
      fullName: 'Kenenisa Bekele',
      phone: '+251922334455',
    });

    assert.strictEqual(req2.status, 'PENDING');

    const rejected = rejectRegistrationRequest(req2.id, adminId, 'Could not verify church attendance');
    assert.strictEqual(rejected.status, 'REJECTED');
    assert.strictEqual(rejected.rejection_reason, 'Could not verify church attendance');
    assert.strictEqual(rejected.reviewed_by, adminId);

    // Member was NOT created
    const notMember = getMemberByTelegramId('200000002');
    assert.strictEqual(notMember, undefined);
  });

  await t.test('8. Admin notification recipient lookup includes assigned admins', () => {
    const adminIds = getAdminTelegramIds();
    assert.ok(adminIds.includes(adminId));
  });

  cleanup();
});
