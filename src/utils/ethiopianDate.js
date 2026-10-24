/**
 * Ethiopian Calendar (ዓ.ም.) Conversion and Formatting Utilities
 *
 * Implements precise mathematical conversion between the Gregorian Calendar
 * and the Ethiopian Orthodox / Ge'ez Calendar (12 months of 30 days + Pagume of 5/6 days).
 */

const ETHIOPIAN_MONTHS = [
  { id: 1, am: 'መስከረም', en: 'Meskerem' },
  { id: 2, am: 'ጥቅምት', en: 'Tikimt' },
  { id: 3, am: 'ኅዳር', en: 'Hidar' },
  { id: 4, am: 'ታኅሣሥ', en: 'Tahsas' },
  { id: 5, am: 'ጥር', en: 'Tir' },
  { id: 6, am: 'የካቲት', en: 'Yekatit' },
  { id: 7, am: 'መጋቢት', en: 'Megabit' },
  { id: 8, am: 'ሚያዝያ', en: 'Miyazya' },
  { id: 9, am: 'ግንቦት', en: 'Ginbot' },
  { id: 10, am: 'ሰኔ', en: 'Sene' },
  { id: 11, am: 'ሐምሌ', en: 'Hamle' },
  { id: 12, am: 'ነሐሴ', en: 'Nehase' },
  { id: 13, am: 'ጳጉሜን', en: 'Pagume' },
];

/**
 * Gregorian (Y, M, D) to Julian Day Number (JDN)
 */
function gregorianToJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/**
 * Julian Day Number (JDN) to Ethiopian (year, month, day)
 */
function jdnToEthiopian(jdn) {
  const r = (jdn - 1723856) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year = 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

/**
 * Ethiopian (year, month, day) to Julian Day Number (JDN)
 */
function ethiopianToJdn(year, month, day) {
  return 1723855 + 365 * year + Math.floor(year / 4) + 30 * (month - 1) + day;
}

/**
 * Julian Day Number (JDN) to Gregorian (year, month, day)
 */
function jdnToGregorian(jdn) {
  const l = jdn + 68569;
  const n = Math.floor((4 * l) / 146097);
  const l1 = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l1 + 1)) / 1461001);
  const l2 = l1 - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l2) / 2447);
  const day = l2 - Math.floor((2447 * j) / 80);
  const l3 = Math.floor(j / 11);
  const month = j + 2 - 12 * l3;
  const year = 100 * (n - 49) + i + l3;
  return { year, month, day };
}

/**
 * Convert any Gregorian date input (Date, YYYY-MM-DD string) to Ethiopian Date
 */
function toEthiopianDate(dateInput) {
  let y, m, d;
  if (!dateInput) {
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth() + 1;
    d = now.getDate();
  } else if (dateInput instanceof Date) {
    y = dateInput.getFullYear();
    m = dateInput.getMonth() + 1;
    d = dateInput.getDate();
  } else if (typeof dateInput === 'string') {
    const parts = dateInput.trim().slice(0, 10).split('-');
    y = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    d = parseInt(parts[2] || '1', 10);
  } else {
    throw new Error(`Invalid date input: ${dateInput}`);
  }

  const jdn = gregorianToJdn(y, m, d);
  const eth = jdnToEthiopian(jdn);
  const monthMeta = ETHIOPIAN_MONTHS[eth.month - 1] || ETHIOPIAN_MONTHS[0];

  return {
    year: eth.year,
    month: eth.month,
    day: eth.day,
    monthNameAm: monthMeta.am,
    monthNameEn: monthMeta.en,
    formattedAm: `${monthMeta.am} ${eth.day} ቀን ${eth.year} ዓ.ም.`,
    formattedEn: `${monthMeta.en} ${eth.day}, ${eth.year} E.C.`,
  };
}

/**
 * Convert Ethiopian Date (year, month, day) to Gregorian Date
 */
function toGregorianDate(year, month, day) {
  const jdn = ethiopianToJdn(year, month, day);
  const greg = jdnToGregorian(jdn);
  const mm = String(greg.month).padStart(2, '0');
  const dd = String(greg.day).padStart(2, '0');
  return {
    year: greg.year,
    month: greg.month,
    day: greg.day,
    dateStr: `${greg.year}-${mm}-${dd}`,
  };
}

/**
 * Format a YYYY-MM period into dual Ethiopian & Gregorian representation
 * e.g. "2026-10" -> "ጥቅምት 2019 ዓ.ም. (2026-10)"
 */
function formatDualMonth(yearMonth) {
  if (!yearMonth || typeof yearMonth !== 'string') return yearMonth || '';
  const parts = yearMonth.split('-');
  if (parts.length < 2) return yearMonth;

  // Use the 15th of the month to reflect the predominant Ethiopian month of that monthly cycle
  const gregY = parseInt(parts[0], 10);
  const gregM = parseInt(parts[1], 10);
  const eth = toEthiopianDate(`${gregY}-${String(gregM).padStart(2, '0')}-15`);

  return `${eth.monthNameAm} ${eth.year} ዓ.ም. (${yearMonth})`;
}

/**
 * Format a YYYY-MM-DD date into dual Ethiopian & Gregorian representation
 * e.g. "2026-10-24" -> "ጥቅምት 14, 2019 ዓ.ም. (2026-10-24)"
 */
function formatDualDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return dateStr || '';
  const clean = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return dateStr;

  const eth = toEthiopianDate(clean);
  return `${eth.monthNameAm} ${eth.day}, ${eth.year} ዓ.ም. (${clean})`;
}

/**
 * Get current date in Ethiopian Calendar
 */
function getEthiopianToday() {
  return toEthiopianDate(new Date());
}

module.exports = {
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
};
