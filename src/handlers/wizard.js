const { Markup } = require('telegraf');
const { getSession, setSession, clearSession } = require('../utils/session');
const { isValidTelegramId, sanitizeText, isValidYearMonth } = require('../utils/validators');
const { registerMember, deactivateMember, getMemberById, getAllActiveMembers } = require('../services/memberService');
const {
  setStandardAmountCents,
  getStandardAmountCents,
  getCurrency,
  reversePayment,
  getPaymentByTxId,
  getOrCreateObligation,
} = require('../services/accounting');
const { parseMoneyToCents, formatMoney, getCurrentYearMonth } = require('../utils/formatters');
const { getPaymentMethodKeyboard, getCancelKeyboard } = require('../utils/keyboards');
const { showPaymentConfirmation } = require('./payments');

function registerWizardHandler(bot) {
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
          { parse_mode: 'Markdown' }
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
        });
      } catch (err) {
        return ctx.reply(`❌ Deactivation failed: ${err.message}`);
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
          { parse_mode: 'Markdown' }
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
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      return ctx.reply(`❌ Registration failed: ${err.message}`);
    }
  });
}

module.exports = {
  registerWizardHandler,
};
