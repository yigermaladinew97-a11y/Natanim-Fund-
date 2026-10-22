const { requireActiveMember } = require('../middleware/auth');
const {
  getOrCreateObligation,
  listMemberObligations,
  listMemberPayments,
  getMemberOutstandingTotal,
  getCurrency,
} = require('../services/accounting');
const { formatMoney, getCurrentYearMonth, formatStatus, formatPaymentMethod } = require('../utils/formatters');

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

  let text = `📊 *My Monthly Contribution Status*\n\n`;
  text += `👤 *Member:* ${member.full_name}\n`;
  text += `📅 *Current Period:* ${currentMonth}\n`;
  text += `🎯 *Target Amount Due:* ${formatMoney(obligation.amount_due_cents, currency)}\n`;
  text += `✅ *Amount Paid:* ${formatMoney(obligation.amount_paid_cents, currency)}\n`;
  text += `💰 *Remaining Balance:* ${formatMoney(balanceCents, currency)}\n`;
  text += `📌 *Status:* ${formatStatus(obligation.status)}\n`;
  text += `⏰ *Due Date:* ${obligation.due_date}\n\n`;

  if (totalOutstanding > balanceCents) {
    text += `⚠️ *Total Unpaid Balance (including prior months):* ${formatMoney(totalOutstanding, currency)}\n\n`;
  }

  text += `💡 *Payment Methods Accepted:*\n`;
  text += `• Cash to church leader or treasurer\n`;
  text += `• Bank Transfer\n`;
  text += `• Mobile Money\n\n`;
  text += `_Once paid, the treasurer will verify and record your receipt._`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

async function handleHistory(ctx) {
  const member = ctx.state?.member;
  if (!member) {
    return ctx.reply('⚠️ You must be a registered member to view history.');
  }

  const currency = getCurrency();
  const obligations = listMemberObligations(member.id, 6);
  const payments = listMemberPayments(member.id, 6);

  let text = `📜 *My Contribution History*\n`;
  text += `👤 *Member:* ${member.full_name}\n\n`;

  text += `🗓️ *Recent Monthly Obligations:*\n`;
  if (obligations.length === 0) {
    text += `_No obligations recorded yet._\n`;
  } else {
    for (const obl of obligations) {
      const balance = Math.max(0, obl.amount_due_cents - obl.amount_paid_cents);
      text += `• *${obl.year_month}:* ${formatStatus(obl.status)} | Paid: ${formatMoney(obl.amount_paid_cents, currency)} / Due: ${formatMoney(obl.amount_due_cents, currency)}`;
      if (balance > 0) {
        text += ` (Bal: ${formatMoney(balance, currency)})`;
      }
      text += `\n`;
    }
  }

  text += `\n🧾 *Recent Payment Receipts:*\n`;
  if (payments.length === 0) {
    text += `_No verified payments recorded yet._\n`;
  } else {
    for (const p of payments) {
      if (p.is_reversed === 1) {
        text += `• ~${p.tx_id}~ — ${formatMoney(p.amount_cents, currency)} [REVERSED: ${p.reversal_reason}]\n`;
      } else {
        const ref = p.reference_number ? ` (Ref: ${p.reference_number})` : '';
        text += `• *${p.tx_id}* — ${formatMoney(p.amount_cents, currency)} via ${formatPaymentMethod(p.payment_method)} on ${p.created_at.slice(0, 10)}${ref}\n`;
      }
    }
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
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
}

module.exports = {
  registerMemberHandlers,
  handleMyStatus,
  handleHistory,
};

