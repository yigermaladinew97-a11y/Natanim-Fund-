const { getDatabase } = require('../db');
const { generateCsv } = require('../utils/csv');
const { formatMoney, formatStatus, formatPaymentMethod } = require('../utils/formatters');
const { getCurrency } = require('./accounting');

function getMonthlyReportSummary(yearMonth) {
  const db = getDatabase();
  const currency = getCurrency();

  // Active members count
  const activeMembersCount = db.prepare("SELECT COUNT(*) AS count FROM members WHERE status = 'active'").get().count;

  // Obligations counts & sums for the month
  const oblSummary = db.prepare(`
    SELECT
      COUNT(*) AS total_obligations,
      SUM(CASE WHEN o.status = 'FULLY_PAID' THEN 1 ELSE 0 END) AS fully_paid_count,
      SUM(CASE WHEN o.status = 'PARTIALLY_PAID' THEN 1 ELSE 0 END) AS partially_paid_count,
      SUM(CASE WHEN o.status IN ('UNPAID', 'OVERDUE') THEN 1 ELSE 0 END) AS unpaid_count,
      COALESCE(SUM(o.amount_due_cents), 0) AS total_expected_cents,
      COALESCE(SUM(o.amount_paid_cents), 0) AS total_collected_cents
    FROM obligations o
    JOIN members m ON o.member_id = m.id
    WHERE o.year_month = ? AND m.status = 'active'
  `).get(yearMonth);

  const totalExpectedCents = oblSummary.total_expected_cents;
  const totalCollectedCents = oblSummary.total_collected_cents;
  const totalOutstandingCents = Math.max(0, totalExpectedCents - totalCollectedCents);

  // Group by payment method for valid, non-reversed payments for this month
  const methodBreakdown = db.prepare(`
    SELECT
      p.payment_method,
      COUNT(p.id) AS tx_count,
      COALESCE(SUM(p.amount_cents), 0) AS total_cents
    FROM payments p
    JOIN obligations o ON p.obligation_id = o.id
    WHERE o.year_month = ? AND p.is_reversed = 0
    GROUP BY p.payment_method
  `).all(yearMonth);

  // Reversals for this month
  const reversalSummary = db.prepare(`
    SELECT
      COUNT(p.id) AS reversal_count,
      COALESCE(SUM(p.amount_cents), 0) AS reversed_cents
    FROM payments p
    JOIN obligations o ON p.obligation_id = o.id
    WHERE o.year_month = ? AND p.is_reversed = 1
  `).get(yearMonth);

  return {
    yearMonth,
    currency,
    activeMembersCount,
    obligationsCount: oblSummary.total_obligations,
    fullyPaidCount: oblSummary.fully_paid_count,
    partiallyPaidCount: oblSummary.partially_paid_count,
    unpaidCount: oblSummary.unpaid_count,
    totalExpectedCents,
    totalCollectedCents,
    totalOutstandingCents,
    methodBreakdown,
    reversals: {
      count: reversalSummary.reversal_count,
      totalCents: reversalSummary.reversed_cents,
    },
  };
}

function getMonthlyMemberDetails(yearMonth, page = 1, pageSize = 10) {
  const db = getDatabase();
  const offset = (page - 1) * pageSize;

  const countRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM obligations o
    JOIN members m ON o.member_id = m.id
    WHERE o.year_month = ? AND m.status = 'active'
  `).get(yearMonth);

  const total = countRow.count;

  const rows = db.prepare(`
    SELECT
      m.id AS member_id,
      m.full_name,
      m.telegram_id,
      o.amount_due_cents,
      o.amount_paid_cents,
      (o.amount_due_cents - o.amount_paid_cents) AS balance_cents,
      o.status,
      o.due_date
    FROM obligations o
    JOIN members m ON o.member_id = m.id
    WHERE o.year_month = ? AND m.status = 'active'
    ORDER BY m.full_name COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).all(yearMonth, pageSize, offset);

  return {
    rows,
    total,
    page,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

function exportMonthlyReportCsv(yearMonth) {
  const db = getDatabase();
  const currency = getCurrency();

  const rows = db.prepare(`
    SELECT
      m.id AS member_id,
      m.full_name,
      m.phone,
      m.telegram_id,
      o.year_month,
      o.amount_due_cents,
      o.amount_paid_cents,
      (o.amount_due_cents - o.amount_paid_cents) AS balance_cents,
      o.status,
      o.due_date,
      COALESCE((
        SELECT GROUP_CONCAT(p.tx_id || ' (' || (p.amount_cents / 100.0) || ' via ' || p.payment_method || ')')
        FROM payments p
        WHERE p.obligation_id = o.id AND p.is_reversed = 0
      ), 'None') AS payments_list
    FROM obligations o
    JOIN members m ON o.member_id = m.id
    WHERE o.year_month = ?
    ORDER BY m.full_name COLLATE NOCASE ASC
  `).all(yearMonth);

  const headers = [
    'Member ID',
    'Full Name',
    'Phone',
    'Telegram ID',
    'Month',
    `Due (${currency})`,
    `Paid (${currency})`,
    `Balance (${currency})`,
    'Status',
    'Due Date',
    'Payment Transactions',
  ];

  const csvData = rows.map((r) => [
    r.member_id,
    r.full_name,
    r.phone || 'N/A',
    r.telegram_id,
    r.year_month,
    (r.amount_due_cents / 100).toFixed(2),
    (r.amount_paid_cents / 100).toFixed(2),
    (Math.max(0, r.balance_cents) / 100).toFixed(2),
    r.status,
    r.due_date,
    r.payments_list,
  ]);

  return generateCsv(headers, csvData);
}

module.exports = {
  getMonthlyReportSummary,
  getMonthlyMemberDetails,
  exportMonthlyReportCsv,
};
