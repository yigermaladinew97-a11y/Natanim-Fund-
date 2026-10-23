const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { registerMember } = require('../src/services/memberService');
const { getActiveBroadcastRecipients, sendChurchBroadcast } = require('../src/services/broadcastService');

test('Church Announcements & Broadcast Service Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_broadcast.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  };

  // Seed test members:
  // Member 1: Active with Telegram ID
  const m1 = registerMember({
    telegramId: '100000001',
    fullName: 'Abebe Bikila',
    phone: '+251911111111',
    actorTelegramId: '999',
  });

  // Member 2: Active with Telegram ID
  const m2 = registerMember({
    telegramId: '100000002',
    fullName: 'Derartu Tulu',
    phone: '+251922222222',
    actorTelegramId: '999',
  });

  // Member 3: Active with NO Telegram ID
  const m3 = registerMember({
    telegramId: null,
    fullName: 'Haile Gebrselassie',
    phone: '+251933333333',
    actorTelegramId: '999',
  });

  // Member 4: Inactive / deactivated member
  db.prepare(`
    INSERT INTO members (telegram_id, full_name, phone, status, joined_date)
    VALUES ('100000004', 'Inactive Member', '+251944444444', 'inactive', '2026-01-01')
  `).run();

  await t.test('1. getActiveBroadcastRecipients only returns active members with Telegram IDs', () => {
    const recipients = getActiveBroadcastRecipients();
    assert.strictEqual(recipients.length, 2);
    const ids = recipients.map((r) => r.telegram_id);
    assert.ok(ids.includes('100000001'));
    assert.ok(ids.includes('100000002'));
    assert.strictEqual(ids.includes('100000004'), false);
  });

  await t.test('2. sendChurchBroadcast delivers text message to all active recipients', async () => {
    const sentMessages = [];
    const mockTelegram = {
      sendMessage: async (chatId, text, opts) => {
        sentMessages.push({ chatId, text, opts });
        return { message_id: 123 };
      },
    };

    const results = await sendChurchBroadcast({
      telegram: mockTelegram,
      messageType: 'text',
      text: '<b>Blessings of the Feast!</b>\nAll members are invited to tomorrow prayer.',
      actorTelegramId: '999',
      throttleMs: 0,
    });

    assert.strictEqual(results.totalRecipients, 2);
    assert.strictEqual(results.sentCount, 2);
    assert.strictEqual(results.failedCount, 0);
    assert.strictEqual(results.blockedCount, 0);
    assert.strictEqual(sentMessages.length, 2);
    assert.strictEqual(sentMessages[0].chatId, '100000001');
    assert.strictEqual(sentMessages[1].chatId, '100000002');

    // Verify audit log
    const log = db.prepare("SELECT * FROM audit_log WHERE action = 'SEND_BROADCAST'").get();
    assert.ok(log);
    assert.strictEqual(log.actor_telegram_id, '999');
    const details = JSON.parse(log.details_json);
    assert.strictEqual(details.sentCount, 2);
    assert.strictEqual(details.messageType, 'text');
  });

  await t.test('3. sendChurchBroadcast delivers photo announcement with caption', async () => {
    const sentPhotos = [];
    const mockTelegram = {
      sendPhoto: async (chatId, fileId, opts) => {
        sentPhotos.push({ chatId, fileId, opts });
        return { message_id: 124 };
      },
    };

    const results = await sendChurchBroadcast({
      telegram: mockTelegram,
      messageType: 'photo',
      fileId: 'photo_file_id_xyz',
      caption: 'Church building project progress update 🕊️',
      actorTelegramId: '999',
      throttleMs: 0,
    });

    assert.strictEqual(results.sentCount, 2);
    assert.strictEqual(sentPhotos.length, 2);
    assert.strictEqual(sentPhotos[0].fileId, 'photo_file_id_xyz');
    assert.strictEqual(sentPhotos[0].opts.caption, 'Church building project progress update 🕊️');
  });

  await t.test('4. Gracefully handles blocked members and continues delivery', async () => {
    const mockTelegram = {
      sendMessage: async (chatId) => {
        if (chatId === '100000001') {
          throw new Error('Forbidden: bot was blocked by the user');
        }
        return { message_id: 125 };
      },
    };

    const results = await sendChurchBroadcast({
      telegram: mockTelegram,
      messageType: 'text',
      text: 'Testing blocked member handling',
      actorTelegramId: '999',
      throttleMs: 0,
    });

    assert.strictEqual(results.totalRecipients, 2);
    assert.strictEqual(results.sentCount, 1);
    assert.strictEqual(results.blockedCount, 1);
    assert.strictEqual(results.failedCount, 0);
  });

  cleanup();
});
