const { Markup } = require('telegraf');
const { getSession, setSession, clearSession } = require('../utils/session');
const { isValidTelegramId, sanitizeText, isValidYearMonth } = require('../utils/validators');
const {
  registerMember,
  deactivateMember,
  getMemberById,
  getMemberByTelegramId,
  getAllActiveMembers,
  createRegistrationRequest,
  notifyAdminsNewRegistration,
} = require('../services/memberService');
const {
  setStandardAmountCents,
  getStandardAmountCents,
  getCurrency,
  reversePayment,
  getPaymentByTxId,
  getOrCreateObligation,
  createPaymentSubmission,
  notifyStaffNewPaymentSubmission,
  setBankInfo,
  setCbeAccountDetails,
  validateSubmissionMonth,
} = require('../services/accounting');
const {
  parseMoneyToCents,
  formatMoney,
  getCurrentYearMonth,
  formatPaymentMethod,
  escapeHtml,
  formatDualMonth,
  formatPeriod,
  isAcademicMonth,
  getNextAcademicMonthsList,
} = require('../utils/formatters');
const { getUserLanguage } = require('../services/i18n');
const { getPaymentMethodKeyboard, getCancelKeyboard, getCancelReplyKeyboard, getMainMenuKeyboard } = require('../utils/keyboards');
const { showPaymentConfirmation } = require('./payments');
const { assignRole } = require('../services/permissions');
const { notifyTreasurerAppointed, getStaffGroupId } = require('../services/staffArchive');
const { isTursoConfigured, pushToTurso } = require('../services/tursoService');

const MENU_BUTTON_PATTERNS = [
  /^(?:📊\s*)?(?:My Status|ሁኔታዬ)$/i,
  /^(?:📜\s*)?(?:My History|ታሪኬ)$/i,
  /^(?:👤\s*)?(?:My Profile|መገለጫዬ)$/i,
  /^(?:💰\s*)?(?:Record Payment|ክፍያ መዝግብ)$/i,
  /^(?:📑\s*)?(?:Monthly Report|ወርሃዊ ሪፖርት)$/i,
  /^(?:👥\s*)?(?:Members List|የአባላት ዝርዝር)$/i,
  /^(?:⏳\s*)?(?:Unpaid List|ያልከፈሉ አባላት)$/i,
  /^(?:📨\s*)?(?:Send Reminders|ማስታወሻ ላክ)$/i,
  /^(?:➕\s*)?(?:Add Member|አባል መዝግብ)$/i,
  /^(?:📥\s*)?(?:Pending Approvals|ማጽደቂያዎች)$/i,
  /^(?:📝\s*)?(?:Register as Member|እንደ አባል ይመዝገቡ)$/i,
  /^(?:📤\s*)?(?:Submit (?:Payment )?Receipt|ደረሰኝ ላክ)$/i,
  /^(?:💳\s*)?(?:Verify Receipts|ደረሰኝ አረጋግጥ)$/i,
  /^(?:🛑\s*)?(?:Deactivate Member|አባል አግድ)$/i,
  /^(?:⚙️\s*)?(?:Set Standard Amount|መዋጮ መጠን)$/i,
  /^(?:🛡️\s*)?(?:Manage Roles|ሚናዎች)$/i,
  /^(?:🔄\s*)?(?:Reverse Payment|ክፍያ መልስ)$/i,
  /^(?:📁\s*)?(?:Export CSV|CSV ኤክስፖርት)$/i,
  /^(?:🔍\s*)?(?:Audit Log|ኦዲት መዝገብ)$/i,
  /^(?:🏦\s*)?(?:Church\s+)?(?:Bank\s+)?Accounts(?: Details)?$/i,
  /^(?:🏦\s*)?(?:Edit (?:Church )?(?:CBE|Bank)?\s*Accounts?|የCBE ሂሳብ)$/i,
  /^(?:📢\s*)?(?:Broadcast (?:Message|Announcement)|መልእክት አሰራጭ)$/i,
  /^(?:🏠\s*)?(?:Main Menu|Home|ዋና ምናሌ)$/i,
  /^(?:🌐\s*)?(?:Language|ቋንቋ)$/i,
];

function registerWizardHandler(bot) {
  async function finishSelfRegistration(ctx, userId, fullName, phone) {
    clearSession(userId);
    try {
      const request = createRegistrationRequest({
        telegramId: userId,
        username: ctx.from.username || null,
        fullName,
        phone,
      });

      await ctx.reply(
        `🎉 *Registration Request Submitted!*\n\n` +
        `Thank you, *${fullName}*!\n` +
        `Your request to join *Natanim Church Fund* has been received.\n\n` +
        `📋 *Details Submitted:*\n` +
        `• *Full Name:* ${fullName}\n` +
        `• *Phone:* ${phone}\n` +
        `• *Telegram ID:* \`${userId}\`\n\n` +
        `⏳ *What happens next?*\n` +
        `The church administrator has received an instant notification to review your request. You will receive a confirmation message right here as soon as it is approved!`,
        {
          parse_mode: 'Markdown',
          ...getMainMenuKeyboard('pending'),
        }
      );

      // Notify administrators
      try {
        await notifyAdminsNewRegistration(ctx.telegram, request);
      } catch (adminErr) {
        console.warn('[Registration] Failed to notify admins:', adminErr.message);
      }

      // Async cloud persistence push
      if (isTursoConfigured()) {
        pushToTurso().catch((e) => console.warn('[Turso] Async registration push notice:', e.message));
      }
    } catch (err) {
      return ctx.reply(`❌ Registration submission failed: ${err.message}`, getMainMenuKeyboard('unregistered'));
    }
  }

  bot.on('contact', async (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || session.step !== 'SELF_REGISTER_WAIT_PHONE') {
      return;
    }

    const contact = ctx.message.contact;
    const phone = contact?.phone_number ? sanitizeText(contact.phone_number, 30) : null;
    if (!phone) {
      return ctx.reply('❌ Could not read phone number. Please type your phone number directly in the chat:');
    }

    return finishSelfRegistration(ctx, userId, session.fullName, phone);
  });

  function promptMemberForPaymentMonths(ctx, userId, session, month) {
    const lang = session.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';

    setSession(userId, {
      ...session,
      lang,
      step: 'MEMBER_SUBMIT_WAIT_MONTHS',
      selectedMonth: month,
    });

    const standardAmount = getStandardAmountCents();
    const currency = getCurrency();

    const monthButtons = isAm
      ? [
          [
            Markup.button.callback(`1 ወር (${formatMoney(standardAmount, currency)})`, 'mem_sub_cnt_1'),
            Markup.button.callback(`2 ወራት (${formatMoney(standardAmount * 2, currency)})`, 'mem_sub_cnt_2'),
            Markup.button.callback(`3 ወራት (${formatMoney(standardAmount * 3, currency)})`, 'mem_sub_cnt_3'),
          ],
          [
            Markup.button.callback(`4 ወራት (${formatMoney(standardAmount * 4, currency)})`, 'mem_sub_cnt_4'),
            Markup.button.callback(`5 ወራት (ሴሚስተር)`, 'mem_sub_cnt_5'),
            Markup.button.callback(`🎓 9 ወራት (ሙሉ ዓመት)`, 'mem_sub_cnt_9'),
          ],
          [
            Markup.button.callback('❌ ሰርዝ', 'action_cancel'),
          ],
        ]
      : [
          [
            Markup.button.callback(`1 Month (${formatMoney(standardAmount, currency)})`, 'mem_sub_cnt_1'),
            Markup.button.callback(`2 Months (${formatMoney(standardAmount * 2, currency)})`, 'mem_sub_cnt_2'),
            Markup.button.callback(`3 Months (${formatMoney(standardAmount * 3, currency)})`, 'mem_sub_cnt_3'),
          ],
          [
            Markup.button.callback(`4 Months (${formatMoney(standardAmount * 4, currency)})`, 'mem_sub_cnt_4'),
            Markup.button.callback(`5 Months (Semester)`, 'mem_sub_cnt_5'),
            Markup.button.callback(`🎓 9 Months (Full Year)`, 'mem_sub_cnt_9'),
          ],
          [
            Markup.button.callback('❌ Cancel', 'action_cancel'),
          ],
        ];

    const promptText = isAm
      ? `📅 <b>መነሻ ወር፦</b> ${formatPeriod(month, 'am')}\n\n` +
        `ይህ ክፍያ ስንት ወራት ይሸፍናል?\n` +
        `ከታች ካሉት አማራጮች አንዱን ይምረጡ፦`
      : `📅 <b>Start Month:</b> ${formatPeriod(month, 'en')}\n\n` +
        `How many months does this payment cover?\n` +
        `Please select an option below:`;

    return ctx.reply(promptText, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(monthButtons),
    });
  }

  function promptMemberForPaymentAmount(ctx, userId, session, monthsCount) {
    const lang = session.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';
    const count = Math.max(1, Math.min(24, parseInt(monthsCount, 10) || 1));
    const startMonth = session.selectedMonth;
    const standardAmount = getStandardAmountCents();
    const currency = getCurrency();

    const academicMonths = getNextAcademicMonthsList(startMonth, count);
    const endMonth = academicMonths[academicMonths.length - 1];

    const totalDue = count * standardAmount;

    const startDisplay = formatPeriod(startMonth, isAm ? 'am' : 'en');
    const endDisplay = formatPeriod(endMonth, isAm ? 'am' : 'en');
    const periodDisplay = count === 1
      ? startDisplay
      : (isAm ? `${startDisplay} እስከ ${endDisplay} (${count} ወራት)` : `${startDisplay} to ${endDisplay} (${count} months)`);

    setSession(userId, {
      ...session,
      lang,
      step: 'MEMBER_SUBMIT_WAIT_AMOUNT',
      monthsCount: count,
      periodDisplay,
      dueBalance: totalDue,
    });

    const buttons = [
      [Markup.button.callback(isAm ? `💰 ${formatMoney(totalDue, currency)} አረጋግጥ` : `💰 Confirm ${formatMoney(totalDue, currency)}`, `mem_sub_amt_${totalDue}`)],
      [Markup.button.callback(isAm ? '❌ ሰርዝ' : '❌ Cancel', 'action_cancel')],
    ];

    const promptText = isAm
      ? `📅 <b>የሚሸፈነው ጊዜ፦</b> ${periodDisplay}\n` +
        `🎯 <b>የሚከፈል መዋጮ፦</b> <code>${formatMoney(totalDue, currency)}</code>\n\n` +
        `መጠኑን ለማረጋገጥ ከታች ያለውን ቁልፍ ይጫኑ፦`
      : `📅 <b>Covered Period:</b> ${periodDisplay}\n` +
        `🎯 <b>Contribution Due:</b> <code>${formatMoney(totalDue, currency)}</code>\n\n` +
        `Please confirm the payment amount below:`;

    return ctx.reply(promptText, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  async function handleProofUpload(ctx, fileId, fileUniqueId, caption) {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || session.step !== 'MEMBER_SUBMIT_WAIT_PHOTO') {
      return false;
    }

    const lang = session.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';

    clearSession(userId);
    const currency = getCurrency();

    try {
      const monthsCount = session.monthsCount || 1;
      const periodDisplay = session.periodDisplay || session.selectedMonth;

      const submission = createPaymentSubmission({
        memberId: session.memberId,
        telegramId: userId,
        yearMonth: session.selectedMonth,
        amountCents: session.amountCents,
        paymentMethod: session.paymentMethod,
        referenceNumber: caption || null,
        monthsCount,
        fileId,
        fileUniqueId,
        caption,
      });

      const userRole = ctx.state?.role || 'member';

      const replyText = isAm
        ? `✅ <b>የመዋጮ ደረሰኝዎ ደርሶናል!</b>\n\n` +
          `እናመሰግናለን <b>${escapeHtml(session.memberName)}</b>! 🙏\n` +
          `የ${periodDisplay} <code>${formatMoney(session.amountCents, currency)}</code> ደረሰኝዎ ለአስተዳዳሪዎች ተልኳል።\n\n` +
          `⏳ <i>ክፍያው እንደተረጋገጠ ማረጋገጫ መልእክት ይደርስዎታል። እግዚአብሔር ይባርክዎ!</i> ✨`
        : `✅ <b>Payment Receipt Received!</b>\n\n` +
          `Thank you, <b>${escapeHtml(session.memberName)}</b>! 🙏\n` +
          `Your receipt of <code>${formatMoney(session.amountCents, currency)}</code> for <b>${periodDisplay}</b> has been submitted to leadership.\n\n` +
          `⏳ <i>You will receive a confirmation once it is verified. God bless you!</i> ✨`;

      await ctx.reply(replyText, {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(userRole, isAm ? 'am' : 'en'),
      });

      // Notify staff
      try {
        await notifyStaffNewPaymentSubmission(ctx.telegram, submission);
      } catch (staffErr) {
        console.warn('[Payment] Could not notify staff:', staffErr.message);
      }

      // Async cloud persistence push
      if (isTursoConfigured()) {
        pushToTurso().catch((e) => console.warn('[Turso] Async payment submission push notice:', e.message));
      }
      return true;
    } catch (err) {
      await ctx.reply(
        isAm ? `❌ ደረሰኙን ማስረከብ አልተቻለም፦ ${err.message}` : `❌ Could not submit receipt: ${err.message}`,
        getMainMenuKeyboard(ctx.state?.role || 'member', isAm ? 'am' : 'en')
      );
      return true;
    }
  }

  bot.on('photo', async (ctx, next) => {
    const userId = ctx.from.id;
    const session = getSession(userId);

    if (session && session.step === 'BROADCAST_WAIT_CONTENT') {
      const photos = ctx.message.photo;
      if (!photos || photos.length === 0) return next();
      const largest = photos[photos.length - 1];
      const caption = ctx.message.caption || '';

      setSession(userId, {
        ...session,
        step: 'BROADCAST_CONFIRM_SEND',
        messageType: 'photo',
        fileId: largest.file_id,
        caption,
      });

      const confirmButtons = [
        [Markup.button.callback('🚀 Send Broadcast Now', 'broadcast_send_confirm')],
        [Markup.button.callback('❌ Cancel', 'action_cancel')],
      ];

      await ctx.replyWithPhoto(largest.file_id, {
        caption:
          `📢 <b>Broadcast Preview:</b>\n` +
          `────────────────────\n` +
          (caption ? `${caption}\n` : '') +
          `────────────────────\n` +
          `👥 <b>Target Audience:</b> ${session.recipientsCount} active church members\n\n` +
          `⚠️ <i>Send this photo broadcast to all members now?</i>`,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(confirmButtons),
      });
      return;
    }

    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return next();
    const largest = photos[photos.length - 1];
    const handled = await handleProofUpload(ctx, largest.file_id, largest.file_unique_id, ctx.message.caption);
    if (!handled) return next();
  });

  bot.on('document', async (ctx, next) => {
    const userId = ctx.from.id;
    const session = getSession(userId);

    if (session && session.step === 'BROADCAST_WAIT_CONTENT') {
      const doc = ctx.message.document;
      if (!doc) return next();
      const caption = ctx.message.caption || '';

      setSession(userId, {
        ...session,
        step: 'BROADCAST_CONFIRM_SEND',
        messageType: 'document',
        fileId: doc.file_id,
        caption,
      });

      const confirmButtons = [
        [Markup.button.callback('🚀 Send Broadcast Now', 'broadcast_send_confirm')],
        [Markup.button.callback('❌ Cancel', 'action_cancel')],
      ];

      await ctx.replyWithDocument(doc.file_id, {
        caption:
          `📢 <b>Broadcast Document Preview:</b>\n` +
          `────────────────────\n` +
          (caption ? `${caption}\n` : '') +
          `────────────────────\n` +
          `👥 <b>Target Audience:</b> ${session.recipientsCount} active church members\n\n` +
          `⚠️ <i>Send this document broadcast to all members now?</i>`,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(confirmButtons),
      });
      return;
    }

    const doc = ctx.message.document;
    if (!doc) return next();
    const isImage = doc.mime_type && doc.mime_type.startsWith('image/');
    if (isImage) {
      const handled = await handleProofUpload(ctx, doc.file_id, doc.file_unique_id, ctx.message.caption);
      if (handled) return;
    }
    return next();
  });

  bot.on('text', async (ctx, next) => {
    // If it's a bot command (starts with /), let normal command handlers run
    if (ctx.message.text.startsWith('/')) {
      return next();
    }

    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || !session.step) {
      return next();
    }

    const text = ctx.message.text.trim();

    // Check if user clicked Cancel while in a wizard
    if (/^(?:❌\s*)?Cancel(?: Operation)?$/i.test(text) || text.toLowerCase() === 'cancel') {
      clearSession(userId);
      const userRole = ctx.state?.role || (ctx.state?.member ? 'member' : 'unregistered');
      return ctx.reply('❌ Current operation has been cancelled.', {
        ...getMainMenuKeyboard(userRole),
      });
    }

    // Check if user pressed a menu button while in a wizard
    if (MENU_BUTTON_PATTERNS.some((pattern) => pattern.test(text))) {
      clearSession(userId);
      return next();
    }

    // ----------------------------------------------------
    // SELF-REGISTRATION WIZARD (Name -> Phone)
    // ----------------------------------------------------
    if (session.step === 'SELF_REGISTER_WAIT_NAME') {
      const cleanName = sanitizeText(text, 100);
      if (!cleanName || cleanName.length < 2) {
        return ctx.reply('❌ Please enter a valid full name (at least 2 characters):', getCancelReplyKeyboard());
      }
      setSession(userId, { ...session, step: 'SELF_REGISTER_WAIT_PHONE', fullName: cleanName });
      return ctx.reply(
        `👤 *Name:* ${cleanName}\n\n` +
        `📞 *Step 2/2: Phone Number*\n` +
        `Please provide your phone number so church leadership can reach and verify your membership.\n\n` +
        `Tap the *📱 Share My Phone Number* button below, or type your phone number directly (e.g. \`0911223344\`):`,
        Markup.keyboard([
          [Markup.button.contactRequest('📱 Share My Phone Number')],
          ['❌ Cancel Operation'],
        ]).resize().oneTime()
      );
    }

    if (session.step === 'SELF_REGISTER_WAIT_PHONE') {
      const cleanPhone = sanitizeText(text, 30);
      if (!cleanPhone || cleanPhone.length < 7) {
        return ctx.reply(
          '❌ Please enter a valid phone number (at least 7 digits) or tap the "Share My Phone Number" button below:',
          Markup.keyboard([
            [Markup.button.contactRequest('📱 Share My Phone Number')],
            ['❌ Cancel Operation'],
          ]).resize().oneTime()
        );
      }
      return finishSelfRegistration(ctx, userId, session.fullName, cleanPhone);
    }

    // ----------------------------------------------------
    // MEMBER PAYMENT SUBMISSION WIZARD (Month -> Months Count -> Amount -> Method -> Photo)
    // ----------------------------------------------------
    if (session.step === 'MEMBER_SUBMIT_MONTH') {
      const lang = session.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
      const isAm = lang === 'am';
      const validation = validateSubmissionMonth(session.memberId, text.trim());
      if (!validation.ok) {
        return ctx.reply(validation.error, { parse_mode: 'HTML', ...getCancelReplyKeyboard(isAm ? 'am' : 'en') });
      }
      return promptMemberForPaymentMonths(ctx, userId, session, text.trim());
    }

    if (session.step === 'MEMBER_SUBMIT_WAIT_MONTHS') {
      const lang = session.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
      const isAm = lang === 'am';
      const cleanNum = parseInt(text.trim(), 10);
      if (Number.isNaN(cleanNum) || cleanNum < 1 || cleanNum > 24) {
        return ctx.reply(
          isAm ? '❌ እባክዎ ትክክለኛ የወራት ቁጥር (ከ 1 እስከ 24) ያስገቡ፦' : '❌ Please enter a valid number of months (1 to 24):',
          getCancelReplyKeyboard(isAm ? 'am' : 'en')
        );
      }
      return promptMemberForPaymentAmount(ctx, userId, session, cleanNum);
    }

    if (session.step === 'MEMBER_SUBMIT_WAIT_AMOUNT') {
      const lang = session.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
      const isAm = lang === 'am';
      const cents = parseMoneyToCents(text);
      if (!cents) {
        return ctx.reply(
          isAm ? '❌ እባክዎ ትክክለኛ የብር መጠን ያስገቡ (ለምሳሌ 50 ወይም 100)፦' : '❌ Please enter a valid amount (e.g. 50 or 100):',
          getCancelReplyKeyboard(isAm ? 'am' : 'en')
        );
      }

      const standardAmount = getStandardAmountCents();
      const count = session.monthsCount || 1;
      const minRequired = count * standardAmount;
      const currency = getCurrency();

      if (cents < minRequired) {
        return ctx.reply(
          isAm
            ? `⚠️ <b>አነስተኛው የክፍያ መጠን ${formatMoney(minRequired, currency)} ነው።</b>\nለ${count} ወር ከ${formatMoney(minRequired, currency)} በታች መክፈል አይቻልም። እባክዎ ትክክለኛውን መጠን ያስገቡ፦`
            : `⚠️ <b>Minimum payment is ${formatMoney(minRequired, currency)}.</b>\nPlease enter at least ${formatMoney(minRequired, currency)} for ${count} month(s):`,
          { parse_mode: 'HTML', ...getCancelReplyKeyboard(isAm ? 'am' : 'en') }
        );
      }

      setSession(userId, {
        ...session,
        lang,
        step: 'MEMBER_SUBMIT_WAIT_METHOD',
        amountCents: cents,
      });

      const methodButtons = isAm
        ? [
            [Markup.button.callback('🏦 የCBE ባንክ ሂሳብ', 'mem_sub_meth_bank_transfer')],
            [Markup.button.callback('📱 ሲቢኢ ብር (CBE Birr)', 'mem_sub_meth_mobile_money')],
            [Markup.button.callback('❌ ሰርዝ', 'action_cancel')],
          ]
        : [
            [Markup.button.callback('🏦 CBE Bank Transfer', 'mem_sub_meth_bank_transfer')],
            [Markup.button.callback('📱 CBE Birr', 'mem_sub_meth_mobile_money')],
            [Markup.button.callback('❌ Cancel', 'action_cancel')],
          ];

      return ctx.reply(
        isAm
          ? `💰 <b>የክፍያ መጠን፦</b> <code>${formatMoney(cents, currency)}</code>\n` +
            `📅 <b>የሚሸፈነው ጊዜ፦</b> ${session.periodDisplay || session.selectedMonth}\n\n` +
            `ክፍያውን በየትኛው መንገድ ፈጸሙ?`
          : `💰 <b>Amount:</b> <code>${formatMoney(cents, currency)}</code>\n` +
            `📅 <b>Covered Period:</b> ${session.periodDisplay || session.selectedMonth}\n\n` +
            `How did you make this payment?`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(methodButtons),
        }
      );
    }

    if (session.step === 'MEMBER_SUBMIT_WAIT_PHOTO') {
      const lang = session.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
      const isAm = lang === 'am';
      return ctx.reply(
        isAm
          ? '📸 <b>እባክዎ የክፍያ ደረሰኝዎን በፎቶ (ስክሪንሾት) ይላኩ።</b>'
          : '📸 <b>Please upload your payment receipt as an image or photo.</b>',
        {
          parse_mode: 'HTML',
          ...getCancelReplyKeyboard(isAm ? 'am' : 'en'),
        }
      );
    }

    // ----------------------------------------------------
    // ADDMEMBER WIZARD (Name -> Phone -> Telegram ID)
    // ----------------------------------------------------
    if (session.step === 'ADDMEMBER_WAIT_NAME') {
      const cleanName = sanitizeText(text, 100);
      if (!cleanName || cleanName.length < 2) {
        return ctx.reply('❌ Please enter a valid name (at least 2 characters):', getCancelKeyboard());
      }
      setSession(userId, { ...session, step: 'ADDMEMBER_WAIT_PHONE', fullName: cleanName });
      return ctx.reply(
        `👤 *Name:* ${cleanName}\n\n` +
        `📞 *Step 2/3: Phone Number*\n` +
        `Enter the member's phone number (e.g. \`0911223344\`), or reply with \`skip\`:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏩ Skip Phone', 'addmember_skip_phone')],
            [Markup.button.callback('❌ Cancel', 'action_cancel')],
          ]),
        }
      );
    }

    if (session.step === 'ADDMEMBER_WAIT_PHONE') {
      const phone = text.toLowerCase() === 'skip' ? null : sanitizeText(text, 30);
      setSession(userId, { ...session, step: 'ADDMEMBER_WAIT_TELEGRAM_ID', phone });
      return ctx.reply(
        `📞 *Phone:* ${phone || 'Not provided'}\n\n` +
        `📱 *Step 3/3: Telegram User ID*\n` +
        `Enter the member's *numeric Telegram ID* (e.g. \`123456789\`), or tap *Skip* if they haven't joined Telegram yet:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏩ Skip / Create Church ID', 'addmember_skip_tg')],
            [Markup.button.callback('❌ Cancel', 'action_cancel')],
          ]),
        }
      );
    }

    if (session.step === 'ADDMEMBER_WAIT_TELEGRAM_ID') {
      let tid = text.toLowerCase() === 'skip' ? null : text;
      if (tid && !isValidTelegramId(tid)) {
        return ctx.reply(
          '❌ Invalid Telegram ID. Please enter a valid numeric ID (5–15 digits) or tap Skip below:',
          Markup.inlineKeyboard([
            [Markup.button.callback('⏩ Skip / Create Church ID', 'addmember_skip_tg')],
            [Markup.button.callback('❌ Cancel', 'action_cancel')],
          ])
        );
      }

      clearSession(userId);
      try {
        const member = registerMember({
          telegramId: tid,
          fullName: session.fullName,
          phone: session.phone,
          actorTelegramId: userId,
        });

        return ctx.reply(
          `🎉 *Member Successfully Registered!*\n\n` +
          `• *Member ID:* #${member.id}\n` +
          `• *Full Name:* ${member.full_name}\n` +
          `• *Phone:* ${member.phone || 'Not provided'}\n` +
          `• *Telegram ID:* \`${member.telegram_id}\`\n` +
          `• *Joined Date:* ${member.joined_date}\n\n` +
          `_Current month contribution obligation initialized._`,
          { parse_mode: 'Markdown', ...getMainMenuKeyboard(ctx.state?.role) }
        );
      } catch (err) {
        return ctx.reply(`❌ Registration failed: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // DEACTIVATE MEMBER WIZARD (Wait Reason)
    // ----------------------------------------------------
    if (session.step === 'DEACTIVATE_WAIT_REASON') {
      const memberId = session.memberId;
      const cleanReason = sanitizeText(text, 255) || 'Deactivated by administrator';
      clearSession(userId);

      try {
        const member = deactivateMember({
          memberId,
          reason: cleanReason,
          actorTelegramId: userId,
        });

        return ctx.reply(
          `✅ Member <b>${escapeHtml(member.full_name)}</b> (#${member.id}) has been deactivated.\n\n` +
          `• <b>Reason:</b> ${escapeHtml(cleanReason)}\n` +
          `• <b>Status:</b> 🔴 Inactive\n\n` +
          `<i>If you also wish to permanently delete their payment history and obligations, tap below:</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🗑️ Wipe Payment History', `purge_prompt_${member.id}`)],
            ]),
          }
        );
      } catch (err) {
        return ctx.reply(`❌ Deactivation failed: ${err.message}`, getMainMenuKeyboard(ctx.state?.role));
      }
    }

    // ----------------------------------------------------
    // SETAMOUNT WIZARD
    // ----------------------------------------------------
    if (session.step === 'SETAMOUNT_WAIT_VALUE') {
      const cents = parseMoneyToCents(text);
      if (!cents) {
        return ctx.reply('❌ Invalid amount. Please enter a valid positive number (e.g. 500 or 1000):', getCancelKeyboard());
      }
      clearSession(userId);
      setStandardAmountCents(cents, userId);
      const currency = getCurrency();
      return ctx.reply(`✅ Standard monthly contribution updated to *${formatMoney(cents, currency)}* for future obligations.`, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(ctx.state?.role),
      });
    }

    // ----------------------------------------------------
    // EDIT CHURCH CBE ACCOUNT WIZARD (Number -> Name)
    // ----------------------------------------------------
    if (session.step === 'ADMIN_SET_CBE_ACCOUNT_NUMBER') {
      const cleanAcc = text.replace(/\s+/g, '').trim();
      if (!/^\d{8,25}$/.test(cleanAcc)) {
        return ctx.reply(
          '❌ Invalid CBE Account Number. Please enter digits only (at least 8 numbers, e.g. 1000123456789) or tap Cancel:',
          getCancelKeyboard()
        );
      }

      setSession(userId, {
        ...session,
        step: 'ADMIN_SET_CBE_ACCOUNT_NAME',
        newAccountNumber: cleanAcc,
      });

      return ctx.reply(
        `👤 <b>Edit Church CBE Account — Step 2/2</b>\n\n` +
        `• <b>New Account Number:</b> <code>${cleanAcc}</code>\n` +
        `• <b>Current Account Name:</b> ${escapeHtml(session.currentAccountName || 'None')}\n\n` +
        `Please enter the <b>Official Account Holder / Church Name</b>\n` +
        `(e.g. <code>Natanim Fund / የናታኒም ፈንድ</code>):`,
        {
          parse_mode: 'HTML',
          ...getCancelKeyboard(),
        }
      );
    }

    if (session.step === 'ADMIN_SET_CBE_ACCOUNT_NAME') {
      const cleanName = sanitizeText(text, 100);
      if (!cleanName || cleanName.length < 2) {
        return ctx.reply('❌ Account Name must be at least 2 characters long. Please try again or tap Cancel:', getCancelKeyboard());
      }

      clearSession(userId);
      try {
        const updated = setCbeAccountDetails({
          accountNumber: session.newAccountNumber,
          accountName: cleanName,
          actorTelegramId: userId,
        });

        return ctx.reply(
          `✅ <b>Church CBE Account Successfully Updated!</b>\n\n` +
          `• <b>Bank:</b> Commercial Bank of Ethiopia (CBE)\n` +
          `• <b>Account Number:</b> <code>${escapeHtml(updated.accountNumber)}</code>\n` +
          `• <b>Account Name:</b> ${escapeHtml(updated.accountName)}\n\n` +
          `<i>All members will now see these updated account details when submitting receipts.</i>`,
          {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard(ctx.state?.role),
          }
        );
      } catch (err) {
        return ctx.reply(`❌ Could not update CBE account: ${err.message}`, getMainMenuKeyboard(ctx.state?.role));
      }
    }

    // ----------------------------------------------------
    // CHURCH BROADCAST WIZARD (Wait Text Announcement)
    // ----------------------------------------------------
    if (session.step === 'BROADCAST_WAIT_CONTENT') {
      const cleanText = text.trim();
      if (cleanText.length < 3) {
        return ctx.reply('❌ Broadcast message is too short. Please enter at least 3 characters or tap Cancel:', getCancelKeyboard());
      }

      setSession(userId, {
        ...session,
        step: 'BROADCAST_CONFIRM_SEND',
        messageType: 'text',
        text: cleanText,
      });

      const confirmButtons = [
        [Markup.button.callback('🚀 Send Broadcast Now', 'broadcast_send_confirm')],
        [Markup.button.callback('❌ Cancel', 'action_cancel')],
      ];

      return ctx.reply(
        `📢 <b>Broadcast Preview:</b>\n` +
        `────────────────────\n` +
        cleanText + '\n' +
        `────────────────────\n` +
        `👥 <b>Target Audience:</b> ${session.recipientsCount} active church members\n\n` +
        `⚠️ <i>Do you want to send this broadcast message to all members now?</i>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(confirmButtons),
        }
      );
    }

    // ----------------------------------------------------
    // DEACTIVATE REASON WIZARD
    // ----------------------------------------------------
    if (session.step === 'DEACTIVATE_WAIT_REASON') {
      const memberId = session.memberId;
      clearSession(userId);
      try {
        const member = deactivateMember({
          memberId,
          reason: text,
          actorTelegramId: userId,
        });
        return ctx.reply(`✅ Member *${member.full_name}* (#${member.id}) has been deactivated. Historical records have been preserved.`, {
          parse_mode: 'Markdown',
          ...getMainMenuKeyboard(ctx.state?.role),
        });
      } catch (err) {
        return ctx.reply(`❌ Deactivation failed: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // ROLE ASSIGNMENT WIZARD (Wait Target ID)
    // ----------------------------------------------------
    if (session.step === 'ROLE_WAIT_ADD_ID') {
      const targetId = text.trim();
      if (!isValidTelegramId(targetId)) {
        return ctx.reply('❌ Invalid Telegram ID. Please enter a valid numeric user ID (5–15 digits) or tap Cancel:', getCancelKeyboard());
      }
      clearSession(userId);
      try {
        assignRole(targetId, 'treasurer', userId);
        const notifyRes = await notifyTreasurerAppointed(ctx.telegram, targetId, ctx.from.first_name || 'an administrator');
        const displayName = notifyRes.memberName || targetId;

        let adminMsg = `✅ Successfully granted <b>Treasurer</b> role to <b>${escapeHtml(displayName)}</b> (<code>${escapeHtml(targetId)}</code>).\n\n`;
        adminMsg += `• Menu buttons automatically updated on their device\n`;

        const adminButtons = [];
        if (notifyRes.inviteLink) {
          adminMsg += `\n🔗 <b>Leadership Group Invite Link:</b>\n<code>${notifyRes.inviteLink}</code>\n\n`;
          if (notifyRes.dmSent) {
            adminMsg += `• ✅ Link and staff menu was sent directly to their private chat.\n`;
          } else {
            adminMsg += `• ⚠️ <b>Could not DM user:</b> They have not started the bot privately yet (or blocked it).\n👉 <b>Please copy and share the link above directly with them!</b>\n`;
          }
          adminMsg += `• Welcome announcement posted in leadership group.`;
          adminButtons.push([Markup.button.url('🏛️ Open Group Invite Link', notifyRes.inviteLink)]);
        } else {
          const staffGroupId = getStaffGroupId();
          if (!staffGroupId) {
            adminMsg += `\n⚠️ <b>Staff Group Not Connected:</b>\n` +
                   `The bot cannot generate an invite link because the leadership group is not set.\n` +
                   `👉 Add the bot to your leadership group as Admin, then send <code>/setstaffgroup</code> in that group!`;
          } else {
            adminMsg += `\n⚠️ <b>Could not create invite link:</b>\n` +
                   `Make sure the bot is an <b>Administrator</b> in your leadership group with <b>"Invite Users via Link"</b> enabled!`;
          }
        }

        return ctx.reply(
          adminMsg,
          {
            parse_mode: 'HTML',
            ...(adminButtons.length > 0 ? Markup.inlineKeyboard(adminButtons) : {}),
            ...getMainMenuKeyboard(ctx.state?.role),
          }
        );
      } catch (err) {
        return ctx.reply(`❌ Failed to assign role: ${err.message}`, getMainMenuKeyboard(ctx.state?.role));
      }
    }

    // ----------------------------------------------------
    // PAYMENT REVERSAL WIZARD
    // ----------------------------------------------------
    if (session.step === 'REVERSE_WAIT_TXID') {
      const txId = text.toUpperCase();
      const payment = getPaymentByTxId(txId);
      if (!payment) {
        return ctx.reply(`❌ Payment with Transaction ID "${txId}" was not found. Please recheck and try again:`, getCancelKeyboard());
      }
      if (payment.is_reversed === 1) {
        clearSession(userId);
        return ctx.reply(`⚠️ Payment ${txId} is already marked as reversed.`);
      }

      const currency = getCurrency();
      setSession(userId, { ...session, step: 'REVERSE_WAIT_REASON', txId, paymentId: payment.id });
      return ctx.reply(
        `Found payment: *${txId}*\n` +
        `• Member: ${payment.full_name}\n` +
        `• Amount: ${formatMoney(payment.amount_cents, currency)}\n` +
        `• Period: ${payment.year_month}\n\n` +
        `Please reply with the *mandatory reason* for reversing this payment:`,
        { parse_mode: 'Markdown', ...getCancelKeyboard() }
      );
    }

    if (session.step === 'REVERSE_WAIT_REASON') {
      const txId = session.txId;
      clearSession(userId);
      try {
        const result = reversePayment({
          txId,
          reason: text,
          reversedBy: userId,
        });
        const currency = getCurrency();
        return ctx.reply(
          `🔄 *Payment Reversal Completed*\n\n` +
          `• *Transaction ID:* ${result.payment.tx_id}\n` +
          `• *Reversed Amount:* ${formatMoney(result.payment.amount_cents, currency)}\n` +
          `• *Reason:* ${result.payment.reversal_reason}\n` +
          `• *Period:* ${result.obligation.year_month}\n` +
          `• *New Obligation Status:* ${result.obligation.status}`,
          { parse_mode: 'Markdown', ...getMainMenuKeyboard(ctx.state?.role) }
        );
      } catch (err) {
        return ctx.reply(`❌ Reversal failed: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // RECORD PAYMENT TEXT INPUTS
    // ----------------------------------------------------
    if (session.step === 'PAY_SELECT_MEMBER') {
      const cleanInput = text.replace(/#/g, '').trim();
      const allMembers = getAllActiveMembers();
      let matched = null;

      // Try matching by numeric ID
      if (/^\d+$/.test(cleanInput)) {
        matched = getMemberById(parseInt(cleanInput, 10));
      }
      // Or try matching by name
      if (!matched) {
        matched = allMembers.find((m) => m.full_name.toLowerCase().includes(cleanInput.toLowerCase()));
      }

      if (!matched) {
        return ctx.reply('❌ Member not found. Please type their Member ID (#1, #2) or select from buttons above:', getCancelKeyboard());
      }

      const currentMonth = getCurrentYearMonth();
      setSession(userId, {
        step: 'PAY_SELECT_MONTH',
        memberId: matched.id,
        memberName: matched.full_name,
      });

      return ctx.reply(
        `👤 *Selected Member:* ${matched.full_name} (#${matched.id})\n\n` +
        `*Step 2/5 — Contribution Period:*\n` +
        `Reply with month (e.g. \`${currentMonth}\`) or tap button:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`📅 Current Month (${currentMonth})`, `pay_month_${currentMonth}`)],
            [Markup.button.callback('❌ Cancel', 'action_cancel')],
          ]),
        }
      );
    }

    if (session.step === 'PAY_SELECT_MONTH') {
      if (!isValidYearMonth(text)) {
        return ctx.reply('❌ Invalid month format. Please use `YYYY-MM` (e.g. `2026-10`):', getCancelKeyboard());
      }
      const yearMonth = text;
      const obligation = getOrCreateObligation(session.memberId, yearMonth);
      if (obligation.status === 'FULLY_PAID') {
        return ctx.reply(
          `⚠️ <b>የ${formatDualMonth(yearMonth)} መዋጮ አስቀድሞ ሙሉ በሙሉ ተከፍሏል።</b>\nደጋግሞ መክፈል አይቻልም። እባክዎ ያልተከፈለ ወር ይምረጡ፦`,
          { parse_mode: 'HTML', ...getCancelKeyboard() }
        );
      }
      const currency = getCurrency();
      const balanceCents = Math.max(0, obligation.amount_due_cents - obligation.amount_paid_cents);

      setSession(userId, {
        ...session,
        step: 'PAY_ENTER_AMOUNT',
        yearMonth,
        balanceCents,
        dueCents: obligation.amount_due_cents,
      });

      const quickButtons = [];
      if (balanceCents > 0) {
        quickButtons.push([
          Markup.button.callback(`Pay Full Remaining (${formatMoney(balanceCents, currency)})`, `pay_amt_${balanceCents}`),
        ]);
      }
      quickButtons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);

      return ctx.reply(
        `📅 *Month:* ${yearMonth}\n` +
        `🎯 *Due for Month:* ${formatMoney(obligation.amount_due_cents, currency)}\n` +
        `💰 *Outstanding Balance:* ${formatMoney(balanceCents, currency)}\n\n` +
        `*Step 3/5 — Payment Amount:*\n` +
        `Click button or reply with an amount (e.g. \`500\` or \`250\`):`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(quickButtons) }
      );
    }

    if (session.step === 'PAY_ENTER_AMOUNT') {
      const cents = parseMoneyToCents(text);
      if (!cents) {
        return ctx.reply('❌ Please enter a valid payment amount (e.g. 500 or 250):', getCancelKeyboard());
      }
      setSession(userId, { ...session, step: 'PAY_SELECT_METHOD', amountCents: cents });
      const currency = getCurrency();
      return ctx.reply(
        `💵 *Amount:* ${formatMoney(cents, currency)}\n\n` +
        `*Step 4/5 — Payment Method:*\n` +
        `Please select how the funds were received:`,
        { parse_mode: 'Markdown', ...getPaymentMethodKeyboard() }
      );
    }

    if (session.step === 'PAY_WAIT_REFERENCE') {
      const refNotes = sanitizeText(text, 255);
      setSession(userId, {
        ...session,
        step: 'PAY_CONFIRM',
        referenceNumber: refNotes,
        notes: refNotes,
      });
      return showPaymentConfirmation(ctx, {
        ...session,
        referenceNumber: refNotes,
        notes: refNotes,
      });
    }

    return next();
  });

  // Action callbacks for skipping steps in Add Member
  bot.action('addmember_skip_phone', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || !session.fullName) {
      return ctx.reply('Session expired. Please start again with /addmember.');
    }
    setSession(userId, { ...session, step: 'ADDMEMBER_WAIT_TELEGRAM_ID', phone: null });
    await ctx.reply(
      `📞 *Phone:* Skipped\n\n` +
      `📱 *Step 3/3: Telegram User ID*\n` +
      `Enter the member's *numeric Telegram ID* (e.g. \`123456789\`), or tap *Skip* below:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏩ Skip / Create Church ID', 'addmember_skip_tg')],
          [Markup.button.callback('❌ Cancel', 'action_cancel')],
        ]),
      }
    );
  });

  bot.action('addmember_skip_tg', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || !session.fullName) {
      return ctx.reply('Session expired. Please start again with /addmember.');
    }

    clearSession(userId);
    try {
      const member = registerMember({
        telegramId: null,
        fullName: session.fullName,
        phone: session.phone,
        actorTelegramId: userId,
      });

      return ctx.reply(
        `🎉 *Member Successfully Registered!*\n\n` +
        `• *Member ID:* #${member.id}\n` +
        `• *Full Name:* ${member.full_name}\n` +
        `• *Phone:* ${member.phone || 'Not provided'}\n` +
        `• *System ID:* \`${member.telegram_id}\`\n` +
        `• *Joined Date:* ${member.joined_date}\n\n` +
        `_Current month contribution obligation initialized._`,
        { parse_mode: 'Markdown', ...getMainMenuKeyboard(ctx.state?.role) }
      );
    } catch (err) {
      return ctx.reply(`❌ Registration failed: ${err.message}`);
    }
  });

  // ==========================================
  // Member Submission Action Callbacks
  // ==========================================
  bot.action(/^mem_sub_month_(\d{4}-\d{2})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    const lang = session?.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';
    if (!session || session.step !== 'MEMBER_SUBMIT_MONTH') {
      return ctx.reply(
        isAm ? '⚠️ የክፍያ ሂደቱ ጊዜው አልፏል። እባክዎ እንደገና በ «ደረሰኝ ላክ» ይጀምሩ።' : '⚠️ Session timed out. Please restart by tapping Submit Receipt.'
      );
    }
    const selectedMonth = ctx.match[1];
    const validation = validateSubmissionMonth(session.memberId, selectedMonth);
    if (!validation.ok) {
      return ctx.reply(validation.error, { parse_mode: 'HTML', ...getCancelReplyKeyboard(isAm ? 'am' : 'en') });
    }
    return promptMemberForPaymentMonths(ctx, userId, session, selectedMonth);
  });

  bot.action(/^mem_sub_cnt_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    const lang = session?.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';
    if (!session || (session.step !== 'MEMBER_SUBMIT_WAIT_MONTHS' && session.step !== 'MEMBER_SUBMIT_MONTH')) {
      return ctx.reply(
        isAm ? '⚠️ የክፍያ ሂደቱ ጊዜው አልፏል። እባክዎ እንደገና በ «ደረሰኝ ላክ» ይጀምሩ።' : '⚠️ Session timed out. Please restart by tapping Submit Receipt.'
      );
    }
    return promptMemberForPaymentAmount(ctx, userId, session, ctx.match[1]);
  });

  bot.action(/^mem_sub_amt_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    const lang = session?.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';
    if (!session || session.step !== 'MEMBER_SUBMIT_WAIT_AMOUNT') {
      return ctx.reply(
        isAm ? '⚠️ የክፍያ ሂደቱ ጊዜው አልፏል። እባክዎ እንደገና በ «ደረሰኝ ላክ» ይጀምሩ።' : '⚠️ Session timed out. Please restart by tapping Submit Receipt.'
      );
    }

    const amountCents = parseInt(ctx.match[1], 10);
    const standardAmount = getStandardAmountCents();
    const count = session.monthsCount || 1;
    const minRequired = count * standardAmount;
    const currency = getCurrency();

    if (amountCents < minRequired) {
      return ctx.reply(
        isAm
          ? `⚠️ <b>አነስተኛው የክፍያ መጠን ${formatMoney(minRequired, currency)} ነው።</b>\nለ${count} ወር ከ${formatMoney(minRequired, currency)} በታች መክፈል አይቻልም።`
          : `⚠️ <b>Minimum payment is ${formatMoney(minRequired, currency)}.</b>`,
        { parse_mode: 'HTML', ...getCancelReplyKeyboard(isAm ? 'am' : 'en') }
      );
    }

    setSession(userId, {
      ...session,
      lang,
      step: 'MEMBER_SUBMIT_WAIT_METHOD',
      amountCents,
    });

    const methodButtons = isAm
      ? [
          [Markup.button.callback('🏦 የCBE ባንክ ሂሳብ', 'mem_sub_meth_bank_transfer')],
          [Markup.button.callback('📱 ሲቢኢ ብር (CBE Birr)', 'mem_sub_meth_mobile_money')],
          [Markup.button.callback('❌ ሰርዝ', 'action_cancel')],
        ]
      : [
          [Markup.button.callback('🏦 CBE Bank Transfer', 'mem_sub_meth_bank_transfer')],
          [Markup.button.callback('📱 CBE Birr', 'mem_sub_meth_mobile_money')],
          [Markup.button.callback('❌ Cancel', 'action_cancel')],
        ];

    await ctx.reply(
      isAm
        ? `💰 <b>የክፍያ መጠን፦</b> <code>${formatMoney(amountCents, currency)}</code>\n` +
          `📅 <b>የሚሸፈነው ጊዜ፦</b> ${session.periodDisplay || session.selectedMonth}\n\n` +
          `ክፍያውን በየትኛው መንገድ ፈጸሙ?`
        : `💰 <b>Amount:</b> <code>${formatMoney(amountCents, currency)}</code>\n` +
          `📅 <b>Covered Period:</b> ${session.periodDisplay || session.selectedMonth}\n\n` +
          `How did you make this payment?`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(methodButtons),
      }
    );
  });

  bot.action(/^mem_sub_meth_(bank_transfer|mobile_money|cash)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    const lang = session?.lang || ctx.state?.language || getUserLanguage(userId) || 'am';
    const isAm = lang === 'am';
    if (!session || session.step !== 'MEMBER_SUBMIT_WAIT_METHOD') {
      return ctx.reply(
        isAm ? '⚠️ የክፍያ ሂደቱ ጊዜው አልፏል። እባክዎ እንደገና በ «ደረሰኝ ላክ» ይጀምሩ።' : '⚠️ Session timed out. Please restart by tapping Submit Receipt.'
      );
    }

    const paymentMethod = ctx.match[1];
    const currency = getCurrency();

    setSession(userId, {
      ...session,
      lang,
      step: 'MEMBER_SUBMIT_WAIT_PHOTO',
      paymentMethod,
    });

    await ctx.reply(
      isAm
        ? `✅ <b>የክፍያ ዝርዝር፦</b>\n` +
          `• <b>የሚሸፈነው ጊዜ፦</b> ${session.periodDisplay || session.selectedMonth}\n` +
          `• <b>መጠን፦</b> <code>${formatMoney(session.amountCents, currency)}</code>\n` +
          `• <b>የክፍያ መንገድ፦</b> ${formatPaymentMethod(paymentMethod, 'am')}\n\n` +
          `📸 <b>እባክዎ አሁን የባንክ ክፍያዎን ደረሰኝ (ስክሪንሾት) በፎቶ ይላኩ፦</b>`
        : `✅ <b>Payment Details:</b>\n` +
          `• <b>Covered Period:</b> ${session.periodDisplay || session.selectedMonth}\n` +
          `• <b>Amount:</b> <code>${formatMoney(session.amountCents, currency)}</code>\n` +
          `• <b>Payment Method:</b> ${formatPaymentMethod(paymentMethod, 'en')}\n\n` +
          `📸 <b>Please upload your payment receipt screenshot as a photo now:</b>`,
      {
        parse_mode: 'HTML',
        ...getCancelReplyKeyboard(isAm ? 'am' : 'en'),
      }
    );
  });
}

module.exports = {
  registerWizardHandler,
};
