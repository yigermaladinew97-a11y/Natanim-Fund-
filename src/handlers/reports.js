const { Markup } = require('telegraf');
const { requireStaff, requireAdmin } = require('../middleware/auth');
const { getMonthlyReportSummary, getMonthlyMemberDetails, exportMonthlyReportCsv } = require('../services/reporting');
const { listActiveMembers } = require('../services/memberService');
const { listUnpaidMembersForMonth, getCurrency } = require('../services/accounting');
const { formatMoney, getCurrentYearMonth, formatStatus, formatPaymentMethod, escapeHtml } = require('../utils/formatters');
const { isValidYearMonth } = require('../utils/validators');
const { getPaginationKeyboard } = require('../utils/keyboards');

function formatReportMessage(summary) {
  const currency = summary.currency;
  let msg = `📑 *Monthly Financial Report — ${summary.yearMonth}*\n\n`;

  msg += `👥 *Membership Statistics:*\n`;
  msg += `• Active Members: *${summary.activeMembersCount}*\n`;
  msg += `• Fully Paid: *${summary.fullyPaidCount}* 🟢\n`;
  msg += `• Partially Paid: *${summary.partiallyPaidCount}* 🟡\n`;
  msg += `• Unpaid / Overdue: *${summary.unpaidCount}* 🔴\n\n`;

  msg += `💰 *Financial Overview:*\n`;
  msg += `• Total Expected: *${formatMoney(summary.totalExpectedCents, currency)}*\n`;
  msg += `• Total Verified Collected: *${formatMoney(summary.totalCollectedCents, currency)}*\n`;
  msg += `• Total Outstanding: *${formatMoney(summary.totalOutstandingCents, currency)}*\n\n`;

  msg += `💳 *Collections by Method:*\n`;
  if (summary.methodBreakdown.length === 0) {
    msg += `• _No payments collected for this month yet._\n`;
  } else {
    for (const mb of summary.methodBreakdown) {
      msg += `• ${formatPaymentMethod(mb.payment_method)}: *${formatMoney(mb.total_cents, currency)}* (${mb.tx_count} transactions)\n`;
    }
  }

  if (summary.reversals.count > 0) {
    msg += `\n🔄 *Reversed Transactions:*\n`;
    msg += `• Reversed Payments: *${summary.reversals.count}* (${formatMoney(summary.reversals.totalCents, currency)})\n`;
    msg += `  _(Excluded from verified collected total)_\n`;
  }

  return msg;
}

function registerReportHandlers(bot) {
  async function handleReport(ctx) {
    const textParts = ctx.message?.text?.trim().split(/\s+/).slice(1) || [];
    let month = getCurrentYearMonth();
    if (textParts.length >= 1 && isValidYearMonth(textParts[0])) {
      month = textParts[0];
    }

    const summary = getMonthlyReportSummary(month);
    const text = formatReportMessage(summary);

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('👥 Member Breakdown', `report_breakdown_${month}_1`),
        Markup.button.callback('📁 Export CSV', `report_export_${month}`),
      ],
    ]);

    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  }

  bot.command('report', requireStaff, handleReport);
  bot.hears(/^(?:📑\s*)?Monthly Report$/i, requireStaff, handleReport);

  bot.action('menu_report', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    await handleReport(ctx);
  });

  // Member breakdown pagination
  bot.action(/^report_breakdown_(\d{4}-\d{2})_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const month = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);
    const currency = getCurrency();

    const result = getMonthlyMemberDetails(month, page, 8);
    let text = `👥 *Member Report — ${month} (Page ${result.page}/${result.totalPages})*\n\n`;

    if (result.rows.length === 0) {
      text += `_No members recorded for this period._\n`;
    } else {
      for (const r of result.rows) {
        text += `• *${r.full_name}* (#${r.member_id}): ${formatStatus(r.status)}\n`;
        text += `  Paid: ${formatMoney(r.amount_paid_cents, currency)} / Due: ${formatMoney(r.amount_due_cents, currency)}`;
        if (r.balance_cents > 0) {
          text += ` | *Bal: ${formatMoney(r.balance_cents, currency)}*`;
        }
        text += `\n`;
      }
    }

    const buttons = [];
    const navButtons = [];
    if (page > 1) {
      navButtons.push(Markup.button.callback('⬅️ Prev', `report_breakdown_${month}_${page - 1}`));
    }
    navButtons.push(Markup.button.callback(`📄 ${page}/${result.totalPages}`, 'noop'));
    if (page < result.totalPages) {
      navButtons.push(Markup.button.callback('Next ➡️', `report_breakdown_${month}_${page + 1}`));
    }
    buttons.push(navButtons);
    buttons.push([Markup.button.callback('🔙 Back to Summary', 'menu_report')]);

    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
  });

  // ==========================================
  // /unpaid - Outstanding Balances List
  // ==========================================
  bot.command('unpaid', requireStaff, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    let month = getCurrentYearMonth();
    if (parts.length >= 1 && isValidYearMonth(parts[0])) {
      month = parts[0];
    }

    const list = listUnpaidMembersForMonth(month);
    const currency = getCurrency();

    let text = `⏳ *Outstanding Balances — ${month}*\n\n`;
    if (list.length === 0) {
      text += `🎉 *All members have fully paid their contributions for ${month}!*`;
    } else {
      text += `Found *${list.length}* member(s) with outstanding balance:\n\n`;
      for (const m of list) {
        text += `• *${m.full_name}* (#${m.member_id})\n`;
        text += `  Balance Due: *${formatMoney(m.balance_cents, currency)}* (Status: ${formatStatus(m.status)})\n`;
        text += `  Phone: ${m.phone || 'N/A'} | Telegram: \`${m.telegram_id}\`\n\n`;
      }
      text += `_Use /remind to send them a private reminder._`;
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  bot.hears(/^(?:⏳\s*)?Unpaid List$/i, requireStaff, async (ctx) => {
    const month = getCurrentYearMonth();
    const list = listUnpaidMembersForMonth(month);
    const currency = getCurrency();

    let text = `⏳ *Outstanding Balances — ${month}*\n\n`;
    if (list.length === 0) {
      text += `🎉 *All members have fully paid their contributions for ${month}!*`;
    } else {
      text += `Found *${list.length}* member(s) with outstanding balance:\n\n`;
      for (const m of list) {
        text += `• *${m.full_name}* (#${m.member_id})\n`;
        text += `  Balance Due: *${formatMoney(m.balance_cents, currency)}* (Status: ${formatStatus(m.status)})\n`;
        text += `  Phone: ${m.phone || 'N/A'} | Telegram: \`${m.telegram_id}\`\n\n`;
      }
      text += `_Use /remind to send them a private reminder._`;
    }
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  bot.action('menu_unpaid', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const month = getCurrentYearMonth();
    const list = listUnpaidMembersForMonth(month);
    const currency = getCurrency();

    let text = `⏳ *Outstanding Balances — ${month}*\n\n`;
    if (list.length === 0) {
      text += `🎉 *All members have fully paid their contributions for ${month}!*`;
    } else {
      text += `Found *${list.length}* member(s) with outstanding balance:\n\n`;
      for (const m of list) {
        text += `• *${m.full_name}* (#${m.member_id})\n`;
        text += `  Balance Due: *${formatMoney(m.balance_cents, currency)}* (Status: ${formatStatus(m.status)})\n`;
        text += `  Phone: ${m.phone || 'N/A'} | Telegram: \`${m.telegram_id}\`\n\n`;
      }
      text += `_Use /remind to send them a private reminder._`;
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  // ==========================================
  // /members - Active Members Directory
  // ==========================================
  async function handleMembers(ctx) {
    const res = listActiveMembers(1, 8);
    let text = `👥 *Active Church Fund Members (Page 1/${res.totalPages})*\n`;
    text += `Total Active Members: *${res.total}*\n\n`;

    for (const m of res.members) {
      text += `• *${m.full_name}* (#${m.id})\n  Telegram: \`${m.telegram_id}\` | Phone: ${m.phone || 'N/A'}\n`;
    }

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...getPaginationKeyboard('members_page', 1, res.totalPages),
    });
  }

  bot.command('members', requireStaff, handleMembers);
  bot.hears(/^(?:👥\s*)?Members List$/i, requireStaff, handleMembers);

  bot.action(/^members_page_(\d+)$/, requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    const res = listActiveMembers(page, 8);

    let text = `👥 *Active Church Fund Members (Page ${page}/${res.totalPages})*\n`;
    text += `Total Active Members: *${res.total}*\n\n`;

    for (const m of res.members) {
      text += `• *${m.full_name}* (#${m.id})\n  Telegram: \`${m.telegram_id}\` | Phone: ${m.phone || 'N/A'}\n`;
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...getPaginationKeyboard('members_page', page, res.totalPages),
      });
    } catch (_) {
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...getPaginationKeyboard('members_page', page, res.totalPages),
      });
    }
  });

  // ==========================================
  // /export - CSV Export
  // ==========================================
  async function sendCsvDocument(botToken, chatId, csvBuffer, filename, caption) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption || '');
    form.append('parse_mode', 'HTML');
    form.append('document', new Blob([csvBuffer], { type: 'text/csv' }), filename);

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    });

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.description || 'Failed to upload document to Telegram');
    }
    return data.result;
  }

  async function handleExportCsv(ctx, targetMonth) {
    const parts = ctx.message?.text?.trim().split(/\s+/).slice(1) || [];
    let month = targetMonth || getCurrentYearMonth();
    if (!targetMonth && parts.length >= 1 && isValidYearMonth(parts[0])) {
      month = parts[0];
    }

    try {
      const csvBuffer = exportMonthlyReportCsv(month);
      const filename = `Natanim_Fund_Report_${month}.csv`;
      const caption = `📁 <b>Monthly Financial Report for ${escapeHtml(month)}</b>\n<i>RFC-4180 CSV Spreadsheet Export</i>`;

      await sendCsvDocument(ctx.telegram.token, ctx.chat.id, csvBuffer, filename, caption);
    } catch (err) {
      await ctx.reply(`❌ Export failed: ${err.message}`);
    }
  }

  bot.command('export', requireAdmin, async (ctx) => handleExportCsv(ctx));
  bot.hears(/^(?:📁\s*)?Export CSV$/i, requireAdmin, async (ctx) => handleExportCsv(ctx));

  bot.action('menu_export_csv', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    await handleExportCsv(ctx);
  });

  bot.action(/^report_export_(\d{4}-\d{2})$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const month = ctx.match[1];
    await handleExportCsv(ctx, month);
  });
}

module.exports = {
  registerReportHandlers,
};

