const { Markup } = require('telegraf');

function getMainMenuKeyboard(role) {
  if (role === 'pending') {
    return Markup.removeKeyboard();
  }

  const buttons = [];

  if (role === 'unregistered') {
    buttons.push(['📝 Register as Member']);
    return Markup.keyboard(buttons).resize().persistent();
  }

  // Member buttons
  buttons.push(['📊 My Status', '📜 My History']);
  buttons.push(['👤 My Profile', '📤 Submit Receipt']);

  // Treasurer / Admin buttons
  if (role === 'admin' || role === 'treasurer') {
    buttons.push(['💰 Record Payment', '📑 Monthly Report']);
    buttons.push(['👥 Members List', '⏳ Unpaid List']);
    buttons.push(['📨 Send Reminders', '💳 Verify Receipts']);
  }

  // Admin exclusive buttons
  if (role === 'admin') {
    buttons.push(['📥 Pending Approvals']);
    buttons.push(['➕ Add Member', '🛑 Deactivate Member']);
    buttons.push(['⚙️ Set Standard Amount', '🛡️ Manage Roles']);
    buttons.push(['🏦 Edit CBE Account', '📁 Export CSV']);
    buttons.push(['🔄 Reverse Payment', '🔍 Audit Log']);
  }

  return Markup.keyboard(buttons).resize().persistent();
}

function getMainMenuInlineKeyboard(role) {
  if (role === 'pending') {
    return Markup.inlineKeyboard([]);
  }

  const buttons = [];

  if (role === 'unregistered') {
    buttons.push([Markup.button.callback('📝 Register as Member', 'start_self_register')]);
    return Markup.inlineKeyboard(buttons);
  }

  // Member buttons
  buttons.push([Markup.button.callback('📊 My Status', 'menu_mystatus'), Markup.button.callback('📜 My History', 'menu_history')]);
  buttons.push([Markup.button.callback('👤 My Profile', 'menu_myprofile'), Markup.button.callback('📤 Submit Receipt', 'menu_submit_payment')]);

  // Treasurer / Admin buttons
  if (role === 'admin' || role === 'treasurer') {
    buttons.push([Markup.button.callback('💰 Record Payment', 'menu_record_payment'), Markup.button.callback('📑 Monthly Report', 'menu_report')]);
    buttons.push([Markup.button.callback('👥 Members List', 'menu_members_page_1'), Markup.button.callback('⏳ Unpaid List', 'menu_unpaid')]);
    buttons.push([Markup.button.callback('📨 Send Reminders', 'menu_remind'), Markup.button.callback('💳 Verify Receipts', 'menu_submissions')]);
  }

  // Admin exclusive buttons
  if (role === 'admin') {
    buttons.push([Markup.button.callback('📥 Pending Approvals', 'menu_approvals')]);
    buttons.push([Markup.button.callback('➕ Add Member', 'menu_addmember'), Markup.button.callback('🛑 Deactivate Member', 'menu_deactivate')]);
    buttons.push([Markup.button.callback('⚙️ Set Standard Amount', 'menu_setamount'), Markup.button.callback('🛡️ Manage Roles', 'menu_roles')]);
    buttons.push([Markup.button.callback('🏦 Edit CBE Account', 'admin_edit_bankinfo'), Markup.button.callback('📁 Export CSV', 'menu_export_csv')]);
    buttons.push([Markup.button.callback('🔄 Reverse Payment', 'menu_reverse_payment'), Markup.button.callback('🔍 Audit Log', 'menu_audit')]);
  }

  return Markup.inlineKeyboard(buttons);
}

function getPaymentMethodKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💵 Cash', 'paymethod_cash'),
      Markup.button.callback('🏦 Bank Transfer', 'paymethod_bank_transfer'),
    ],
    [
      Markup.button.callback('📱 Mobile Money', 'paymethod_mobile_money'),
      Markup.button.callback('❌ Cancel', 'action_cancel'),
    ],
  ]);
}

function getCancelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Cancel Operation', 'action_cancel')],
  ]);
}

function getCancelReplyKeyboard() {
  return Markup.keyboard([
    ['❌ Cancel Operation']
  ]).resize();
}

function getConfirmationKeyboard(confirmAction, cancelAction = 'action_cancel') {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm & Submit', confirmAction),
      Markup.button.callback('❌ Cancel', cancelAction),
    ],
  ]);
}

function getPaginationKeyboard(prefix, currentPage, totalPages) {
  const buttons = [];
  if (currentPage > 1) {
    buttons.push(Markup.button.callback('⬅️ Prev', `${prefix}_${currentPage - 1}`));
  }
  buttons.push(Markup.button.callback(`📄 ${currentPage}/${totalPages}`, 'noop'));
  if (currentPage < totalPages) {
    buttons.push(Markup.button.callback('Next ➡️', `${prefix}_${currentPage + 1}`));
  }
  return Markup.inlineKeyboard([buttons]);
}

module.exports = {
  getMainMenuKeyboard,
  getMainMenuInlineKeyboard,
  getPaymentMethodKeyboard,
  getCancelKeyboard,
  getCancelReplyKeyboard,
  getConfirmationKeyboard,
  getPaginationKeyboard,
};

