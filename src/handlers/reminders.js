const { Markup } = require('telegraf');
const { requireStaff } = require('../middleware/auth');
const { sendMonthlyReminders, getUnpaidRemindersSummary } = require('../services/reminders');
const { getCurrentYearMonth } = require('../utils/formatters');

function registerReminderHandlers(bot) {
  async function handleRemindPrompt(ctx) {
    const currentMonth = getCurrentYearMonth();
    const summary = getUnpaidRemindersSummary(currentMonth);

    if (summary.totalUnpaid === 0) {
      return ctx.reply(
        `🎉 <b>All Caught Up!</b>\n\nAll active church members have fully settled their contributions for <b>${summary.month}</b>.\nNo reminders needed!`,
        { parse_mode: 'HTML' }
      );
    }

    let text = `📨 <b>Send Payment Reminders — ${summary.month}</b>\n\n`;
    text += `📊 <b>Status Overview:</b>\n`;
    text += `• Total Unpaid Members: <b>${summary.totalUnpaid}</b>\n`;
    text += `• Reachable via Telegram: <b>${summary.reachableCount}</b>\n`;
    if (summary.unreachableCount > 0) {
      text += `• No Telegram Account (Offline): <b>${summary.unreachableCount}</b>\n`;
    }
    text += `• Total Outstanding Dues: <b>${summary.totalBalanceFormatted}</b>\n\n`;
    text += `ℹ️ <i>A 72-hour cooldown is automatically respected to prevent duplicate notifications.</i>\n\n`;
    text += `<b>Preview of the private reminder sent to members:</b>\n`;
    text += `───────────────────────\n`;
    text += `${summary.samplePreview}\n`;
    text += `───────────────────────\n\n`;
    text += `Would you like to dispatch reminders now?`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Send Reminders Now', 'remind_execute_confirm')],
      [Markup.button.callback('⚡ Send (Ignore 72h Cooldown)', 'remind_force_confirm')],
      [Markup.button.callback('❌ Cancel', 'action_cancel')],
    ]);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  }

  bot.command('remind', requireStaff, handleRemindPrompt);
  bot.command('send_reminders', requireStaff, handleRemindPrompt);
  bot.hears(/^(?:📨\s*)?(?:Send Reminders|ማስታወሻ ላክ)$/i, requireStaff, handleRemindPrompt);

  bot.action('menu_remind', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    await handleRemindPrompt(ctx);
  });

  async function executeReminders(ctx, force) {
    await ctx.answerCbQuery();
    await ctx.reply('⏳ <i>Dispatching personalized reminders to eligible members, please wait...</i>', {
      parse_mode: 'HTML',
    });

    const currentMonth = getCurrentYearMonth();
    try {
      const startTime = Date.now();
      const results = await sendMonthlyReminders({
        bot,
        yearMonth: currentMonth,
        sentBy: ctx.from.id,
        force,
        throttleMs: 35,
      });
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

      let text = `📬 <b>Reminder Dispatch Report — ${currentMonth}</b>\n\n`;
      text += `• Total Unpaid Members: <b>${results.totalEligible}</b>\n`;
      text += `• Successfully Delivered: <b>${results.sentCount}</b> ✅\n`;
      text += `• Skipped (Sent within 72h): <b>${results.skippedCooldownCount}</b> ⏳\n`;
      text += `• Blocked / Deactivated: <b>${results.blockedCount}</b> 🚫\n`;
      if (results.unreachableCount > 0) {
        text += `• No Telegram Account (Contact offline): <b>${results.unreachableCount}</b> 📞\n`;
      }
      if (results.failedCount > 0) {
        text += `• Delivery Failures: <b>${results.failedCount}</b> ❌\n`;
      }
      text += `• Duration: <b>${durationSec}s</b>\n\n`;
      text += `<i>All reminder events and timestamps have been logged to the church audit trail.</i>`;

      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ Failed to send reminders: ${err.message}`);
    }
  }

  bot.action('remind_execute_confirm', requireStaff, async (ctx) => {
    await executeReminders(ctx, false);
  });

  bot.action('remind_force_confirm', requireStaff, async (ctx) => {
    await executeReminders(ctx, true);
  });
}

module.exports = {
  registerReminderHandlers,
};
