const { Markup } = require('telegraf');
const { getMainMenuKeyboard, getCancelReplyKeyboard } = require('../utils/keyboards');
const { setSession, clearSession } = require('../utils/session');
const { formatDate } = require('../utils/formatters');
const { getPendingRequestByTelegramId } = require('../services/memberService');

function formatHelpMessage(role, fullName, isPending = false) {
  let msg = `🕊️ *Welcome to Natanim Fund Bot*\n`;
  msg += `*Church Monthly Contribution Management System*\n`;
  if (fullName) {
    msg += `👤 Logged in as: *${fullName}*\n`;
  }
  msg += `🔑 Role: *${role ? role.toUpperCase() : (isPending ? 'Pending Approval' : 'Unregistered')}*\n\n`;

  if (isPending) {
    msg += `⏳ *Registration Status:*\n`;
    msg += `• Your membership request has been submitted and is under administrator review.\n\n`;
  } else if (!role && !fullName) {
    msg += `📝 *Registration:*\n`;
    msg += `• /register — Register yourself as a contributing church member\n\n`;
  }

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
    msg += `• /approvals — Review and approve pending member registrations\n`;
    msg += `• /addmember — Register a new member into the fund (backup option)\n`;
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
  function getUserKeyboardRole(ctx) {
    const role = ctx.state?.role;
    const member = ctx.state?.member;
    if (member && member.status === 'active') {
      return role || 'member';
    }
    if (role === 'admin' || role === 'treasurer') {
      return role;
    }
    const userId = ctx.from?.id;
    if (userId) {
      const pending = getPendingRequestByTelegramId(userId);
      if (pending) {
        return 'pending';
      }
    }
    return 'unregistered';
  }

  async function handleStartRegistration(ctx) {
    const userId = ctx.from.id;
    const member = ctx.state?.member;
    if (member && member.status === 'active') {
      return ctx.reply('✅ You are already registered as an active church member!', getMainMenuKeyboard(ctx.state?.role || 'member'));
    }

    const pending = getPendingRequestByTelegramId(userId);
    if (pending) {
      return ctx.reply(
        `⏳ *You already have a pending registration request!*\n\n` +
        `• *Full Name:* ${pending.full_name}\n` +
        `• *Phone:* ${pending.phone || 'Not provided'}\n` +
        `• *Submitted:* ${pending.created_at}\n\n` +
        `Church leadership has received your request and will review it shortly.`,
        { parse_mode: 'Markdown', ...getMainMenuKeyboard('pending') }
      );
    }

    setSession(userId, { step: 'SELF_REGISTER_WAIT_NAME' });
    await ctx.reply(
      `📝 *Church Member Registration — Step 1/2*\n\n` +
      `Welcome! Please enter your *Full Name* (e.g. \`Brother Daniel Bekele\`):`,
      {
        parse_mode: 'Markdown',
        ...getCancelReplyKeyboard(),
      }
    );
  }

  bot.command('start', async (ctx) => {
    const role = ctx.state?.role;
    const member = ctx.state?.member;
    const userId = ctx.from.id;

    clearSession(userId);

    let welcomeText = `🕊️ *Welcome to Natanim Fund Bot!*\n`;
    welcomeText += `*Church Monthly Contribution Management System*\n\n`;

    if (member && member.status === 'active') {
      welcomeText += `Hello, *${member.full_name}*! You are registered as an active member.\n`;
      welcomeText += `You can check your payment status, contribution history, and profile below.`;
      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(role || 'member'),
      });
    }

    if (role === 'admin') {
      welcomeText += `Hello, *Administrator*! You can manage members, review pending approvals, and oversee finances.`;
      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard('admin'),
      });
    }

    if (role === 'treasurer') {
      welcomeText += `Hello, *Treasurer*! You can record verified payments and view monthly reports.`;
      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard('treasurer'),
      });
    }

    // Pending registration check
    const pending = getPendingRequestByTelegramId(userId);
    if (pending) {
      welcomeText +=
        `⏳ *Your Registration is Pending Approval*\n\n` +
        `• *Full Name:* ${pending.full_name}\n` +
        `• *Phone:* ${pending.phone || 'Not provided'}\n` +
        `• *Submitted On:* ${pending.created_at}\n\n` +
        `Church leadership has received your request and is reviewing it. You will receive an instant notification here once approved!`;

      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard('pending'),
      });
    }

    // Inactive (deactivated) member re-registration check
    if (member && member.status === 'inactive') {
      welcomeText +=
        `⚠️ *Your Membership Account is Currently Inactive*\n\n` +
        `Your membership was deactivated. If you wish to re-join Natanim Church Fund, you can submit a registration request below for church leadership review.`;

      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Register as Member', 'start_self_register')],
        ]),
        ...getMainMenuKeyboard('unregistered'),
      });
    }

    welcomeText +=
      `You are not yet registered as a member in Natanim Fund.\n\n` +
      `Joining the fund allows you to contribute to church programs and track your monthly contributions transparently.\n\n` +
      `Tap *📝 Register as Member* below to submit your details for admin approval.`;

    await ctx.reply(welcomeText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📝 Register as Member', 'start_self_register')],
      ]),
      ...getMainMenuKeyboard('unregistered'),
    });
  });

  bot.command('register', handleStartRegistration);
  bot.hears(/^(?:📝\s*)?Register as Member$/i, handleStartRegistration);
  bot.action('start_self_register', async (ctx) => {
    await ctx.answerCbQuery();
    await handleStartRegistration(ctx);
  });

  bot.command('help', async (ctx) => {
    const role = ctx.state?.role;
    const member = ctx.state?.member;
    const userId = ctx.from.id;
    const pending = getPendingRequestByTelegramId(userId);

    const keyboardRole = getUserKeyboardRole(ctx);
    const msg = formatHelpMessage(role, member?.status === 'active' ? member.full_name : null, !!pending);
    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(keyboardRole),
    });
  });

  async function handleMyProfile(ctx) {
    const member = ctx.state?.member;
    const userId = ctx.from.id;

    if (!member) {
      const pending = getPendingRequestByTelegramId(userId);
      if (pending) {
        return ctx.reply(
          `⏳ *Registration Pending Approval*\n\n` +
          `• *Name:* ${pending.full_name}\n` +
          `• *Phone:* ${pending.phone || 'Not provided'}\n` +
          `• *Telegram ID:* \`${userId}\`\n` +
          `• *Submitted:* ${pending.created_at}\n\n` +
          `Your registration request is currently being reviewed by administrators.`,
          { parse_mode: 'Markdown', ...getMainMenuKeyboard('pending') }
        );
      }

      return ctx.reply(
        `👤 *Profile Not Registered*\n\n` +
        `Your Telegram User ID: \`${userId}\`\n\n` +
        `You are not yet registered as a member. Tap *📝 Register as Member* to sign up!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 Register as Member', 'start_self_register')],
          ]),
          ...getMainMenuKeyboard('unregistered'),
        }
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

    await ctx.reply(text, { parse_mode: 'Markdown', ...getMainMenuKeyboard(getUserKeyboardRole(ctx)) });
  }

  bot.command('cancel', async (ctx) => {
    const userId = ctx.from.id;
    clearSession(userId);
    await ctx.reply('❌ Current operation has been cancelled.', {
      ...getMainMenuKeyboard(getUserKeyboardRole(ctx)),
    });
  });

  bot.hears(/^(?:❌\s*)?Cancel(?: Operation)?$/i, async (ctx) => {
    const userId = ctx.from.id;
    clearSession(userId);
    await ctx.reply('❌ Current operation has been cancelled.', {
      ...getMainMenuKeyboard(getUserKeyboardRole(ctx)),
    });
  });

  bot.hears(/^(?:🏠\s*)?(?:Main Menu|Home)$/i, async (ctx) => {
    const userId = ctx.from.id;
    clearSession(userId);
    await ctx.reply('🏠 *Main Menu*', {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(getUserKeyboardRole(ctx)),
    });
  });

  bot.action('action_cancel', async (ctx) => {
    await ctx.answerCbQuery('Operation cancelled.');
    const userId = ctx.from.id;
    clearSession(userId);
    try {
      await ctx.editMessageText('❌ Operation cancelled.');
    } catch (_) {
      await ctx.reply('❌ Operation cancelled.', getMainMenuKeyboard(getUserKeyboardRole(ctx)));
    }
  });

  bot.command('myprofile', handleMyProfile);
  bot.hears(/^(?:👤\s*)?My Profile$/i, handleMyProfile);
  bot.action('menu_myprofile', async (ctx) => {
    await ctx.answerCbQuery();
    await handleMyProfile(ctx);
  });
}

module.exports = {
  registerStartHandlers,
};

