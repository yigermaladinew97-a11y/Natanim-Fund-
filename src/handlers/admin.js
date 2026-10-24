const { Markup } = require('telegraf');
const { requireAdmin } = require('../middleware/auth');
const {
  registerMember,
  deactivateMember,
  getAllActiveMembers,
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
const { assignRole, revokeRole, listRoles, getMemberByTelegramId } = require('../services/permissions');
const { getDatabase } = require('../db');
const { setSession, getSession, clearSession } = require('../utils/session');
const { parseMoneyToCents, formatMoney, escapeHtml } = require('../utils/formatters');
const { isValidTelegramId, sanitizeText } = require('../utils/validators');
const { getCancelKeyboard, getMainMenuKeyboard } = require('../utils/keyboards');

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
        return ctx.reply(`✅ Member *${member.full_name}* (#${member.id}) has been deactivated. Historical records have been preserved.`, {
          parse_mode: 'Markdown',
        });
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
  async function notifyUserRoleChanged(telegram, targetId, newRole) {
    try {
      if (newRole === 'treasurer') {
        await telegram.sendMessage(
          targetId,
          `🎉 <b>Role Updated!</b>\n\n` +
          `You have been granted <b>Treasurer</b> privileges for Natanim Church Fund by an administrator.\n\n` +
          `Your menu buttons below have been automatically updated. You now have access to staff tools like <b>Record Payment</b>, <b>Monthly Report</b>, <b>Members List</b>, and <b>Verify Receipts</b>!`,
          {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard('treasurer'),
          }
        );
      } else {
        const member = getMemberByTelegramId(targetId);
        const fallbackRole = member && member.status === 'active' ? 'member' : 'unregistered';
        await telegram.sendMessage(
          targetId,
          `ℹ️ <b>Staff Role Update</b>\n\n` +
          `Your Treasurer privileges for Natanim Church Fund have been removed by an administrator.\n\n` +
          `Your menu buttons below have been updated back to regular member access.`,
          {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard(fallbackRole),
          }
        );
      }
    } catch (dmErr) {
      console.warn(`[Roles] Could not send direct notification to user ${targetId}:`, dmErr.message);
    }
  }

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
    msg += `• Or revoke with: <code>/roles remove &lt;telegram_id&gt;</code>`;

    const buttons = [];
    buttons.push([Markup.button.callback('➕ Add Treasurer', 'admin_role_prompt_add')]);

    const treasurers = rolesList.filter((r) => r.role === 'treasurer');
    for (const t of treasurers) {
      const label = t.full_name ? `❌ Revoke ${t.full_name}` : `❌ Revoke ${t.telegram_id}`;
      buttons.push([Markup.button.callback(label, `admin_role_revoke_${t.telegram_id}`)]);
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
          await notifyUserRoleChanged(ctx.telegram, targetId, 'treasurer');
          return ctx.reply(
            `✅ Successfully granted <b>Treasurer</b> role to Telegram ID <code>${escapeHtml(targetId)}</code>.\n` +
            `Their menu keyboard has been automatically updated on their device!`,
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          return ctx.reply(`❌ Failed to assign role: ${err.message}`);
        }
      } else if (subAction === 'remove' || subAction === 'revoke') {
        try {
          revokeRole(targetId, ctx.from.id);
          await notifyUserRoleChanged(ctx.telegram, targetId, 'member');
          return ctx.reply(
            `✅ Successfully revoked staff role from Telegram ID <code>${escapeHtml(targetId)}</code>.\n` +
            `Their menu keyboard has been automatically updated on their device!`,
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

  bot.action(/^admin_role_revoke_(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = ctx.match[1];
    try {
      revokeRole(targetId, ctx.from.id);
      await notifyUserRoleChanged(ctx.telegram, targetId, 'member');

      await ctx.reply(
        `✅ Successfully revoked Treasurer role from Telegram ID <code>${escapeHtml(targetId)}</code>.\n` +
        `Their menu keyboard has been automatically updated.`,
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
}

module.exports = {
  registerAdminHandlers,
};

