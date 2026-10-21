const { getSession, setSession, clearSession } = require('../utils/session');
const { isValidTelegramId, sanitizeText } = require('../utils/validators');
const { registerMember, deactivateMember, getMemberById } = require('../services/memberService');
const {
  setStandardAmountCents,
  getStandardAmountCents,
  getCurrency,
  reversePayment,
  getPaymentByTxId,
  getOrCreateObligation,
} = require('../services/accounting');
const { parseMoneyToCents, formatMoney } = require('../utils/formatters');
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
    // ADDMEMBER WIZARD
    // ----------------------------------------------------
    if (session.step === 'ADDMEMBER_WAIT_TELEGRAM_ID') {
      if (!isValidTelegramId(text)) {
        return ctx.reply('❌ Invalid Telegram ID. Please enter a valid numeric ID (5–15 digits):', getCancelKeyboard());
      }
      setSession(userId, { ...session, step: 'ADDMEMBER_WAIT_NAME', telegramId: text });
      return ctx.reply('👤 *Step 2/3: Full Name*\nPlease enter the member\'s full legal or church name:', {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      });
    }

    if (session.step === 'ADDMEMBER_WAIT_NAME') {
      const cleanName = sanitizeText(text, 100);
      if (!cleanName || cleanName.length < 2) {
        return ctx.reply('❌ Please enter a valid name (at least 2 characters):', getCancelKeyboard());
      }
      setSession(userId, { ...session, step: 'ADDMEMBER_WAIT_PHONE', fullName: cleanName });
      return ctx.reply('📞 *Step 3/3: Phone Number*\nEnter the member\'s phone number, or reply with `skip`:', {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      });
    }

    if (session.step === 'ADDMEMBER_WAIT_PHONE') {
      const phone = text.toLowerCase() === 'skip' ? null : sanitizeText(text, 30);
      clearSession(userId);

      try {
        const member = registerMember({
          telegramId: session.telegramId,
          fullName: session.fullName,
          phone,
          actorTelegramId: userId,
        });

        return ctx.reply(
          `✅ *Member Successfully Registered!*\n\n` +
          `• *ID:* #${member.id}\n` +
          `• *Name:* ${member.full_name}\n` +
          `• *Telegram ID:* \`${member.telegram_id}\`\n` +
          `• *Phone:* ${member.phone || 'Not provided'}\n` +
          `• *Joined:* ${member.joined_date}\n\n` +
          `Monthly contribution obligation initialized.`,
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
    // RECORD PAYMENT CUSTOM TEXT INPUTS
    // ----------------------------------------------------
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
}

module.exports = {
  registerWizardHandler,
};

