/**
 * Middleware to enforce private chats for sensitive financial operations
 */

function requirePrivateChat(ctx, next) {
  if (ctx.chat && ctx.chat.type !== 'private') {
    const text = (ctx.message?.text || '').trim();
    // Allow staff group configuration commands inside groups
    if (/^\/(setstaffgroup|staffstatus|helpstaff)(?:@\w+)?(?:\s|$)/i.test(text)) {
      return next();
    }
    // Allow group service messages (bot added, group created, topic created)
    if (ctx.message?.new_chat_members || ctx.message?.group_chat_created || ctx.message?.forum_topic_created) {
      return next();
    }

    return ctx.reply(
      '🔒 For your privacy and financial security, financial commands can only be used in a private direct message. Please message me directly.',
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

