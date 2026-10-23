const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { registerMember } = require('../src/services/memberService');
const { recordPayment, setCbeAccountDetails } = require('../src/services/accounting');
const {
  isUnderCooldown,
  getUnpaidRemindersSummary,
  sendMonthlyReminders,
} = require('../src/services/reminders');

test('Automated Monthly Contribution Reminders & Service Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_reminders.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  };

  // Configure church CBE account
  setCbeAccountDetails({
    accountNumber: '1000987654321',
    accountName: 'St. Natanim Church Building Fund',
    actorTelegramId: '999',
  });

  const testMonth = '2026-10';

  // Seed Member 1: Active with Telegram ID (Unpaid)
  const m1 = registerMember({
    telegramId: '100000001',
    fullName: 'Yared Melaku',
    phone: '+251911111111',
    actorTelegramId: '999',
  });

  // Seed Member 2: Active with Telegram ID (Fully Paid)
  const m2 = registerMember({
    telegramId: '100000002',
    fullName: 'Marta Hailu',
    phone: '+251922222222',
    actorTelegramId: '999',
  });
  // Pay off m2
  recordPayment({
    memberId: m2.id,
    yearMonth: testMonth,
    amountCents: 5000,
    paymentMethod: 'bank_transfer',
    referenceNumber: 'CBE-M2-001',
    recordedBy: '999',
  });

  // Seed Member 3: Active with NO Telegram ID (Unpaid, registered manually by admin)
  const m3 = registerMember({
    telegramId: null,
    fullName: 'Solomon Tesfaye',
    phone: '+251933333333',
    actorTelegramId: '999',
  });

  // Seed Member 4: Active with Telegram ID (Partially Paid)
  const m4 = registerMember({
    telegramId: '100000004',
    fullName: 'Almaz Ayana',
    phone: '+251944444444',
    actorTelegramId: '999',
  });
  // Pay 20.00 ETB out of 50.00 ETB
  recordPayment({
    memberId: m4.id,
    yearMonth: testMonth,
    amountCents: 2000,
    paymentMethod: 'cash',
    referenceNumber: 'CASH-001',
    recordedBy: '999',
  });

  await t.test('1. getUnpaidRemindersSummary accurately groups unpaid and reachable members', () => {
    const summary = getUnpaidRemindersSummary(testMonth);
    // m1 (unpaid), m3 (unpaid, no telegram), m4 (partial 30.00 ETB left). m2 is fully paid.
    assert.strictEqual(summary.totalUnpaid, 3);
    assert.strictEqual(summary.reachableCount, 2); // m1 and m4
    assert.strictEqual(summary.unreachableCount, 1); // m3
    // m1: 5000 cents, m4: 3000 cents, m3: 5000 cents -> total = 13000 cents (130.00 ETB)
    assert.strictEqual(summary.totalBalanceCents, 13000);
    assert.ok(summary.samplePreview.includes('1000987654321'));
    assert.ok(summary.samplePreview.includes('St. Natanim Church Building Fund'));
  });

  await t.test('2. sendMonthlyReminders delivers messages to reachable unpaid members with CBE info', async () => {
    const sentMessages = [];
    const mockTelegram = {
      sendMessage: async (chatId, text, opts) => {
        sentMessages.push({ chatId, text, opts });
        return { message_id: 101 };
      },
    };

    const results = await sendMonthlyReminders({
      telegram: mockTelegram,
      yearMonth: testMonth,
      sentBy: '999',
      force: false,
      throttleMs: 0,
    });

    assert.strictEqual(results.totalEligible, 3);
    assert.strictEqual(results.reachableCount, 2);
    assert.strictEqual(results.unreachableCount, 1);
    assert.strictEqual(results.sentCount, 2); // m1 and m4
    assert.strictEqual(results.skippedCooldownCount, 0);
    assert.strictEqual(sentMessages.length, 2);

    // Verify m1 message
    const m1Msg = sentMessages.find((msg) => msg.chatId === '100000001');
    assert.ok(m1Msg);
    assert.ok(m1Msg.text.includes('Yared Melaku'));
    assert.ok(m1Msg.text.includes('50.00 ETB'));
    assert.ok(m1Msg.text.includes('1000987654321'));
    assert.ok(m1Msg.text.includes('St. Natanim Church Building Fund'));
    assert.ok(m1Msg.text.includes('Submit Receipt'));

    // Verify m4 message (partial balance)
    const m4Msg = sentMessages.find((msg) => msg.chatId === '100000004');
    assert.ok(m4Msg);
    assert.ok(m4Msg.text.includes('Almaz Ayana'));
    assert.ok(m4Msg.text.includes('30.00 ETB'));

    // Verify reminder_log entries
    const logs = db.prepare("SELECT * FROM reminder_log WHERE year_month = ? AND status = 'SENT'").all(testMonth);
    assert.strictEqual(logs.length, 2);
  });

  await t.test('3. Cooldown prevents resending within 72 hours unless forced', async () => {
    // Both m1 and m4 were just sent reminders. Under cooldown, they should be skipped.
    assert.strictEqual(isUnderCooldown(m1.id, testMonth, 72), true);
    assert.strictEqual(isUnderCooldown(m4.id, testMonth, 72), true);

    const sentMessages = [];
    const mockTelegram = {
      sendMessage: async (chatId, text, opts) => {
        sentMessages.push({ chatId, text, opts });
        return { message_id: 102 };
      },
    };

    // Attempt standard send without force
    const results = await sendMonthlyReminders({
      telegram: mockTelegram,
      yearMonth: testMonth,
      sentBy: '999',
      force: false,
      throttleMs: 0,
    });

    assert.strictEqual(results.sentCount, 0);
    assert.strictEqual(results.skippedCooldownCount, 2);
    assert.strictEqual(sentMessages.length, 0);

    // Now test with force = true
    const forceResults = await sendMonthlyReminders({
      telegram: mockTelegram,
      yearMonth: testMonth,
      sentBy: '999',
      force: true,
      throttleMs: 0,
    });

    assert.strictEqual(forceResults.sentCount, 2);
    assert.strictEqual(forceResults.skippedCooldownCount, 0);
    assert.strictEqual(sentMessages.length, 2);
  });

  await t.test('4. Gracefully handles blocked user without failing remaining deliveries', async () => {
    const sentMessages = [];
    const mockTelegram = {
      sendMessage: async (chatId, text, opts) => {
        if (chatId === '100000001') {
          throw new Error('Forbidden: bot was blocked by the user');
        }
        sentMessages.push({ chatId, text, opts });
        return { message_id: 103 };
      },
    };

    const results = await sendMonthlyReminders({
      telegram: mockTelegram,
      yearMonth: testMonth,
      sentBy: '999',
      force: true,
      throttleMs: 0,
    });

    assert.strictEqual(results.sentCount, 1); // only m4 succeeded
    assert.strictEqual(results.blockedCount, 1); // m1 blocked
    assert.strictEqual(results.failedCount, 0);

    const blockedLog = db.prepare("SELECT * FROM reminder_log WHERE telegram_id = '100000001' AND status = 'BLOCKED'").get();
    assert.ok(blockedLog);
  });

  cleanup();
});
