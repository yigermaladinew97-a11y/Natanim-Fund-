const { getUserRole, getMemberByTelegramId } = require('../services/permissions');
const { getUserLanguage } = require('../services/i18n');

function attachAuthContext(ctx, next) {
  const userId = ctx.from ? String(ctx.from.id) : null;
  if (!userId) return next();

  const role = getUserRole(userId);
  const member = getMemberByTelegramId(userId);
  const language = getUserLanguage(userId);

  ctx.state = ctx.state || {};
  ctx.state.userId = userId;
  ctx.state.role = role;
  ctx.state.isAdmin = role === 'admin';
  ctx.state.isTreasurer = role === 'treasurer';
  ctx.state.isStaff = role === 'admin' || role === 'treasurer';
  ctx.state.member = member;
  ctx.state.isActiveMember = member && member.status === 'active';
  ctx.state.language = language;

  return next();
}

function requireAdmin(ctx, next) {
  if (!ctx.state?.isAdmin) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('⛔ Access Denied: Administrator role required.', { show_alert: true });
    }
    return ctx.reply('⛔ Access Denied: This command requires Administrator privileges.');
  }
  return next();
}

function requireStaff(ctx, next) {
  if (!ctx.state?.isStaff) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('⛔ Access Denied: Administrator or Treasurer role required.', { show_alert: true });
    }
    return ctx.reply('⛔ Access Denied: This action requires Administrator or Treasurer privileges.');
  }
  return next();
}

function requireActiveMember(ctx, next) {
  if (!ctx.state?.isActiveMember && !ctx.state?.isStaff) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('⚠️ You are not registered as an active member of Natanim Fund.', { show_alert: true });
    }
    return ctx.reply(
      '⚠️ You are not currently registered as an active member of Natanim Fund.\n\n' +
      'Please contact the church team leader or an administrator to complete your registration.'
    );
  }
  return next();
}

module.exports = {
  attachAuthContext,
  requireAdmin,
  requireStaff,
  requireActiveMember,
};

