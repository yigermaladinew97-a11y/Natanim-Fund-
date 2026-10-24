const test = require('node:test');
const assert = require('node:assert');
const {
  ETHIOPIAN_MONTHS,
  gregorianToJdn,
  jdnToEthiopian,
  ethiopianToJdn,
  jdnToGregorian,
  toEthiopianDate,
  toGregorianDate,
  formatDualMonth,
  formatDualDate,
  getEthiopianToday,
} = require('../src/utils/ethiopianDate');

test('Ethiopian Calendar (ዓ.ም.) Conversion & Formatting Unit Tests', async (t) => {
  await t.test('1. All 13 Ethiopian months are correctly defined in Geez/Amharic and English', () => {
    assert.strictEqual(ETHIOPIAN_MONTHS.length, 13);
    assert.strictEqual(ETHIOPIAN_MONTHS[0].am, 'መስከረም');
    assert.strictEqual(ETHIOPIAN_MONTHS[1].am, 'ጥቅምት');
    assert.strictEqual(ETHIOPIAN_MONTHS[2].am, 'ኅዳር');
    assert.strictEqual(ETHIOPIAN_MONTHS[12].am, 'ጳጉሜን');
  });

  await t.test('2. Converts Ethiopian New Year (Enkutatash) accurately', () => {
    // 2026-09-11 is 1 Meskerem 2019 E.C.
    const eth = toEthiopianDate('2026-09-11');
    assert.strictEqual(eth.year, 2019);
    assert.strictEqual(eth.month, 1);
    assert.strictEqual(eth.day, 1);
    assert.strictEqual(eth.monthNameAm, 'መስከረም');
    assert.strictEqual(eth.formattedAm, 'መስከረም 1 ቀን 2019 ዓ.ም.');
  });

  await t.test('3. Converts current date (2026-10-24) to 14 Tikimt 2019 accurately', () => {
    const eth = toEthiopianDate('2026-10-24');
    assert.strictEqual(eth.year, 2019);
    assert.strictEqual(eth.month, 2);
    assert.strictEqual(eth.day, 14);
    assert.strictEqual(eth.monthNameAm, 'ጥቅምት');
    assert.strictEqual(eth.formattedAm, 'ጥቅምት 14 ቀን 2019 ዓ.ም.');
  });

  await t.test('4. Converts round-trip between Ethiopian and Gregorian calendars', () => {
    // Meskerem 1, 2019 E.C. -> 2026-09-11
    const greg1 = toGregorianDate(2019, 1, 1);
    assert.strictEqual(greg1.dateStr, '2026-09-11');

    // Tikimt 14, 2019 E.C. -> 2026-10-24
    const greg2 = toGregorianDate(2019, 2, 14);
    assert.strictEqual(greg2.dateStr, '2026-10-24');
  });

  await t.test('5. formatDualMonth formats period with Ethiopian month and Gregorian period', () => {
    const period1 = formatDualMonth('2026-10');
    assert.ok(period1.includes('ጥቅምት 2019 ዓ.ም.'));
    assert.ok(period1.includes('(2026-10)'));

    const period2 = formatDualMonth('2026-09');
    assert.ok(period2.includes('መስከረም 2019 ዓ.ም.'));
    assert.ok(period2.includes('(2026-09)'));
  });

  await t.test('6. formatDualDate formats full dates in both calendars', () => {
    const formatted = formatDualDate('2026-10-24');
    assert.strictEqual(formatted, 'ጥቅምት 14, 2019 ዓ.ም. (2026-10-24)');
  });

  await t.test('7. getEthiopianToday returns valid today structure', () => {
    const today = getEthiopianToday();
    assert.ok(today.year >= 2015 && today.year <= 2030);
    assert.ok(today.month >= 1 && today.month <= 13);
    assert.ok(today.day >= 1 && today.day <= 30);
    assert.ok(today.formattedAm.includes('ዓ.ም.'));
  });
});
