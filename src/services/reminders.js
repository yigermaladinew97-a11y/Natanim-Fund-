const { Markup } = require('telegraf');
const { getDatabase } = require('../db');
const { config } = require('../config');
const {
  formatMoney,
  getCurrentYearMonth,
  escapeHtml,
  formatPeriod,
  formatDate,
  formatDualMonth,
  formatDualDate,
} = require('../utils/formatters');
const { isValidTelegramId } = require('../utils/validators');
const { getUserLanguage } = require('./i18n');
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
  lang = 'am',
}) {
  const isAm = lang === 'am';
  if (isAm) {
    let msg = `📌 ሰላም <b>${escapeHtml(fullName)}</b> 🙏\n\n`;
    msg += `የ<b>${formatPeriod(month, 'am')}</b> የናታኒም ፈንድ መዋጮ ማስታወሻ፦\n\n`;
    msg += `💰 <b>የሚከፈል፦</b> <code>${balanceFormatted}</code> (እስከ ${formatDate(dueDate, 'am') || 'ወሩ መጨረሻ'})\n`;
    if (hasOlderDues && totalOutstandingFormatted) {
      msg += `⚠️ <b>ጠቅላላ ያለብዎት ዕዳ፦</b> <code>${totalOutstandingFormatted}</code>\n`;
    }
    msg += `🏦 <b>CBE ሂሳብ፦</b> <code>${cbeAccountNum}</code> (${escapeHtml(cbeAccountName)})\n`;
    msg += `💡 <i>(ቁጥሩን ነክተው ኮፒ ማድረግ ይችላሉ)</i>\n\n`;
    msg += `እባክዎ ክፍያውን እንደፈጸሙ ከታች ያለውን <b>«ደረሰኝ ላክ»</b> ቁልፍ በመጫን ደረሰኝዎን ይላኩ። እግዚአብሔር ይባርክዎ! 🙏`;
    return msg;
  }

  let msg = `📌 Greetings <b>${escapeHtml(fullName)}</b> 🙏\n\n`;
  msg += `This is a reminder for your <b>${formatPeriod(month, 'en')}</b> Natanim Fund contribution:\n\n`;
  msg += `💰 <b>Amount Due:</b> <code>${balanceFormatted}</code> (Due: ${formatDate(dueDate, 'en') || 'End of month'})\n`;
  if (hasOlderDues && totalOutstandingFormatted) {
    msg += `⚠️ <b>Total Outstanding Balance:</b> <code>${totalOutstandingFormatted}</code>\n`;
  }
  msg += `🏦 <b>CBE Account:</b> <code>${cbeAccountNum}</code> (${escapeHtml(cbeAccountName)})\n`;
  msg += `💡 <i>(Tap the number to copy it)</i>\n\n`;
  msg += `Please submit your receipt using the <b>«Submit Receipt»</b> button below once transferred. God bless you! 🙏`;
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

    const memberLang = getUserLanguage(m.telegram_id) || 'am';
    const isAm = memberLang === 'am';

    const message = buildReminderMessage({
      fullName: m.full_name,
      month,
      balanceFormatted,
      totalOutstandingFormatted,
      hasOlderDues,
      dueDate: m.due_date,
      cbeAccountNum,
      cbeAccountName,
      lang: memberLang,
    });

    const reminderKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback(isAm ? '📤 ደረሰኝ ላክ' : '📤 Submit Receipt', 'start_payment_submission')],
    ]);

    try {
      await tg.sendMessage(m.telegram_id, message, {
        parse_mode: 'HTML',
        ...reminderKeyboard,
      });
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
