const { Markup } = require('telegraf');
const { requireAdmin } = require('../middleware/auth');
const {
  registerMember,
  deactivateMember,
  getAllActiveMembers,
  getAllInactiveMembers,
  getMemberPurgeSummary,
  purgeMemberHistory,
  getPendingRegistrationRequests,
  approveRegistrationRequest,
  rejectRegistrationRequest,
} = require('../services/memberService');
const {
  setStandardAmountCents,
  getStandardAmountCents,
  getCurrency,
  reversePayment,
  getPaymentByTxId,
} = require('../services/accounting');
const { assignRole, revokeRole, listRoles, getMemberByTelegramId, isAdmin } = require('../services/permissions');
const { getDatabase } = require('../db');
const { setSession, getSession, clearSession } = require('../utils/session');
const { parseMoneyToCents, formatMoney, escapeHtml, getCurrentYearMonth, formatDualMonth } = require('../utils/formatters');
const { isValidTelegramId, sanitizeText } = require('../utils/validators');
const { getCancelKeyboard, getMainMenuKeyboard } = require('../utils/keyboards');
const {
  getStaffGroupId,
  setStaffGroupId,
  getStaffGroupDetails,
  getStaffGroupInviteLink,
  setStaffGroupInviteLink,
  getOrCreateTopic,
  initializeAcademicYearTopics,
  getMonthTopicKey,
  getMonthTopicName,
  getReportsTopicName,
  inviteTreasurerToStaffGroup,
  removeTreasurerFromStaffGroup,
  notifyTreasurerAppointed,
  notifyTreasurerRevoked,
} = require('../services/staffArchive');
const { createDatabaseBackup, sendDatabaseBackupToChat, restoreDatabaseFromBuffer } = require('../services/backupService');
const { getSystemDiagnostics, formatDiagnosticsHtml } = require('../services/diagnosticsService');
const { isTursoConfigured, pushToTurso, pullFromTurso } = require('../services/tursoService');
const { config } = require('../config');

function registerAdminHandlers(bot) {
  // ==========================================
  // /approvals - Review Pending Registrations
  // ==========================================
  async function handlePendingApprovals(ctx) {
    const list = getPendingRegistrationRequests();
    if (list.length === 0) {
      return ctx.reply('✅ *No Pending Registrations*\n\nThere are currently no member requests awaiting approval.', {
        parse_mode: 'Markdown',
      });
    }

    await ctx.reply(`📥 *Pending Member Registrations (${list.length})*\n\nReview each request below:`, {
      parse_mode: 'Markdown',
    });

    for (const req of list) {
      const text =
        `👤 <b>${escapeHtml(req.full_name)}</b>\n` +
        `• <b>Phone:</b> ${escapeHtml(req.phone || 'Not provided')}\n` +
        `• <b>Telegram ID:</b> <code>${escapeHtml(req.telegram_id)}</code>\n` +
        (req.username ? `• <b>Username:</b> @${escapeHtml(req.username)}\n` : '') +
        `• <b>Requested:</b> ${escapeHtml(req.created_at)}`;

      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Approve', `reg_approve_${req.id}`),
            Markup.button.callback('❌ Reject', `reg_reject_${req.id}`),
          ],
        ]),
      });
    }
  }

  bot.command('approvals', requireAdmin, handlePendingApprovals);
  bot.hears(/^(?:📥\s*)?(?:Pending Approvals|ማጽደቂያዎች)$/i, requireAdmin, handlePendingApprovals);
  bot.action('menu_approvals', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    await handlePendingApprovals(ctx);
  });

  bot.action(/^reg_approve_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const requestId = parseInt(ctx.match[1], 10);
    const adminId = ctx.from.id;

    try {
      const { member, request } = approveRegistrationRequest(requestId, adminId);

      const text =
        `✅ <b>Member Approved & Registered!</b>\n\n` +
        `• <b>Member:</b> ${escapeHtml(member.full_name)} (#${member.id})\n` +
        `• <b>Telegram ID:</b> <code>${escapeHtml(member.telegram_id)}</code>\n` +
        `• <b>Phone:</b> ${escapeHtml(member.phone || 'Not provided')}\n` +
        `• <b>Approved By:</b> Admin (${escapeHtml(ctx.from.first_name || String(adminId))})\n` +
        `• <b>Joined Date:</b> ${escapeHtml(member.joined_date)}\n\n` +
        `<i>Active member registered & current month obligation initialized.</i>`;

      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML' });
      } catch (_) {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }

      // Notify the member
      try {
        await ctx.telegram.sendMessage(
          request.telegram_id,
          `🎉 <b>Congratulations, ${escapeHtml(member.full_name)}!</b>\n\n` +
          `Your registration request for <b>Natanim Church Fund</b> has been <b>approved</b> by church administrators!\n\n` +
          `You are now an active contributing member. Use the menu below to view your monthly contribution status and profile anytime.`,
          {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard('member'),
          }
        );
      } catch (notifyErr) {
        console.warn(`[Registration] Could not send DM to member ${request.telegram_id}:`, notifyErr.message);
      }
    } catch (err) {
      return ctx.reply(`⚠️ ${err.message}`);
    }
  });

  bot.action(/^reg_reject_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const requestId = parseInt(ctx.match[1], 10);
    const adminId = ctx.from.id;

    try {
      const request = rejectRegistrationRequest(requestId, adminId);

      const text =
        `❌ <b>Registration Request Rejected</b>\n\n` +
        `• <b>Applicant:</b> ${escapeHtml(request.full_name)}\n` +
        `• <b>Telegram ID:</b> <code>${escapeHtml(request.telegram_id)}</code>\n` +
        `• <b>Rejected By:</b> Admin (${escapeHtml(ctx.from.first_name || String(adminId))})\n`;

      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML' });
      } catch (_) {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }

      // Notify the applicant
      try {
        await ctx.telegram.sendMessage(
          request.telegram_id,
          `ℹ️ <b>Registration Update</b>\n\n` +
          `Your membership request for <b>Natanim Church Fund</b> was not approved at this time.\n\n` +
          `You may review your details and submit a new registration request when ready.`,
          {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard('unregistered'),
          }
        );
      } catch (_) {}
    } catch (err) {
      return ctx.reply(`⚠️ ${err.message}`);
    }
  });

  // ==========================================
  // /addmember - Register New Member (Backup)
  // ==========================================
  bot.command('addmember', requireAdmin, async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);

    // If all args provided: /addmember <telegram_id> <full name...>
    if (parts.length >= 2) {
      const telegramId = parts[0];
      const fullName = parts.slice(1).join(' ');

      try {
        const member = registerMember({
          telegramId,
          fullName,
          actorTelegramId: ctx.from.id,
        });

        return ctx.reply(
          `✅ *Member Successfully Registered!*\n\n` +
          `• *ID:* #${member.id}\n` +
          `• *Name:* ${member.full_name}\n` +
          `• *Telegram ID:* \`${member.telegram_id}\`\n` +
          `• *Joined:* ${member.joined_date}\n\n` +
          `An obligation for the current month has been created automatically.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        return ctx.reply(`❌ Registration failed: ${err.message}`);
      }
    }

    // Otherwise start guided wizard
    setSession(ctx.from.id, { step: 'ADDMEMBER_WAIT_NAME' });
    await ctx.reply(
      '👤 *Register New Member — Step 1/3*\n\n' +
      'Please enter the member\'s *Full Name* (e.g. `Brother Daniel Bekele`):\n\n' +
      '_(You can also add sample members for testing with /seed)_',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌱 Add 3 Demo Members For Testing', 'admin_seed_demo')],
          [Markup.button.callback('❌ Cancel', 'action_cancel')],
        ]),
      }
    );
  });

  bot.hears(/^(?:➕\s*)?(?:Add Member|አባል መዝግብ)$/i, requireAdmin, async (ctx) => {
    setSession(ctx.from.id, { step: 'ADDMEMBER_WAIT_NAME' });
    await ctx.reply(
      '👤 *Register New Member — Step 1/3*\n\n' +
      'Please enter the member\'s *Full Name* (e.g. `Brother Daniel Bekele`):\n\n' +
      '_(You can also add sample members for testing with /seed)_',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌱 Add 3 Demo Members For Testing', 'admin_seed_demo')],
          [Markup.button.callback('❌ Cancel', 'action_cancel')],
        ]),
      }
    );
  });

  bot.action('menu_addmember', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    setSession(ctx.from.id, { step: 'ADDMEMBER_WAIT_NAME' });
    await ctx.reply(
      '👤 *Register New Member — Step 1/3*\n\n' +
      'Please enter the member\'s *Full Name* (e.g. `Brother Daniel Bekele`):\n\n' +
      '_(You can also add sample members for testing with /seed)_',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌱 Add 3 Demo Members For Testing', 'admin_seed_demo')],
          [Markup.button.callback('❌ Cancel', 'action_cancel')],
        ]),
      }
    );
  });

  // Seed demo members command
  bot.command('seed', requireAdmin, async (ctx) => {
    const { seedDemoMembers } = require('../services/memberService');
    const added = seedDemoMembers(ctx.from.id);
    await ctx.reply(
      `🌱 *Added ${added.length} Demo Church Members!*\n\n` +
      `1. Yohannes Girma (#987000101)\n` +
      `2. Marta Haile (#987000102)\n` +
      `3. Dawit Tadesse (#987000103)\n\n` +
      `You can now test /paid, /report, /unpaid, /members, and /export right away!`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('admin_seed_demo', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const { seedDemoMembers } = require('../services/memberService');
    const added = seedDemoMembers(ctx.from.id);
    await ctx.reply(
      `🌱 *Added ${added.length} Demo Church Members!*\n\n` +
      `1. Yohannes Girma (#987000101)\n` +
      `2. Marta Haile (#987000102)\n` +
      `3. Dawit Tadesse (#987000103)\n\n` +
      `You can now test /paid, /report, /unpaid, /members, and /export right away!`,
      { parse_mode: 'Markdown' }
    );
  });

  // ==========================================
  // /deactivate - Deactivate Member
  // ==========================================
  bot.command('deactivate', requireAdmin, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length >= 1) {
      const memberId = parseInt(parts[0], 10);
      const reason = parts.slice(1).join(' ') || 'Deactivated by administrator';

      try {
        const member = deactivateMember({
          memberId,
          reason,
          actorTelegramId: ctx.from.id,
        });
        return ctx.reply(
          `✅ Member <b>${escapeHtml(member.full_name)}</b> (#${member.id}) has been deactivated.\n\n` +
          `<i>Their status is now inactive. If you also wish to permanently wipe their payment history and obligations, tap below:</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🗑️ Wipe Payment History', `purge_prompt_${member.id}`)],
            ]),
          }
        );
      } catch (err) {
        return ctx.reply(`❌ Deactivation failed: ${err.message}`);
      }
    }

    // Show active members to pick
    const active = getAllActiveMembers();
    if (active.length === 0) {
      return ctx.reply('No active members found to deactivate.');
    }

    const buttons = active.slice(0, 10).map((m) => [
      Markup.button.callback(`${m.full_name} (#${m.id})`, `deact_select_${m.id}`),
    ]);
    buttons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);

    await ctx.reply('Select the member you wish to deactivate:', Markup.inlineKeyboard(buttons));
  });

  bot.hears(/^(?:🛑\s*)?(?:Deactivate Member|አባል አግድ)$/i, requireAdmin, async (ctx) => {
    const active = getAllActiveMembers();
    if (active.length === 0) {
      return ctx.reply('No active members found to deactivate.');
    }
    const buttons = active.slice(0, 10).map((m) => [
      Markup.button.callback(`${m.full_name} (#${m.id})`, `deact_select_${m.id}`),
    ]);
    buttons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);
    await ctx.reply('Select the member you wish to deactivate:', Markup.inlineKeyboard(buttons));
  });

  bot.action('menu_deactivate', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const active = getAllActiveMembers();
    if (active.length === 0) {
      return ctx.reply('No active members found to deactivate.');
    }
    const buttons = active.slice(0, 10).map((m) => [
      Markup.button.callback(`${m.full_name} (#${m.id})`, `deact_select_${m.id}`),
    ]);
    buttons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);
    await ctx.reply('Select the member you wish to deactivate:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/^deact_select_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const memberId = parseInt(ctx.match[1], 10);
    setSession(ctx.from.id, { step: 'DEACTIVATE_WAIT_REASON', memberId });
    await ctx.reply(
      `Please reply with the *reason* for deactivating member #${memberId}:`,
      { parse_mode: 'Markdown', ...getCancelKeyboard() }
    );
  });

  // ==========================================
  // /purgemember - Delete Payment History for Deactivated Member
  // ==========================================
  async function renderPurgePrompt(ctx, memberId) {
    try {
      const summary = getMemberPurgeSummary(memberId);
      const currency = getCurrency();

      if (summary.member.status !== 'inactive') {
        return ctx.reply(
          `⛔ <b>Member is still Active</b>\n\n` +
          `<b>${escapeHtml(summary.member.full_name)}</b> (#${summary.member.id}) is currently active.\n` +
          `You must deactivate the member with <code>/deactivate ${summary.member.id}</code> before you can delete their history.`,
          { parse_mode: 'HTML' }
        );
      }

      const text =
        `⚠️ <b>ማስጠንቀቂያ / CONFIRM PERMANENT DELETION</b>\n\n` +
        `You are about to permanently delete the financial history of:\n` +
        `• <b>ተማሪ / Member:</b> ${escapeHtml(summary.member.full_name)} (#${summary.member.id})\n` +
        `• <b>Telegram ID:</b> <code>${escapeHtml(summary.member.telegram_id)}</code>\n` +
        `• <b>ሁኔታ / Status:</b> 🔴 Inactive (የተሰናበተ)\n\n` +
        `<b>የሚጠፉ መረጃዎች / Records to be Permanently Erased:</b>\n` +
        `• የተከፈሉ ክፍያዎች / Payments: <b>${summary.paymentsCount}</b> (${formatMoney(summary.paymentsTotalCents, currency)})\n` +
        `• ወርሃዊ እዳዎች / Obligations: <b>${summary.obligationsCount}</b>\n` +
        `• ደረሰኞች / Submissions: <b>${summary.submissionsCount}</b>\n\n` +
        `⚠️ <i>ይህ እርምጃ አንዴ ከተፈጸመ በኋላ ፈጽሞ አይመለስም! / This action is IRREVERSIBLE and cannot be undone.</i>\n\n` +
        `Choose an action:`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🗑️ ታሪክ ብቻ አጥፋ (Delete History Only)', `purge_hist_confirm_${memberId}`),
        ],
        [
          Markup.button.callback('💥 ሙሉ በሙሉ ሰርዝ (Wipe Member & History)', `purge_all_confirm_${memberId}`),
        ],
        [
          Markup.button.callback('❌ ሰርዝ / Cancel', 'action_cancel'),
        ],
      ]);

      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  }

  bot.command(['purgemember', 'deletememberhistory'], requireAdmin, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length >= 1) {
      const memberId = parseInt(parts[0], 10);
      return renderPurgePrompt(ctx, memberId);
    }

    const inactive = getAllInactiveMembers();
    if (inactive.length === 0) {
      return ctx.reply('ℹ️ No inactive / deactivated members found.');
    }

    const buttons = inactive.slice(0, 10).map((m) => [
      Markup.button.callback(`${m.full_name} (#${m.id})`, `purge_prompt_${m.id}`),
    ]);
    buttons.push([Markup.button.callback('❌ Cancel', 'action_cancel')]);

    await ctx.reply(
      '🗑️ <b>Select Inactive Member to Purge History:</b>\n\n' +
      'Choose a deactivated member below to review and permanently delete their payment history:',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      }
    );
  });

  bot.action(/^purge_prompt_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const memberId = parseInt(ctx.match[1], 10);
    await renderPurgePrompt(ctx, memberId);
  });

  bot.action(/^purge_hist_confirm_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery('Purging history...');
    const memberId = parseInt(ctx.match[1], 10);
    try {
      const res = await purgeMemberHistory({
        memberId,
        actorTelegramId: ctx.from.id,
        deleteMemberRecord: false,
      });
      const currency = getCurrency();
      await ctx.editMessageText(
        `🗑️ <b>Payment History Successfully Deleted!</b>\n\n` +
        `• <b>Member:</b> ${escapeHtml(res.member.full_name)} (#${memberId})\n` +
        `• <b>Status:</b> Inactive (Member record retained)\n` +
        `• <b>Deleted Payments:</b> ${res.deletedPaymentsCount} (${formatMoney(res.deletedPaymentsTotalCents, currency)})\n` +
        `• <b>Deleted Obligations:</b> ${res.deletedObligationsCount}\n` +
        `• <b>Deleted Submissions:</b> ${res.deletedSubmissionsCount}\n\n` +
        `<i>Permanent audit log has been created.</i>`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      await ctx.reply(`❌ Purge failed: ${err.message}`);
    }
  });

  bot.action(/^purge_all_confirm_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery('Wiping member and history...');
    const memberId = parseInt(ctx.match[1], 10);
    try {
      const res = await purgeMemberHistory({
        memberId,
        actorTelegramId: ctx.from.id,
        deleteMemberRecord: true,
      });
      const currency = getCurrency();
      await ctx.editMessageText(
        `💥 <b>Member & History Completely Wiped!</b>\n\n` +
        `• <b>Deleted Member:</b> ${escapeHtml(res.member.full_name)} (#${memberId})\n` +
        `• <b>Deleted Payments:</b> ${res.deletedPaymentsCount} (${formatMoney(res.deletedPaymentsTotalCents, currency)})\n` +
        `• <b>Deleted Obligations:</b> ${res.deletedObligationsCount}\n` +
        `• <b>Deleted Submissions:</b> ${res.deletedSubmissionsCount}\n\n` +
        `<i>The member and all associated financial records have been permanently erased from the database.</i>`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      await ctx.reply(`❌ Purge failed: ${err.message}`);
    }
  });

  // ==========================================
  // /setamount - Set standard contribution
  // ==========================================
  bot.command('setamount', requireAdmin, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    const currency = getCurrency();

    if (parts.length >= 1) {
      const cents = parseMoneyToCents(parts[0]);
      if (!cents) {
        return ctx.reply('❌ Invalid amount. Please enter a positive number (e.g. `/setamount 500`).', { parse_mode: 'Markdown' });
      }

      setStandardAmountCents(cents, ctx.from.id);
      return ctx.reply(`✅ Standard monthly contribution updated to *${formatMoney(cents, currency)}* for future obligations.`, {
        parse_mode: 'Markdown',
      });
    }

    const currentCents = getStandardAmountCents();
    setSession(ctx.from.id, { step: 'SETAMOUNT_WAIT_VALUE' });
    await ctx.reply(
      `⚙️ *Current Standard Contribution:* ${formatMoney(currentCents, currency)}\n\n` +
      `Please enter the new standard monthly amount (e.g. \`600\` or \`750.50\`):`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      }
    );
  });

  bot.hears(/^(?:⚙️\s*)?(?:Set Standard Amount|መዋጮ መጠን)$/i, requireAdmin, async (ctx) => {
    const currency = getCurrency();
    const currentCents = getStandardAmountCents();
    setSession(ctx.from.id, { step: 'SETAMOUNT_WAIT_VALUE' });
    await ctx.reply(
      `⚙️ *Current Standard Contribution:* ${formatMoney(currentCents, currency)}\n\n` +
      `Please enter the new standard monthly amount (e.g. \`600\` or \`750.50\`):`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      }
    );
  });

  bot.action('menu_setamount', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const currency = getCurrency();
    const currentCents = getStandardAmountCents();
    setSession(ctx.from.id, { step: 'SETAMOUNT_WAIT_VALUE' });
    await ctx.reply(
      `⚙️ *Current Standard Contribution:* ${formatMoney(currentCents, currency)}\n\n` +
      `Please enter the new standard monthly amount (e.g. \`600\` or \`750.50\`):`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      }
    );
  });

  // ==========================================
  // /roles - Manage Treasurer roles
  // ==========================================
  function getRolesView() {
    const rolesList = listRoles();
    let msg = `🛡️ <b>Authorized System Roles</b>\n\n`;
    for (const r of rolesList) {
      const name = r.full_name ? ` (${escapeHtml(r.full_name)})` : '';
      msg += `• <b>${escapeHtml(r.role.toUpperCase())}</b>: <code>${escapeHtml(r.telegram_id)}</code>${name}\n  <i>Assigned by: ${escapeHtml(r.assigned_by)} on ${escapeHtml(r.created_at.slice(0, 10))}</i>\n\n`;
    }

    msg += `<b>Quick Actions:</b>\n`;
    msg += `• Tap <b>➕ Add Treasurer</b> to assign a member as Treasurer.\n`;
    msg += `• Or send command: <code>/roles add &lt;telegram_id&gt;</code>\n`;
    msg += `• Tap <b>🔗 Send Link</b> to deliver group invite link directly to any treasurer.\n`;
    msg += `• Or revoke with: <code>/roles remove &lt;telegram_id&gt;</code>`;

    const buttons = [];
    buttons.push([
      Markup.button.callback('➕ Add Treasurer', 'admin_role_prompt_add'),
      Markup.button.callback('🏛️ Group Invite Link', 'admin_role_get_link'),
    ]);

    const treasurers = rolesList.filter((r) => r.role === 'treasurer');
    for (const t of treasurers) {
      const label = t.full_name ? `❌ Revoke ${t.full_name}` : `❌ Revoke ${t.telegram_id}`;
      buttons.push([
        Markup.button.callback(label, `admin_role_revoke_${t.telegram_id}`),
        Markup.button.callback('🔗 Send Link', `admin_role_sendlink_${t.telegram_id}`),
      ]);
    }

    return { text: msg, keyboard: Markup.inlineKeyboard(buttons) };
  }

  bot.command('roles', requireAdmin, async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);

    if (parts.length >= 2) {
      const subAction = parts[0].toLowerCase();
      const targetId = parts[1];

      if (!isValidTelegramId(targetId)) {
        return ctx.reply('❌ Invalid Telegram ID. Please enter a valid numeric ID (5–15 digits).');
      }

      if (subAction === 'add' || subAction === 'grant') {
        try {
          assignRole(targetId, 'treasurer', ctx.from.id);
          const notifyRes = await notifyTreasurerAppointed(ctx.telegram, targetId, ctx.from.first_name || 'an administrator');
          const displayName = notifyRes.memberName || targetId;

          let msg = `✅ Successfully granted <b>Treasurer</b> role to <b>${escapeHtml(displayName)}</b> (<code>${escapeHtml(targetId)}</code>).\n\n`;
          msg += `• Menu keyboard upgraded on their device\n`;

          const adminButtons = [];
          if (notifyRes.inviteLink) {
            msg += `\n🔗 <b>Leadership Group Invite Link:</b>\n<code>${notifyRes.inviteLink}</code>\n\n`;
            if (notifyRes.dmSent) {
              msg += `• ✅ Link and staff menu was sent directly to their private chat.\n`;
            } else {
              msg += `• ⚠️ <b>Could not DM user:</b> The user has not started the bot privately yet (or blocked it).\n👉 <b>Please copy and share the link above directly with them!</b>\n`;
            }
            msg += `• Welcome announcement posted in leadership group.`;
            adminButtons.push([Markup.button.url('🏛️ Open Group Invite Link', notifyRes.inviteLink)]);
          } else {
            const staffGroupId = getStaffGroupId();
            if (!staffGroupId) {
              msg += `\n⚠️ <b>Staff Group Not Connected:</b>\n` +
                     `The bot cannot generate an invite link because the leadership group is not set.\n` +
                     `👉 Add the bot to your leadership group as Admin, then send <code>/setstaffgroup</code> in that group!`;
            } else {
              msg += `\n⚠️ <b>Could not create invite link:</b>\n` +
                     `Make sure the bot is an <b>Administrator</b> in your leadership group with <b>"Invite Users via Link"</b> enabled!`;
            }
          }

          return ctx.reply(msg, {
            parse_mode: 'HTML',
            ...(adminButtons.length > 0 ? Markup.inlineKeyboard(adminButtons) : {}),
          });
        } catch (err) {
          return ctx.reply(`❌ Failed to assign role: ${err.message}`);
        }
      } else if (subAction === 'remove' || subAction === 'revoke') {
        try {
          revokeRole(targetId, ctx.from.id);
          const revokeRes = await notifyTreasurerRevoked(ctx.telegram, targetId);
          const displayName = revokeRes.memberName || targetId;
          return ctx.reply(
            `✅ Successfully revoked staff role from <b>${escapeHtml(displayName)}</b> (<code>${escapeHtml(targetId)}</code>).\n\n` +
            `• Menu keyboard returned to regular member access\n` +
            `• Automatically removed from the leadership staff group\n` +
            `• Staff group notified`,
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          return ctx.reply(`❌ Failed to revoke role: ${err.message}`);
        }
      }
    }

    const { text: msg, keyboard } = getRolesView();
    return ctx.reply(msg, { parse_mode: 'HTML', ...keyboard });
  });

  bot.command(['stafflink', 'stafflinks', 'grouplink', 'grouplinks'], requireAdmin, async (ctx) => {
    const groupId = getStaffGroupId();
    if (!groupId) {
      return ctx.reply(
        '⚠️ <b>Staff Group Not Connected</b>\n\n' +
        'Please add the bot to your leadership group as an Administrator and send <code>/setstaffgroup</code> inside that group first.',
        { parse_mode: 'HTML' }
      );
    }

    try {
      const inviteLink = await inviteTreasurerToStaffGroup(ctx.telegram, ctx.from.id, 'Admin Request');
      if (inviteLink) {
        return ctx.reply(
          `🏛️ <b>Leadership Group Invite Link:</b>\n\n` +
          `<code>${inviteLink}</code>\n\n` +
          `<i>You can share this link with any approved church staff or treasurer to join the leadership group.</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('🏛️ Join Leadership Group', inviteLink)]]),
          }
        );
      }
      return ctx.reply('⚠️ Could not generate invite link. Ensure the bot is an Administrator in the group with "Invite Users via Link" enabled.');
    } catch (err) {
      return ctx.reply(`❌ Failed to generate invite link: ${err.message}`);
    }
  });

  bot.command(['sendstafflink', 'invitetreasurer'], requireAdmin, async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);
    if (parts.length < 1 || !isValidTelegramId(parts[0])) {
      return ctx.reply(
        'ℹ️ <b>Usage:</b> <code>/sendstafflink &lt;telegram_id&gt;</code>\n\n' +
        'Example: <code>/sendstafflink 7997115682</code>\n\n' +
        '<i>Generates an invite link and sends it directly to the treasurer, plus displays the link here for you.</i>',
        { parse_mode: 'HTML' }
      );
    }
    const targetId = parts[0];
    try {
      const res = await notifyTreasurerAppointed(ctx.telegram, targetId, ctx.from.first_name || 'Admin');
      const name = res.memberName || targetId;

      let msg = `🏛️ <b>Group Invite Link for ${escapeHtml(name)}</b> (<code>${escapeHtml(targetId)}</code>):\n\n`;
      const buttons = [];

      if (res.inviteLink) {
        msg += `🔗 <code>${res.inviteLink}</code>\n\n`;
        if (res.dmSent) {
          msg += `• ✅ Link and staff menu successfully delivered to their private chat!`;
        } else {
          msg += `• ⚠️ <b>Could not DM user:</b> They have not started the bot privately yet.\n👉 <b>Please copy the link above and send it to them directly!</b>`;
        }
        buttons.push([Markup.button.url('🏛️ Open Group Invite Link', res.inviteLink)]);
      } else {
        msg += `⚠️ Could not generate invite link. Ensure the bot is an Administrator in the group with "Invite Users via Link" enabled.`;
      }

      return ctx.reply(msg, {
        parse_mode: 'HTML',
        ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}),
      });
    } catch (err) {
      return ctx.reply(`❌ Failed to send invite link: ${err.message}`);
    }
  });

  bot.command(['setstafflink', 'setgrouplink'], requireAdmin, async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);
    if (parts.length < 1) {
      const current = getStaffGroupInviteLink();
      return ctx.reply(
        `🏛️ <b>Staff Group Fallback Invite Link</b>\n\n` +
        (current ? `Current fallback link: <code>${current}</code>\n\n` : `No fallback link currently set.\n\n`) +
        `To set a permanent fallback link, send:\n<code>/setstafflink https://t.me/+YourLinkHere</code>`,
        { parse_mode: 'HTML' }
      );
    }
    const newLink = parts[0];
    setStaffGroupInviteLink(newLink, ctx.from.id);
    return ctx.reply(
      `✅ <b>Staff group fallback invite link saved!</b>\n\n<code>${escapeHtml(newLink)}</code>\n\nThis link will be used as a guaranteed fallback whenever inviting treasurers.`,
      { parse_mode: 'HTML' }
    );
  });
          `🏛️ <b>Leadership Group Invite Link:</b>\n\n` +
          `<code>${inviteLink}</code>\n\n` +
          `<i>You can share this link with any approved church staff or treasurer to join the leadership group.</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('🏛️ Join Leadership Group', inviteLink)]]),
          }
        );
      }
      return ctx.reply('⚠️ Could not generate invite link. Ensure the bot is an Administrator in the group with "Invite Users via Link" enabled.');
    } catch (err) {
      return ctx.reply(`❌ Failed to generate invite link: ${err.message}`);
    }
  });

  bot.hears(/^(?:🛡️\s*)?(?:Manage Roles|ሚናዎች)$/i, requireAdmin, async (ctx) => {
    const { text: msg, keyboard } = getRolesView();
    await ctx.reply(msg, { parse_mode: 'HTML', ...keyboard });
  });

  bot.action('menu_roles', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const { text: msg, keyboard } = getRolesView();
    await ctx.reply(msg, { parse_mode: 'HTML', ...keyboard });
  });

  bot.action('admin_role_prompt_add', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    setSession(ctx.from.id, { step: 'ROLE_WAIT_ADD_ID' });
    await ctx.reply(
      `🛡️ <b>Add Treasurer Role</b>\n\n` +
      `Please enter the numeric <b>Telegram ID</b> of the member you want to grant Treasurer privileges to (e.g. <code>7862773644</code>):`,
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard(),
      }
    );
  });

  bot.action('admin_role_get_link', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = getStaffGroupId();
    if (!groupId) {
      return ctx.reply(
        '⚠️ <b>Staff Group Not Connected</b>\n\n' +
        'Please add the bot to your leadership group as an Administrator and send <code>/setstaffgroup</code> inside that group first.',
        { parse_mode: 'HTML' }
      );
    }

    try {
      const inviteLink = await inviteTreasurerToStaffGroup(ctx.telegram, ctx.from.id, 'Admin Request');
      if (inviteLink) {
        return ctx.reply(
          `🏛️ <b>Leadership Group Invite Link:</b>\n\n` +
          `<code>${inviteLink}</code>\n\n` +
          `<i>You can share this link with any approved church staff or treasurer to join the leadership group.</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('🏛️ Join Leadership Group', inviteLink)]]),
          }
        );
      }
      return ctx.reply('⚠️ Could not generate invite link. Ensure the bot is an Administrator in the group with "Invite Users via Link" enabled.');
    } catch (err) {
      return ctx.reply(`❌ Failed to generate invite link: ${err.message}`);
    }
  });

  bot.action(/^admin_role_sendlink_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery('Sending group invite link...');
    const targetId = ctx.match[1];
    try {
      const res = await notifyTreasurerAppointed(ctx.telegram, targetId, ctx.from.first_name || 'Admin');
      const name = res.memberName || targetId;

      let msg = `🏛️ <b>Group Invite Link for ${escapeHtml(name)}</b> (<code>${escapeHtml(targetId)}</code>):\n\n`;
      const buttons = [];

      if (res.inviteLink) {
        msg += `🔗 <code>${res.inviteLink}</code>\n\n`;
        if (res.dmSent) {
          msg += `• ✅ Link and staff menu successfully delivered to their private chat!`;
        } else {
          msg += `• ⚠️ <b>Could not DM user:</b> They have not started the bot privately yet.\n👉 <b>Please copy the link above and send it to them directly!</b>`;
        }
        buttons.push([Markup.button.url('🏛️ Open Group Invite Link', res.inviteLink)]);
      } else {
        msg += `⚠️ Could not generate invite link. Ensure the bot is an Administrator in the group with "Invite Users via Link" enabled.`;
      }

      return ctx.reply(msg, {
        parse_mode: 'HTML',
        ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}),
      });
    } catch (err) {
      return ctx.reply(`❌ Failed to send invite link: ${err.message}`);
    }
  });

  bot.action(/^admin_role_revoke_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = ctx.match[1];
    try {
      revokeRole(targetId, ctx.from.id);
      await notifyTreasurerRevoked(ctx.telegram, targetId);

      await ctx.reply(
        `✅ Successfully revoked Treasurer role from Telegram ID <code>${escapeHtml(targetId)}</code>.\n\n` +
        `• Automatically removed from the leadership staff group\n` +
        `• Menu keyboard returned to regular member access`,
        { parse_mode: 'HTML' }
      );

      const { text: msg, keyboard } = getRolesView();
      try {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
      } catch (_) {}
    } catch (err) {
      await ctx.reply(`❌ Failed to revoke role: ${err.message}`);
    }
  });

  // ==========================================
  // /reversepayment - Reverse incorrect payment
  // ==========================================
  bot.command('reversepayment', requireAdmin, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length >= 2) {
      const txId = parts[0].toUpperCase();
      const reason = parts.slice(1).join(' ');

      try {
        const result = reversePayment({
          txId,
          reason,
          reversedBy: ctx.from.id,
        });

        const currency = getCurrency();
        return ctx.reply(
          `🔄 *Payment Reversal Completed*\n\n` +
          `• *Transaction ID:* ${result.payment.tx_id}\n` +
          `• *Reversed Amount:* ${formatMoney(result.payment.amount_cents, currency)}\n` +
          `• *Reason:* ${result.payment.reversal_reason}\n` +
          `• *Obligation Period:* ${result.obligation.year_month}\n` +
          `• *New Obligation Status:* ${result.obligation.status}\n\n` +
          `_Audit log entry and reversal transaction recorded successfully._`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        return ctx.reply(`❌ Reversal failed: ${err.message}`);
      }
    }

    setSession(ctx.from.id, { step: 'REVERSE_WAIT_TXID' });
    await ctx.reply(
      `🔄 *Payment Reversal*\n\n` +
      `Please reply with the *Transaction ID* of the payment you want to reverse (e.g. \`TX-20261021-A1B2C3\`):`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      }
    );
  });

  bot.hears(/^(?:🔄\s*)?(?:Reverse Payment|ክፍያ መልስ)$/i, requireAdmin, async (ctx) => {
    setSession(ctx.from.id, { step: 'REVERSE_WAIT_TXID' });
    await ctx.reply(
      `🔄 *Payment Reversal*\n\n` +
      `Please reply with the *Transaction ID* of the payment you want to reverse (e.g. \`TX-20261021-A1B2C3\`):`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      }
    );
  });

  bot.action('menu_reverse_payment', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    setSession(ctx.from.id, { step: 'REVERSE_WAIT_TXID' });
    await ctx.reply(
      `🔄 *Payment Reversal*\n\n` +
      `Please reply with the *Transaction ID* of the payment you want to reverse (e.g. \`TX-20261021-A1B2C3\`):`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard(),
      }
    );
  });

  // ==========================================
  // /audit - System Audit History
  // ==========================================
  function formatAuditTrailMessage() {
    const db = getDatabase();
    const logs = db.prepare(`
      SELECT * FROM audit_log
      ORDER BY id DESC
      LIMIT 10
    `).all();

    if (logs.length === 0) {
      return '<i>No audit log entries recorded yet.</i>';
    }

    let msg = `🔍 <b>System Audit Trail (Last 10 Actions)</b>\n\n`;
    for (const l of logs) {
      let details = '';
      try {
        const parsed = JSON.parse(l.details_json);
        details = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ');
      } catch (_) {
        details = l.details_json || '';
      }

      msg += `• <b>#${l.id} [${escapeHtml(l.action)}]</b> — ${escapeHtml(l.created_at)}\n`;
      msg += `  <i>Actor:</i> <code>${escapeHtml(l.actor_telegram_id)}</code> | <i>Entity:</i> ${escapeHtml(l.entity_type)} (#${escapeHtml(l.entity_id || 'N/A')})\n`;
      if (details) {
        msg += `  <i>${escapeHtml(details)}</i>\n`;
      }
      msg += `\n`;
    }
    return msg;
  }

  bot.command('audit', requireAdmin, async (ctx) => {
    await ctx.reply(formatAuditTrailMessage(), { parse_mode: 'HTML' });
  });

  bot.hears(/^(?:🔍\s*)?(?:Audit Log|ኦዲት መዝገብ)$/i, requireAdmin, async (ctx) => {
    await ctx.reply(formatAuditTrailMessage(), { parse_mode: 'HTML' });
  });

  bot.action('menu_audit', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(formatAuditTrailMessage(), { parse_mode: 'HTML' });
  });

  // ==========================================
  // /setstaffgroup - Connect Staff Telegram Group
  // ==========================================
  bot.command('setstaffgroup', async (ctx) => {
    const senderId = String(ctx.from?.id || '');
    if (!isAdmin(senderId)) {
      return ctx.reply('⛔ Only fellowship administrators can configure the staff archive group.', {
        reply_to_message_id: ctx.message?.message_id,
      });
    }

    const text = (ctx.message?.text || '').trim();
    const parts = text.split(/\s+/).slice(1);

    let chatId = ctx.chat.type !== 'private' ? ctx.chat.id : null;
    let chatTitle = ctx.chat.title || 'Fellowship Staff Group';
    let isForum = Boolean(ctx.chat.is_forum);

    // If an argument is provided: /setstaffgroup <groupId>
    if (parts.length > 0 && /^-?\d+$/.test(parts[0])) {
      chatId = parts[0];
      try {
        const chatInfo = await ctx.telegram.getChat(chatId);
        chatTitle = chatInfo.title || chatTitle;
        isForum = Boolean(chatInfo.is_forum);
      } catch (chatErr) {
        console.warn(`[StaffArchive] Could not fetch chat info for ${chatId}:`, chatErr.message);
      }
    }

    if (!chatId) {
      return ctx.reply(
        'ℹ️ <b>Connect Staff Group</b>\n\n' +
        'You can connect your staff archive group in one of two ways:\n\n' +
        '1. <b>Inside the Group:</b>\n' +
        '• Add this bot to your leadership group as an <b>Administrator</b>.\n' +
        '• Send <code>/setstaffgroup</code> inside that group.\n\n' +
        '2. <b>Directly in Private Chat:</b>\n' +
        '• Send <code>/setstaffgroup &lt;group_id&gt;</code> (e.g. <code>/setstaffgroup -100123456789</code>).\n\n' +
        '<i>Tip: After connecting, run /teststaffgroup to verify connectivity!</i>',
        { parse_mode: 'HTML' }
      );
    }

    setStaffGroupId(chatId, chatTitle, senderId);
    if (isTursoConfigured()) {
      pushToTurso().catch((e) => console.warn('[Turso] Async set staff group push notice:', e.message));
    }

    let topicNotice = '';
    if (isForum) {
      try {
        const topics = await initializeAcademicYearTopics(ctx.telegram, chatId);
        const monthTopics = topics.filter((t) => t.month !== 'reports');
        const reportsTopic = topics.find((t) => t.month === 'reports');

        topicNotice =
          `\n\n📁 <b>Academic Year Month Folders Initialized (${monthTopics.length} Months):</b>\n` +
          monthTopics.map((t) => `• <b>${escapeHtml(t.name)}</b>`).join('\n') +
          (reportsTopic ? `\n• <b>${escapeHtml(reportsTopic.name)}</b>` : '') +
          `\n\n<i>As administrators approve payment screenshots, verified receipts will be posted directly into their respective month folders!</i>`;
      } catch (topErr) {
        topicNotice = `\n\n⚠️ <i>Note on topics: ${escapeHtml(topErr.message)}</i>`;
      }
    } else {
      topicNotice =
        `\n\n💡 <b>Tip to enable Month Folders:</b>\n` +
        `1. Open Group Settings ⚙️\n` +
        `2. Turn on <b>Topics</b> (Forum mode)\n` +
        `3. Re-type <code>/setstaffgroup</code> so the bot creates all month folders automatically!`;
    }

    await ctx.reply(
      `🎉 <b>Staff Archive Group Successfully Connected!</b>\n\n` +
      `• <b>Group Name:</b> ${escapeHtml(chatTitle)}\n` +
      `• <b>Group ID:</b> <code>${chatId}</code>\n` +
      `• <b>Topics (Folders) Mode:</b> ${isForum ? '✅ Active' : '⚪ Standard Group'}\n\n` +
      `Send <code>/teststaffgroup</code> to verify that the bot can post into the group.` +
      topicNotice,
      {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message?.message_id,
      }
    );
  });

  bot.command(['initfolders', 'createmonths'], async (ctx) => {
    const senderId = String(ctx.from?.id || '');
    if (!isAdmin(senderId)) {
      return ctx.reply('⛔ Only fellowship administrators can initialize folder topics.');
    }
    const details = getStaffGroupDetails();
    const targetGroupId = ctx.chat.type !== 'private' ? ctx.chat.id : details.groupId;
    if (!targetGroupId) {
      return ctx.reply('⚠️ Please run /setstaffgroup inside your leadership group first.');
    }

    await ctx.reply('⏳ <b>Initializing all 9 Ethiopian Academic Year Month Folders (ጥቅምት እስከ ሰኔ)...</b>', {
      parse_mode: 'HTML',
      reply_to_message_id: ctx.message?.message_id,
    });

    const topics = await initializeAcademicYearTopics(ctx.telegram, targetGroupId);
    const summary = topics.map((t) => `• ${escapeHtml(t.name)} (ID: <code>${t.threadId || 'General'}</code>)`).join('\n');

    await ctx.reply(
      `✅ <b>All Academic Year Folders are Ready!</b>\n\n${summary}`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message?.message_id,
      }
    );
  });

  bot.command('staffstatus', async (ctx) => {
    const senderId = String(ctx.from?.id || '');
    if (!isAdmin(senderId)) {
      return ctx.reply('⛔ Only fellowship administrators can check staff group status.');
    }
    const details = getStaffGroupDetails();
    if (!details.groupId) {
      return ctx.reply(
        '⚠️ <b>Staff Group Not Connected</b>\n\n' +
        'Please add the bot to your leadership group as an administrator and send <code>/setstaffgroup</code> in that group (or send <code>/setstaffgroup &lt;group_id&gt;</code> here).',
        { parse_mode: 'HTML' }
      );
    }
    return ctx.reply(
      `🏛️ <b>Connected Staff Archive Group:</b>\n\n` +
      `• <b>Title:</b> ${escapeHtml(details.groupTitle)}\n` +
      `• <b>Group ID:</b> <code>${details.groupId}</code>\n` +
      `• <b>Status:</b> Ready to archive verified screenshots and reports.\n\n` +
      `💡 <i>Send /teststaffgroup to verify posting rights!</i>`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('teststaffgroup', async (ctx) => {
    const senderId = String(ctx.from?.id || '');
    if (!isAdmin(senderId)) {
      return ctx.reply('⛔ Only fellowship administrators can test staff group connectivity.');
    }
    const details = getStaffGroupDetails();
    if (!details.groupId) {
      return ctx.reply('⚠️ Staff group is not connected yet. Please run /setstaffgroup first.');
    }

    try {
      await ctx.telegram.sendMessage(
        details.groupId,
        `🔔 <b>Test Notification from Natanim Fund Bot</b>\n\n` +
        `Staff Archive Group connection verified successfully by <a href="tg://user?id=${senderId}">${escapeHtml(ctx.from?.first_name || 'Admin')}</a>.\n` +
        `Verified payment receipts and monthly reports will be archived here automatically.`,
        { parse_mode: 'HTML' }
      );
      return ctx.reply(`✅ <b>Success!</b> A test message was posted to <b>${escapeHtml(details.groupTitle)}</b> (<code>${details.groupId}</code>). The bot is ready to archive receipts!`, {
        parse_mode: 'HTML',
      });
    } catch (testErr) {
      return ctx.reply(
        `❌ <b>Failed to post into staff group:</b>\n\n<code>${escapeHtml(testErr.message)}</code>\n\n` +
        `<b>How to fix:</b>\n` +
        `1. Make sure the bot is added to the group.\n` +
        `2. Make sure the bot is promoted to <b>Administrator</b> in the group with permission to send messages and photos.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ==========================================
  // /diagnostics or /system - Health Check
  // ==========================================
  bot.command(['diagnostics', 'system'], requireAdmin, async (ctx) => {
    try {
      const diag = getSystemDiagnostics();
      const text = formatDiagnosticsHtml(diag);
      return ctx.reply(text, { parse_mode: 'HTML' });
    } catch (err) {
      return ctx.reply(`❌ Failed to retrieve diagnostics: ${err.message}`);
    }
  });

  // ==========================================
  // /backup - Live SQLite Database Backup
  // ==========================================
  bot.command('backup', requireAdmin, async (ctx) => {
    let statusMsg = null;
    try {
      statusMsg = await ctx.reply('⏳ <i>Generating safe online SQLite backup snapshot...</i>', { parse_mode: 'HTML' });
    } catch (_) {}

    try {
      await sendDatabaseBackupToChat(config.botToken, ctx.from.id);

      if (statusMsg) {
        try {
          await ctx.deleteMessage(statusMsg.message_id);
        } catch (_) {}
      }
    } catch (err) {
      console.error('[Backup Error]:', err.message);
      return ctx.reply(`❌ Failed to send database backup: ${err.message}`);
    }
  });

  // ==========================================
  // /restore - Restore SQLite Database Backup
  // ==========================================
  bot.command('restore', requireAdmin, async (ctx) => {
    return ctx.reply(
      '📥 <b>Restore SQLite Database Backup</b>\n\n' +
      'To restore your database, simply <b>send or forward</b> your <code>.db</code> backup file (e.g. from /backup) directly to this chat.\n\n' +
      '⚠️ <i>Warning: Restoring will overwrite the active database with the uploaded backup file.</i>',
      { parse_mode: 'HTML' }
    );
  });

  // ==========================================
  // /turso or /sync - Turso Cloud Synchronization
  // ==========================================
  bot.command(['turso', 'sync'], requireAdmin, async (ctx) => {
    if (!isTursoConfigured()) {
      return ctx.reply(
        '☁️ <b>Turso Cloud Synchronization</b>\n\n' +
        '⚠️ <b>Status:</b> Not Configured\n\n' +
        'To enable permanent cloud persistence, set the following environment variables in Render:\n' +
        '• <code>TURSO_DATABASE_URL</code>\n' +
        '• <code>TURSO_AUTH_TOKEN</code>',
        { parse_mode: 'HTML' }
      );
    }

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const subCommand = (args[0] || 'status').toLowerCase();

    if (subCommand === 'pull') {
      let waitMsg = null;
      try {
        waitMsg = await ctx.reply('⏳ <i>Pulling cloud state from Turso into local SQLite...</i>', { parse_mode: 'HTML' });
      } catch (_) {}

      try {
        const res = await pullFromTurso();
        if (waitMsg) {
          try { await ctx.deleteMessage(waitMsg.message_id); } catch (_) {}
        }
        return ctx.reply(
          `✅ <b>Turso Pull Complete!</b>\n\n` +
          `• <b>Rows Restored:</b> ${res.totalRowsPulled}\n` +
          `• <b>Status:</b> Local database synchronized with cloud.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        return ctx.reply(`❌ Pull failed: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      }
    }

    if (subCommand === 'push' || subCommand === 'now') {
      let waitMsg = null;
      try {
        waitMsg = await ctx.reply('⏳ <i>Pushing local database state to Turso cloud...</i>', { parse_mode: 'HTML' });
      } catch (_) {}

      try {
        const res = await pushToTurso();
        if (waitMsg) {
          try { await ctx.deleteMessage(waitMsg.message_id); } catch (_) {}
        }
        return ctx.reply(
          `✅ <b>Turso Cloud Backup Complete!</b>\n\n` +
          `• <b>Rows Uploaded:</b> ${res.totalRowsPushed}\n` +
          `• <b>Cloud Status:</b> 🟢 Up to date and permanently persisted.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        return ctx.reply(`❌ Push failed: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      }
    }

    return ctx.reply(
      `☁️ <b>Turso Cloud Persistence Status</b>\n\n` +
      `• <b>Status:</b> 🟢 Connected\n` +
      `• <b>Cloud URL:</b> <code>${escapeHtml(config.tursoDatabaseUrl || 'configured')}</code>\n` +
      `• <b>Auto-Sync:</b> Every 5 minutes + on payment approvals\n\n` +
      `<b>Available Commands:</b>\n` +
      `• <code>/turso push</code> — Force push local database to cloud now\n` +
      `• <code>/turso pull</code> — Force pull cloud database into local bot`,
      { parse_mode: 'HTML' }
    );
  });

  // Listener for .db database backup files sent by Administrators
  bot.on('document', async (ctx, next) => {
    const doc = ctx.message?.document;
    if (!doc || !doc.file_name?.endsWith('.db')) {
      return next();
    }

    const senderId = String(ctx.from?.id || '');
    if (!isAdmin(senderId)) {
      return next();
    }

    let statusMsg = null;
    try {
      statusMsg = await ctx.reply('⏳ <i>Downloading and verifying database backup file...</i>', { parse_mode: 'HTML' });

      // 1. Get file download link from Telegram
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(link.href);
      if (!res.ok) {
        throw new Error(`Failed to download backup file from Telegram: ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Perform restoration and validation
      const result = restoreDatabaseFromBuffer(buffer);

      if (statusMsg) {
        try {
          await ctx.deleteMessage(statusMsg.message_id);
        } catch (_) {}
      }

      return ctx.reply(
        `🎉 <b>Database Successfully Restored!</b>\n\n` +
        `• <b>File Restored:</b> <code>${escapeHtml(doc.file_name)}</code>\n` +
        `• <b>Active Members:</b> ${result.memberCount}\n` +
        `• <b>Recorded Payments:</b> ${result.paymentCount}\n` +
        `• <b>Staff Archive Group:</b> ${escapeHtml(result.staffGroupTitle)}\n\n` +
        `✅ All member accounts, obligations, and histories are online and verified!`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('[Restore Error]:', err.message);
      if (statusMsg) {
        try {
          await ctx.deleteMessage(statusMsg.message_id);
        } catch (_) {}
      }
      return ctx.reply(`❌ <b>Database Restore Failed:</b>\n\n<code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
    }
  });
}

module.exports = {
  registerAdminHandlers,
};

