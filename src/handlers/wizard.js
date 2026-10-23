const { Markup } = require('telegraf');
const { getSession, setSession, clearSession } = require('../utils/session');
const { isValidTelegramId, sanitizeText, isValidYearMonth } = require('../utils/validators');
const {
  registerMember,
  deactivateMember,
  getMemberById,
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
} = require('../services/accounting');
const { parseMoneyToCents, formatMoney, getCurrentYearMonth, formatPaymentMethod, escapeHtml } = require('../utils/formatters');
const { getPaymentMethodKeyboard, getCancelKeyboard, getCancelReplyKeyboard, getMainMenuKeyboard } = require('../utils/keyboards');
const { showPaymentConfirmation } = require('./payments');
const { assignRole } = require('../services/permissions');

const MENU_BUTTON_PATTERNS = [
  /^(?:📊\s*)?My Status$/i,
  /^(?:📜\s*)?My History$/i,
  /^(?:👤\s*)?My Profile$/i,
  /^(?:💰\s*)?Record Payment$/i,
  /^(?:📑\s*)?Monthly Report$/i,
  /^(?:👥\s*)?Members List$/i,
  /^(?:⏳\s*)?Unpaid List$/i,
  /^(?:📨\s*)?Send Reminders$/i,
  /^(?:➕\s*)?Add Member$/i,
  /^(?:📥\s*)?Pending Approvals$/i,
  /^(?:📝\s*)?Register as Member$/i,
  /^(?:📤\s*)?Submit (?:Payment )?Receipt$/i,
  /^(?:💳\s*)?Verify Receipts$/i,
  /^(?:🛑\s*)?Deactivate Member$/i,
  /^(?:⚙️\s*)?Set Standard Amount$/i,
  /^(?:🛡️\s*)?Manage Roles$/i,
  /^(?:🔄\s*)?Reverse Payment$/i,
  /^(?:📁\s*)?Export CSV$/i,
  /^(?:🔍\s*)?Audit Log$/i,
  /^(?:🏠\s*)?(?:Main Menu|Home)$/i,
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

  async function handleProofUpload(ctx, fileId, fileUniqueId, caption) {
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || session.step !== 'MEMBER_SUBMIT_WAIT_PHOTO') {
      return false;
    }

    clearSession(userId);
    const currency = getCurrency();

    try {
      const submission = createPaymentSubmission({
        memberId: session.memberId,
        telegramId: userId,
        yearMonth: session.selectedMonth,
        amountCents: session.amountCents,
        paymentMethod: session.paymentMethod,
        referenceNumber: caption || null,
        fileId,
        fileUniqueId,
        caption,
      });

      const userRole = ctx.state?.role || 'member';
      await ctx.reply(
        `🎉 *Payment Receipt Submitted!*\n\n` +
        `Thank you, *${session.memberName}*!\n` +
        `Your payment receipt for *${session.selectedMonth}* (*${formatMoney(session.amountCents, currency)}*) has been sent to church leadership for verification.\n\n` +
        `📋 *Submission Details:*\n` +
        `• *Period:* ${session.selectedMonth}\n` +
        `• *Amount:* ${formatMoney(session.amountCents, currency)}\n` +
        `• *Method:* ${formatPaymentMethod(session.paymentMethod)}\n` +
        `• *Ref / Note:* ${caption || 'None'}\n\n` +
        `⏳ You will receive an official confirmation message and receipt once approved by the treasurer!`,
        {
          parse_mode: 'Markdown',
          ...getMainMenuKeyboard(userRole),
        }
      );

      // Notify staff
      try {
        await notifyStaffNewPaymentSubmission(ctx.telegram, submission);
      } catch (staffErr) {
        console.warn('[Payment] Could not notify staff:', staffErr.message);
      }
      return true;
    } catch (err) {
      await ctx.reply(`❌ Could not submit payment proof: ${err.message}`, getMainMenuKeyboard(ctx.state?.role || 'member'));
      return true;
    }
  }

  bot.on('photo', async (ctx, next) => {
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return next();
    const largest = photos[photos.length - 1];
    const handled = await handleProofUpload(ctx, largest.file_id, largest.file_unique_id, ctx.message.caption);
    if (!handled) return next();
  });

  bot.on('document', async (ctx, next) => {
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
    // MEMBER PAYMENT SUBMISSION WIZARD (Month -> Amount -> Method -> Photo)
    // ----------------------------------------------------
    if (session.step === 'MEMBER_SUBMIT_MONTH') {
      if (!isValidYearMonth(text)) {
        return ctx.reply('❌ Invalid period format. Please enter YYYY-MM (e.g. 2026-10) or tap Cancel:', getCancelReplyKeyboard());
      }
      const obl = getOrCreateObligation(session.memberId, text);
      const dueBalance = Math.max(0, obl.amount_due_cents - obl.amount_paid_cents) || obl.amount_due_cents;
      const currency = getCurrency();

      setSession(userId, {
        ...session,
        step: 'MEMBER_SUBMIT_WAIT_AMOUNT',
        selectedMonth: text,
        dueBalance,
      });

      const buttons = [];
      if (dueBalance > 0) {
        buttons.push([Markup.button.callback(`💰 Pay Full Balance (${formatMoney(dueBalance, currency)})`, `mem_sub_amt_${dueBalance}`)]);
      }
      buttons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);

      return ctx.reply(
        `📅 *Selected Period:* ${text}\n` +
        `🎯 *Balance Due:* ${formatMoney(dueBalance, currency)}\n\n` +
        `*Step 2/3 — Payment Amount:*\n` +
        `Tap below or type the amount you paid (e.g. \`500\` or \`1000\`):`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    }

    if (session.step === 'MEMBER_SUBMIT_WAIT_AMOUNT') {
      const cents = parseMoneyToCents(text);
      if (!cents) {
        return ctx.reply('❌ Please enter a valid payment amount (e.g. 500 or 1000):', getCancelReplyKeyboard());
      }
      const currency = getCurrency();
      setSession(userId, {
        ...session,
        step: 'MEMBER_SUBMIT_WAIT_METHOD',
        amountCents: cents,
      });

      const methodButtons = [
        [Markup.button.callback('🏦 Bank Transfer (CBE, Awash...)', 'mem_sub_meth_bank_transfer')],
        [Markup.button.callback('📱 Mobile Money (Telebirr, CBE Birr)', 'mem_sub_meth_mobile_money')],
        [Markup.button.callback('💵 Cash to Leader / Treasurer', 'mem_sub_meth_cash')],
        [Markup.button.callback('❌ Cancel', 'action_cancel')],
      ];

      return ctx.reply(
        `💰 *Amount:* ${formatMoney(cents, currency)}\n\n` +
        `*Step 3/3 — Payment Method:*\n` +
        `How did you make this payment?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(methodButtons),
        }
      );
    }

    if (session.step === 'MEMBER_SUBMIT_WAIT_PHOTO') {
      return ctx.reply(
        '📸 *Please send your payment screenshot or receipt as a photo or image file* (not plain text).\n\n' +
        'Tap the attachment icon 📎 or photo gallery icon and select your receipt photo, or tap Cancel below:',
        getCancelReplyKeyboard()
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

        // Automatically push updated keyboard to the new treasurer!
        try {
          await ctx.telegram.sendMessage(
            targetId,
            `🎉 <b>Role Updated!</b>\n\n` +
            `You have been granted <b>Treasurer</b> privileges for Natanim Church Fund by an administrator.\n\n` +
            `Your menu buttons below have been automatically updated. You now have access to staff tools like <b>Record Payment</b>, <b>Monthly Report</b>, <b>Members List</b>, and <b>Verify Receipts</b>!`,
            {
              parse_mode: 'HTML',
              ...getMainMenuKeyboard('treasurer'),
            }
          );
        } catch (dmErr) {
          console.warn(`[Roles] Could not push keyboard to user ${targetId}:`, dmErr.message);
        }

        return ctx.reply(
          `✅ Successfully granted <b>Treasurer</b> role to Telegram ID <code>${escapeHtml(targetId)}</code>.\n` +
          `Their menu buttons have been automatically updated on their device!`,
          {
            parse_mode: 'HTML',
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
    if (!session || session.step !== 'MEMBER_SUBMIT_MONTH') {
      return ctx.reply('Session expired. Please start again with /submitpayment.');
    }

    const month = ctx.match[1];
    const obl = getOrCreateObligation(session.memberId, month);
    const dueBalance = Math.max(0, obl.amount_due_cents - obl.amount_paid_cents) || obl.amount_due_cents;
    const currency = getCurrency();

    setSession(userId, {
      ...session,
      step: 'MEMBER_SUBMIT_WAIT_AMOUNT',
      selectedMonth: month,
      dueBalance,
    });

    const buttons = [];
    if (dueBalance > 0) {
      buttons.push([Markup.button.callback(`💰 Pay Full Balance (${formatMoney(dueBalance, currency)})`, `mem_sub_amt_${dueBalance}`)]);
    }
    buttons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);

    await ctx.reply(
      `📅 *Selected Period:* ${month}\n` +
      `🎯 *Balance Due:* ${formatMoney(dueBalance, currency)}\n\n` +
      `*Step 2/3 — Payment Amount:*\n` +
      `Tap below to pay the full balance, or type the amount you paid (e.g. \`500\` or \`1000\`):`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      }
    );
  });

  bot.action(/^mem_sub_amt_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || session.step !== 'MEMBER_SUBMIT_WAIT_AMOUNT') {
      return ctx.reply('Session expired. Please start again with /submitpayment.');
    }

    const amountCents = parseInt(ctx.match[1], 10);
    const currency = getCurrency();

    setSession(userId, {
      ...session,
      step: 'MEMBER_SUBMIT_WAIT_METHOD',
      amountCents,
    });

    const methodButtons = [
      [Markup.button.callback('🏦 Bank Transfer (CBE, Awash...)', 'mem_sub_meth_bank_transfer')],
      [Markup.button.callback('📱 Mobile Money (Telebirr, CBE Birr)', 'mem_sub_meth_mobile_money')],
      [Markup.button.callback('💵 Cash to Leader / Treasurer', 'mem_sub_meth_cash')],
      [Markup.button.callback('❌ Cancel', 'action_cancel')],
    ];

    await ctx.reply(
      `💰 *Amount:* ${formatMoney(amountCents, currency)}\n\n` +
      `*Step 3/3 — Payment Method:*\n` +
      `How did you make this payment?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(methodButtons),
      }
    );
  });

  bot.action(/^mem_sub_meth_(bank_transfer|mobile_money|cash)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session || session.step !== 'MEMBER_SUBMIT_WAIT_METHOD') {
      return ctx.reply('Session expired. Please start again with /submitpayment.');
    }

    const paymentMethod = ctx.match[1];
    const currency = getCurrency();

    setSession(userId, {
      ...session,
      step: 'MEMBER_SUBMIT_WAIT_PHOTO',
      paymentMethod,
    });

    await ctx.reply(
      `✅ *Payment Details:*\n` +
      `• *Period:* ${session.selectedMonth}\n` +
      `• *Amount:* ${formatMoney(session.amountCents, currency)}\n` +
      `• *Method:* ${formatPaymentMethod(paymentMethod)}\n\n` +
      `📸 *Please send your payment screenshot or receipt photo now:*\n` +
      `_(Take a screenshot of your Telebirr / CBE confirmation SMS or receipt and send it as a photo. You can include your transaction reference in the photo caption)_`,
      {
        parse_mode: 'Markdown',
        ...getCancelReplyKeyboard(),
      }
    );
  });
}

module.exports = {
  registerWizardHandler,
};
