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
const { getUserLanguage } = require('../services/i18n');
const { setSession } = require('../utils/session');
const {
  formatMoney,
  getCurrentYearMonth,
  formatStatus,
  formatPaymentMethod,
  escapeHtml,
  formatPeriod,
  formatDate,
  formatDualMonth,
  formatDualDate,
  isAcademicMonth,
  getNextAcademicMonth,
} = require('../utils/formatters');

async function handleMyStatus(ctx) {
  const member = ctx.state?.member;
  const lang = ctx.state?.language || getUserLanguage(ctx.from?.id) || 'am';
  const isAm = lang === 'am';

  if (!member) {
    return ctx.reply(
      isAm
        ? '⚠️ የወርሃዊ መዋጮ ሁኔታን ለመመልከት የተመዘገቡ አባል መሆን አለብዎት።'
        : '⚠️ You must be a registered member to check contribution status.'
    );
  }

  const currentMonth = getCurrentYearMonth();
  const obligation = getOrCreateObligation(member.id, currentMonth);
  const totalOutstanding = getMemberOutstandingTotal(member.id, currentMonth);
  const prepaidMonths = getMemberPrepaidMonths(member.id);
  const currency = getCurrency();

  const balanceCents = Math.max(0, obligation.amount_due_cents - obligation.amount_paid_cents);

  let text = '';
  if (isAm) {
    text += `📊 <b>የወርሃዊ መዋጮ ሁኔታ</b>\n\n`;
    text += `👤 <b>አባል፦</b> ${escapeHtml(member.full_name)}\n`;
    text += `📅 <b>ወቅት፦</b> ${formatPeriod(currentMonth, 'am')}\n`;
    text += `🎯 <b>የሚጠበቅ መጠን፦</b> ${formatMoney(obligation.amount_due_cents, currency)}\n`;
    text += `✅ <b>የተከፈለ፦</b> ${formatMoney(obligation.amount_paid_cents, currency)}\n`;
    text += `💰 <b>ቀሪ ሂሳብ፦</b> ${formatMoney(balanceCents, currency)}\n`;
    text += `📌 <b>ሁኔታ፦</b> ${formatStatus(obligation.status, 'am')}\n`;
    text += `⏰ <b>የመጨረሻ ቀን፦</b> ${formatDate(obligation.due_date, 'am')}\n\n`;

    if (totalOutstanding > balanceCents) {
      const priorDues = totalOutstanding - balanceCents;
      text += `⚠️ <b>ያለፈ ቀሪ ዕዳ፦</b> ${formatMoney(priorDues, currency)}\n`;
      text += `⚠️ <b>ጠቅላላ ቀሪ ዕዳ፦</b> ${formatMoney(totalOutstanding, currency)}\n\n`;
    }

    if (prepaidMonths.length > 0) {
      const latestPrepaid = prepaidMonths[prepaidMonths.length - 1];
      text += `✨ <b>የቅድመ ክፍያ ሁኔታ፦</b>\n`;
      text += `• እስከ <b>${formatPeriod(latestPrepaid.year_month, 'am')}</b> ድረስ ሙሉ በሙሉ ተከፍሏል! (${prepaidMonths.length} ወራት)\n\n`;
    }

    if (!isAcademicMonth(currentMonth)) {
      text += `🏖️ <b>የክረምት ዕረፍት፦</b> የአሁኑ ወር የክረምት ዕረፍት በመሆኑ ክፍያ አይጠየቅም። መዋጮ በጥቅምት ወር ይቀጥላል።\n\n`;
    }

    text += `💡 <i>የከፈሉበትን ደረሰኝ (ስክሪንሾት) ለመላክ ከታች ያለውን ቁልፍ ይጫኑ፦</i>`;
  } else {
    text += `📊 <b>Contribution Status</b>\n\n`;
    text += `👤 <b>Member:</b> ${escapeHtml(member.full_name)}\n`;
    text += `📅 <b>Period:</b> ${formatPeriod(currentMonth, 'en')}\n`;
    text += `🎯 <b>Target Amount Due:</b> ${formatMoney(obligation.amount_due_cents, currency)}\n`;
    text += `✅ <b>Amount Paid:</b> ${formatMoney(obligation.amount_paid_cents, currency)}\n`;
    text += `💰 <b>Remaining Balance:</b> ${formatMoney(balanceCents, currency)}\n`;
    text += `📌 <b>Status:</b> ${formatStatus(obligation.status, 'en')}\n`;
    text += `⏰ <b>Due Date:</b> ${formatDate(obligation.due_date, 'en')}\n\n`;

    if (totalOutstanding > balanceCents) {
      const priorDues = totalOutstanding - balanceCents;
      text += `⚠️ <b>Prior Months Overdue:</b> ${formatMoney(priorDues, currency)}\n`;
      text += `⚠️ <b>Total Outstanding:</b> ${formatMoney(totalOutstanding, currency)}\n\n`;
    }

    if (prepaidMonths.length > 0) {
      const latestPrepaid = prepaidMonths[prepaidMonths.length - 1];
      text += `✨ <b>Advance Contributions:</b>\n`;
      text += `• Fully paid in advance through <b>${formatPeriod(latestPrepaid.year_month, 'en')}</b>! (${prepaidMonths.length} month${prepaidMonths.length > 1 ? 's' : ''})\n\n`;
    }

    if (!isAcademicMonth(currentMonth)) {
      text += `🏖️ <b>Summer Break:</b> Contributions are only due October to June. No contribution due this month.\n\n`;
    }

    text += `💡 <i>Tap the button below to upload your payment receipt:</i>`;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(isAm ? '📤 ደረሰኝ ላክ' : '📤 Submit Receipt', 'start_payment_submission')],
  ]);

  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

async function handleHistory(ctx) {
  const member = ctx.state?.member;
  const lang = ctx.state?.language || getUserLanguage(ctx.from?.id) || 'am';
  const isAm = lang === 'am';

  if (!member) {
    return ctx.reply(
      isAm
        ? '⚠️ የመዋጮ ታሪክን ለመመልከት የተመዘገቡ አባል መሆን አለብዎት።'
        : '⚠️ You must be a registered member to view history.'
    );
  }

  const currency = getCurrency();
  const obligations = listMemberObligations(member.id, 6);
  const payments = listMemberPayments(member.id, 6);

  let text = '';
  if (isAm) {
    text += `📜 <b>የመዋጮ ታሪክ</b>\n`;
    text += `👤 <b>አባል፦</b> ${escapeHtml(member.full_name)}\n\n`;

    text += `🗓️ <b>የቅርብ ወራት ሁኔታ፦</b>\n`;
    if (obligations.length === 0) {
      text += `<i>ምንም መረጃ የለም።</i>\n`;
    } else {
      for (const obl of obligations) {
        const balance = Math.max(0, obl.amount_due_cents - obl.amount_paid_cents);
        text += `• <b>${formatPeriod(obl.year_month, 'am')}፦</b> ${formatStatus(obl.status, 'am')} | የተከፈለ፦ ${formatMoney(obl.amount_paid_cents, currency)} / የሚጠበቅ፦ ${formatMoney(obl.amount_due_cents, currency)}`;
        if (balance > 0) {
          text += ` (ቀሪ፦ ${formatMoney(balance, currency)})`;
        }
        text += `\n`;
      }
    }

    text += `\n🧾 <b>የተረጋገጡ የክፍያ ደረሰኞች፦</b>\n`;
    if (payments.length === 0) {
      text += `<i>ምንም የተረጋገጠ ክፍያ የለም።</i>\n`;
    } else {
      for (const p of payments) {
        if (p.is_reversed === 1) {
          text += `• <s>${p.tx_id}</s> — ${formatMoney(p.amount_cents, currency)} [የተሰረዘ፦ ${escapeHtml(p.reversal_reason)}]\n`;
        } else {
          const ref = p.reference_number ? ` (ማጣቀሻ፦ ${escapeHtml(p.reference_number)})` : '';
          const paidDate = p.created_at.slice(0, 10);
          text += `• <b>${p.tx_id}</b> — ${formatMoney(p.amount_cents, currency)} በ${formatPaymentMethod(p.payment_method, 'am')} ቀን ${formatDate(paidDate, 'am')}${ref}\n`;
        }
      }
    }
  } else {
    text += `📜 <b>Contribution History</b>\n`;
    text += `👤 <b>Member:</b> ${escapeHtml(member.full_name)}\n\n`;

    text += `🗓️ <b>Recent Monthly Obligations:</b>\n`;
    if (obligations.length === 0) {
      text += `<i>No obligations recorded yet.</i>\n`;
    } else {
      for (const obl of obligations) {
        const balance = Math.max(0, obl.amount_due_cents - obl.amount_paid_cents);
        text += `• <b>${formatPeriod(obl.year_month, 'en')}:</b> ${formatStatus(obl.status, 'en')} | Paid: ${formatMoney(obl.amount_paid_cents, currency)} / Due: ${formatMoney(obl.amount_due_cents, currency)}`;
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
          text += `• <b>${p.tx_id}</b> — ${formatMoney(p.amount_cents, currency)} via ${formatPaymentMethod(p.payment_method, 'en')} on ${formatDate(paidDate, 'en')}${ref}\n`;
        }
      }
    }
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
}

async function startMemberPaymentSubmission(ctx) {
  const member = ctx.state?.member;
  const lang = ctx.state?.language || getUserLanguage(ctx.from?.id) || 'am';
  const isAm = lang === 'am';

  if (!member || member.status !== 'active') {
    return ctx.reply(
      isAm
        ? '⚠️ ንቁ የቤተክርስቲያን አባላት ብቻ ደረሰኝ ማስረከብ ይችላሉ።'
        : '⚠️ Only active church members can submit payment receipts.'
    );
  }

  const eligibleMonths = getEligibleSubmissionMonths(member.id, 3);
  if (eligibleMonths.length === 0) {
    return ctx.reply(
      isAm
        ? '🎉 <b>ምንም ያልተከፈለ መዋጮ የለብዎትም!</b>\n\n' +
          'የሁሉንም ወራት መዋጮዎን ሙሉ በሙሉ ከፍለዋል (ወይም ያስገቧቸው ደረሰኞች በማረጋገጥ ላይ ናቸው)።\n' +
          'እግዚአብሔር ይስጥልን! 🙏'
        : '🎉 <b>No Outstanding Contributions!</b>\n\n' +
          'All your contributions are fully paid (or submitted receipts are pending review).\n' +
          'Thank you and God bless you! 🙏',
      { parse_mode: 'HTML' }
    );
  }

  setSession(ctx.from.id, {
    step: 'MEMBER_SUBMIT_MONTH',
    memberId: member.id,
    memberName: member.full_name,
    lang,
  });

  const buttons = eligibleMonths.map((m) => [
    Markup.button.callback(`📅 ${formatPeriod(m, isAm ? 'am' : 'en')}`, `mem_sub_month_${m}`),
  ]);
  buttons.push([Markup.button.callback(isAm ? '❌ ሰርዝ' : '❌ Cancel', 'action_cancel')]);

  const cbeInfo = getBankInfo(lang);

  const promptMsg = isAm
    ? `📤 <b>የመዋጮ ደረሰኝ ማስረከቢያ</b>\n\n` +
      `👤 <b>አባል፦</b> ${escapeHtml(member.full_name)}\n\n` +
      `${cbeInfo}\n\n` +
      `👇 <b>ክፍያው የሚሸፍነውን ወር ይምረጡ፦</b>`
    : `📤 <b>Submit Contribution Receipt</b>\n\n` +
      `👤 <b>Member:</b> ${escapeHtml(member.full_name)}\n\n` +
      `${cbeInfo}\n\n` +
      `👇 <b>Select which month this payment covers:</b>`;

  await ctx.reply(promptMsg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons),
  });
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

