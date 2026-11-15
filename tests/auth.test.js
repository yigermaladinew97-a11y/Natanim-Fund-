const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const {
  getUserRole,
  isAdmin,
  isTreasurer,
  isStaff,
  assignRole,
  revokeRole,
  listRoles,
} = require('../src/services/permissions');
const { registerMember } = require('../src/services/memberService');
const { requireAdmin, requireStaff, requireActiveMember } = require('../src/middleware/auth');

const TEST_DB_PATH = path.join(__dirname, 'test_auth.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

test('Authentication, Roles & Authorization Tests', async (t) => {
  cleanup();
  initDatabase(TEST_DB_PATH);

  const adminId = '111111111';
  const treasurerId = '222222222';
  const regularMemberId = '333333333';
  const outsiderId = '444444444';

  await t.test('1. Assign and verify admin & treasurer roles', () => {
    assignRole(adminId, 'admin', 'SYSTEM_SETUP');
    assignRole(treasurerId, 'treasurer', adminId);

    assert.strictEqual(getUserRole(adminId), 'admin');
    assert.strictEqual(isAdmin(adminId), true);
    assert.strictEqual(isStaff(adminId), true);
    assert.strictEqual(isTreasurer(adminId), false);

    assert.strictEqual(getUserRole(treasurerId), 'treasurer');
    assert.strictEqual(isTreasurer(treasurerId), true);
    assert.strictEqual(isStaff(treasurerId), true);
    assert.strictEqual(isAdmin(treasurerId), false);

    assert.strictEqual(getUserRole(outsiderId), null);
    assert.strictEqual(isStaff(outsiderId), false);
  });

  await t.test('2. Role-based middleware enforcement', () => {
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    // Test requireAdmin for non-admin
    nextCalled = false;
    let repliedMsg = '';
    const nonAdminCtx = {
      state: { isAdmin: false, isStaff: true },
      reply: (msg) => { repliedMsg = msg; },
    };
    requireAdmin(nonAdminCtx, next);
    assert.strictEqual(nextCalled, false);
    assert.ok(repliedMsg.includes('Access Denied'));

    // Test requireAdmin for admin
    nextCalled = false;
    const adminCtx = {
      state: { isAdmin: true, isStaff: true },
      reply: () => {},
    };
    requireAdmin(adminCtx, next);
    assert.strictEqual(nextCalled, true);

    // Test requireStaff for treasurer
    nextCalled = false;
    const treasurerCtx = {
      state: { isStaff: true, isTreasurer: true },
      reply: () => {},
    };
    requireStaff(treasurerCtx, next);
    assert.strictEqual(nextCalled, true);

    // Test requireStaff for outsider
    nextCalled = false;
    repliedMsg = '';
    const outsiderCtx = {
      state: { isStaff: false, isAdmin: false },
      reply: (msg) => { repliedMsg = msg; },
    };
    requireStaff(outsiderCtx, next);
    assert.strictEqual(nextCalled, false);
    assert.ok(repliedMsg.includes('Access Denied'));
  });

  await t.test('3. Registered active member status enforcement', () => {
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    registerMember({
      telegramId: regularMemberId,
      fullName: 'Yohannes Girma',
      actorTelegramId: adminId,
    });

    const activeMemberCtx = {
      state: { isActiveMember: true, isStaff: false },
      reply: () => {},
    };
    requireActiveMember(activeMemberCtx, next);
    assert.strictEqual(nextCalled, true);

    // Unregistered user should be blocked
    nextCalled = false;
    let repliedMsg = '';
    const unregisteredCtx = {
      state: { isActiveMember: false, isStaff: false },
      reply: (msg) => { repliedMsg = msg; },
    };
    requireActiveMember(unregisteredCtx, next);
    assert.strictEqual(nextCalled, false);
    assert.ok(repliedMsg.includes('not currently registered'));
  });

  await t.test('4. Revoke role correctly removes access', () => {
    revokeRole(treasurerId, adminId);
    assert.strictEqual(getUserRole(treasurerId), null);
    assert.strictEqual(isStaff(treasurerId), false);
  });

  await t.test('5. Re-assigning or updating role for existing user executes UPDATE without SQL error', () => {
    // Initial insert
    assignRole('555666777', 'treasurer', adminId);
    assert.strictEqual(getUserRole('555666777'), 'treasurer');

    // Update existing record (exercises UPDATE roles SET ... updated_at = datetime('now'))
    assignRole('555666777', 'admin', adminId);
    assert.strictEqual(getUserRole('555666777'), 'admin');

    // Re-assign again to treasurer
    assignRole('555666777', 'treasurer', adminId);
    assert.strictEqual(getUserRole('555666777'), 'treasurer');
  });

  cleanup();
});

