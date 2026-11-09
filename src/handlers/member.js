const { Markup } = require('telegraf');
const { requireActiveMember } = require('../middleware/auth');
const {
  getOrCreateObligation,
  listMemberObligations,
  listMemberPayments,
  getMemberOutstandingTotal,
  getMemberPrepaidMonths,
  getCurrency,
  getBankInfo,
  getEligibleSubmissionMonths,
} = require('../services/accounting');
const { setSession } = require('../utils/session');
const {
  formatMoney,
  getCurrentYearMonth,
  formatStatus,
  formatPaymentMethod,
  escapeHtml,
  formatDualMonth,
  formatDualDate,
  isAcademicMonth,
  getNextAcademicMonth,
} = require('../utils/formatters');

async function handleMyStatus(ctx) {
  const member = ctx.state?.member;
  if (!member) {
    return ctx.reply('⚠️ You must be a registered member to check contribution status.');
  }

  const currentMonth = getCurrentYearMonth();
  const obligation = getOrCreateObligation(member.id, currentMonth);
  const totalOutstanding = getMemberOutstandingTotal(member.id, currentMonth);
  const prepaidMonths = getMemberPrepaidMonths(member.id);
  const currency = getCurrency();

  const balanceCents = Math.max(0, obligation.amount_due_cents - obligation.amount_paid_cents);

  let text = `📊 <b>የወርሃዊ መዋጮ ሁኔታ / Contribution Status</b>\n\n`;
  text += `👤 <b>Member:</b> ${escapeHtml(member.full_name)}\n`;
  text += `📅 <b>Current Period:</b> ${formatDualMonth(currentMonth)}\n`;
  text += `🎯 <b>Target Amount Due:</b> ${formatMoney(obligation.amount_due_cents, currency)}\n`;
  text += `✅ <b>Amount Paid:</b> ${formatMoney(obligation.amount_paid_cents, currency)}\n`;
  text += `💰 <b>Remaining Balance:</b> ${formatMoney(balanceCents, currency)}\n`;
  text += `📌 <b>Status:</b> ${formatStatus(obligation.status)}\n`;
  text += `⏰ <b>Due Date:</b> ${formatDualDate(obligation.due_date)}\n\n`;

  if (totalOutstanding > balanceCents) {
    const priorDues = totalOutstanding - balanceCents;
    text += `⚠️ <b>ያለፈ ቀሪ ዕዳ / Prior Months Overdue:</b> ${formatMoney(priorDues, currency)}\n`;
    text += `⚠️ <b>ጠቅላላ ቀሪ ዕዳ / Total Outstanding:</b> ${formatMoney(totalOutstanding, currency)}\n\n`;
  }

  if (prepaidMonths.length > 0) {
    const latestPrepaid = prepaidMonths[prepaidMonths.length - 1];
    text += `✨ <b>የቅድመ ክፍያ ሁኔታ / Advance Contributions:</b>\n`;
    text += `• Fully paid in advance through <b>${formatDualMonth(latestPrepaid.year_month)}</b>! (${prepaidMonths.length} future month${prepaidMonths.length > 1 ? 's' : ''})\n\n`;
  }

  if (!isAcademicMonth(currentMonth)) {
    text += `🏖️ <b>የክረምት ዕረፍት / Summer Break:</b> የአሁኑ ወር የክረምት ዕረፍት በመሆኑ ክፍያ አይጠየቅም። መዋጮ በጥቅምት ወር ይቀጥላል። (Contributions are only due October to June / ጥቅምት እስከ ሰኔ).\n\n`;
  }

  text += `💡 <b>Payment Instructions:</b>\n`;
  text += `• Transfer to official fellowship CBE account\n`;
  text += `• Tap the button below to upload your payment screenshot or receipt.\n`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📤 Submit Payment Receipt', 'start_payment_submission')],
  ]);

  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

async function handleHistory(ctx) {
  const member = ctx.state?.member;
  if (!member) {
    return ctx.reply('⚠️ You must be a registered member to view history.');
  }

  const currency = getCurrency();
  const obligations = listMemberObligations(member.id, 6);
  const payments = listMemberPayments(member.id, 6);

  let text = `📜 <b>የመዋጮ ታሪክ / Contribution History</b>\n`;
  text += `👤 <b>Member:</b> ${escapeHtml(member.full_name)}\n\n`;

  text += `🗓️ <b>Recent Monthly Obligations:</b>\n`;
  if (obligations.length === 0) {
    text += `<i>No obligations recorded yet.</i>\n`;
  } else {
    for (const obl of obligations) {
      const balance = Math.max(0, obl.amount_due_cents - obl.amount_paid_cents);
      text += `• <b>${formatDualMonth(obl.year_month)}:</b> ${formatStatus(obl.status)} | Paid: ${formatMoney(obl.amount_paid_cents, currency)} / Due: ${formatMoney(obl.amount_due_cents, currency)}`;
      if (balance > 0) {
        text += ` (Bal: ${formatMoney(balance, currency)})`;
      }
      text += `\n`;
    }
  }

  text += `\n🧾 <b>Recent Payment Receipts:</b>\n`;
  if (payments.length === 0) {
    text += `<i>No verified payments recorded yet.</i>\n`;
  } else {
    for (const p of payments) {
      if (p.is_reversed === 1) {
        text += `• <s>${p.tx_id}</s> — ${formatMoney(p.amount_cents, currency)} [REVERSED: ${escapeHtml(p.reversal_reason)}]\n`;
      } else {
        const ref = p.reference_number ? ` (Ref: ${escapeHtml(p.reference_number)})` : '';
        const paidDate = p.created_at.slice(0, 10);
        text += `• <b>${p.tx_id}</b> — ${formatMoney(p.amount_cents, currency)} via ${formatPaymentMethod(p.payment_method)} on ${formatDualDate(paidDate)}${ref}\n`;
      }
    }
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
}

async function startMemberPaymentSubmission(ctx) {
  const member = ctx.state?.member;
  if (!member || member.status !== 'active') {
    return ctx.reply('⚠️ ንቁ የቤተክርስቲያን አባላት ብቻ ደረሰኝ ማስረከብ ይችላሉ።');
  }

  const eligibleMonths = getEligibleSubmissionMonths(member.id, 3);
  if (eligibleMonths.length === 0) {
    return ctx.reply(
      '🎉 <b>ምንም ያልተከፈለ መዋጮ የለብዎትም!</b>\n\n' +
      'የሁሉንም ወራት መዋጮዎን ሙሉ በሙሉ ከፍለዋል (ወይም ያስገቧቸው ደረሰኞች በማረጋገጥ ላይ ናቸው)።\n' +
      'እግዚአብሔር ይስጥልን! 🙏',
      { parse_mode: 'HTML' }
    );
  }

  setSession(ctx.from.id, {
    step: 'MEMBER_SUBMIT_MONTH',
    memberId: member.id,
    memberName: member.full_name,
  });

  const buttons = eligibleMonths.map((m) => [
    Markup.button.callback(`📅 ${formatDualMonth(m)}`, `mem_sub_month_${m}`),
  ]);
  buttons.push([Markup.button.callback('❌ ሰርዝ', 'action_cancel')]);

  const cbeInfo = getBankInfo();

  await ctx.reply(
    `📤 <b>የመዋጮ ደረሰኝ ማስረከቢያ — ደረጃ 1/4</b>\n\n` +
    `👤 <b>አባል፡</b> ${escapeHtml(member.full_name)} (#${member.id})\n\n` +
    `${cbeInfo}\n\n` +
    `🎓 <i>ማስታወሻ፦ የናታኒም ፈንድ መዋጮ ከጥቅምት እስከ ሰኔ ባሉት 9 ወራት ብቻ የሚሰበሰብ ሲሆን፣ የክረምት ወራት (ከሐምሌ እስከ መስከረም) መዋጮ አይጠየቅም።</i>\n\n` +
    `👇 <b>ክፍያው የሚሸፍነውን መነሻ ወር ይምረጡ፦</b>\n` +
    `<i>(ወይም ሌላ ወር በ <code>YYYY-MM</code> ቅርጸት ይጻፉ)</i>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    }
  );
}

function registerMemberHandlers(bot) {
  bot.command('mystatus', requireActiveMember, handleMyStatus);
  bot.hears(/^(?:📊\s*)?(?:My Status|ሁኔታዬ)$/i, requireActiveMember, handleMyStatus);
  bot.action('menu_mystatus', requireActiveMember, async (ctx) => {
    await ctx.answerCbQuery();
    await handleMyStatus(ctx);
  });

  bot.command('history', requireActiveMember, handleHistory);
  bot.hears(/^(?:📜\s*)?(?:My History|ታሪኬ)$/i, requireActiveMember, handleHistory);
  bot.action('menu_history', requireActiveMember, async (ctx) => {
    await ctx.answerCbQuery();
    await handleHistory(ctx);
  });

  bot.command('submitpayment', requireActiveMember, startMemberPaymentSubmission);
  bot.command('payproof', requireActiveMember, startMemberPaymentSubmission);
  bot.hears(/^(?:📤\s*)?(?:Submit (?:Payment )?Receipt|ደረሰኝ ላክ)$/i, requireActiveMember, startMemberPaymentSubmission);
  bot.action('start_payment_submission', requireActiveMember, async (ctx) => {
    await ctx.answerCbQuery();
    await startMemberPaymentSubmission(ctx);
  });
  bot.action('menu_submit_payment', requireActiveMember, async (ctx) => {
    await ctx.answerCbQuery();
    await startMemberPaymentSubmission(ctx);
  });
}

module.exports = {
  registerMemberHandlers,
  handleMyStatus,
  handleHistory,
  startMemberPaymentSubmission,
};

