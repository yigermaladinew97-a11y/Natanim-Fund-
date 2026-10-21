const { getMainMenuKeyboard } = require('../utils/keyboards');
const { clearSession } = require('../utils/session');
const { formatDate } = require('../utils/formatters');

function formatHelpMessage(role, fullName) {
  let msg = `🕊️ *Welcome to Natanim Fund Bot*\n`;
  msg += `*Church Monthly Contribution Management System*\n`;
  if (fullName) {
    msg += `👤 Logged in as: *${fullName}*\n`;
  }
  msg += `🔑 Role: *${role ? role.toUpperCase() : 'Registered Member'}*\n\n`;

  msg += `📋 *Member Commands:*\n`;
  msg += `• /mystatus — View your current monthly contribution status\n`;
  msg += `• /history — View your personal payment and obligation history\n`;
  msg += `• /myprofile — View your registered church profile details\n`;
  msg += `• /help — Show available commands\n`;
  msg += `• /cancel — Cancel an unfinished action\n\n`;

  if (role === 'treasurer' || role === 'admin') {
    msg += `💼 *Treasurer & Staff Commands:*\n`;
    msg += `• /paid — Record a verified payment for a member\n`;
    msg += `• /report — View the monthly financial report\n`;
    msg += `• /unpaid — List active members with outstanding balances\n`;
    msg += `• /members — Browse all active church fund members\n`;
    msg += `• /remind — Send private payment reminders to unpaid members\n\n`;
  }

  if (role === 'admin') {
    msg += `🛡️ *Administrator Commands:*\n`;
    msg += `• /addmember — Register a new member into the fund\n`;
    msg += `• /deactivate — Deactivate a member (preserves financial records)\n`;
    msg += `• /setamount — Set the standard monthly contribution amount\n`;
    msg += `• /roles — View and manage Treasurer privileges\n`;
    msg += `• /reversepayment — Securely reverse an incorrect payment transaction\n`;
    msg += `• /export — Export full monthly financial report as CSV document\n`;
    msg += `• /audit — View authorized system and financial audit history\n\n`;
  }

  msg += `ℹ️ *Privacy Note:* All contribution details are strictly confidential and only shown in private chat.`;
  return msg;
}

function registerStartHandlers(bot) {
  bot.command('start', async (ctx) => {
    const role = ctx.state?.role;
    const member = ctx.state?.member;
    const userId = ctx.from.id;

    clearSession(userId);

    let welcomeText = `🕊️ *Welcome to Natanim Fund Bot!*\n\n`;

    if (member) {
      welcomeText += `Hello, *${member.full_name}*! You are registered as an active member.\n`;
      welcomeText += `You can check your payment status, contribution history, and profile below.`;
    } else if (role === 'admin') {
      welcomeText += `Hello, *Administrator*! You can manage members, record payments, and oversee monthly finances.`;
    } else {
      welcomeText += `You are currently *not registered* as a member in Natanim Fund.\n\n`;
      welcomeText += `Your numeric Telegram ID is: \`${userId}\`\n\n`;
      welcomeText += `Please share this ID with your church team leader or administrator to be registered into the fund.`;
    }

    await ctx.reply(welcomeText, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(role),
    });
  });

  bot.command('help', async (ctx) => {
    const role = ctx.state?.role;
    const member = ctx.state?.member;
    const msg = formatHelpMessage(role, member?.full_name);
    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(role),
    });
  });

  bot.command('cancel', async (ctx) => {
    const userId = ctx.from.id;
    clearSession(userId);
    await ctx.reply('❌ Current operation has been cancelled.', {
      ...getMainMenuKeyboard(ctx.state?.role),
    });
  });

  bot.action('action_cancel', async (ctx) => {
    await ctx.answerCbQuery('Operation cancelled.');
    const userId = ctx.from.id;
    clearSession(userId);
    try {
      await ctx.editMessageText('❌ Operation cancelled.');
    } catch (_) {
      await ctx.reply('❌ Operation cancelled.');
    }
  });

  bot.command('myprofile', async (ctx) => {
    const member = ctx.state?.member;
    const userId = ctx.from.id;

    if (!member) {
      return ctx.reply(
        `👤 *Profile Not Registered*\n\n` +
        `Your Telegram User ID: \`${userId}\`\n\n` +
        `You are not yet registered as a member. Please contact the church administrator to add you.`,
        { parse_mode: 'Markdown' }
      );
    }

    const text =
      `👤 *My Registered Church Profile*\n\n` +
      `• *Full Name:* ${member.full_name}\n` +
      `• *Phone:* ${member.phone || 'Not provided'}\n` +
      `• *Telegram ID:* \`${member.telegram_id}\`\n` +
      `• *Member Status:* ${member.status === 'active' ? '🟢 Active' : '🔴 Inactive'}\n` +
      `• *Joined Date:* ${member.joined_date}\n` +
      `• *System Member ID:* #${member.id}`;

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  bot.action('menu_myprofile', async (ctx) => {
    await ctx.answerCbQuery();
    const member = ctx.state?.member;
    const userId = ctx.from.id;

    if (!member) {
      return ctx.reply(
        `👤 *Profile Not Registered*\n\n` +
        `Your Telegram User ID: \`${userId}\`\n\n` +
        `You are not yet registered as a member. Please contact the church administrator to add you.`,
        { parse_mode: 'Markdown' }
      );
    }

    const text =
      `👤 *My Registered Church Profile*\n\n` +
      `• *Full Name:* ${member.full_name}\n` +
      `• *Phone:* ${member.phone || 'Not provided'}\n` +
      `• *Telegram ID:* \`${member.telegram_id}\`\n` +
      `• *Member Status:* ${member.status === 'active' ? '🟢 Active' : '🔴 Inactive'}\n` +
      `• *Joined Date:* ${member.joined_date}\n` +
      `• *System Member ID:* #${member.id}`;

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });
}

module.exports = {
  registerStartHandlers,
};

