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
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(getNextMonth(startYearMonth, i));
  }
  return list;
}

function getDueDateForMonth(yearMonth, dueDay = 10) {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  
  // Handle months with fewer days than dueDay
  const daysInMonth = new Date(year, month, 0).getDate();
  const actualDay = Math.min(dueDay, daysInMonth);
  
  return `${yearStr}-${monthStr}-${String(actualDay).padStart(2, '0')}`;
}

function formatStatus(status) {
  switch (status) {
    case 'FULLY_PAID':
      return '🟢 Fully Paid';
    case 'PARTIALLY_PAID':
      return '🟡 Partially Paid';
    case 'OVERDUE':
      return '⏰ Overdue';
    case 'UNPAID':
    default:
      return '🔴 Unpaid';
  }
}

function formatPaymentMethod(method) {
  switch (method) {
    case 'cash':
      return '💵 Cash';
    case 'bank_transfer':
      return '🏦 Bank Transfer';
    case 'mobile_money':
      return '📱 Mobile Money';
    default:
      return method || 'Unknown';
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
  toEthiopianDate,
  getEthiopianToday,
} = require('./ethiopianDate');

module.exports = {
  formatMoney,
  parseMoneyToCents,
  getCurrentYearMonth,
  getNextMonth,
  getNextMonthsList,
  getDueDateForMonth,
  formatStatus,
  formatPaymentMethod,
  escapeHtml,
  formatDualMonth,
  formatDualDate,
  toEthiopianDate,
  getEthiopianToday,
};

