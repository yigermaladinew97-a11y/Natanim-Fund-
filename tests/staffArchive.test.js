const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const {
  getStaffGroupId,
  getStaffGroupDetails,
  setStaffGroupId,
  getOrCreateTopic,
  initializeAcademicYearTopics,
  getMonthTopicKey,
  getMonthTopicName,
  getReportsTopicName,
  forwardVerifiedReceiptToStaffGroup,
  sendReportToStaffGroup,
  postMonthlyReportToStaffGroup,
} = require('../src/services/staffArchive');

test('Staff Archive Group & Forum Topic (Folder) Management Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_staff_archive.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  };

  await t.test('1. Staff group ID is null by default and can be saved and retrieved', () => {
    assert.strictEqual(getStaffGroupId(), null);

    const saved = setStaffGroupId('-100987654321', 'Arbaminch Christian Fellowship Staff', '123456');
    assert.strictEqual(saved.groupId, '-100987654321');
    assert.strictEqual(saved.groupTitle, 'Arbaminch Christian Fellowship Staff');
    assert.strictEqual(getStaffGroupId(), '-100987654321');
  });

  await t.test('2. Forum topic (folder) keys and names format correctly with Ethiopian dual date', () => {
    const key = getMonthTopicKey('2026-10');
    assert.strictEqual(key, 'month_2026-10');

    const name = getMonthTopicName('2026-10');
    assert.ok(name.includes('ጥቅምት 2019 ዓ.ም.'));
    assert.ok(name.includes('2026-10'));

    const repName = getReportsTopicName();
    assert.ok(repName.includes('Monthly Reports'));
  });

  await t.test('3. getOrCreateTopic creates topic via Telegram API and caches thread_id in SQLite', async () => {
    const createdTopics = [];
    const mockTelegram = {
      async createForumTopic(chatId, name, options) {
        createdTopics.push({ chatId, name, options });
        return { message_thread_id: 42 };
      },
    };

    const threadId1 = await getOrCreateTopic(mockTelegram, '-100987654321', 'month_2026-10', '📁 ጥቅምት 2019 (2026-10)');
    assert.strictEqual(threadId1, 42);
    assert.strictEqual(createdTopics.length, 1);
    assert.strictEqual(createdTopics[0].name, '📁 ጥቅምት 2019 (2026-10)');

    // Second call for the same group and month should hit cache in SQLite without calling Telegram API
    const threadId2 = await getOrCreateTopic(mockTelegram, '-100987654321', 'month_2026-10', '📁 ጥቅምት 2019 (2026-10)');
    assert.strictEqual(threadId2, 42);
    assert.strictEqual(createdTopics.length, 1); // No new call to createForumTopic!
  });

  await t.test('4. forwardVerifiedReceiptToStaffGroup dispatches photo to month topic with full metadata', async () => {
    let sentPhotoCall = null;
    const mockTelegram = {
      async sendPhoto(chatId, photo, extra) {
        sentPhotoCall = { chatId, photo, extra };
        return { message_id: 101 };
      },
    };

    const res = await forwardVerifiedReceiptToStaffGroup(mockTelegram, {
      submission: {
        file_id: 'AgACAgIAAxkBAAIFZ2...sample_receipt_id',
        year_month: '2026-10',
        amount_cents: 50000,
        payment_method: 'bank_transfer',
        reference_number: 'CBE-FT2026-8888',
        months_count: 1,
      },
      member: {
        id: 15,
        full_name: 'Daniel Bekele',
      },
      approverName: 'Admin Yigermal',
      currency: 'ETB',
      txId: 'TX-202610-001',
    });

    assert.ok(res);
    assert.strictEqual(sentPhotoCall.chatId, '-100987654321');
    assert.strictEqual(sentPhotoCall.photo, 'AgACAgIAAxkBAAIFZ2...sample_receipt_id');
    assert.strictEqual(sentPhotoCall.extra.message_thread_id, 42);
    assert.ok(sentPhotoCall.extra.caption.includes('VERIFIED CBE PAYMENT RECEIPT'));
    assert.ok(sentPhotoCall.extra.caption.includes('Daniel Bekele'));
    assert.ok(sentPhotoCall.extra.caption.includes('500.00 ETB'));
    assert.ok(sentPhotoCall.extra.caption.includes('CBE-FT2026-8888'));
    assert.ok(sentPhotoCall.extra.caption.includes('Admin Yigermal'));
  });

  await t.test('5. sendReportToStaffGroup sends report and document to reports topic', async () => {
    let sentMsg = null;
    let sentDoc = null;
    const mockTelegram = {
      async createForumTopic(chatId, name) {
        return { message_thread_id: 99 };
      },
      async sendMessage(chatId, text, extra) {
        sentMsg = { chatId, text, extra };
      },
      async sendDocument(chatId, doc, extra) {
        sentDoc = { chatId, doc, extra };
      },
    };

    await sendReportToStaffGroup(
      mockTelegram,
      '2026-10',
      '📊 <b>Monthly Financial Report</b>\nTotal: 500.00 ETB',
      Buffer.from('Member,Paid\nDaniel,500'),
      'report_2026_10.csv'
    );

    assert.ok(sentMsg);
    assert.strictEqual(sentMsg.chatId, '-100987654321');
    assert.strictEqual(sentMsg.extra.message_thread_id, 99);
    assert.ok(sentDoc);
    assert.strictEqual(sentDoc.doc.filename, 'report_2026_10.csv');
  });

  await t.test('6. initializeAcademicYearTopics creates all 9 campus months + reports topic', async () => {
    let topicCounter = 100;
    const created = [];
    const mockTelegram = {
      async createForumTopic(chatId, name, options) {
        topicCounter++;
        created.push({ chatId, name, options, threadId: topicCounter });
        return { message_thread_id: topicCounter };
      },
    };

    const topics = await initializeAcademicYearTopics(mockTelegram, '-100987654321', '2026-10');
    assert.strictEqual(topics.length, 10); // 9 months + reports
    const monthTopics = topics.filter((t) => t.month !== 'reports');
    assert.strictEqual(monthTopics.length, 9);
    assert.strictEqual(monthTopics[0].month, '2026-10');
    assert.strictEqual(monthTopics[8].month, '2027-06');
    assert.ok(monthTopics[0].name.includes('ጥቅምት'));
    assert.ok(monthTopics[8].name.includes('ሰኔ'));

    const reports = topics.find((t) => t.month === 'reports');
    assert.ok(reports);
    assert.ok(reports.name.includes('ሪፖርቶች'));
  });

  await t.test('7. postMonthlyReportToStaffGroup generates summary & CSV and sends to reports topic', async () => {
    let sentMsg = null;
    let sentDoc = null;
    const mockTelegram = {
      async createForumTopic(chatId, name) {
        return { message_thread_id: 88 };
      },
      async sendMessage(chatId, text, extra) {
        sentMsg = { chatId, text, extra };
      },
      async sendDocument(chatId, doc, extra) {
        sentDoc = { chatId, doc, extra };
      },
    };

    const res = await postMonthlyReportToStaffGroup(mockTelegram, '2026-10');
    assert.ok(res.success);
    assert.strictEqual(res.threadId, 99);
    assert.ok(sentMsg);
    assert.strictEqual(sentMsg.chatId, '-100987654321');
    assert.ok(sentMsg.text.includes('ወርሃዊ የፋይናንስ ሪፖርት'));
    assert.ok(sentDoc);
    assert.strictEqual(sentDoc.doc.filename, 'Natanim_Fund_Report_2026-10.csv');
  });

  cleanup();
});

