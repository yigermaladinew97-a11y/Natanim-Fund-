const test = require('node:test');
const assert = require('node:assert');
const {
  getMainMenuKeyboard,
  getMainMenuInlineKeyboard,
  getPaymentMethodKeyboard,
  getCancelKeyboard,
  getCancelReplyKeyboard,
  getConfirmationKeyboard,
  getPaginationKeyboard,
} = require('../src/utils/keyboards');

test('Keyboards & Menu Button Utilities Tests', async (t) => {
  await t.test('1. Member role generates persistent Reply Keyboard with 3 buttons', () => {
    const kb = getMainMenuKeyboard('member');
    assert.ok(kb.reply_markup);
    assert.ok(kb.reply_markup.keyboard);
    assert.strictEqual(kb.reply_markup.resize_keyboard, true);
    assert.strictEqual(kb.reply_markup.is_persistent, true);

    const rows = kb.reply_markup.keyboard;
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], ['📊 My Status', '📜 My History']);
    assert.deepStrictEqual(rows[1], ['👤 My Profile']);
  });

  await t.test('2. Treasurer role includes staff management menu buttons', () => {
    const kb = getMainMenuKeyboard('treasurer');
    assert.ok(kb.reply_markup.keyboard);
    const flat = kb.reply_markup.keyboard.flat();
    assert.ok(flat.includes('📊 My Status'));
    assert.ok(flat.includes('💰 Record Payment'));
    assert.ok(flat.includes('📑 Monthly Report'));
    assert.ok(flat.includes('👥 Members List'));
    assert.ok(flat.includes('⏳ Unpaid List'));
    assert.ok(flat.includes('📨 Send Reminders'));
    // Should NOT have admin-only buttons
    assert.strictEqual(flat.includes('➕ Add Member'), false);
    assert.strictEqual(flat.includes('🛡️ Manage Roles'), false);
  });

  await t.test('3. Admin role includes all member, staff, and admin menu buttons', () => {
    const kb = getMainMenuKeyboard('admin');
    assert.ok(kb.reply_markup.keyboard);
    const flat = kb.reply_markup.keyboard.flat();
    assert.ok(flat.includes('📊 My Status'));
    assert.ok(flat.includes('💰 Record Payment'));
    assert.ok(flat.includes('➕ Add Member'));
    assert.ok(flat.includes('🛑 Deactivate Member'));
    assert.ok(flat.includes('⚙️ Set Standard Amount'));
    assert.ok(flat.includes('🛡️ Manage Roles'));
    assert.ok(flat.includes('🔄 Reverse Payment'));
    assert.ok(flat.includes('📁 Export CSV'));
    assert.ok(flat.includes('🔍 Audit Log'));
  });

  await t.test('4. Cancel Reply Keyboard generates clean 1-button keyboard', () => {
    const kb = getCancelReplyKeyboard();
    assert.ok(kb.reply_markup.keyboard);
    assert.strictEqual(kb.reply_markup.resize_keyboard, true);
    assert.deepStrictEqual(kb.reply_markup.keyboard, [['❌ Cancel Operation']]);
  });

  await t.test('5. Inline Keyboards (confirmation, payment method, pagination) remain functional', () => {
    const payMethodKb = getPaymentMethodKeyboard();
    assert.ok(payMethodKb.reply_markup.inline_keyboard);

    const confirmKb = getConfirmationKeyboard('action_confirm');
    assert.ok(confirmKb.reply_markup.inline_keyboard);
    assert.strictEqual(confirmKb.reply_markup.inline_keyboard[0][0].callback_data, 'action_confirm');

    const paginationKb = getPaginationKeyboard('page_prefix', 2, 5);
    assert.ok(paginationKb.reply_markup.inline_keyboard);
    const buttons = paginationKb.reply_markup.inline_keyboard[0];
    assert.strictEqual(buttons[0].text, '⬅️ Prev');
    assert.strictEqual(buttons[1].text, '📄 2/5');
    assert.strictEqual(buttons[2].text, 'Next ➡️');
  });
});
