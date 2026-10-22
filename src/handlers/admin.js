const { Markup } = require('telegraf');
const { requireAdmin } = require('../middleware/auth');
const { registerMember, deactivateMember, getAllActiveMembers } = require('../services/memberService');
const {
  setStandardAmountCents,
  getStandardAmountCents,
  getCurrency,
  reversePayment,
  getPaymentByTxId,
} = require('../services/accounting');
const { assignRole, revokeRole, listRoles } = require('../services/permissions');
const { getDatabase } = require('../db');
const { setSession, getSession, clearSession } = require('../utils/session');
const { parseMoneyToCents, formatMoney } = require('../utils/formatters');
const { isValidTelegramId, sanitizeText } = require('../utils/validators');
const { getCancelKeyboard } = require('../utils/keyboards');

function registerAdminHandlers(bot) {
  // ==========================================
  // /addmember - Register New Member
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
  bot.command('roles', requireAdmin, async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);

    if (parts.length >= 2) {
      const subAction = parts[0].toLowerCase();
      const targetId = parts[1];

      if (!isValidTelegramId(targetId)) {
        return ctx.reply('❌ Invalid Telegram ID.');
      }

      if (subAction === 'add' || subAction === 'grant') {
        try {
          assignRole(targetId, 'treasurer', ctx.from.id);
          return ctx.reply(`✅ Successfully granted *Treasurer* role to Telegram ID \`${targetId}\`.`, { parse_mode: 'Markdown' });
        } catch (err) {
          return ctx.reply(`❌ Failed to assign role: ${err.message}`);
        }
      } else if (subAction === 'remove' || subAction === 'revoke') {
        try {
          revokeRole(targetId, ctx.from.id);
          return ctx.reply(`✅ Successfully revoked staff role from Telegram ID \`${targetId}\`.`, { parse_mode: 'Markdown' });
        } catch (err) {
          return ctx.reply(`❌ Failed to revoke role: ${err.message}`);
        }
      }
    }

    const rolesList = listRoles();
    let msg = `🛡️ *Authorized System Roles*\n\n`;
    for (const r of rolesList) {
      const name = r.full_name ? ` (${r.full_name})` : '';
      msg += `• *${r.role.toUpperCase()}*: \`${r.telegram_id}\`${name}\n  _Assigned by: ${r.assigned_by} on ${r.created_at.slice(0, 10)}_\n\n`;
    }

    msg += `*To add a treasurer:*\n\`/roles add <telegram_id>\`\n\n`;
    msg += `*To remove a treasurer:*\n\`/roles remove <telegram_id>\``;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.action('menu_roles', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const rolesList = listRoles();
    let msg = `🛡️ *Authorized System Roles*\n\n`;
    for (const r of rolesList) {
      const name = r.full_name ? ` (${r.full_name})` : '';
      msg += `• *${r.role.toUpperCase()}*: \`${r.telegram_id}\`${name}\n  _Assigned by: ${r.assigned_by} on ${r.created_at.slice(0, 10)}_\n\n`;
    }

    msg += `*To add a treasurer:*\n\`/roles add <telegram_id>\`\n\n`;
    msg += `*To remove a treasurer:*\n\`/roles remove <telegram_id>\``;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
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
  bot.command('audit', requireAdmin, async (ctx) => {
    const db = getDatabase();
    const logs = db.prepare(`
      SELECT * FROM audit_log
      ORDER BY id DESC
      LIMIT 10
    `).all();

    if (logs.length === 0) {
      return ctx.reply('No audit log entries recorded yet.');
    }

    let msg = `🔍 *System Audit Trail (Last 10 Actions)*\n\n`;
    for (const l of logs) {
      let details = '';
      try {
        const parsed = JSON.parse(l.details_json);
        details = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ');
      } catch (_) {
        details = l.details_json || '';
      }

      msg += `• *#${l.id} [${l.action}]* — ${l.created_at}\n  _Actor:_ \`${l.actor_telegram_id}\` | _Entity:_ ${l.entity_type} (#${l.entity_id || 'N/A'})\n  _${details}_\n\n`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.action('menu_audit', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    const db = getDatabase();
    const logs = db.prepare(`
      SELECT * FROM audit_log
      ORDER BY id DESC
      LIMIT 10
    `).all();

    if (logs.length === 0) {
      return ctx.reply('No audit log entries recorded yet.');
    }

    let msg = `🔍 *System Audit Trail (Last 10 Actions)*\n\n`;
    for (const l of logs) {
      let details = '';
      try {
        const parsed = JSON.parse(l.details_json);
        details = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ');
      } catch (_) {
        details = l.details_json || '';
      }

      msg += `• *#${l.id} [${l.action}]* — ${l.created_at}\n  _Actor:_ \`${l.actor_telegram_id}\` | _Entity:_ ${l.entity_type} (#${l.entity_id || 'N/A'})\n  _${details}_\n\n`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });
}

module.exports = {
  registerAdminHandlers,
};

