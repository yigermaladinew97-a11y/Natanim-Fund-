const { Markup } = require('telegraf');
const { requireStaff } = require('../middleware/auth');
const { getAllActiveMembers, getMemberById } = require('../services/memberService');
const {
  recordPayment,
  getCurrency,
  getOrCreateObligation,
  getPendingPaymentSubmissions,
  approvePaymentSubmission,
  rejectPaymentSubmission,
} = require('../services/accounting');
const { setSession, getSession, clearSession } = require('../utils/session');
const { parseMoneyToCents, formatMoney, getCurrentYearMonth, formatPaymentMethod, formatStatus } = require('../utils/formatters');
const { getPaymentMethodKeyboard, getCancelKeyboard, getConfirmationKeyboard, getMainMenuKeyboard } = require('../utils/keyboards');

function startPaymentWizard(ctx) {
  const members = getAllActiveMembers();
  if (members.length === 0) {
    return ctx.reply(
      '⚠️ *No active members found in the database yet.*\n\n' +
      'Please add a member first, or add demo church members to test the bot:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Register Member', 'menu_addmember')],
          [Markup.button.callback('🌱 Add 3 Demo Members For Testing', 'admin_seed_demo')],
          [Markup.button.callback('❌ Cancel', 'action_cancel')],
        ]),
      }
    );
  }

  // Display top active members as inline buttons or let them type member ID
  const buttons = members.slice(0, 8).map((m) => [
    Markup.button.callback(`${m.full_name} (#${m.id})`, `pay_member_${m.id}`),
  ]);
  buttons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);

  setSession(ctx.from.id, { step: 'PAY_SELECT_MEMBER' });

  return ctx.reply(
    '💰 *Record Verified Payment — Step 1/5*\n\n' +
    'Select the member from the list below, or reply with their *Member ID*:\n',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    }
  );
}

function registerPaymentHandlers(bot) {
  // ==========================================
  // Verify & Approve Member Screenshot Submissions
  // ==========================================
  async function handleSubmissionsList(ctx) {
    const list = getPendingPaymentSubmissions();
    if (list.length === 0) {
      return ctx.reply('✅ *No Pending Receipts*\n\nAll submitted member payments have been reviewed and verified.', {
        parse_mode: 'Markdown',
      });
    }

    const currency = getCurrency();
    await ctx.reply(`💳 *Pending Payment Receipts (${list.length})*\n\nReview each submitted receipt below:`, {
      parse_mode: 'Markdown',
    });

    for (const sub of list) {
      const caption =
        `👤 *${sub.full_name}* (#${sub.member_id})\n` +
        `• *Period:* ${sub.year_month}\n` +
        `• *Amount:* *${formatMoney(sub.amount_cents, currency)}*\n` +
        `• *Method:* ${formatPaymentMethod(sub.payment_method)}\n` +
        `• *Ref / Tx:* ${sub.reference_number || 'None'}\n` +
        `• *Submitted:* ${sub.created_at}`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Verify & Approve', `sub_approve_${sub.id}`),
          Markup.button.callback('❌ Reject', `sub_reject_${sub.id}`),
        ],
      ]);

      try {
        await ctx.replyWithPhoto(sub.file_id, {
          caption,
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } catch (_) {
        await ctx.reply(caption, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    }
  }

  bot.command('submissions', requireStaff, handleSubmissionsList);
  bot.command('verify', requireStaff, handleSubmissionsList);
  bot.hears(/^(?:💳\s*)?Verify Receipts$/i, requireStaff, handleSubmissionsList);
  bot.action('menu_submissions', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    await handleSubmissionsList(ctx);
  });

  bot.action(/^sub_approve_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const submissionId = parseInt(ctx.match[1], 10);
    const staffId = ctx.from.id;
    const staffName = ctx.from.first_name || 'Staff';

    try {
      const { payment, submission } = approvePaymentSubmission(submissionId, staffId);
      const currency = getCurrency();
      const obl = getOrCreateObligation(submission.member_id, submission.year_month);
      const balanceCents = Math.max(0, obl.amount_due_cents - obl.amount_paid_cents);

      const caption =
        `✅ *Payment Verified & Approved!*\n\n` +
        `• *Member:* ${submission.full_name} (#${submission.member_id})\n` +
        `• *Period:* ${payment.year_month}\n` +
        `• *Amount:* *${formatMoney(payment.amount_cents, currency)}*\n` +
        `• *Method:* ${formatPaymentMethod(payment.payment_method)}\n` +
        `• *Tx ID:* \`${payment.tx_id}\`\n` +
        `• *Verified By:* ${staffName} (\`${staffId}\`)\n` +
        `• *Obligation Status:* ${formatStatus(obl.status)}`;

      try {
        await ctx.editMessageCaption(caption, { parse_mode: 'Markdown' });
      } catch (_) {
        await ctx.reply(caption, { parse_mode: 'Markdown' });
      }

      // Send official digital receipt to member
      try {
        await ctx.telegram.sendMessage(
          submission.telegram_id,
          `🎉 *Payment Verified & Recorded!*\n\n` +
          `Hello *${submission.full_name}*, your contribution has been verified by church administration.\n\n` +
          `🧾 *Official Payment Receipt:*\n` +
          `• *Transaction ID:* \`${payment.tx_id}\`\n` +
          `• *Period:* ${payment.year_month}\n` +
          `• *Amount Paid:* *${formatMoney(payment.amount_cents, currency)}*\n` +
          `• *Payment Method:* ${formatPaymentMethod(payment.payment_method)}\n` +
          `• *Status:* ${formatStatus(obl.status)}\n` +
          `• *Remaining Balance for ${payment.year_month}:* ${formatMoney(balanceCents, currency)}\n\n` +
          `May God bless your generosity and support for the church! 🕊️`,
          {
            parse_mode: 'Markdown',
            ...getMainMenuKeyboard('member'),
          }
        );
      } catch (notifyErr) {
        console.warn(`[Payment] Could not send receipt DM to member ${submission.telegram_id}:`, notifyErr.message);
      }
    } catch (err) {
      return ctx.reply(`⚠️ ${err.message}`);
    }
  });

  bot.action(/^sub_reject_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const submissionId = parseInt(ctx.match[1], 10);
    const staffId = ctx.from.id;
    const staffName = ctx.from.first_name || 'Staff';

    try {
      const submission = rejectPaymentSubmission(submissionId, staffId, 'Declined by staff');
      const currency = getCurrency();

      const caption =
        `❌ *Payment Submission Rejected*\n\n` +
        `• *Member:* ${submission.full_name} (#${submission.member_id})\n` +
        `• *Amount:* ${formatMoney(submission.amount_cents, currency)}\n` +
        `• *Period:* ${submission.year_month}\n` +
        `• *Rejected By:* ${staffName} (\`${staffId}\`)\n`;

      try {
        await ctx.editMessageCaption(caption, { parse_mode: 'Markdown' });
      } catch (_) {
        await ctx.reply(caption, { parse_mode: 'Markdown' });
      }

      // Notify the member
      try {
        await ctx.telegram.sendMessage(
          submission.telegram_id,
          `⚠️ *Payment Verification Notice*\n\n` +
          `Hello *${submission.full_name}*, your payment submission of *${formatMoney(submission.amount_cents, currency)}* for *${submission.year_month}* could not be verified.\n\n` +
          `Please check that the transfer was sent to the church account and that the screenshot is clear. You can re-submit via /submitpayment or contact the treasurer.`,
          { parse_mode: 'Markdown' }
        );
      } catch (_) {}
    } catch (err) {
      return ctx.reply(`⚠️ ${err.message}`);
    }
  });

  bot.command('paid', requireStaff, async (ctx) => {
    startPaymentWizard(ctx);
  });

  bot.hears(/^(?:💰\s*)?Record Payment$/i, requireStaff, async (ctx) => {
    startPaymentWizard(ctx);
  });

  bot.action('menu_record_payment', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    startPaymentWizard(ctx);
  });

  // Step 1: Member clicked
  bot.action(/^pay_member_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const memberId = parseInt(ctx.match[1], 10);
    const member = getMemberById(memberId);
    if (!member) {
      return ctx.reply('❌ Member not found.');
    }

    const currentMonth = getCurrentYearMonth();
    const [year, monthNum] = currentMonth.split('-').map(Number);
    const prevMonthNum = monthNum === 1 ? 12 : monthNum - 1;
    const prevYear = monthNum === 1 ? year - 1 : year;
    const prevMonth = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;

    setSession(ctx.from.id, {
      step: 'PAY_SELECT_MONTH',
      memberId: member.id,
      memberName: member.full_name,
    });

    const monthButtons = [
      [
        Markup.button.callback(`📅 Current Month (${currentMonth})`, `pay_month_${currentMonth}`),
        Markup.button.callback(`📅 Prior Month (${prevMonth})`, `pay_month_${prevMonth}`),
      ],
      [Markup.button.callback('❌ Cancel', 'action_cancel')],
    ];

    await ctx.reply(
      `👤 *Selected Member:* ${member.full_name} (#${member.id})\n\n` +
      `*Step 2/5 — Contribution Period:*\n` +
      `Select the month for this payment, or reply with another \`YYYY-MM\` format:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(monthButtons),
      }
    );
  });

  // Step 2: Month clicked
  bot.action(/^pay_month_(\d{4}-\d{2})$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const session = getSession(ctx.from.id);
    if (!session || !session.memberId) {
      return ctx.reply('⚠️ Session expired. Please start again with /paid.');
    }

    const yearMonth = ctx.match[1];
    const obligation = getOrCreateObligation(session.memberId, yearMonth);
    const currency = getCurrency();
    const balanceCents = Math.max(0, obligation.amount_due_cents - obligation.amount_paid_cents);

    setSession(ctx.from.id, {
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

    await ctx.reply(
      `📅 *Month:* ${yearMonth}\n` +
      `🎯 *Due for Month:* ${formatMoney(obligation.amount_due_cents, currency)}\n` +
      `💰 *Outstanding Balance:* ${formatMoney(balanceCents, currency)}\n\n` +
      `*Step 3/5 — Payment Amount:*\n` +
      `Click the button below to pay full balance, or reply with an amount (e.g. \`500\` or \`250\`):`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(quickButtons),
      }
    );
  });

  // Step 3: Quick amount button clicked
  bot.action(/^pay_amt_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const session = getSession(ctx.from.id);
    if (!session || !session.memberId) {
      return ctx.reply('⚠️ Session expired. Please start again with /paid.');
    }

    const amountCents = parseInt(ctx.match[1], 10);
    setSession(ctx.from.id, {
      ...session,
      step: 'PAY_SELECT_METHOD',
      amountCents,
    });

    const currency = getCurrency();
    await ctx.reply(
      `💵 *Amount:* ${formatMoney(amountCents, currency)}\n\n` +
      `*Step 4/5 — Payment Method:*\n` +
      `Please select how the funds were received and verified:`,
      {
        parse_mode: 'Markdown',
        ...getPaymentMethodKeyboard(),
      }
    );
  });

  // Step 4: Payment method selected
  bot.action(/^paymethod_(cash|bank_transfer|mobile_money)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const session = getSession(ctx.from.id);
    if (!session || !session.memberId || !session.amountCents) {
      return ctx.reply('⚠️ Session expired. Please start again with /paid.');
    }

    const paymentMethod = ctx.match[1];
    setSession(ctx.from.id, {
      ...session,
      step: 'PAY_WAIT_REFERENCE',
      paymentMethod,
    });

    const skipKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏭️ Skip Reference / Notes', 'pay_skip_ref')],
      [Markup.button.callback('❌ Cancel', 'action_cancel')],
    ]);

    await ctx.reply(
      `💳 *Method:* ${formatPaymentMethod(paymentMethod)}\n\n` +
      `*Step 5/5 — Reference or Receipt Number:*\n` +
      `Please reply with the bank/mobile transfer reference number or receipt note, or tap *Skip*:`,
      {
        parse_mode: 'Markdown',
        ...skipKeyboard,
      }
    );
  });

  // Step 5: Skip reference
  bot.action('pay_skip_ref', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const session = getSession(ctx.from.id);
    if (!session || !session.memberId || !session.amountCents) {
      return ctx.reply('⚠️ Session expired. Please start again with /paid.');
    }

    setSession(ctx.from.id, {
      ...session,
      step: 'PAY_CONFIRM',
      referenceNumber: null,
      notes: null,
    });

    await showPaymentConfirmation(ctx, session);
  });

  // Final confirmation
  bot.action('pay_execute_confirm', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const session = getSession(ctx.from.id);
    if (!session || !session.memberId || !session.amountCents) {
      return ctx.reply('⚠️ Session expired or already processed.');
    }

    clearSession(ctx.from.id);

    try {
      const result = recordPayment({
        memberId: session.memberId,
        yearMonth: session.yearMonth,
        amountCents: session.amountCents,
        paymentMethod: session.paymentMethod,
        referenceNumber: session.referenceNumber,
        notes: session.notes,
        recordedBy: ctx.from.id,
      });

      const currency = getCurrency();
      const text =
        `🎉 *Payment Successfully Recorded!*\n\n` +
        `• *Transaction ID:* \`${result.payment.tx_id}\`\n` +
        `• *Member:* ${result.member.full_name}\n` +
        `• *Amount:* ${formatMoney(result.payment.amount_cents, currency)}\n` +
        `• *Method:* ${formatPaymentMethod(result.payment.payment_method)}\n` +
        `• *Period:* ${result.obligation.year_month}\n` +
        `• *Reference:* ${result.payment.reference_number || 'None'}\n` +
        `• *Obligation Status:* ${result.obligation.status}\n` +
        `• *Total Paid This Month:* ${formatMoney(result.obligation.amount_paid_cents, currency)} / ${formatMoney(result.obligation.amount_due_cents, currency)}\n\n` +
        `_This verified payment has been safely saved and audited._`;

      await ctx.editMessageText(text, { parse_mode: 'Markdown' });

      // Notify the member privately if they have started the bot
      try {
        const memberPrivateMsg =
          `🕊️ *Payment Verified Receipt*\n\n` +
          `Dear ${result.member.full_name},\n` +
          `Your contribution has been received and verified by the church team:\n\n` +
          `• *Receipt ID:* \`${result.payment.tx_id}\`\n` +
          `• *Amount:* ${formatMoney(result.payment.amount_cents, currency)}\n` +
          `• *Method:* ${formatPaymentMethod(result.payment.payment_method)}\n` +
          `• *Period:* ${result.obligation.year_month}\n` +
          `• *Status:* ${result.obligation.status}\n\n` +
          `May God bless your giving! 🙏`;

        await ctx.telegram.sendMessage(result.member.telegram_id, memberPrivateMsg, { parse_mode: 'Markdown' });
      } catch (_) {
        // Member hasn't started the bot or blocked it; don't fail the operation
      }
    } catch (err) {
      return ctx.reply(`❌ Payment recording failed: ${err.message}`);
    }
  });
}

async function showPaymentConfirmation(ctx, session) {
  const currency = getCurrency();
  const text =
    `📝 *Payment Confirmation Summary*\n\n` +
    `• *Member:* ${session.memberName} (#${session.memberId})\n` +
    `• *Period:* ${session.yearMonth}\n` +
    `• *Amount:* ${formatMoney(session.amountCents, currency)}\n` +
    `• *Method:* ${formatPaymentMethod(session.paymentMethod)}\n` +
    `• *Reference:* ${session.referenceNumber || 'None'}\n` +
    `• *Notes:* ${session.notes || 'None'}\n\n` +
    `⚠️ *Please confirm that funds have been received and verified.*`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...getConfirmationKeyboard('pay_execute_confirm'),
  });
}

module.exports = {
  registerPaymentHandlers,
  showPaymentConfirmation,
};

