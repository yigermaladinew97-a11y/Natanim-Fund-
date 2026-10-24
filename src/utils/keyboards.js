const { Markup } = require('telegraf');

function getLanguageSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇪🇹 አማርኛ (Amharic)', 'set_lang_am'),
      Markup.button.callback('🇬🇧 English', 'set_lang_en'),
    ],
  ]);
}

function getMainMenuKeyboard(role, lang = 'en', includeLangButton = false) {
  if (role === 'pending') {
    return Markup.removeKeyboard();
  }

  const isAm = lang === 'am';
  const buttons = [];

  if (role === 'unregistered') {
    buttons.push([isAm ? '📝 እንደ አባል ይመዝገቡ' : '📝 Register as Member']);
    if (includeLangButton || isAm) {
      buttons.push(['🌐 ቋንቋ / Language']);
    }
    return Markup.keyboard(buttons).resize().persistent();
  }

  // Member buttons
  if (isAm) {
    buttons.push(['📊 ሁኔታዬ', '📜 ታሪኬ']);
    buttons.push(['👤 መገለጫዬ', '📤 ደረሰኝ ላክ']);
  } else {
    buttons.push(['📊 My Status', '📜 My History']);
    buttons.push(['👤 My Profile', '📤 Submit Receipt']);
  }

  // Treasurer / Admin buttons
  if (role === 'admin' || role === 'treasurer') {
    if (isAm) {
      buttons.push(['💰 ክፍያ መዝግብ', '📑 ወርሃዊ ሪፖርት']);
      buttons.push(['👥 የአባላት ዝርዝር', '⏳ ያልከፈሉ አባላት']);
      buttons.push(['📨 ማስታወሻ ላክ', '💳 ደረሰኝ አረጋግጥ']);
    } else {
      buttons.push(['💰 Record Payment', '📑 Monthly Report']);
      buttons.push(['👥 Members List', '⏳ Unpaid List']);
      buttons.push(['📨 Send Reminders', '💳 Verify Receipts']);
    }
  }

  // Admin exclusive buttons
  if (role === 'admin') {
    if (isAm) {
      buttons.push(['📥 ማጽደቂያዎች']);
      buttons.push(['➕ አባል መዝግብ', '🛑 አባል አግድ']);
      buttons.push(['⚙️ መዋጮ መጠን', '🛡️ ሚናዎች']);
      buttons.push(['🏦 የCBE ሂሳብ', '📁 CSV ኤክስፖርት']);
      buttons.push(['📢 መልእክት አሰራጭ', '🔍 ኦዲት መዝገብ']);
      buttons.push(['🔄 ክፍያ መልስ']);
    } else {
      buttons.push(['📥 Pending Approvals']);
      buttons.push(['➕ Add Member', '🛑 Deactivate Member']);
      buttons.push(['⚙️ Set Standard Amount', '🛡️ Manage Roles']);
      buttons.push(['🏦 Edit CBE Account', '📁 Export CSV']);
      buttons.push(['📢 Broadcast Message', '🔍 Audit Log']);
      buttons.push(['🔄 Reverse Payment']);
    }
  }

  if (includeLangButton || isAm) {
    buttons.push(['🌐 ቋንቋ / Language']);
  }

  return Markup.keyboard(buttons).resize().persistent();
}

function getMainMenuInlineKeyboard(role, lang = 'en') {
  if (role === 'pending') {
    return Markup.inlineKeyboard([]);
  }

  const isAm = lang === 'am';
  const buttons = [];

  if (role === 'unregistered') {
    buttons.push([Markup.button.callback(isAm ? '📝 እንደ አባል ይመዝገቡ' : '📝 Register as Member', 'start_self_register')]);
    buttons.push([Markup.button.callback('🌐 ቋንቋ / Language', 'menu_language')]);
    return Markup.inlineKeyboard(buttons);
  }

  // Member buttons
  if (isAm) {
    buttons.push([Markup.button.callback('📊 ሁኔታዬ', 'menu_mystatus'), Markup.button.callback('📜 ታሪኬ', 'menu_history')]);
    buttons.push([Markup.button.callback('👤 መገለጫዬ', 'menu_myprofile'), Markup.button.callback('📤 ደረሰኝ ላክ', 'menu_submit_payment')]);
  } else {
    buttons.push([Markup.button.callback('📊 My Status', 'menu_mystatus'), Markup.button.callback('📜 My History', 'menu_history')]);
    buttons.push([Markup.button.callback('👤 My Profile', 'menu_myprofile'), Markup.button.callback('📤 Submit Receipt', 'menu_submit_payment')]);
  }

  // Treasurer / Admin buttons
  if (role === 'admin' || role === 'treasurer') {
    if (isAm) {
      buttons.push([Markup.button.callback('💰 ክፍያ መዝግብ', 'menu_record_payment'), Markup.button.callback('📑 ወርሃዊ ሪፖርት', 'menu_report')]);
      buttons.push([Markup.button.callback('👥 የአባላት ዝርዝር', 'menu_members_page_1'), Markup.button.callback('⏳ ያልከፈሉ አባላት', 'menu_unpaid')]);
      buttons.push([Markup.button.callback('📨 ማስታወሻ ላክ', 'menu_remind'), Markup.button.callback('💳 ደረሰኝ አረጋግጥ', 'menu_submissions')]);
    } else {
      buttons.push([Markup.button.callback('💰 Record Payment', 'menu_record_payment'), Markup.button.callback('📑 Monthly Report', 'menu_report')]);
      buttons.push([Markup.button.callback('👥 Members List', 'menu_members_page_1'), Markup.button.callback('⏳ Unpaid List', 'menu_unpaid')]);
      buttons.push([Markup.button.callback('📨 Send Reminders', 'menu_remind'), Markup.button.callback('💳 Verify Receipts', 'menu_submissions')]);
    }
  }

  // Admin exclusive buttons
  if (role === 'admin') {
    if (isAm) {
      buttons.push([Markup.button.callback('📥 ማጽደቂያዎች', 'menu_approvals')]);
      buttons.push([Markup.button.callback('➕ አባል መዝግብ', 'menu_addmember'), Markup.button.callback('🛑 አባል አግድ', 'menu_deactivate')]);
      buttons.push([Markup.button.callback('⚙️ መዋጮ መጠን', 'menu_setamount'), Markup.button.callback('🛡️ ሚናዎች', 'menu_roles')]);
      buttons.push([Markup.button.callback('🏦 የCBE ሂሳብ', 'admin_edit_bankinfo'), Markup.button.callback('📁 CSV ኤክስፖርት', 'menu_export_csv')]);
      buttons.push([Markup.button.callback('📢 መልእክት አሰራጭ', 'menu_broadcast'), Markup.button.callback('🔍 ኦዲት መዝገብ', 'menu_audit')]);
      buttons.push([Markup.button.callback('🔄 ክፍያ መልስ', 'menu_reverse_payment')]);
    } else {
      buttons.push([Markup.button.callback('📥 Pending Approvals', 'menu_approvals')]);
      buttons.push([Markup.button.callback('➕ Add Member', 'menu_addmember'), Markup.button.callback('🛑 Deactivate Member', 'menu_deactivate')]);
      buttons.push([Markup.button.callback('⚙️ Set Standard Amount', 'menu_setamount'), Markup.button.callback('🛡️ Manage Roles', 'menu_roles')]);
      buttons.push([Markup.button.callback('🏦 Edit CBE Account', 'admin_edit_bankinfo'), Markup.button.callback('📁 Export CSV', 'menu_export_csv')]);
      buttons.push([Markup.button.callback('📢 Broadcast Message', 'menu_broadcast'), Markup.button.callback('🔍 Audit Log', 'menu_audit')]);
      buttons.push([Markup.button.callback('🔄 Reverse Payment', 'menu_reverse_payment')]);
    }
  }

  buttons.push([Markup.button.callback('🌐 ቋንቋ / Language', 'menu_language')]);

  return Markup.inlineKeyboard(buttons);
}

function getPaymentMethodKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🏦 CBE Transfer', 'paymethod_bank_transfer'),
      Markup.button.callback('📱 CBE Birr', 'paymethod_mobile_money'),
    ],
    [
      Markup.button.callback('❌ Cancel', 'action_cancel'),
    ],
  ]);
}

function getCancelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Cancel Operation', 'action_cancel')],
  ]);
}

function getCancelReplyKeyboard(lang = 'en') {
  return Markup.keyboard([
    [lang === 'am' ? '❌ ሰርዝ' : '❌ Cancel Operation']
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
  getLanguageSelectionKeyboard,
  getMainMenuKeyboard,
  getMainMenuInlineKeyboard,
  getPaymentMethodKeyboard,
  getCancelKeyboard,
  getCancelReplyKeyboard,
  getConfirmationKeyboard,
  getPaginationKeyboard,
};

