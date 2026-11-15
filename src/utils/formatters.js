/**
 * Formatting utilities for currency, dates, and statuses
 */

function formatMoney(cents, currency = 'ETB') {
  if (cents === null || cents === undefined || Number.isNaN(cents)) {
    cents = 0;
  }
  const numericCents = Number(cents);
  const formatted = (numericCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}

function parseMoneyToCents(amountStr) {
  if (typeof amountStr !== 'string' && typeof amountStr !== 'number') {
    return null;
  }
  const clean = String(amountStr).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    return null;
  }
  const floatVal = parseFloat(clean);
  if (Number.isNaN(floatVal) || floatVal <= 0) {
    return null;
  }
  return Math.round(floatVal * 100);
}

function getCurrentYearMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getNextMonth(yearMonth, offset = 1) {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  const newY = date.getUTCFullYear();
  const newM = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${newY}-${newM}`;
}

function getNextMonthsList(startYearMonth, count = 1) {
  return getNextAcademicMonthsList(startYearMonth, count);
}

function getDueDateForMonth(yearMonth, dueDay = 30) {
  if (!yearMonth || typeof yearMonth !== 'string') return '';
  const parts = yearMonth.split('-');
  if (parts.length < 2) return yearMonth;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);

  // Map to the Ethiopian month corresponding to this period (sampled on the 15th)
  const eth = toEthiopianDate(`${year}-${String(month).padStart(2, '0')}-15`);
  const maxDay = eth.month === 13 ? (eth.year % 4 === 3 ? 6 : 5) : 30;
  const dayInEth = Math.min(Math.max(1, dueDay), maxDay);

  const greg = toGregorianDate(eth.year, eth.month, dayInEth);
  return greg.dateStr;
}

function formatStatus(status, lang = 'en') {
  const isAm = lang === 'am';
  switch (status) {
    case 'FULLY_PAID':
      return isAm ? '🟢 ሙሉ በሙሉ የተከፈለ' : '🟢 Fully Paid';
    case 'PARTIALLY_PAID':
      return isAm ? '🟡 በከፊል የተከፈለ' : '🟡 Partially Paid';
    case 'OVERDUE':
      return isAm ? '⏰ ያለፈበት' : '⏰ Overdue';
    case 'UNPAID':
    default:
      return isAm ? '🔴 ያልተከፈለ' : '🔴 Unpaid';
  }
}

function formatPaymentMethod(method, lang = 'en') {
  const isAm = lang === 'am';
  switch (method) {
    case 'cash':
      return isAm ? '💵 በጥሬ ገንዘብ' : '💵 Cash';
    case 'bank_transfer':
      return isAm ? '🏦 የባንክ ሂሳብ (CBE)' : '🏦 CBE Transfer';
    case 'mobile_money':
    case 'cbe_birr':
      return isAm ? '📱 ሲቢኢ ብር (CBE Birr)' : '📱 CBE Birr';
    default:
      return method || (isAm ? 'የባንክ ሂሳብ' : 'CBE');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const {
  formatDualMonth,
  formatDualDate,
  formatPeriod,
  formatDate,
  toEthiopianDate,
  toGregorianDate,
  getEthiopianToday,
  isAcademicMonth,
  getNextAcademicMonth,
  getNextAcademicMonthsList,
} = require('./ethiopianDate');

module.exports = {
  formatMoney,
  parseMoneyToCents,
  getCurrentYearMonth,
  getNextMonth,
  getNextMonthsList,
  getNextAcademicMonth,
  getNextAcademicMonthsList,
  isAcademicMonth,
  getDueDateForMonth,
  formatStatus,
  formatPaymentMethod,
  escapeHtml,
  formatDualMonth,
  formatDualDate,
  formatPeriod,
  formatDate,
  toEthiopianDate,
  getEthiopianToday,
};

