const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { getUserLanguage, setUserLanguage, t } = require('../src/services/i18n');
const {
  getMainMenuKeyboard,
  getMainMenuInlineKeyboard,
  getLanguageSelectionKeyboard,
  getCancelReplyKeyboard,
} = require('../src/utils/keyboards');

const TEST_DB_PATH = path.join(__dirname, 'test_i18n.db');

function cleanup() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

test('Internationalization (i18n) & Bilingual Language Selection Tests', async (suite) => {
  cleanup();
  initDatabase(TEST_DB_PATH);

  await suite.test('1. Default language lookup returns null for unset user, and fallback to amharic for null id', () => {
    assert.strictEqual(getUserLanguage('999999999'), null);
    assert.strictEqual(getUserLanguage(null), 'am');
  });

  await suite.test('2. Setting user language persists in SQLite and can be retrieved', () => {
    const userId = '123456789';
    const lang = setUserLanguage(userId, 'am');
    assert.strictEqual(lang, 'am');
    assert.strictEqual(getUserLanguage(userId), 'am');

    // Switch to English
    const updated = setUserLanguage(userId, 'en');
    assert.strictEqual(updated, 'en');
    assert.strictEqual(getUserLanguage(userId), 'en');
  });

  await suite.test('3. Translation dictionary t() formats strings correctly with parameter interpolation', () => {
    const amText = t('am', 'welcome_member', { name: 'ዳንኤል' });
    assert.ok(amText.includes('ዳንኤል'));
    assert.ok(amText.includes('ናታኒም'));

    const enText = t('en', 'welcome_member', { name: 'Daniel' });
    assert.ok(enText.includes('Daniel'));
    assert.ok(enText.includes('Natanim'));

    // Missing key returns key name
    assert.strictEqual(t('am', 'unknown_key_xyz'), 'unknown_key_xyz');
  });

  await suite.test('4. Language selection inline keyboard renders Amharic and English options', () => {
    const kb = getLanguageSelectionKeyboard();
    assert.ok(kb.reply_markup.inline_keyboard);
    const row = kb.reply_markup.inline_keyboard[0];
    assert.strictEqual(row.length, 2);
    assert.ok(row[0].text.includes('አማርኛ'));
    assert.strictEqual(row[0].callback_data, 'set_lang_am');
    assert.ok(row[1].text.includes('English'));
    assert.strictEqual(row[1].callback_data, 'set_lang_en');
  });

  await suite.test('5. Amharic Reply Keyboards render pure Ge\'ez/Amharic buttons', () => {
    const memberAmKb = getMainMenuKeyboard('member', 'am');
    const flatAm = memberAmKb.reply_markup.keyboard.flat();
    assert.ok(flatAm.includes('📊 ሁኔታዬ'));
    assert.ok(flatAm.includes('📜 ታሪኬ'));
    assert.ok(flatAm.includes('👤 መገለጫዬ'));
    assert.ok(flatAm.includes('📤 ደረሰኝ ላክ'));
    assert.ok(flatAm.includes('🌐 ቋንቋ'));

    const adminAmKb = getMainMenuKeyboard('admin', 'am');
    const flatAdminAm = adminAmKb.reply_markup.keyboard.flat();
    assert.ok(flatAdminAm.includes('💰 ክፍያ መዝግብ'));
    assert.ok(flatAdminAm.includes('📑 ወርሃዊ ሪፖርት'));
    assert.ok(flatAdminAm.includes('👥 የአባላት ዝርዝር'));
    assert.ok(flatAdminAm.includes('⏳ ያልከፈሉ አባላት'));
    assert.ok(flatAdminAm.includes('📥 ማጽደቂያዎች'));
    assert.ok(flatAdminAm.includes('➕ አባል መዝግብ'));
    assert.ok(flatAdminAm.includes('🛑 አባል አግድ'));
    assert.ok(flatAdminAm.includes('⚙️ መዋጮ መጠን'));
    assert.ok(flatAdminAm.includes('🛡️ ሚናዎች'));
    assert.ok(flatAdminAm.includes('🏦 የCBE ሂሳብ'));
    assert.ok(flatAdminAm.includes('📁 CSV ኤክስፖርት'));
    assert.ok(flatAdminAm.includes('📢 መልእክት አሰራጭ'));
    assert.ok(flatAdminAm.includes('🔍 ኦዲት መዝገብ'));
    assert.ok(flatAdminAm.includes('🔄 ክፍያ መልስ'));
  });

  await suite.test('6. English Reply Keyboards maintain existing backward compatibility', () => {
    const memberEnKb = getMainMenuKeyboard('member', 'en');
    const flatEn = memberEnKb.reply_markup.keyboard.flat();
    assert.ok(flatEn.includes('📊 My Status'));
    assert.ok(flatEn.includes('📜 My History'));
    assert.ok(flatEn.includes('👤 My Profile'));
    assert.ok(flatEn.includes('📤 Submit Receipt'));

    const adminEnKb = getMainMenuKeyboard('admin', 'en');
    const flatAdminEn = adminEnKb.reply_markup.keyboard.flat();
    assert.ok(flatAdminEn.includes('💰 Record Payment'));
    assert.ok(flatAdminEn.includes('📥 Pending Approvals'));
    assert.ok(flatAdminEn.includes('➕ Add Member'));
  });

  await suite.test('7. Cancel Reply Keyboard supports both Amharic and English', () => {
    const cancelAm = getCancelReplyKeyboard('am');
    assert.deepStrictEqual(cancelAm.reply_markup.keyboard, [['❌ ሰርዝ']]);

    const cancelEn = getCancelReplyKeyboard('en');
    assert.deepStrictEqual(cancelEn.reply_markup.keyboard, [['❌ Cancel Operation']]);
  });

  await suite.test('8. Inline Keyboards support Amharic localization', () => {
    const inlineAm = getMainMenuInlineKeyboard('member', 'am');
    const flatInlineAm = inlineAm.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.ok(flatInlineAm.includes('📊 ሁኔታዬ'));
    assert.ok(flatInlineAm.includes('📜 ታሪኬ'));
    assert.ok(flatInlineAm.includes('👤 መገለጫዬ'));
    assert.ok(flatInlineAm.includes('📤 ደረሰኝ ላክ'));
  });

  cleanup();
});
