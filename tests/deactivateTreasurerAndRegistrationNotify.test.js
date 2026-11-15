const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase, getDatabase } = require('../src/db');
const {
  registerMember,
  deactivateMember,
  createRegistrationRequest,
  notifyAdminsNewRegistration,
  getMemberByTelegramId,
} = require('../src/services/memberService');
const { assignRole, getUserRole } = require('../src/services/permissions');
const { setStaffGroupId } = require('../src/services/staffArchive');

const TEST_DB_PATH = path.join(__dirname, 'test_deact_reg.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

test('Deactivate Treasurer & Enhanced Registration Notification Tests', async (t) => {
  cleanup();
  initDatabase(TEST_DB_PATH);

  await t.test('1. Deactivating a member who is a Treasurer simultaneously removes membership and treasurer role', () => {
    // Register a member
    const member = registerMember({
      telegramId: '33445566',
      fullName: 'Solomon Treasurer',
      phone: '0911002233',
      actorTelegramId: '111111',
    });

    // Assign treasurer role
    assignRole('33445566', 'treasurer', '111111');
    assert.strictEqual(getUserRole('33445566'), 'treasurer');

    // Admin deactivates the member
    const res = deactivateMember({
      memberId: member.id,
      reason: 'Relieved of church fellowship duties',
      actorTelegramId: '111111',
    });

    assert.strictEqual(res.status, 'inactive');
    assert.strictEqual(res.wasTreasurer, true);
    assert.strictEqual(res.roleRevoked, 'treasurer');

    // Verify role is completely gone from permissions
    assert.strictEqual(getUserRole('33445566'), null);

    // Verify audit log has REVOKE_ROLE entry
    const db = getDatabase();
    const auditLogs = db.prepare('SELECT * FROM audit_log WHERE action = ?').all('REVOKE_ROLE');
    assert.ok(auditLogs.length > 0);
    const lastAudit = auditLogs[auditLogs.length - 1];
    assert.strictEqual(lastAudit.entity_id, '33445566');
  });

  await t.test('2. notifyAdminsNewRegistration delivers to staff members AND to the leadership staff group', async () => {
    // Set a staff group ID
    setStaffGroupId('-100987654321', 'Staff Leadership Group', '111111');

    // Assign an admin and a treasurer
    assignRole('111111', 'admin', 'SYSTEM');
    assignRole('222222', 'treasurer', '111111');

    const sentMessages = [];
    const mockTelegram = {
      async sendMessage(chatId, text, options) {
        sentMessages.push({ chatId, text, options });
      },
    };

    const req = createRegistrationRequest({
      telegramId: '77889900',
      fullName: 'New Applicant',
      phone: '0922334455',
    });

    await notifyAdminsNewRegistration(mockTelegram, req);

    // Verify sent to Admin DM
    const adminDm = sentMessages.find((m) => m.chatId === '111111');
    assert.ok(adminDm, 'Must send registration notification to admin DM');
    assert.ok(adminDm.text.includes('New Applicant'));
    assert.ok(adminDm.options.reply_markup.inline_keyboard[0][0].callback_data.includes('reg_approve_'));

    // Verify sent to Treasurer DM
    const treasurerDm = sentMessages.find((m) => m.chatId === '222222');
    assert.ok(treasurerDm, 'Must send registration notification to treasurer DM');

    // Verify sent to Staff Group
    const groupMsg = sentMessages.find((m) => m.chatId === '-100987654321');
    assert.ok(groupMsg, 'Must broadcast registration notification to staff group');
    assert.ok(groupMsg.text.includes('New Applicant'));
    assert.ok(groupMsg.options.reply_markup.inline_keyboard[0][0].callback_data.includes('reg_approve_'));
  });

  cleanup();
});
