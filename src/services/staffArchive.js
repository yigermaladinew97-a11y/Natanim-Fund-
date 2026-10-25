const { getDatabase } = require('../db');
const { formatMoney, formatPaymentMethod, formatDualMonth, formatDualDate, escapeHtml } = require('../utils/formatters');
const { config } = require('../config');

/**
 * Staff Archive Group & Forum Topic (Folder) Management Service
 */

function getStaffGroupId() {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'staff_group_id'").get();
  if (row && row.value) {
    return row.value;
  }
  return config.staffGroupId || process.env.STAFF_GROUP_ID || null;
}

function getStaffGroupDetails() {
  const db = getDatabase();
  const idRow = db.prepare("SELECT value FROM settings WHERE key = 'staff_group_id'").get();
  const titleRow = db.prepare("SELECT value FROM settings WHERE key = 'staff_group_title'").get();
  return {
    groupId: idRow?.value || config.staffGroupId || process.env.STAFF_GROUP_ID || null,
    groupTitle: titleRow?.value || 'Fellowship Staff Group',
  };
}

function setStaffGroupId(groupId, groupTitle, actorTelegramId) {
  const db = getDatabase();
  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('staff_group_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(groupId));

    if (groupTitle) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('staff_group_title', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(groupTitle));
    }

    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('SET_STAFF_GROUP', 'settings', 'staff_group_id', String(actorTelegramId), JSON.stringify({
      groupId: String(groupId),
      groupTitle: groupTitle || null,
    }));
  });

  save();
  return getStaffGroupDetails();
}

function getMonthTopicKey(yearMonth) {
  return `month_${yearMonth}`;
}

function getMonthTopicName(yearMonth) {
  return `📁 ${formatDualMonth(yearMonth)}`;
}

function getReportsTopicName() {
  return '📊 ወርሃዊ ሪፖርቶች / Monthly Reports';
}

async function getOrCreateTopic(telegram, groupId, topicKey, topicName, iconColor = 0x6FB9F0) {
  const db = getDatabase();
  const existing = db.prepare(`
    SELECT thread_id FROM group_topics WHERE group_id = ? AND topic_key = ?
  `).get(String(groupId), String(topicKey));

  if (existing && existing.thread_id) {
    return existing.thread_id;
  }

  // Attempt to create Forum Topic in Telegram Supergroup
  try {
    const topic = await telegram.createForumTopic(groupId, topicName, {
      icon_color: iconColor,
    });

    const threadId = topic.message_thread_id;
    db.prepare(`
      INSERT INTO group_topics (group_id, topic_key, topic_name, thread_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id, topic_key) DO UPDATE SET thread_id = excluded.thread_id, topic_name = excluded.topic_name
    `).run(String(groupId), String(topicKey), String(topicName), threadId);

    return threadId;
  } catch (err) {
    console.warn(`[StaffArchive] Could not create forum topic "${topicName}" in group ${groupId}:`, err.message);
    // If topics aren't supported or bot lacks manage_topics, messages will still be posted to the general thread
    return null;
  }
}

async function forwardVerifiedReceiptToStaffGroup(telegram, {
  submission,
  member,
  approverName,
  currency = 'ETB',
  txId,
}) {
  const groupId = getStaffGroupId();
  if (!groupId || !telegram) return null;

  const topicKey = getMonthTopicKey(submission.year_month);
  const topicName = getMonthTopicName(submission.year_month);

  const threadId = await getOrCreateTopic(telegram, groupId, topicKey, topicName, 0x6FB9F0);

  const todayStr = new Date().toISOString().slice(0, 10);
  const caption =
    `✅ <b>VERIFIED CBE PAYMENT RECEIPT</b>\n` +
    `────────────────────\n` +
    `👤 <b>Member:</b> ${escapeHtml(member.full_name)} (#${member.id})\n` +
    `💰 <b>Amount:</b> ${formatMoney(submission.amount_cents, currency)}\n` +
    `📅 <b>Period:</b> ${formatDualMonth(submission.year_month)}\n` +
    `• <b>Months Covered:</b> ${submission.months_count || 1} Month${(submission.months_count || 1) > 1 ? 's' : ''}\n` +
    `🏦 <b>Method:</b> ${formatPaymentMethod(submission.payment_method)}\n` +
    `🔢 <b>CBE Ref:</b> <code>${escapeHtml(submission.reference_number || 'N/A')}</code>\n` +
    `👮 <b>Approved By:</b> ${escapeHtml(approverName || 'Treasurer')}\n` +
    `⏰ <b>Verified On:</b> ${formatDualDate(todayStr)}\n` +
    `🧾 <b>Tx ID:</b> <code>${escapeHtml(txId || 'APPROVED')}</code>`;

  const extra = {
    parse_mode: 'HTML',
  };
  if (threadId) {
    extra.message_thread_id = threadId;
  }

  try {
    return await telegram.sendPhoto(groupId, submission.file_id, {
      ...extra,
      caption,
    });
  } catch (err) {
    console.error(`[StaffArchive] Failed to forward screenshot to staff group:`, err.message);
    return null;
  }
}

async function sendReportToStaffGroup(telegram, yearMonth, reportText, csvBuffer, filename) {
  const groupId = getStaffGroupId();
  if (!groupId || !telegram) return null;

  const topicKey = 'reports';
  const topicName = getReportsTopicName();

  const threadId = await getOrCreateTopic(telegram, groupId, topicKey, topicName, 0xFFD67E);

  const extra = {
    parse_mode: 'HTML',
  };
  if (threadId) {
    extra.message_thread_id = threadId;
  }

  try {
    if (reportText) {
      await telegram.sendMessage(groupId, reportText, extra);
    }
    if (csvBuffer && filename) {
      await telegram.sendDocument(
        groupId,
        { source: csvBuffer, filename },
        { ...extra, caption: `📊 Financial Statement Export for ${formatDualMonth(yearMonth)}` }
      );
    }
  } catch (err) {
    console.error(`[StaffArchive] Failed to send report to staff group:`, err.message);
  }
}

module.exports = {
  getStaffGroupId,
  getStaffGroupDetails,
  setStaffGroupId,
  getOrCreateTopic,
  getMonthTopicKey,
  getMonthTopicName,
  getReportsTopicName,
  forwardVerifiedReceiptToStaffGroup,
  sendReportToStaffGroup,
};
