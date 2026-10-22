const { Markup } = require('telegraf');
const { requireStaff } = require('../middleware/auth');
const { sendMonthlyReminders } = require('../services/reminders');
const { listUnpaidMembersForMonth } = require('../services/accounting');
const { getCurrentYearMonth } = require('../utils/formatters');
const { getConfirmationKeyboard } = require('../utils/keyboards');

function registerReminderHandlers(bot) {
  async function handleRemindPrompt(ctx) {
    const currentMonth = getCurrentYearMonth();
    const unpaid = listUnpaidMembersForMonth(currentMonth);

    if (unpaid.length === 0) {
      return ctx.reply(`🎉 All members have fully paid for ${currentMonth}. No reminders needed!`);
    }

    const text =
      `📨 *Send Payment Reminders — ${currentMonth}*\n\n` +
      `There are currently *${unpaid.length}* active member(s) with an outstanding balance for this month.\n\n` +
      `Each member will receive a private reminder via direct message from this bot.\n` +
      `_A 72-hour cooldown is applied automatically to prevent duplicate or spam reminders._\n\n` +
      `Do you want to proceed?`;

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...getConfirmationKeyboard('remind_execute_confirm'),
    });
  }

  bot.command('remind', requireStaff, handleRemindPrompt);
  bot.hears(/^(?:📨\s*)?Send Reminders$/i, requireStaff, handleRemindPrompt);

  bot.action('menu_remind', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    await handleRemindPrompt(ctx);
  });

  bot.action('remind_execute_confirm', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('⏳ Sending private reminders to eligible members, please wait...');

    const currentMonth = getCurrentYearMonth();
    try {
      const results = await sendMonthlyReminders({
        bot,
        yearMonth: currentMonth,
        sentBy: ctx.from.id,
        force: false,
      });

      let text = `📬 *Reminder Dispatch Report — ${currentMonth}*\n\n`;
      text += `• Total Unpaid Members: *${results.totalEligible}*\n`;
      text += `• Successfully Delivered: *${results.sentCount}* ✅\n`;
      text += `• Skipped (Sent Recently): *${results.skippedCooldownCount}* ⏳\n`;
      text += `• Blocked / Not Started: *${results.blockedCount}* 🚫\n`;
      if (results.failedCount > 0) {
        text += `• Failed Deliveries: *${results.failedCount}* ❌\n`;
      }
      text += `\n_Reminder history and attempts have been logged to the audit system._`;

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply(`❌ Failed to send reminders: ${err.message}`);
    }
  });
}

module.exports = {
  registerReminderHandlers,
};

