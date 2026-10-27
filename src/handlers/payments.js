const { Markup } = require('telegraf');
const { requireStaff } = require('../middleware/auth');
const { getAllActiveMembers, getMemberById } = require('../services/memberService');
const {
  recordPayment,
  getCurrency,
  getStandardAmountCents,
  getOrCreateObligation,
  getPendingPaymentSubmissions,
  getPaymentSubmissionById,
  approvePaymentSubmission,
  rejectPaymentSubmission,
} = require('../services/accounting');
const {
  parseMoneyToCents,
  formatMoney,
  getCurrentYearMonth,
  formatPaymentMethod,
  formatStatus,
  escapeHtml,
  formatDualMonth,
  formatDualDate,
} = require('../utils/formatters');
const { getPaymentMethodKeyboard, getCancelKeyboard, getConfirmationKeyboard, getMainMenuKeyboard } = require('../utils/keyboards');
const { forwardVerifiedReceiptToStaffGroup } = require('../services/staffArchive');

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
      const monthsCount = sub.months_count || 1;
      let periodDisplay = formatDualMonth(sub.year_month);
      if (monthsCount > 1) {
        let currentYm = sub.year_month;
        for (let i = 1; i < monthsCount; i++) {
          const [y, m] = currentYm.split('-').map(Number);
          const nextM = m === 12 ? 1 : m + 1;
          const nextY = m === 12 ? y + 1 : y;
          currentYm = `${nextY}-${String(nextM).padStart(2, '0')}`;
        }
        periodDisplay = `${formatDualMonth(sub.year_month)} to ${formatDualMonth(currentYm)} (${monthsCount} Months)`;
      }

      const caption =
        `👤 <b>${escapeHtml(sub.full_name)}</b> (#${sub.member_id})\n` +
        `• <b>Period:</b> ${escapeHtml(periodDisplay)}\n` +
        `• <b>Months:</b> ${monthsCount} Month${monthsCount > 1 ? 's' : ''}\n` +
        `• <b>Amount:</b> <b>${escapeHtml(formatMoney(sub.amount_cents, currency))}</b>\n` +
        `• <b>Method:</b> ${escapeHtml(formatPaymentMethod(sub.payment_method))}\n` +
        `• <b>Ref / Tx:</b> <code>${escapeHtml(sub.reference_number || 'None')}</code>\n` +
        `• <b>Submitted:</b> ${escapeHtml(sub.created_at)}`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Verify & Approve', `sub_approve_${sub.id}`),
          Markup.button.callback('❌ Reject', `sub_reject_${sub.id}`),
        ],
      ]);

      try {
        await ctx.replyWithPhoto(sub.file_id, {
          caption,
          parse_mode: 'HTML',
          ...keyboard,
        });
      } catch (photoErr) {
        // Fallback 1: if uploaded as document/PDF
        try {
          await ctx.replyWithDocument(sub.file_id, {
            caption,
            parse_mode: 'HTML',
            ...keyboard,
          });
        } catch (_) {
          // Fallback 2: text message with action buttons
          await ctx.reply(caption, {
            parse_mode: 'HTML',
            ...keyboard,
          });
        }
      }
    }
  }

  bot.command('submissions', requireStaff, handleSubmissionsList);
  bot.command('verify', requireStaff, handleSubmissionsList);
  bot.hears(/^(?:💳\s*)?(?:Verify Receipts|ደረሰኝ አረጋግጥ)$/i, requireStaff, handleSubmissionsList);
  bot.action('menu_submissions', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    await handleSubmissionsList(ctx);
  });

  bot.action(/^sub_approve_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const submissionId = parseInt(ctx.match[1], 10);
    const sub = getPaymentSubmissionById(submissionId);
    if (!sub) {
      return ctx.reply('❌ Payment submission not found.');
    }
    if (sub.status !== 'PENDING') {
      return ctx.reply(`⚠️ This payment submission has already been ${sub.status.toLowerCase()}.`);
    }

    const currency = getCurrency();
    const standardAmount = getStandardAmountCents();
    const memberMonths = sub.months_count || 1;
    const suggestedMonths = memberMonths > 1
      ? memberMonths
      : Math.max(1, Math.round(sub.amount_cents / standardAmount));

    let periodDisplay = sub.year_month;
    if (memberMonths > 1) {
      let currentYm = sub.year_month;
      for (let i = 1; i < memberMonths; i++) {
        const [y, m] = currentYm.split('-').map(Number);
        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        currentYm = `${nextY}-${String(nextM).padStart(2, '0')}`;
      }
      periodDisplay = `${sub.year_month} to ${currentYm} (${memberMonths} Months)`;
    }

    const text =
      `💳 <b>Approve Contribution Receipt</b>\n\n` +
      `• <b>Member:</b> ${escapeHtml(sub.full_name)} (#${sub.member_id})\n` +
      `• <b>Submitted Amount:</b> <b>${escapeHtml(formatMoney(sub.amount_cents, currency))}</b>\n` +
      `• <b>Starting Month:</b> <code>${escapeHtml(sub.year_month)}</code>\n` +
      `• <b>Period:</b> ${escapeHtml(periodDisplay)}\n` +
      `• <b>Member Stated:</b> ${memberMonths} Month${memberMonths > 1 ? 's' : ''}\n` +
      `• <b>Standard Rate:</b> ${escapeHtml(formatMoney(standardAmount, currency))} / month\n\n` +
      `💡 <i>Suggested: ${suggestedMonths} Month(s)</i>\n\n` +
      `❓ <b>How many months does this payment cover?</b>`;

    const getBtnLabel = (n, label) => (n === suggestedMonths ? `⭐ ${label}` : label);

    const buttons = [
      [
        Markup.button.callback(getBtnLabel(1, `1 Month (${formatMoney(standardAmount, currency)})`), `sub_confirm_${submissionId}_1`),
        Markup.button.callback(getBtnLabel(2, '2 Months'), `sub_confirm_${submissionId}_2`),
      ],
      [
        Markup.button.callback(getBtnLabel(3, '3 Months'), `sub_confirm_${submissionId}_3`),
        Markup.button.callback(getBtnLabel(4, '4 Months'), `sub_confirm_${submissionId}_4`),
      ],
      [
        Markup.button.callback(getBtnLabel(5, '5 Months'), `sub_confirm_${submissionId}_5`),
        Markup.button.callback(getBtnLabel(6, '6 Months'), `sub_confirm_${submissionId}_6`),
      ],
      [
        Markup.button.callback(getBtnLabel(12, '12 Months (1 Year)'), `sub_confirm_${submissionId}_12`),
        Markup.button.callback('❌ Cancel', 'action_cancel'),
      ],
    ];

    try {
      await ctx.editMessageCaption(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (_) {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    }
  });

  bot.action(/^sub_confirm_(\d+)_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const submissionId = parseInt(ctx.match[1], 10);
    const monthsCount = parseInt(ctx.match[2], 10) || 1;
    const staffId = ctx.from.id;
    const staffName = ctx.from.first_name || 'Staff';

    try {
      const { payment, monthsCovered, txId, submission } = approvePaymentSubmission(submissionId, staffId, monthsCount);
      const currency = getCurrency();
      const finalTxId = txId || (payment && payment.tx_id) || `TX-${submission.id}`;

      const coveredSummary = monthsCovered.length > 1
        ? `${formatDualMonth(monthsCovered[0])} to ${formatDualMonth(monthsCovered[monthsCovered.length - 1])} (${monthsCovered.length} months)`
        : formatDualMonth(monthsCovered[0]);

      const caption =
        `✅ <b>Payment Verified & Approved!</b>\n\n` +
        `• <b>Member:</b> ${escapeHtml(submission.full_name)} (#${submission.member_id})\n` +
        `• <b>Months Covered (${monthsCovered.length}):</b> <code>${escapeHtml(coveredSummary)}</code>\n` +
        `• <b>Total Amount:</b> <b>${escapeHtml(formatMoney(submission.amount_cents, currency))}</b>\n` +
        `• <b>Payment Method:</b> ${escapeHtml(formatPaymentMethod(submission.payment_method))}\n` +
        `• <b>Transaction / Batch ID:</b> <code>${escapeHtml(finalTxId)}</code>\n` +
        `• <b>Verified By:</b> ${escapeHtml(staffName)} (<code>${staffId}</code>)\n` +
        `• <b>Status:</b> 🟢 Fully Paid for all ${monthsCovered.length} month(s)`;

      try {
        await ctx.editMessageCaption(caption, { parse_mode: 'HTML' });
      } catch (_) {
        try {
          await ctx.editMessageText(caption, { parse_mode: 'HTML' });
        } catch (_) {
          await ctx.reply(caption, { parse_mode: 'HTML' });
        }
      }

      // Send official digital receipt message to member
      try {
        const coveredList = monthsCovered.map(formatDualMonth).join(', ');

        const receiptMsg =
          `🕊️ <b>የአርባ ምንጭ ዩኒቨርሲቲ ክርስቲያን ተማሪዎች ናታኒም ፈንድ</b>\n` +
          `<i>Arbaminch University Christian Students Natanim Fund</i>\n` +
          `───────────────────────\n` +
          `🎉 <b>ይፋዊ የክፍያ ማረጋገጫ ደረሰኝ / Official Receipt</b>\n\n` +
          `ሰላም <b>${escapeHtml(submission.full_name)}</b>! ያቀረቡት መዋጮ በአስተዳደሩ ተረጋግጦ ይፋዊ ደረሰኝ ተመዝግቧል።\n\n` +
          `🧾 <b>የደረሰኝ ዝርዝር (Receipt Details):</b>\n` +
          `• <b>ደረሰኝ ቁጥር (TxID):</b> <code>${escapeHtml(finalTxId)}</code>\n` +
          `• <b>የተከፈለው መጠን:</b> <b>${escapeHtml(formatMoney(submission.amount_cents, currency))}</b>\n` +
          `• <b>የክፍያ ዘዴ:</b> ${escapeHtml(formatPaymentMethod(submission.payment_method))}\n` +
          (submission.reference_number ? `• <b>ማመሳከሪያ (Ref):</b> <code>${escapeHtml(submission.reference_number)}</code>\n` : '') +
          `• <b>የተሸፈኑ ወራት (${monthsCovered.length}):</b> <code>${escapeHtml(coveredList)}</code>\n` +
          `• <b>ሁኔታ:</b> 🟢 ሙሉ በሙሉ ተከፍሏል (Fully Settled)\n\n` +
          `«እግዚአብሔር በደስታ የሚሰጠውን ይወዳልና እያንዳንዱ በልቡ እንዳሰበ ይስጥ።» (2ኛ ቆሮንቶስ 9:7)\n` +
          `እግዚአብሔር አብዝቶ ይባርክዎት! 🕊️`;

        await ctx.telegram.sendMessage(
          submission.telegram_id,
          receiptMsg,
          {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard('member'),
          }
        );
      } catch (notifyErr) {
        console.warn(`[Payment] Could not send receipt DM to member ${submission.telegram_id}:`, notifyErr.message);
      }

      // Auto-archive verified screenshot to the Fellowship Staff Group (organized by Month Topic)
      try {
        await forwardVerifiedReceiptToStaffGroup(ctx.telegram, {
          submission,
          member: { id: submission.member_id, full_name: submission.full_name },
          approverName: staffName,
          currency,
          txId: finalTxId,
        });
      } catch (archiveErr) {
        console.warn('[StaffArchive] Could not auto-archive to staff group:', archiveErr.message);
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
        `❌ <b>Payment Submission Rejected</b>\n\n` +
        `• <b>Member:</b> ${escapeHtml(submission.full_name)} (#${submission.member_id})\n` +
        `• <b>Amount:</b> ${escapeHtml(formatMoney(submission.amount_cents, currency))}\n` +
        `• <b>Period:</b> ${escapeHtml(submission.year_month)}\n` +
        `• <b>Rejected By:</b> ${escapeHtml(staffName)} (<code>${staffId}</code>)\n`;

      try {
        await ctx.editMessageCaption(caption, { parse_mode: 'HTML' });
      } catch (_) {
        await ctx.reply(caption, { parse_mode: 'HTML' });
      }

      // Notify the member
      try {
        await ctx.telegram.sendMessage(
          submission.telegram_id,
          `⚠️ <b>Payment Verification Notice</b>\n\n` +
          `Hello <b>${escapeHtml(submission.full_name)}</b>, your payment submission of <b>${escapeHtml(formatMoney(submission.amount_cents, currency))}</b> for <code>${escapeHtml(submission.year_month)}</code> could not be verified.\n\n` +
          `Please check that the transfer was sent to the church account and that the screenshot is clear. You can re-submit via /submitpayment or contact the church treasurer.`,
          { parse_mode: 'HTML' }
        );
      } catch (_) {}
    } catch (err) {
      return ctx.reply(`⚠️ ${err.message}`);
    }
  });

  bot.command('paid', requireStaff, async (ctx) => {
    startPaymentWizard(ctx);
  });

  bot.hears(/^(?:💰\s*)?(?:Record Payment|ክፍያ መዝግብ)$/i, requireStaff, async (ctx) => {
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

      // Notify the member privately with clean receipt message
      if (result.member && result.member.telegram_id) {
        try {
          const receiptMsg =
            `🕊️ <b>የአርባ ምንጭ ዩኒቨርሲቲ ክርስቲያን ተማሪዎች ናታኒም ፈንድ</b>\n` +
            `<i>Arbaminch University Christian Students Natanim Fund</i>\n` +
            `───────────────────────\n` +
            `🎉 <b>ይፋዊ የክፍያ ማረጋገጫ ደረሰኝ / Official Receipt</b>\n\n` +
            `ውድ <b>${escapeHtml(result.member.full_name)}</b>! ያበረከቱት ወርሃዊ መዋጮ በገንዘብ ያዥ ተረጋግጦ ተመዝግቧል።\n\n` +
            `• <b>ደረሰኝ ቁጥር (TxID):</b> <code>${escapeHtml(result.payment.tx_id)}</code>\n` +
            `• <b>መጠን:</b> <b>${escapeHtml(formatMoney(result.payment.amount_cents, currency))}</b>\n` +
            `• <b>የመዋጮ ጊዜ:</b> <code>${escapeHtml(formatDualMonth(result.obligation.year_month))}</code>\n` +
            `• <b>ዘዴ:</b> ${escapeHtml(formatPaymentMethod(result.payment.payment_method))}\n` +
            (result.payment.reference_number ? `• <b>ማመሳከሪያ:</b> <code>${escapeHtml(result.payment.reference_number)}</code>\n` : '') +
            `• <b>ሁኔታ:</b> 🟢 ${escapeHtml(result.obligation.status)}\n\n` +
            `«እግዚአብሔር በደስታ የሚሰጠውን ይወዳል...» (2ኛ ቆሮንቶስ 9:7)\n` +
            `በረከቱ ይደርስዎ! እግዚአብሔር ይባርክዎት! 🙏`;

          await ctx.telegram.sendMessage(result.member.telegram_id, receiptMsg, { parse_mode: 'HTML' });
        } catch (_) {}
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

