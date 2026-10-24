const { getDatabase } = require('../db');
const { config } = require('../config');
const {
  formatMoney,
  getCurrentYearMonth,
  escapeHtml,
  formatDualMonth,
  formatDualDate,
} = require('../utils/formatters');
const { isValidTelegramId } = require('../utils/validators');
const {
  listUnpaidMembersForMonth,
  getCurrency,
  getCbeAccountNumber,
  getCbeAccountName,
  getMemberOutstandingTotal,
  ensureMonthlyObligations,
} = require('./accounting');

function isUnderCooldown(memberId, yearMonth, cooldownHours = 72) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT sent_at
    FROM reminder_log
    WHERE member_id = ? AND year_month = ? AND status = 'SENT'
    ORDER BY sent_at DESC
    LIMIT 1
  `).get(memberId, yearMonth);

  if (!row) return false;

  const lastSentTime = new Date(row.sent_at).getTime();
  const now = Date.now();
  const hoursSince = (now - lastSentTime) / (1000 * 60 * 60);

  return hoursSince < cooldownHours;
}

function buildReminderMessage({
  fullName,
  month,
  balanceFormatted,
  totalOutstandingFormatted,
  hasOlderDues,
  dueDate,
  cbeAccountNum,
  cbeAccountName,
}) {
  let msg = `🔔 <b>የወርሃዊ መዋጮ ማስታወሻ / Monthly Contribution Reminder</b>\n\n`;
  msg += `ሰላም <b>${escapeHtml(fullName)}</b>! 🙏\n`;
  msg += `ይህ የ <b>${formatDualMonth(month)}</b> ወርሃዊ የቤተክርስቲያን ፈንድ መዋጮ ማስታወሻ ነው።\n`;
  msg += `This is a friendly reminder regarding your church contribution for <b>${formatDualMonth(month)}</b>.\n\n`;
  msg += `💰 <b>የዚህ ወር ቀሪ ክፍያ / Month Due:</b> <code>${balanceFormatted}</code>\n`;
  if (hasOlderDues && totalOutstandingFormatted) {
    msg += `⚠️ <b>ጠቅላላ ያለብዎት ዕዳ / Total Outstanding:</b> <code>${totalOutstandingFormatted}</code>\n`;
  }
  msg += `⏰ <b>የመክፈያ ቀን / Due Date:</b> ${formatDualDate(dueDate) || 'ወሩ ከማለቁ በፊት'}\n\n`;
  msg += `🏦 <b>የባንክ ሂሳብ መረጃ (CBE Account):</b>\n`;
  msg += `• <b>Bank:</b> Commercial Bank of Ethiopia (CBE)\n`;
  msg += `• <b>Account Number:</b> <code>${cbeAccountNum}</code>\n`;
  msg += `• <b>Account Name:</b> ${escapeHtml(cbeAccountName)}\n`;
  msg += `💡 <i>(የሂሳብ ቁጥሩን በመንካት ኮፒ ማድረግ ይችላሉ / Tap account number to copy)</i>\n\n`;
  msg += `ክፍያውን በ CBE Mobile Banking፣ በ CBE Birr ወይም በቅርንጫፍ ከፈጸሙ በኋላ፣ ከታች ያለውን <b>📤 Submit Receipt / ደረሰኝ ላክ</b> ቁልፍ በመጫን የደረሰኙን ስክሪንሾት ወይም ፎቶ መላክ ይችላሉ።\n\n`;
  msg += `እግዚአብሔር ይስጥልን! / May God bless your faithful commitment! 🙏`;
  return msg;
}

function getUnpaidRemindersSummary(yearMonth) {
  const month = yearMonth || getCurrentYearMonth();
  ensureMonthlyObligations(month);

  const unpaidMembers = listUnpaidMembersForMonth(month);
  const currency = getCurrency();
  const cbeAccountNum = getCbeAccountNumber();
  const cbeAccountName = getCbeAccountName();

  let totalBalanceCents = 0;
  let reachableCount = 0;
  let unreachableCount = 0;

  for (const m of unpaidMembers) {
    totalBalanceCents += m.balance_cents;
    if (isValidTelegramId(m.telegram_id)) {
      reachableCount++;
    } else {
      unreachableCount++;
    }
  }

  const avgCents = unpaidMembers.length > 0 ? Math.round(totalBalanceCents / unpaidMembers.length) : 5000;
  const samplePreview = buildReminderMessage({
    fullName: 'ተጠቃሚ / Member Name',
    month,
    balanceFormatted: formatMoney(avgCents, currency),
    totalOutstandingFormatted: null,
    hasOlderDues: false,
    dueDate: unpaidMembers[0]?.due_date || 'End of month',
    cbeAccountNum,
    cbeAccountName,
  });

  return {
    month,
    totalUnpaid: unpaidMembers.length,
    reachableCount,
    unreachableCount,
    totalBalanceCents,
    totalBalanceFormatted: formatMoney(totalBalanceCents, currency),
    samplePreview,
    unpaidMembers,
  };
}

async function sendMonthlyReminders({
  bot,
  telegram,
  yearMonth,
  sentBy,
  force = false,
  throttleMs = 35,
}) {
  const tg = telegram || (bot && bot.telegram);
  if (!tg) {
    throw new Error('Telegram bot or telegram instance is required to send reminders.');
  }

  const month = yearMonth || getCurrentYearMonth();
  ensureMonthlyObligations(month);

  const unpaidMembers = listUnpaidMembersForMonth(month);
  const currency = getCurrency();
  const cbeAccountNum = getCbeAccountNumber();
  const cbeAccountName = getCbeAccountName();
  const cooldownHours = (config && config.reminderCooldownHours) || 72;

  const results = {
    month,
    totalEligible: unpaidMembers.length,
    reachableCount: 0,
    unreachableCount: 0,
    sentCount: 0,
    failedCount: 0,
    blockedCount: 0,
    skippedCooldownCount: 0,
    totalOutstandingCents: 0,
    details: [],
  };

  const db = getDatabase();
  const logStmt = db.prepare(`
    INSERT INTO reminder_log (member_id, telegram_id, year_month, status, error_message, sent_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const m of unpaidMembers) {
    results.totalOutstandingCents += m.balance_cents;

    if (!isValidTelegramId(m.telegram_id)) {
      results.unreachableCount++;
      results.details.push({
        memberId: m.member_id,
        fullName: m.full_name,
        telegramId: m.telegram_id,
        status: 'NO_TELEGRAM',
      });
      continue;
    }

    results.reachableCount++;

    if (!force && isUnderCooldown(m.member_id, month, cooldownHours)) {
      results.skippedCooldownCount++;
      results.details.push({
        memberId: m.member_id,
        fullName: m.full_name,
        telegramId: m.telegram_id,
        status: 'SKIPPED_COOLDOWN',
      });
      continue;
    }

    const balanceFormatted = formatMoney(m.balance_cents, currency);
    const totalOutstandingCents = getMemberOutstandingTotal(m.member_id);
    const hasOlderDues = totalOutstandingCents > m.balance_cents;
    const totalOutstandingFormatted = hasOlderDues ? formatMoney(totalOutstandingCents, currency) : null;

    const message = buildReminderMessage({
      fullName: m.full_name,
      month,
      balanceFormatted,
      totalOutstandingFormatted,
      hasOlderDues,
      dueDate: m.due_date,
      cbeAccountNum,
      cbeAccountName,
    });

    try {
      await tg.sendMessage(m.telegram_id, message, { parse_mode: 'HTML' });
      logStmt.run(m.member_id, m.telegram_id, month, 'SENT', null, String(sentBy));
      results.sentCount++;
      results.details.push({
        memberId: m.member_id,
        fullName: m.full_name,
        telegramId: m.telegram_id,
        status: 'SENT',
      });
    } catch (err) {
      let status = 'FAILED';
      const errMsg = err.message || 'Unknown Telegram error';

      if (
        errMsg.includes('bot was blocked by the user') ||
        errMsg.includes('chat not found') ||
        errMsg.includes('user is deactivated')
      ) {
        status = 'BLOCKED';
        results.blockedCount++;
      } else {
        results.failedCount++;
      }

      logStmt.run(m.member_id, m.telegram_id, month, status, errMsg, String(sentBy));
      results.details.push({
        memberId: m.member_id,
        fullName: m.full_name,
        telegramId: m.telegram_id,
        status,
        error: errMsg,
      });
    }

    if (throttleMs > 0) {
      await new Promise((r) => setTimeout(r, throttleMs));
    }
  }

  // Record audit entry
  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('SEND_REMINDERS', 'reminder_log', month, String(sentBy), JSON.stringify({
    month,
    sentCount: results.sentCount,
    failedCount: results.failedCount,
    blockedCount: results.blockedCount,
    skippedCooldownCount: results.skippedCooldownCount,
    unreachableCount: results.unreachableCount,
  }));

  return results;
}

module.exports = {
  isUnderCooldown,
  buildReminderMessage,
  getUnpaidRemindersSummary,
  sendMonthlyReminders,
};
