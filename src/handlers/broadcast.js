const { Markup } = require('telegraf');
const { requireAdmin } = require('../middleware/auth');
const { getActiveBroadcastRecipients, sendChurchBroadcast } = require('../services/broadcastService');
const { setSession, getSession, clearSession } = require('../utils/session');
const { getCancelKeyboard, getMainMenuKeyboard } = require('../utils/keyboards');

async function startBroadcastWizard(ctx) {
  const recipients = getActiveBroadcastRecipients();
  if (recipients.length === 0) {
    return ctx.reply('⚠️ No active church members with registered Telegram IDs found to receive a broadcast.');
  }

  setSession(ctx.from.id, {
    step: 'BROADCAST_WAIT_CONTENT',
    recipientsCount: recipients.length,
  });

  return ctx.reply(
    `📢 <b>Church Broadcast & Announcements</b>\n\n` +
    `👥 <b>Target Audience:</b> <b>${recipients.length}</b> active church members\n\n` +
    `Please send the announcement message you wish to broadcast:\n` +
    `• Send <b>plain text</b> (supports HTML formatting: bold, italic, links)\n` +
    `• Or send a <b>photo</b> with a caption (flyer / holiday greeting)\n` +
    `• Or send a <b>document</b> (PDF / program file)\n\n` +
    `<i>You will see a confirmation preview before anything is sent.</i>\n` +
    `Tap Cancel below at any time to abort:`,
    {
      parse_mode: 'HTML',
      ...getCancelKeyboard(),
    }
  );
}

function registerBroadcastHandlers(bot) {
  bot.command('broadcast', requireAdmin, startBroadcastWizard);
  bot.command('announce', requireAdmin, startBroadcastWizard);
  bot.hears(/^(?:📢\s*)?Broadcast (?:Message|Announcement)$/i, requireAdmin, startBroadcastWizard);

  bot.action('menu_broadcast', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    await startBroadcastWizard(ctx);
  });

  bot.action('broadcast_send_confirm', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);

    if (!session || session.step !== 'BROADCAST_CONFIRM_SEND') {
      return ctx.reply('⚠️ Broadcast draft expired or already sent. Please use /broadcast to start again.');
    }

    clearSession(userId);
    await ctx.reply(`⏳ <b>Sending broadcast to ${session.recipientsCount} church members...</b>\n<i>Please wait a moment.</i>`, {
      parse_mode: 'HTML',
    });

    try {
      const results = await sendChurchBroadcast({
        telegram: ctx.telegram,
        messageType: session.messageType || 'text',
        text: session.text || null,
        fileId: session.fileId || null,
        caption: session.caption || null,
        actorTelegramId: userId,
      });

      const seconds = (results.durationMs / 1000).toFixed(1);
      const report =
        `🎉 <b>Church Broadcast Completed!</b>\n\n` +
        `• <b>Total Recipients:</b> ${results.totalRecipients}\n` +
        `• <b>Delivered Successfully:</b> ${results.sentCount} ✅\n` +
        (results.blockedCount > 0 ? `• <b>Blocked / Unreachable:</b> ${results.blockedCount} 🚫\n` : '') +
        (results.failedCount > 0 ? `• <b>Failed:</b> ${results.failedCount} ❌\n` : '') +
        `• <b>Time Taken:</b> ${seconds}s\n\n` +
        `<i>Delivery has been recorded in the church audit log.</i>`;

      return ctx.reply(report, {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(ctx.state?.role || 'admin'),
      });
    } catch (err) {
      return ctx.reply(`❌ Broadcast failed: ${err.message}`, getMainMenuKeyboard(ctx.state?.role || 'admin'));
    }
  });
}

module.exports = {
  startBroadcastWizard,
  registerBroadcastHandlers,
};
