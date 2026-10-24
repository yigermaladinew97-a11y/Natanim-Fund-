const { Markup } = require('telegraf');
const { getMainMenuKeyboard, getCancelReplyKeyboard, getLanguageSelectionKeyboard } = require('../utils/keyboards');
const { setSession, clearSession } = require('../utils/session');
const { formatDate, formatDualMonth, getEthiopianToday, getCurrentYearMonth } = require('../utils/formatters');
const { getPendingRequestByTelegramId } = require('../services/memberService');
const { getUserLanguage, setUserLanguage, t } = require('../services/i18n');

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
  msg += `• /language — Switch language / ቋንቋ ይምረጡ (አማርኛ / English)\n`;
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

  async function sendWelcomeMessage(ctx, lang = 'am') {
    const role = ctx.state?.role;
    const member = ctx.state?.member;
    const userId = ctx.from.id;
    const isAm = lang === 'am';

    let welcomeText = isAm
      ? `🕊️ *ወደ ናታኒም ፈንድ ቦት በደህና መጡ!*\n*የቤተክርስቲያን ወርሃዊ መዋጮ አስተዳደር ሥርዓት*\n\n`
      : `🕊️ *Welcome to Natanim Fund Bot!*\n*Church Monthly Contribution Management System*\n\n`;

    if (member && member.status === 'active') {
      welcomeText += isAm
        ? `ሰላም *${member.full_name}*! እንደ ንቁ አባል ተመዝግበዋል።\nየመዋጮ ሁኔታዎን፣ የክፍያ ታሪክዎን እና መገለጫዎን ከታች ማየት ይችላሉ።`
        : `Hello, *${member.full_name}*! You are registered as an active member.\nYou can check your payment status, contribution history, and profile below.`;
      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(role || 'member', lang, true),
      });
    }

    if (role === 'admin') {
      welcomeText += isAm
        ? `ሰላም *አስተዳዳሪ*! አባላትን ማስተዳደር፣ የምዝገባ ጥያቄዎችን ማጽደቅ እና ፋይናንስ መከታተል ይችላሉ።`
        : `Hello, *Administrator*! You can manage members, review pending approvals, and oversee finances.`;
      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard('admin', lang, true),
      });
    }

    if (role === 'treasurer') {
      welcomeText += isAm
        ? `ሰላም *ገንዘብ ያዥ*! የተረጋገጡ ክፍያዎችን መመዝገብ እና ወርሃዊ ሪፖርቶችን መመልከት ይችላሉ።`
        : `Hello, *Treasurer*! You can record verified payments and view monthly reports.`;
      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard('treasurer', lang, true),
      });
    }

    // Pending registration check
    const pending = getPendingRequestByTelegramId(userId);
    if (pending) {
      welcomeText += isAm
        ? `⏳ *የምዝገባ ጥያቄዎ በመጠባበቅ ላይ ነው*\n\n` +
          `• *ሙሉ ስም:* ${pending.full_name}\n` +
          `• *ስልክ ቁጥር:* ${pending.phone || 'አልተሰጠም'}\n` +
          `• *የቀረበበት ቀን:* ${pending.created_at}\n\n` +
          `የቤተክርስቲያን አመራሮች ጥያቄዎን በመገምገም ላይ ናቸው። ልክ እንደጸደቀ እዚህ ፈጣን ማሳወቂያ ይደርስዎታል!`
        : `⏳ *Your Registration is Pending Approval*\n\n` +
          `• *Full Name:* ${pending.full_name}\n` +
          `• *Phone:* ${pending.phone || 'Not provided'}\n` +
          `• *Submitted On:* ${pending.created_at}\n\n` +
          `Church leadership has received your request and is reviewing it. You will receive an instant notification here once approved!`;

      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard('pending', lang, true),
      });
    }

    // Inactive (deactivated) member re-registration check
    if (member && member.status === 'inactive') {
      welcomeText += isAm
        ? `⚠️ *የአባልነት መለያዎ በአሁኑ ጊዜ የታገደ ነው*\n\nየአባልነትዎ ሁኔታ ታግዷል። እንደገና የናታኒም ፈንድ አባል መሆን ከፈለጉ ከታች አዲስ የምዝገባ ጥያቄ ማቅረብ ይችላሉ።`
        : `⚠️ *Your Membership Account is Currently Inactive*\n\nYour membership was deactivated. If you wish to re-join Natanim Church Fund, you can submit a registration request below for church leadership review.`;

      return ctx.reply(welcomeText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(isAm ? '📝 እንደ አባል ይመዝገቡ' : '📝 Register as Member', 'start_self_register')],
        ]),
        ...getMainMenuKeyboard('unregistered', lang, true),
      });
    }

    welcomeText += isAm
      ? `እስካሁን በናታኒም ፈንድ ውስጥ እንደ አባል አልተመዘገቡም።\n\n` +
        `ፈንዱን መቀላቀል የቤተክርስቲያኗን አገልግሎቶች ለመደገፍ እና ወርሃዊ መዋጮዎን በግልፅ ለመከታተል ያስችላል።\n\n` +
        `ለመመዝገብ ከታች ያለውን *📝 እንደ አባል ይመዝገቡ* የሚለውን ይጫኑ።`
      : `You are not yet registered as a member in Natanim Fund.\n\n` +
        `Joining the fund allows you to contribute to church programs and track your monthly contributions transparently.\n\n` +
        `Tap *📝 Register as Member* below to submit your details for admin approval.`;

    await ctx.reply(welcomeText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(isAm ? '📝 እንደ አባል ይመዝገቡ' : '📝 Register as Member', 'start_self_register')],
      ]),
      ...getMainMenuKeyboard('unregistered', lang, true),
    });
  }

  async function handleStartRegistration(ctx) {
    const userId = ctx.from.id;
    const lang = ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';
    const member = ctx.state?.member;
    if (member && member.status === 'active') {
      const msg = isAm ? '✅ አስቀድመው እንደ ንቁ አባል ተመዝግበዋል!' : '✅ You are already registered as an active church member!';
      return ctx.reply(msg, getMainMenuKeyboard(ctx.state?.role || 'member', lang, true));
    }

    const pending = getPendingRequestByTelegramId(userId);
    if (pending) {
      const text = isAm
        ? `⏳ *አስቀድመው ያቀረቡት የምዝገባ ጥያቄ አለ!*\n\n` +
          `• *ሙሉ ስም:* ${pending.full_name}\n` +
          `• *ስልክ:* ${pending.phone || 'አልተሰጠም'}\n` +
          `• *የቀረበበት:* ${pending.created_at}\n\n` +
          `የቤተክርስቲያን አመራሮች ጥያቄዎን ተቀብለው በቅርቡ ይመለከቱታል።`
        : `⏳ *You already have a pending registration request!*\n\n` +
          `• *Full Name:* ${pending.full_name}\n` +
          `• *Phone:* ${pending.phone || 'Not provided'}\n` +
          `• *Submitted:* ${pending.created_at}\n\n` +
          `Church leadership has received your request and will review it shortly.`;
      return ctx.reply(text, { parse_mode: 'Markdown', ...getMainMenuKeyboard('pending', lang, true) });
    }

    setSession(userId, { step: 'SELF_REGISTER_WAIT_NAME' });
    const prompt = isAm
      ? `📝 *የአባልነት ምዝገባ — ደረጃ 1/2*\n\nእንኳን ደህና መጡ! እባክዎ *ሙሉ ስምዎን* ያስገቡ (ለምሳሌ \`ዲያቆን ዳንኤል በቀለ\`):`
      : `📝 *Church Member Registration — Step 1/2*\n\nWelcome! Please enter your *Full Name* (e.g. \`Brother Daniel Bekele\`):`;
    await ctx.reply(prompt, {
      parse_mode: 'Markdown',
      ...getCancelReplyKeyboard(lang),
    });
  }

  bot.command('start', async (ctx) => {
    const userId = ctx.from.id;
    clearSession(userId);

    const userLang = ctx.state?.language;
    if (!userLang) {
      // First-time or language unset -> prompt language selection first!
      return ctx.reply(
        `🕊️ *እንኳን ወደ ናታኒም ፈንድ ቦት በደህና መጡ!*\n` +
        `*የቤተክርስቲያን ወርሃዊ መዋጮ አስተዳደር ሥርዓት*\n` +
        `───────────────────────\n` +
        `🕊️ *Welcome to Natanim Fund Bot!*\n` +
        `*Church Monthly Contribution Management System*\n\n` +
        `🌐 *እባክዎ የሚመርጡትን ቋንቋ ይምረጡ / Please choose your preferred language:*`,
        {
          parse_mode: 'Markdown',
          ...getLanguageSelectionKeyboard(),
        }
      );
    }

    await sendWelcomeMessage(ctx, userLang);
  });

  bot.action(/^set_lang_(am|en)$/, async (ctx) => {
    const selectedLang = ctx.match[1];
    const userId = ctx.from.id;
    setUserLanguage(userId, selectedLang);
    if (ctx.state) {
      ctx.state.language = selectedLang;
    }

    const toastMsg = selectedLang === 'am' ? 'ቋንቋ ወደ አማርኛ ተቀናብሯል' : 'Language set to English';
    await ctx.answerCbQuery(toastMsg);

    await sendWelcomeMessage(ctx, selectedLang);
  });

  async function handleLanguagePrompt(ctx) {
    const currentLang = ctx.state?.language || getUserLanguage(ctx.from?.id) || 'am';
    const isAm = currentLang === 'am';
    const text = isAm
      ? `🌐 <b>የቋንቋ ምርጫ / Language Settings</b>\n\nየአሁኑ ቋንቋዎ: <b>🇪🇹 አማርኛ</b>\nየሚመርጡትን ቋንቋ ከታች ይምረጡ:`
      : `🌐 <b>Language Settings / የቋንቋ ምርጫ</b>\n\nYour current language: <b>🇬🇧 English</b>\nPlease choose your preferred language below:`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...getLanguageSelectionKeyboard(),
    });
  }

  bot.command('language', handleLanguagePrompt);
  bot.command('lang', handleLanguagePrompt);
  bot.command('ቋንቋ', handleLanguagePrompt);
  bot.hears(/^(?:🌐\s*)?(?:Language|ቋንቋ|ቋንቋ \/ Language|Language \/ ቋንቋ)$/i, handleLanguagePrompt);
  bot.action('menu_language', async (ctx) => {
    await ctx.answerCbQuery();
    await handleLanguagePrompt(ctx);
  });

  bot.command('register', handleStartRegistration);
  bot.hears(/^(?:📝\s*)?(?:Register as Member|እንደ አባል ይመዝገቡ)$/i, handleStartRegistration);
  bot.action('start_self_register', async (ctx) => {
    await ctx.answerCbQuery();
    await handleStartRegistration(ctx);
  });

  bot.command('help', async (ctx) => {
    const role = ctx.state?.role;
    const member = ctx.state?.member;
    const userId = ctx.from.id;
    const pending = getPendingRequestByTelegramId(userId);
    const lang = ctx.state?.language || getUserLanguage(userId) || 'am';

    const keyboardRole = getUserKeyboardRole(ctx);
    const msg = formatHelpMessage(role, member?.status === 'active' ? member.full_name : null, !!pending);
    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(keyboardRole, lang, true),
    });
  });

  async function handleMyProfile(ctx) {
    const member = ctx.state?.member;
    const userId = ctx.from.id;
    const lang = ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';

    if (!member) {
      const pending = getPendingRequestByTelegramId(userId);
      if (pending) {
        return ctx.reply(
          isAm
            ? `⏳ *የምዝገባ ጥያቄ በመጠባበቅ ላይ*\n\n` +
              `• *ስም:* ${pending.full_name}\n` +
              `• *ስልክ:* ${pending.phone || 'አልተሰጠም'}\n` +
              `• *ቴሌግራም መለያ:* \`${userId}\`\n` +
              `• *የቀረበበት ቀን:* ${pending.created_at}\n\n` +
              `የምዝገባ ጥያቄዎ በአስተዳዳሪዎች እየተገመገመ ነው።`
            : `⏳ *Registration Pending Approval*\n\n` +
              `• *Name:* ${pending.full_name}\n` +
              `• *Phone:* ${pending.phone || 'Not provided'}\n` +
              `• *Telegram ID:* \`${userId}\`\n` +
              `• *Submitted:* ${pending.created_at}\n\n` +
              `Your registration request is currently being reviewed by administrators.`,
          { parse_mode: 'Markdown', ...getMainMenuKeyboard('pending', lang, true) }
        );
      }

      return ctx.reply(
        isAm
          ? `👤 *መገለጫ አልተመዘገበም*\n\n` +
            `የቴሌግራም መታወቂያዎ: \`${userId}\`\n\n` +
            `እስካሁን እንደ አባል አልተመዘገቡም። ለመመዝገብ ከታች ያለውን *📝 እንደ አባል ይመዝገቡ* የሚለውን ይጫኑ!`
          : `👤 *Profile Not Registered*\n\n` +
            `Your Telegram User ID: \`${userId}\`\n\n` +
            `You are not yet registered as a member. Tap *📝 Register as Member* to sign up!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(isAm ? '📝 እንደ አባል ይመዝገቡ' : '📝 Register as Member', 'start_self_register')],
          ]),
          ...getMainMenuKeyboard('unregistered', lang, true),
        }
      );
    }

    const text = isAm
      ? `👤 *የተመዘገበ የቤተክርስቲያን አባል መገለጫ*\n\n` +
        `• *ሙሉ ስም:* ${member.full_name}\n` +
        `• *ስልክ:* ${member.phone || 'አልተሰጠም'}\n` +
        `• *ቴሌግራም መለያ:* \`${member.telegram_id}\`\n` +
        `• *የአባልነት ሁኔታ:* ${member.status === 'active' ? '🟢 ንቁ (Active)' : '🔴 የታገደ (Inactive)'}\n` +
        `• *የተመዘገበበት ቀን:* ${member.joined_date}\n` +
        `• *የስርዓት አባል መለያ:* #${member.id}`
      : `👤 *My Registered Church Profile*\n\n` +
        `• *Full Name:* ${member.full_name}\n` +
        `• *Phone:* ${member.phone || 'Not provided'}\n` +
        `• *Telegram ID:* \`${member.telegram_id}\`\n` +
        `• *Member Status:* ${member.status === 'active' ? '🟢 Active' : '🔴 Inactive'}\n` +
        `• *Joined Date:* ${member.joined_date}\n` +
        `• *System Member ID:* #${member.id}`;

    await ctx.reply(text, { parse_mode: 'Markdown', ...getMainMenuKeyboard(getUserKeyboardRole(ctx), lang, true) });
  }

  bot.command('cancel', async (ctx) => {
    const userId = ctx.from.id;
    const lang = ctx.state?.language || getUserLanguage(userId) || 'am';
    clearSession(userId);
    await ctx.reply(lang === 'am' ? '❌ ክዋኔው ተሰርዟል።' : '❌ Current operation has been cancelled.', {
      ...getMainMenuKeyboard(getUserKeyboardRole(ctx), lang, true),
    });
  });

  bot.hears(/^(?:❌\s*)?(?:Cancel(?: Operation)?|ሰርዝ)$/i, async (ctx) => {
    const userId = ctx.from.id;
    const lang = ctx.state?.language || getUserLanguage(userId) || 'am';
    clearSession(userId);
    await ctx.reply(lang === 'am' ? '❌ ክዋኔው ተሰርዟል።' : '❌ Current operation has been cancelled.', {
      ...getMainMenuKeyboard(getUserKeyboardRole(ctx), lang, true),
    });
  });

  bot.hears(/^(?:🏠\s*)?(?:Main Menu|Home|ዋና ምናሌ)$/i, async (ctx) => {
    const userId = ctx.from.id;
    const lang = ctx.state?.language || getUserLanguage(userId) || 'am';
    clearSession(userId);
    await ctx.reply(lang === 'am' ? '🏠 *ዋና ምናሌ*' : '🏠 *Main Menu*', {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(getUserKeyboardRole(ctx), lang, true),
    });
  });

  bot.action('action_cancel', async (ctx) => {
    await ctx.answerCbQuery('Operation cancelled.');
    const userId = ctx.from.id;
    const lang = ctx.state?.language || getUserLanguage(userId) || 'am';
    clearSession(userId);
    try {
      await ctx.editMessageText(lang === 'am' ? '❌ ክዋኔው ተሰርዟል።' : '❌ Operation cancelled.');
    } catch (_) {
      await ctx.reply(lang === 'am' ? '❌ ክዋኔው ተሰርዟል።' : '❌ Operation cancelled.', getMainMenuKeyboard(getUserKeyboardRole(ctx), lang, true));
    }
  });

  bot.command('myprofile', handleMyProfile);
  bot.hears(/^(?:👤\s*)?(?:My Profile|መገለጫዬ)$/i, handleMyProfile);
  bot.action('menu_myprofile', async (ctx) => {
    await ctx.answerCbQuery();
    await handleMyProfile(ctx);
  });

  // ==========================================
  // /calendar & /date - Ethiopian Calendar Info
  // ==========================================
  async function handleEthiopianCalendar(ctx) {
    const today = getEthiopianToday();
    const gregStr = new Date().toISOString().slice(0, 10);
    const currentMonth = getCurrentYearMonth();

    let text = `📅 <b>የኢትዮጵያ ቀን መቁጠሪያ / Ethiopian Calendar</b>\n\n`;
    text += `• <b>ዛሬ / Today (ዓ.ም.):</b> <code>${today.formattedAm}</code>\n`;
    text += `• <b>Today (E.C.):</b> <code>${today.formattedEn}</code>\n`;
    text += `• <b>Gregorian Date:</b> <code>${gregStr}</code>\n`;
    text += `• <b>Current Church Period:</b> <code>${formatDualMonth(currentMonth)}</code>\n\n`;
    text += `💡 <i>ሁሉም የወርሃዊ መዋጮ ደረሰኞች፣ ሁኔታዎች እና ማስታወሻዎች በኢትዮጵያ እና በፈረንጅ ቀን መቁጠሪያ በአንድ ላይ ይቀርባሉ።</i>\n`;
    text += `<i>(All monthly obligations, receipts, and reminders display both Ethiopian and Gregorian dates.)</i>`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  bot.command('calendar', handleEthiopianCalendar);
  bot.command('date', handleEthiopianCalendar);
}

module.exports = {
  registerStartHandlers,
};

