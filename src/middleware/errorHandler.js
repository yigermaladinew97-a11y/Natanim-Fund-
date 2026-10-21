function errorHandler(err, ctx) {
  console.error(`[Error] Unhandled error during Telegram update [update_id=${ctx.update?.update_id}]:`, err.message);

  if (ctx.callbackQuery) {
    try {
      ctx.answerCbQuery('⚠️ An unexpected error occurred. Please try again.', { show_alert: true }).catch(() => {});
    } catch (_) {}
  }

  try {
    ctx.reply('⚠️ An unexpected error occurred while processing your request. Please try again or contact the administrator.').catch(() => {});
  } catch (_) {}
}

module.exports = {
  errorHandler,
};

