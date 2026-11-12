const { Markup } = require('telegraf');
const { getDatabase } = require('../db');
const {
  formatMoney,
  formatPaymentMethod,
  formatDualMonth,
  formatDualDate,
  escapeHtml,
  getNextAcademicMonthsList,
  getCurrentYearMonth,
} = require('../utils/formatters');
const { config } = require('../config');
const { getMonthlyReportSummary, exportMonthlyReportCsv, formatMonthlyReportHtml } = require('./reporting');
const { getMemberByTelegramId } = require('./memberService');
const { getMainMenuKeyboard } = require('../utils/keyboards');

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

function getStaffGroupInviteLink() {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'staff_group_invite_link'").get();
  return row?.value || null;
}

function setStaffGroupInviteLink(link, actorTelegramId) {
  const db = getDatabase();
  const cleanLink = link ? String(link).trim() : null;
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('staff_group_invite_link', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(cleanLink);

  if (actorTelegramId) {
    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('SET_STAFF_INVITE_LINK', 'settings', 'staff_group_invite_link', String(actorTelegramId), JSON.stringify({
      inviteLink: cleanLink,
    }));
  }
  return cleanLink;
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

/**
 * Initialize all 9 Academic Year Topics (October to June / ጥቅምት እስከ ሰኔ)
 * plus the Monthly Reports topic in the staff archive group.
 */
async function initializeAcademicYearTopics(telegram, groupId, startYearMonth) {
  const currentMonth = startYearMonth || getCurrentYearMonth();
  const months = getNextAcademicMonthsList(currentMonth, 9);
  const createdTopics = [];

  const topicColors = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F];

  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const key = getMonthTopicKey(m);
    const name = getMonthTopicName(m);
    const color = topicColors[i % topicColors.length];
    const threadId = await getOrCreateTopic(telegram, groupId, key, name, color);
    createdTopics.push({ month: m, key, name, threadId });
    // Modest delay between Telegram API calls
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  // Also ensure Reports topic
  const reportsThread = await getOrCreateTopic(telegram, groupId, 'reports', getReportsTopicName(), 0xFFD67E);
  createdTopics.push({ month: 'reports', key: 'reports', name: getReportsTopicName(), threadId: reportsThread });

  return createdTopics;
}

async function forwardVerifiedReceiptToStaffGroup(telegram, {
  submission,
  member,
  approverName,
  currency = 'ETB',
  txId,
}) {
  const groupId = getStaffGroupId();
  if (!groupId || !telegram) {
    console.warn(`[StaffArchive] Cannot forward receipt: Staff archive group is not configured (groupId=${groupId})`);
    return null;
  }

  const topicKey = getMonthTopicKey(submission.year_month);
  const topicName = getMonthTopicName(submission.year_month);

  let threadId = null;
  try {
    threadId = await getOrCreateTopic(telegram, groupId, topicKey, topicName, 0x6FB9F0);
  } catch (topicErr) {
    console.warn(`[StaffArchive] Topic lookup/creation skipped:`, topicErr.message);
  }

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

  // Tier 1: Try sending as Photo with threadId (if in forum mode)
  try {
    const res = await telegram.sendPhoto(groupId, submission.file_id, {
      ...extra,
      caption,
    });
    console.log(`[StaffArchive] Successfully forwarded receipt photo to staff group ${groupId} (threadId=${threadId || 'general'})`);
    return res;
  } catch (photoErr) {
    console.warn(`[StaffArchive] sendPhoto with threadId=${threadId} failed: ${photoErr.message}`);

    // Tier 2: If threadId failed (e.g. topic deleted or not a forum), try photo in general chat
    if (threadId) {
      try {
        const res = await telegram.sendPhoto(groupId, submission.file_id, {
          parse_mode: 'HTML',
          caption,
        });
        console.log(`[StaffArchive] Forwarded receipt photo to staff group general chat ${groupId}`);
        return res;
      } catch (photoGenErr) {
        console.warn(`[StaffArchive] sendPhoto without threadId failed: ${photoGenErr.message}`);
      }
    }

    // Tier 3: If file_id is a document/PDF rather than a photo, try sendDocument
    try {
      const res = await telegram.sendDocument(groupId, submission.file_id, {
        ...extra,
        caption,
      });
      console.log(`[StaffArchive] Forwarded receipt document to staff group ${groupId}`);
      return res;
    } catch (docErr) {
      console.warn(`[StaffArchive] sendDocument failed: ${docErr.message}`);
    }

    // Tier 4: Fallback to text message so leadership group NEVER misses the verified receipt notification
    try {
      const res = await telegram.sendMessage(groupId, caption, extra);
      console.log(`[StaffArchive] Forwarded receipt text notification to staff group ${groupId}`);
      return res;
    } catch (msgErr) {
      if (threadId) {
        try {
          const res = await telegram.sendMessage(groupId, caption, { parse_mode: 'HTML' });
          console.log(`[StaffArchive] Forwarded receipt text to staff group general chat ${groupId}`);
          return res;
        } catch (_) {}
      }
      console.error(`[StaffArchive] Failed to notify staff group completely:`, msgErr.message);
      return null;
    }
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
    let sentMessage = null;
    if (reportText) {
      sentMessage = await telegram.sendMessage(groupId, reportText, extra);
    }
    if (csvBuffer && filename) {
      const caption = `📊 <b>Financial Statement Export for ${formatDualMonth(yearMonth)}</b>\n<i>RFC-4180 CSV Spreadsheet</i>`;
      if (telegram.token && typeof fetch === 'function') {
        const form = new FormData();
        form.append('chat_id', String(groupId));
        if (threadId) form.append('message_thread_id', String(threadId));
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
        form.append('document', new Blob([csvBuffer], { type: 'text/csv' }), filename);

        await fetch(`https://api.telegram.org/bot${telegram.token}/sendDocument`, {
          method: 'POST',
          body: form,
        });
      } else if (typeof telegram.sendDocument === 'function') {
        await telegram.sendDocument(
          groupId,
          { source: csvBuffer, filename },
          { ...extra, caption }
        );
      }
    }
    return { success: true, threadId, sentMessage };
  } catch (err) {
    console.error(`[StaffArchive] Failed to send report to staff group:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Generate and dispatch the complete monthly financial summary and CSV export
 * directly to the "📊 ወርሃዊ ሪፖርቶች" topic in the connected staff group.
 */
async function postMonthlyReportToStaffGroup(telegram, yearMonth) {
  const targetMonth = yearMonth || getCurrentYearMonth();
  const summary = getMonthlyReportSummary(targetMonth);
  const reportText = formatMonthlyReportHtml(summary);
  const csvBuffer = exportMonthlyReportCsv(targetMonth);
  const filename = `Natanim_Fund_Report_${targetMonth}.csv`;

  return await sendReportToStaffGroup(telegram, targetMonth, reportText, csvBuffer, filename);
}

/**
 * Generate an exclusive single-use invite link for a newly appointed Treasurer
 * and post a welcome announcement in the leadership group.
 */
async function inviteTreasurerToStaffGroup(telegram, targetId, memberName) {
  const groupId = getStaffGroupId();
  if (!groupId || !telegram) {
    console.warn('[StaffArchive] Cannot invite treasurer: staff group ID is not set. Use /setstaffgroup.');
    return null;
  }

  let inviteLink = null;
  const safeName = `Treasurer - ${memberName || targetId}`.slice(0, 32);

  try {
    const linkObj = await telegram.createChatInviteLink(groupId, {
      name: safeName,
      member_limit: 1,
    });
    inviteLink = linkObj?.invite_link || null;
  } catch (err) {
    console.warn(`[StaffArchive] createChatInviteLink with name failed for ${targetId}:`, err.message);
    try {
      // Fallback 1: createChatInviteLink without name parameter (max compatibility)
      const linkObj = await telegram.createChatInviteLink(groupId, {
        member_limit: 1,
      });
      inviteLink = linkObj?.invite_link || null;
    } catch (err2) {
      console.warn(`[StaffArchive] createChatInviteLink without name failed:`, err2.message);
      try {
        // Fallback 2: export primary chat invite link
        inviteLink = await telegram.exportChatInviteLink(groupId);
      } catch (err3) {
        console.warn(`[StaffArchive] exportChatInviteLink fallback failed:`, err3.message);
      }
    }
  }

  // Fallback 3: Stored manual staff group invite link from settings
  if (!inviteLink) {
    inviteLink = getStaffGroupInviteLink();
  }

  // Announce in staff group
  try {
    const displayName = memberName || `User ${targetId}`;
    await telegram.sendMessage(
      groupId,
      `🤝 <b>አዲስ ገንዘብ ያዥ / New Treasurer Appointed!</b>\n\n` +
      `Please welcome <b>${escapeHtml(displayName)}</b> to the fellowship leadership team as <b>Treasurer</b>! 🎉\n` +
      `They now have full access to view monthly reports, verify member payment receipts, and assist in fund administration.`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.warn(`[StaffArchive] Could not send welcome announcement in group:`, err.message);
  }

  return inviteLink;
}

/**
 * Notify newly appointed treasurer via direct message with both inline button
 * and copyable link text, and update their persistent menu keyboard.
 */
async function notifyTreasurerAppointed(telegram, targetId, assignedByName = 'an administrator') {
  const member = getMemberByTelegramId(targetId);
  const memberName = member?.full_name || null;

  // 1. Generate exclusive single-use invite link to staff group & post welcome
  const inviteLink = await inviteTreasurerToStaffGroup(telegram, targetId, memberName);

  let dmSent = false;
  let dmError = null;

  try {
    // Message 1: Role appointment notice with direct copyable invite link & inline button
    const inviteMsg =
      `🎉 <b>Role Updated! / አዲስ ኃላፊነት ተሰጥቶዎታል!</b>\n\n` +
      `You have been appointed as <b>Treasurer (ገንዘብ ያዥ)</b> for Natanim Church Fund by ${escapeHtml(assignedByName)}.\n\n` +
      `• <b>ኃላፊነት / Staff Privileges:</b> As a Treasurer, you have access to view monthly financial reports, verify member payment receipts, and record contributions.\n\n` +
      (inviteLink
        ? `🏛️ <b>የአመራር ግሩፕ መጋበዣ ሊንክ / Leadership Group Invite:</b>\n` +
          `ወርሃዊ ሪፖርቶችን እና የክፍያ ደረሰኞችን ለመከታተል እባክዎ ከታች ያለውን ሊንክ ወይም ቁልፍ በመጫን የአመራር ግሩፑን ይቀላቀሉ፦\n\n` +
          `👉 <code>${inviteLink}</code>\n\n`
        : '') +
      `<i>እግዚአብሔር በአገልግሎትዎ ይባርክዎ! 🙏</i>`;

    const inlineKeyboard = inviteLink
      ? Markup.inlineKeyboard([[Markup.button.url('🏛️ Join Admin & Staff Group / ግሩፑን ተቀላቀል', inviteLink)]])
      : undefined;

    await telegram.sendMessage(targetId, inviteMsg, {
      parse_mode: 'HTML',
      ...(inlineKeyboard || {}),
    });

    // Message 2: Push persistent staff menu buttons (Reply Keyboard)
    // Note: Sent separately because Telegram does not allow inline_keyboard and reply_keyboard in one message.
    await telegram.sendMessage(
      targetId,
      `💼 <b>Staff Menu Activated / የአስተዳዳሪ ሜኑ ተዘጋጅቷል</b>\n\n` +
      `የገንዘብ ያዥ ሜኑ ቁልፎችዎ ከታች ባለው ሰሌዳ ላይ ተዘጋጅተዋል (ክፍያ መዝግብ፣ ወርሃዊ ሪፖርት፣ ደረሰኝ አረጋግጥ ወዘተ)።`,
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard('treasurer', 'am'),
      }
    );

    dmSent = true;
  } catch (dmErr) {
    dmError = dmErr.message;
    console.warn(`[Roles] Could not send direct notification to user ${targetId}:`, dmErr.message);
  }

  return { inviteLink, memberName, dmSent, dmError };
}

/**
 * Notify former treasurer of role revocation via direct message and update menu keyboard.
 */
async function notifyTreasurerRevoked(telegram, targetId) {
  const member = getMemberByTelegramId(targetId);
  const memberName = member?.full_name || null;

  // 1. Automatically remove former treasurer from staff group & announce
  const removalResult = await removeTreasurerFromStaffGroup(telegram, targetId, memberName);

  // 2. DM former treasurer
  const fallbackRole = member && member.status === 'active' ? 'member' : 'unregistered';
  let dmSent = false;
  let dmError = null;

  try {
    await telegram.sendMessage(
      targetId,
      `ℹ️ <b>Staff Role Update / የኃላፊነት ለውጥ</b>\n\n` +
      `Your Treasurer privileges for Natanim Church Fund have been removed by an administrator.\n\n` +
      `• Your menu buttons below have been returned to regular member access.\n` +
      `Thank you for your service! 🙏`,
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(fallbackRole, 'am'),
      }
    );
    dmSent = true;
  } catch (dmErr) {
    dmError = dmErr.message;
    console.warn(`[Roles] Could not send revocation notice to user ${targetId}:`, dmErr.message);
  }

  return { removalResult, memberName, dmSent, dmError };
}

/**
 * Automatically remove a former Treasurer from the leadership group when their role is revoked,
 * and announce in the group.
 */
async function removeTreasurerFromStaffGroup(telegram, targetId, memberName) {
  const groupId = getStaffGroupId();
  if (!groupId || !telegram) return { success: false, reason: 'No staff group configured' };

  let removed = false;
  try {
    // Standard Telegram kick: ban then unban so user is removed without being permanently banned
    await telegram.banChatMember(groupId, Number(targetId));
    await telegram.unbanChatMember(groupId, Number(targetId));
    removed = true;
  } catch (err) {
    console.warn(`[StaffArchive] Could not ban/unban user ${targetId} from group ${groupId}:`, err.message);
  }

  // Announce in staff group
  try {
    const displayName = memberName || `User ${targetId}`;
    await telegram.sendMessage(
      groupId,
      `ℹ️ <b>Staff Role Update</b>\n\n` +
      `<b>${escapeHtml(displayName)}</b> is no longer a Treasurer and has been removed from the staff group.`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.warn(`[StaffArchive] Could not send removal announcement in group:`, err.message);
  }

  return { success: true, removed };
}

module.exports = {
  getStaffGroupId,
  getStaffGroupDetails,
  setStaffGroupId,
  getStaffGroupInviteLink,
  setStaffGroupInviteLink,
  getOrCreateTopic,
  initializeAcademicYearTopics,
  getMonthTopicKey,
  getMonthTopicName,
  getReportsTopicName,
  forwardVerifiedReceiptToStaffGroup,
  sendReportToStaffGroup,
  postMonthlyReportToStaffGroup,
  inviteTreasurerToStaffGroup,
  removeTreasurerFromStaffGroup,
  notifyTreasurerAppointed,
  notifyTreasurerRevoked,
};

