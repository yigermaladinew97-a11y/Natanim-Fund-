const { Markup } = require('telegraf');
const { requireStaff, requireAdmin } = require('../middleware/auth');
const { getMonthlyReportSummary, getMonthlyMemberDetails, exportMonthlyReportCsv } = require('../services/reporting');
const { listActiveMembers } = require('../services/memberService');
const { listUnpaidMembersForMonth, getCurrency } = require('../services/accounting');
const {
  formatMoney,
  getCurrentYearMonth,
  formatStatus,
  formatPaymentMethod,
  escapeHtml,
  formatDualMonth,
  formatDualDate,
} = require('../utils/formatters');
const { isValidYearMonth } = require('../utils/validators');
const { getPaginationKeyboard } = require('../utils/keyboards');
const { postMonthlyReportToStaffGroup } = require('../services/staffArchive');

function formatReportMessage(summary) {
  const currency = summary.currency;
  let msg = `📑 <b>Monthly Financial Report — ${formatDualMonth(summary.yearMonth)}</b>\n\n`;

  msg += `👥 <b>Membership Statistics:</b>\n`;
  msg += `• Active Members: <b>${summary.activeMembersCount}</b>\n`;
  msg += `• Fully Paid: <b>${summary.fullyPaidCount}</b> 🟢\n`;
  msg += `• Partially Paid: <b>${summary.partiallyPaidCount}</b> 🟡\n`;
  msg += `• Unpaid / Overdue: <b>${summary.unpaidCount}</b> 🔴\n\n`;

  msg += `💰 <b>Financial Overview:</b>\n`;
  msg += `• Total Expected: <b>${formatMoney(summary.totalExpectedCents, currency)}</b>\n`;
  msg += `• Total Verified Collected: <b>${formatMoney(summary.totalCollectedCents, currency)}</b>\n`;
  msg += `• Total Outstanding: <b>${formatMoney(summary.totalOutstandingCents, currency)}</b>\n\n`;

  msg += `💳 <b>Collections by Method:</b>\n`;
  if (summary.methodBreakdown.length === 0) {
    msg += `• <i>No payments collected for this month yet.</i>\n`;
  } else {
    for (const mb of summary.methodBreakdown) {
      msg += `• ${formatPaymentMethod(mb.payment_method)}: <b>${formatMoney(mb.total_cents, currency)}</b> (${mb.tx_count} transactions)\n`;
    }
  }

  if (summary.reversals.count > 0) {
    msg += `\n🔄 <b>Reversed Transactions:</b>\n`;
    msg += `• Reversed Payments: <b>${summary.reversals.count}</b> (${formatMoney(summary.reversals.totalCents, currency)})\n`;
    msg += `  <i>(Excluded from verified collected total)</i>\n`;
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
      [
        Markup.button.callback('📢 ሪፖርቱን ግሩፕ ላክ / Post to Staff Group', `report_post_group_${month}`),
      ],
    ]);

    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }

  bot.command('report', requireStaff, handleReport);
  bot.hears(/^(?:📑\s*)?(?:Monthly Report|ወርሃዊ ሪፖርት)$/i, requireStaff, handleReport);

  bot.command(['sendreport', 'postreport'], requireStaff, async (ctx) => {
    const parts = ctx.message?.text?.trim().split(/\s+/).slice(1) || [];
    let month = getCurrentYearMonth();
    if (parts.length >= 1 && isValidYearMonth(parts[0])) {
      month = parts[0];
    }
    await ctx.reply(`⏳ <b>Generating & posting report for ${formatDualMonth(month)} to 📊 ወርሃዊ ሪፖርቶች...</b>`, {
      parse_mode: 'HTML',
    });
    const res = await postMonthlyReportToStaffGroup(ctx.telegram, month);
    if (res && res.success) {
      await ctx.reply(
        `✅ <b>Monthly Financial Report & CSV successfully posted to 📊 ወርሃዊ ሪፖርቶች!</b>\n` +
        `• <b>Period:</b> ${formatDualMonth(month)}\n` +
        `• <b>Folder:</b> <code>#${res.threadId || 'General'}</code>`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`⚠️ Could not post to staff group: ${res?.error || 'Please connect group with /setstaffgroup first.'}`);
    }
  });

  bot.action(/^report_post_group_(\d{4}-\d{2})$/, requireStaff, async (ctx) => {
    const month = ctx.match[1];
    await ctx.answerCbQuery('⏳ Posting report to Staff Group...');
    const res = await postMonthlyReportToStaffGroup(ctx.telegram, month);
    if (res && res.success) {
      await ctx.reply(
        `✅ <b>Monthly Financial Report & CSV have been posted to the staff archive group!</b>\n` +
        `• <b>Folder:</b> <code>📊 ወርሃዊ ሪፖርቶች</code> (#${res.threadId || 'General'})\n` +
        `• <b>Period:</b> ${formatDualMonth(month)}`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`⚠️ Failed to post report to staff group: ${res?.error || 'Group not connected. Run /setstaffgroup in your group first.'}`);
    }
  });

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
    let text = `👥 <b>Member Report — ${formatDualMonth(month)} (Page ${result.page}/${result.totalPages})</b>\n\n`;

    if (result.rows.length === 0) {
      text += `<i>No members recorded for this period.</i>\n`;
    } else {
      for (const r of result.rows) {
        text += `• <b>${escapeHtml(r.full_name)}</b> (#${r.member_id}): ${formatStatus(r.status)}\n`;
        text += `  Paid: ${formatMoney(r.amount_paid_cents, currency)} / Due: ${formatMoney(r.amount_due_cents, currency)}`;
        if (r.balance_cents > 0) {
          text += ` | <b>Bal: ${formatMoney(r.balance_cents, currency)}</b>`;
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
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
  });

  // ==========================================
  // /unpaid - Outstanding Balances List
  // ==========================================
  async function renderUnpaidList(ctx, month) {
    const list = listUnpaidMembersForMonth(month);
    const currency = getCurrency();

    let text = `⏳ <b>የቀሪ ክፍያ ዝርዝር / Outstanding Balances — ${formatDualMonth(month)}</b>\n\n`;
    if (list.length === 0) {
      text += `🎉 <b>All members have fully settled their contributions for ${formatDualMonth(month)}!</b>`;
    } else {
      text += `Found <b>${list.length}</b> member(s) with outstanding balance:\n\n`;
      for (const m of list) {
        text += `• <b>${escapeHtml(m.full_name)}</b> (#${m.member_id})\n`;
        text += `  Balance Due: <b>${formatMoney(m.balance_cents, currency)}</b> (Status: ${formatStatus(m.status)})\n`;
        text += `  Phone: ${escapeHtml(m.phone) || 'N/A'} | Telegram: <code>${m.telegram_id}</code>\n\n`;
      }
      text += `<i>Use /remind to send them a private reminder.</i>`;
    }

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  bot.command('unpaid', requireStaff, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    let month = getCurrentYearMonth();
    if (parts.length >= 1 && isValidYearMonth(parts[0])) {
      month = parts[0];
    }
    await renderUnpaidList(ctx, month);
  });

  bot.hears(/^(?:⏳\s*)?(?:Unpaid List|ያልከፈሉ አባላት)$/i, requireStaff, async (ctx) => {
    const month = getCurrentYearMonth();
    await renderUnpaidList(ctx, month);
  });

  bot.action('menu_unpaid', requireStaff, async (ctx) => {
    await ctx.answerCbQuery();
    const month = getCurrentYearMonth();
    await renderUnpaidList(ctx, month);
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
  bot.hears(/^(?:👥\s*)?(?:Members List|የአባላት ዝርዝር)$/i, requireStaff, handleMembers);

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
  bot.hears(/^(?:📁\s*)?(?:Export CSV|CSV ኤክስፖርት)$/i, requireAdmin, async (ctx) => handleExportCsv(ctx));

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

