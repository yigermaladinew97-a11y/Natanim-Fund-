const { Markup } = require('telegraf');
const { getBankInfo } = require('../services/accounting');
const { setSession } = require('../utils/session');
const { getCancelKeyboard } = require('../utils/keyboards');
const { requireAdmin } = require('../middleware/auth');

async function handleShowBankInfo(ctx) {
  const bankInfoText = getBankInfo();
  const role = ctx.state?.role || 'member';

  const buttons = [];
  buttons.push([Markup.button.callback('📤 Submit Payment Receipt', 'menu_submit_payment')]);

  if (role === 'admin') {
    buttons.push([Markup.button.callback('✏️ Edit Church Accounts', 'admin_edit_bankinfo')]);
  }

  return ctx.reply(bankInfoText, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons),
  });
}

function startEditBankInfo(ctx) {
  setSession(ctx.from.id, { step: 'ADMIN_SET_BANK_INFO' });
  return ctx.reply(
    `✏️ <b>Edit Church Contribution Accounts</b>\n\n` +
    `Please send the new account details text formatted with HTML.\n\n` +
    `💡 <i>Tip: Put account numbers inside &lt;code&gt;1000123456789&lt;/code&gt; so members can copy them with 1 tap!</i>\n\n` +
    `Reply with the new text or tap Cancel below:`,
    {
      parse_mode: 'HTML',
      ...getCancelKeyboard(),
    }
  );
}

function registerBankInfoHandlers(bot) {
  bot.command('bankinfo', handleShowBankInfo);
  bot.command('accounts', handleShowBankInfo);
  bot.command('setbankinfo', requireAdmin, startEditBankInfo);

  bot.hears(/^(?:🏦\s*)?(?:Church\s+)?(?:Bank\s+)?Accounts(?: Details)?$/i, handleShowBankInfo);
  bot.hears(/^(?:🏦\s*)?Edit Church Accounts$/i, requireAdmin, startEditBankInfo);

  bot.action('menu_bankinfo', async (ctx) => {
    await ctx.answerCbQuery();
    await handleShowBankInfo(ctx);
  });

  bot.action('admin_edit_bankinfo', requireAdmin, async (ctx) => {
    await ctx.answerCbQuery();
    await startEditBankInfo(ctx);
  });
}

module.exports = {
  handleShowBankInfo,
  startEditBankInfo,
  registerBankInfoHandlers,
};
