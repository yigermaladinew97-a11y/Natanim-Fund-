const { getDatabase } = require('../db');
const { config } = require('../config');
const { formatMoney, getCurrentYearMonth } = require('../utils/formatters');
const { listUnpaidMembersForMonth, getCurrency } = require('./accounting');

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

async function sendMonthlyReminders({ bot, yearMonth, sentBy, force = false }) {
  const month = yearMonth || getCurrentYearMonth();
  const unpaidMembers = listUnpaidMembersForMonth(month);
  const currency = getCurrency();
  const cooldownHours = config.reminderCooldownHours;

  const results = {
    totalEligible: unpaidMembers.length,
    sentCount: 0,
    failedCount: 0,
    blockedCount: 0,
    skippedCooldownCount: 0,
    details: [],
  };

  const db = getDatabase();
  const logStmt = db.prepare(`
    INSERT INTO reminder_log (member_id, telegram_id, year_month, status, error_message, sent_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const m of unpaidMembers) {
    if (!force && isUnderCooldown(m.member_id, month, cooldownHours)) {
      results.skippedCooldownCount++;
      results.details.push({
        fullName: m.full_name,
        telegramId: m.telegram_id,
        status: 'SKIPPED_COOLDOWN',
      });
      continue;
    }

    const balanceFormatted = formatMoney(m.balance_cents, currency);
    const message =
      `🕊️ *Peace and blessings, ${m.full_name}*\n\n` +
      `This is a gentle, private reminder from *Natanim Fund* regarding your monthly church contribution.\n\n` +
      `📅 *Period:* ${month}\n` +
      `💰 *Outstanding Balance:* ${balanceFormatted}\n` +
      `⏰ *Due Date:* ${m.due_date}\n\n` +
      `You may make your contribution via *Cash*, *Bank Transfer*, or *Mobile Money* and notify the church leader or treasurer once completed.\n\n` +
      `Thank you for your faithful commitment and generous support! 🙏`;

    try {
      await bot.telegram.sendMessage(m.telegram_id, message, { parse_mode: 'Markdown' });
      logStmt.run(m.member_id, m.telegram_id, month, 'SENT', null, String(sentBy));
      results.sentCount++;
      results.details.push({
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
        fullName: m.full_name,
        telegramId: m.telegram_id,
        status,
        error: errMsg,
      });
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
  }));

  return results;
}

module.exports = {
  isUnderCooldown,
  sendMonthlyReminders,
};

