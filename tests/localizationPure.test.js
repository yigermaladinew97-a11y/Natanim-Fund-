const test = require('node:test');
const assert = require('node:assert');

const { formatPeriod, formatDate } = require('../src/utils/ethiopianDate');
const { formatStatus, formatPaymentMethod } = require('../src/utils/formatters');
const { getBankInfo } = require('../src/services/accounting');
const { buildReminderMessage } = require('../src/services/reminders');

test('Pure Amharic vs Pure English Localization & Message Simplicity Tests', async (t) => {
  await t.test('1. formatPeriod formats pure Amharic and pure English without mixed slashes', () => {
    const amPeriod = formatPeriod('2026-10', 'am');
    assert.strictEqual(amPeriod, 'ጥቅምት 2019 ዓ.ም.');
    assert.ok(!amPeriod.includes('/'), 'Amharic period must not contain slash-divided text');

    const enPeriod = formatPeriod('2026-10', 'en');
    assert.strictEqual(enPeriod, 'October 2026');
    assert.ok(!enPeriod.includes('ዓ.ም.'), 'English period must not contain Amharic text');
  });

  await t.test('2. formatDate formats pure Amharic and pure English dates', () => {
    const amDate = formatDate('2026-10-24', 'am');
    assert.strictEqual(amDate, 'ጥቅምት 14, 2019 ዓ.ም.');

    const enDate = formatDate('2026-10-24', 'en');
    assert.strictEqual(enDate, 'October 24, 2026');
  });

  await t.test('3. formatStatus renders purely localized statuses', () => {
    assert.strictEqual(formatStatus('FULLY_PAID', 'am'), '🟢 ሙሉ በሙሉ የተከፈለ');
    assert.strictEqual(formatStatus('FULLY_PAID', 'en'), '🟢 Fully Paid');

    assert.strictEqual(formatStatus('PARTIALLY_PAID', 'am'), '🟡 በከፊል የተከፈለ');
    assert.strictEqual(formatStatus('PARTIALLY_PAID', 'en'), '🟡 Partially Paid');

    assert.strictEqual(formatStatus('OVERDUE', 'am'), '⏰ ያለፈበት');
    assert.strictEqual(formatStatus('OVERDUE', 'en'), '⏰ Overdue');

    assert.strictEqual(formatStatus('UNPAID', 'am'), '🔴 ያልተከፈለ');
    assert.strictEqual(formatStatus('UNPAID', 'en'), '🔴 Unpaid');
  });

  await t.test('4. formatPaymentMethod renders purely localized methods', () => {
    assert.strictEqual(formatPaymentMethod('bank_transfer', 'am'), '🏦 የባንክ ሂሳብ (CBE)');
    assert.strictEqual(formatPaymentMethod('bank_transfer', 'en'), '🏦 CBE Transfer');

    assert.strictEqual(formatPaymentMethod('mobile_money', 'am'), '📱 ሲቢኢ ብር (CBE Birr)');
    assert.strictEqual(formatPaymentMethod('mobile_money', 'en'), '📱 CBE Birr');
  });

  await t.test('5. getBankInfo renders concise, pure Amharic for "am" and English for "en"', () => {
    const amBank = getBankInfo('am');
    assert.ok(amBank.includes('የናታኒም ፈንድ የባንክ ሂሳብ'));
    assert.ok(amBank.includes('ቀላል መመሪያ'));

    const enBank = getBankInfo('en');
    assert.ok(enBank.includes('Natanim Fund — CBE Account'));
    assert.ok(enBank.includes('Instructions'));
  });

  await t.test('6. buildReminderMessage outputs simple, pure Amharic for "am" and pure English for "en"', () => {
    const amMsg = buildReminderMessage({
      fullName: 'ዮናስ አበበ',
      month: '2026-10',
      balanceFormatted: '50.00 ETB',
      totalOutstandingFormatted: null,
      hasOlderDues: false,
      dueDate: '2026-11-08',
      cbeAccountNum: '1000123456789',
      cbeAccountName: 'Arba Minch Fellowship',
      lang: 'am',
    });

    assert.ok(amMsg.includes('ሰላም <b>ዮናስ አበበ</b>'));
    assert.ok(amMsg.includes('ጥቅምት 2019 ዓ.ም.'));
    assert.ok(amMsg.includes('የሚከፈል፦'));
    assert.ok(amMsg.includes('ደረሰኝ ላክ'));
    assert.ok(!amMsg.includes('Due Date:'));
    assert.ok(!amMsg.includes('Member:'));

    const enMsg = buildReminderMessage({
      fullName: 'Yonas Abebe',
      month: '2026-10',
      balanceFormatted: '50.00 ETB',
      totalOutstandingFormatted: null,
      hasOlderDues: false,
      dueDate: '2026-11-08',
      cbeAccountNum: '1000123456789',
      cbeAccountName: 'Arba Minch Fellowship',
      lang: 'en',
    });

    assert.ok(enMsg.includes('Greetings <b>Yonas Abebe</b>'));
    assert.ok(enMsg.includes('October 2026'));
    assert.ok(enMsg.includes('Amount Due:'));
    assert.ok(enMsg.includes('Submit Receipt'));
    assert.ok(!enMsg.includes('ሰላም'));
    assert.ok(!enMsg.includes('የሚከፈል'));
  });
});
