/**
 * Middleware to enforce private chats for sensitive financial operations
 */

function requirePrivateChat(ctx, next) {
  if (ctx.chat && ctx.chat.type !== 'private') {
    return ctx.reply(
      '🔒 For your privacy and financial security, this bot command can only be used in a private direct message. Please message me directly.',
      {
        reply_to_message_id: ctx.message?.message_id,
      }
    );
  }
  return next();
}

module.exports = {
  requirePrivateChat,
};

