const { getBankInfo, getCbeAccountNumber, getCbeAccountName } = require('../services/accounting');
const { setSession } = require('../utils/session');
const { getCancelKeyboard } = require('../utils/keyboards');
const { requireAdmin } = require('../middleware/auth');

async function handleShowBankInfo(ctx) {
  const bankInfoText = getBankInfo();
  const role = ctx.state?.role || 'member';

  const buttons = [];
  buttons.push([Markup.button.callback('📤 Submit Payment Receipt', 'menu_submit_payment')]);

  if (role === 'admin') {
    buttons.push([Markup.button.callback('✏️ Edit CBE Account', 'admin_edit_bankinfo')]);
  }

  return ctx.reply(bankInfoText, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons),
  });
}

function startEditBankInfo(ctx) {
  const curNum = getCbeAccountNumber();
  const curName = getCbeAccountName();

  setSession(ctx.from.id, {
    step: 'ADMIN_SET_CBE_ACCOUNT_NUMBER',
    currentAccountNumber: curNum,
    currentAccountName: curName,
  });

  return ctx.reply(
    `🏦 <b>Edit Church CBE Account — Step 1/2</b>\n\n` +
    `• <b>Current Account Number:</b> <code>${curNum}</code>\n` +
    `• <b>Current Account Name:</b> ${curName}\n\n` +
    `Please enter the new <b>CBE Account Number</b> (digits only, e.g. <code>1000123456789</code>):`,
    {
      parse_mode: 'HTML',
      ...getCancelKeyboard(),
    }
  );
}

function registerBankInfoHandlers(bot) {
  bot.command('bankinfo', handleShowBankInfo);
  bot.command('cbe', handleShowBankInfo);
  bot.command('accounts', handleShowBankInfo);
  bot.command('setbankinfo', requireAdmin, startEditBankInfo);

  bot.hears(/^(?:🏦\s*)?(?:Church\s+)?(?:Bank\s+)?Accounts(?: Details)?$/i, handleShowBankInfo);
  bot.hears(/^(?:🏦\s*)?Edit (?:Church )?CBE Account$/i, requireAdmin, startEditBankInfo);

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
