const { Markup } = require('telegraf');
const { requireActiveMember } = require('../middleware/auth');
const {
  getOrCreateObligation,
  listMemberObligations,
  listMemberPayments,
  getMemberOutstandingTotal,
  getCurrency,
  getBankInfo,
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
} = require('../utils/formatters');

async function handleMyStatus(ctx) {
  const member = ctx.state?.member;
  if (!member) {
    return ctx.reply('⚠️ You must be a registered member to check contribution status.');
  }

  const currentMonth = getCurrentYearMonth();
  const obligation = getOrCreateObligation(member.id, currentMonth);
  const totalOutstanding = getMemberOutstandingTotal(member.id);
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
    text += `⚠️ <b>ጠቅላላ ቀሪ ዕዳ / Total Unpaid (incl. prior months):</b> ${formatMoney(totalOutstanding, currency)}\n\n`;
  }

  text += `💡 <b>Payment Instructions:</b>\n`;
  text += `• Transfer to official church CBE account\n`;
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
    return ctx.reply('⚠️ Only active church members can submit payment receipts.');
  }

  const curMonth = getCurrentYearMonth();
  const [year, monthNum] = curMonth.split('-').map(Number);
  const prevMonthNum = monthNum === 1 ? 12 : monthNum - 1;
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;

  setSession(ctx.from.id, {
    step: 'MEMBER_SUBMIT_MONTH',
    memberId: member.id,
    memberName: member.full_name,
  });

  const buttons = [
    [
      Markup.button.callback(`📅 ${formatDualMonth(curMonth)}`, `mem_sub_month_${curMonth}`),
      Markup.button.callback(`📅 ${formatDualMonth(prevMonth)}`, `mem_sub_month_${prevMonth}`),
    ],
    [Markup.button.callback('❌ Cancel', 'action_cancel')],
  ];

  const cbeInfo = getBankInfo();

  await ctx.reply(
    `📤 <b>Submit Contribution Receipt — Step 1/4</b>\n\n` +
    `👤 <b>Member:</b> ${escapeHtml(member.full_name)} (#${member.id})\n\n` +
    `${cbeInfo}\n\n` +
    `👇 <b>Select the starting period this payment covers:</b>\n` +
    `<i>(Or reply with another <code>YYYY-MM</code>)</i>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    }
  );
}

function registerMemberHandlers(bot) {
  bot.command('mystatus', requireActiveMember, handleMyStatus);
  bot.hears(/^(?:📊\s*)?My Status$/i, requireActiveMember, handleMyStatus);
  bot.action('menu_mystatus', requireActiveMember, async (ctx) => {
    await ctx.answerCbQuery();
    await handleMyStatus(ctx);
  });

  bot.command('history', requireActiveMember, handleHistory);
  bot.hears(/^(?:📜\s*)?My History$/i, requireActiveMember, handleHistory);
  bot.action('menu_history', requireActiveMember, async (ctx) => {
    await ctx.answerCbQuery();
    await handleHistory(ctx);
  });

  bot.command('submitpayment', requireActiveMember, startMemberPaymentSubmission);
  bot.command('payproof', requireActiveMember, startMemberPaymentSubmission);
  bot.hears(/^(?:📤\s*)?Submit (?:Payment )?Receipt$/i, requireActiveMember, startMemberPaymentSubmission);
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

