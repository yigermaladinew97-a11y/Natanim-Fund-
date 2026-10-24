const { getDatabase } = require('../db');

const MESSAGES = {
  am: {
    welcome_header: '🕊️ <b>ወደ ናታኒም ፈንድ ቦት በደህና መጡ!</b>\n<i>የቤተክርስቲያን ወርሃዊ መዋጮ አስተዳደር ሥርዓት</i>',
    choose_language: '🌐 <b>እባክዎ የሚመርጡትን ቋንቋ ይምረጡ / Please choose your preferred language:</b>',
    language_set_confirm: '✅ <b>ቋንቋ ወደ አማርኛ ተቀይሯል!</b>\nየቦቱ ምናሌዎችና መልእክቶች በአማርኛ ይቀርባሉ።',
    main_menu: '🏠 <b>ዋና ምናሌ</b>',
    welcome_member: 'ሰላም <b>{name}</b>! እንኳን ወደ ናታኒም ፈንድ በደህና መጡ።\nከታች ያሉትን ቁልፎች በመጠቀም ሁኔታዎን መከታተል ወይም ደረሰኝ መላክ ይችላሉ።',
    welcome_unregistered: 'እንኳን በደህና መጡ! ወደ ፈንዱ ለመቀላቀል ከታች ያለውን <b>📝 እንደ አባል ይመዝገቡ</b> ቁልፍ ይጫኑ።',
    welcome_pending: '⏳ <b>የምዝገባ ጥያቄዎ በመጠባበቅ ላይ ነው!</b>\nየአስተዳዳሪዎችን ማረጋገጫ በትዕግስት ይጠብቁ።',
    cancel_op: '❌ ክዋኔው ተሰርዟል።',
    
    // Buttons
    btn_my_status: '📊 ሁኔታዬ',
    btn_my_history: '📜 ታሪኬ',
    btn_my_profile: '👤 መገለጫዬ',
    btn_submit_receipt: '📤 ደረሰኝ ላክ',
    btn_bank_accounts: '🏦 የCBE ሂሳብ',
    btn_language: '🌐 ቋንቋ / Language',
    btn_register: '📝 እንደ አባል ይመዝገቡ',
    btn_record_payment: '💰 ክፍያ መዝግብ',
    btn_monthly_report: '📑 ወርሃዊ ሪፖርት',
    btn_members_list: '👥 የአባላት ዝርዝር',
    btn_unpaid_list: '⏳ ያልከፈሉ አባላት',
    btn_send_reminders: '📨 ማስታወሻ ላክ',
    btn_verify_receipts: '💳 ደረሰኝ አረጋግጥ',
    btn_pending_approvals: '📥 ማጽደቂያዎች',
    btn_add_member: '➕ አባል መዝግብ',
    btn_deactivate_member: '🛑 አባል አግድ',
    btn_set_standard_amount: '⚙️ መዋጮ መጠን',
    btn_manage_roles: '🛡️ ሚናዎች',
    btn_export_csv: '📁 CSV ኤክስፖርት',
    btn_broadcast: '📢 መልእክት አሰራጭ',
    btn_audit_log: '🔍 ኦዲት መዝገብ',
    btn_reverse_payment: '🔄 ክፍያ መልስ',
    btn_cancel: '❌ ሰርዝ',
  },
  en: {
    welcome_header: '🕊️ <b>Welcome to Natanim Fund Bot!</b>\n<i>Church Monthly Contribution Management System</i>',
    choose_language: '🌐 <b>Please choose your preferred language / እባክዎ የሚመርጡትን ቋንቋ ይምረጡ:</b>',
    language_set_confirm: '✅ <b>Language set to English!</b>\nBot menus and instructions will appear in English.',
    main_menu: '🏠 <b>Main Menu</b>',
    welcome_member: 'Hello <b>{name}</b>! Welcome to Natanim Fund.\nUse the menu buttons below to manage your contributions.',
    welcome_unregistered: 'Welcome! Tap <b>📝 Register as Member</b> below to join the church fund.',
    welcome_pending: '⏳ <b>Your registration request is under review!</b>\nPlease wait for administrator approval.',
    cancel_op: '❌ Operation cancelled.',

    // Buttons
    btn_my_status: '📊 My Status',
    btn_my_history: '📜 My History',
    btn_my_profile: '👤 My Profile',
    btn_submit_receipt: '📤 Submit Receipt',
    btn_bank_accounts: '🏦 Bank Accounts',
    btn_language: '🌐 Language / ቋንቋ',
    btn_register: '📝 Register as Member',
    btn_record_payment: '💰 Record Payment',
    btn_monthly_report: '📑 Monthly Report',
    btn_members_list: '👥 Members List',
    btn_unpaid_list: '⏳ Unpaid List',
    btn_send_reminders: '📨 Send Reminders',
    btn_verify_receipts: '💳 Verify Receipts',
    btn_pending_approvals: '📥 Pending Approvals',
    btn_add_member: '➕ Add Member',
    btn_deactivate_member: '🛑 Deactivate Member',
    btn_set_standard_amount: '⚙️ Set Standard Amount',
    btn_manage_roles: '🛡️ Manage Roles',
    btn_export_csv: '📁 Export CSV',
    btn_broadcast: '📢 Broadcast Message',
    btn_audit_log: '🔍 Audit Log',
    btn_reverse_payment: '🔄 Reverse Payment',
    btn_cancel: '❌ Cancel Operation',
  },
};

function getUserLanguage(telegramId) {
  if (!telegramId) return 'am';
  const db = getDatabase();
  const row = db.prepare('SELECT language FROM user_preferences WHERE telegram_id = ?').get(String(telegramId));
  return row ? row.language : null;
}

function setUserLanguage(telegramId, lang) {
  const cleanLang = lang === 'en' ? 'en' : 'am';
  const db = getDatabase();
  db.prepare(`
    INSERT INTO user_preferences (telegram_id, language, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(telegram_id) DO UPDATE SET language = excluded.language, updated_at = datetime('now')
  `).run(String(telegramId), cleanLang);
  return cleanLang;
}

function t(lang, key, params = {}) {
  const selectedLang = lang === 'en' ? 'en' : 'am';
  let text = (MESSAGES[selectedLang] && MESSAGES[selectedLang][key]) || (MESSAGES['en'] && MESSAGES['en'][key]) || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return text;
}

module.exports = {
  getUserLanguage,
  setUserLanguage,
  t,
  MESSAGES,
};
