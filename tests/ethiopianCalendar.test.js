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
  isAcademicMonth,
  getNextAcademicMonth,
  getNextAcademicMonthsList,
} = require('../src/utils/ethiopianDate');
const { getDueDateForMonth } = require('../src/utils/formatters');

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

  await t.test('8. isAcademicMonth validates October to June (ጥቅምት እስከ ሰኔ) and excludes summer break', () => {
    // 9 active academic campus months (October to June)
    const academic = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'];
    for (const m of academic) {
      assert.strictEqual(isAcademicMonth(m), true, `Expected ${m} to be an academic month`);
    }

    // 3 summer vacation break months (July, August, September / ሐምሌ፣ ነሐሴ፣ መስከረም)
    const vacation = ['2027-07', '2027-08', '2027-09'];
    for (const m of vacation) {
      assert.strictEqual(isAcademicMonth(m), false, `Expected ${m} to be a vacation month`);
    }
  });

  await t.test('9. getNextAcademicMonth navigates across academic year skipping summer vacation', () => {
    // Advancing from June (2026-06) jumps summer vacation straight to October (2026-10)
    assert.strictEqual(getNextAcademicMonth('2026-06', 1), '2026-10');

    // Regressing from October (2026-10) goes back to previous academic June (2026-06)
    assert.strictEqual(getNextAcademicMonth('2026-10', -1), '2026-06');

    // Regular consecutive months
    assert.strictEqual(getNextAcademicMonth('2026-10', 1), '2026-11');
    assert.strictEqual(getNextAcademicMonth('2026-12', 1), '2027-01');
  });

  await t.test('10. getNextAcademicMonthsList generates consecutive academic months', () => {
    // Full 9-month university academic year
    const fullYear = getNextAcademicMonthsList('2026-10', 9);
    assert.strictEqual(fullYear.length, 9);
    assert.deepStrictEqual(fullYear, [
      '2026-10', '2026-11', '2026-12',
      '2027-01', '2027-02', '2027-03',
      '2027-04', '2027-05', '2027-06',
    ]);

    // Crossing summer vacation boundary (e.g. 3 months starting from May 2027)
    const crossBreak = getNextAcademicMonthsList('2027-05', 3);
    assert.deepStrictEqual(crossBreak, ['2027-05', '2027-06', '2027-10']);
  });

  await t.test('11. getDueDateForMonth calculates due date as the 30th day of the Ethiopian month (e.g. Tikimt 30 for October)', () => {
    // 2026-10 is Tikimt (ጥቅምት 2019 E.C.). Due date on day 30 of EC month must be Tikimt 30 (2026-11-09)
    const dueDateOct = getDueDateForMonth('2026-10');
    assert.strictEqual(dueDateOct, '2026-11-09');
    assert.strictEqual(formatDualDate(dueDateOct), 'ጥቅምት 30, 2019 ዓ.ም. (2026-11-09)');

    // Custom due day e.g. 15th of the EC month
    const dueDateMidOct = getDueDateForMonth('2026-10', 15);
    assert.strictEqual(dueDateMidOct, '2026-10-25');
    assert.strictEqual(formatDualDate(dueDateMidOct), 'ጥቅምት 15, 2019 ዓ.ም. (2026-10-25)');

    // 2026-11 is Hidar (ኅዳር 2019 E.C.). Due date on day 30 of EC month must be Hidar 30 (2026-12-09)
    const dueDateNov = getDueDateForMonth('2026-11');
    assert.strictEqual(dueDateNov, '2026-12-09');
    assert.strictEqual(formatDualDate(dueDateNov), 'ኅዳር 30, 2019 ዓ.ም. (2026-12-09)');
  });
});
