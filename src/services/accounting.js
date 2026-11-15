const crypto = require('node:crypto');
const { getDatabase } = require('../db');
const {
  getCurrentYearMonth,
  getDueDateForMonth,
  getNextMonthsList,
  getNextAcademicMonth,
  isAcademicMonth,
  formatDualMonth,
  formatMoney,
} = require('../utils/formatters');
const { isValidYearMonth, isValidPaymentMethod, sanitizeText } = require('../utils/validators');

function getSetting(key, fallback = null) {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value, actorTelegramId) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, String(value));

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('UPDATE_SETTING', 'settings', key, String(actorTelegramId), JSON.stringify({ key, value }));
}

function getStandardAmountCents() {
  const val = getSetting('standard_amount_cents');
  return val ? parseInt(val, 10) : 5000; // 50.00 ETB default
}

function setStandardAmountCents(amountCents, actorTelegramId) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Standard contribution amount must be a positive integer in minor units (cents).');
  }
  setSetting('standard_amount_cents', amountCents, actorTelegramId);
}

const DEFAULT_CBE_ACCOUNT_NUMBER = '1000123456789';
const DEFAULT_CBE_ACCOUNT_NAME = 'Natanim Fund / የናታኒም ፈንድ';

function getCbeAccountNumber() {
  return getSetting('cbe_account_number', DEFAULT_CBE_ACCOUNT_NUMBER);
}

function getCbeAccountName() {
  return getSetting('cbe_account_name', DEFAULT_CBE_ACCOUNT_NAME);
}

function setCbeAccountDetails({ accountNumber, accountName, actorTelegramId }) {
  const cleanAcc = String(accountNumber || '').replace(/\s+/g, '').trim();
  if (!cleanAcc || cleanAcc.length < 8) {
    throw new Error('CBE Account Number must be at least 8 digits long.');
  }

  const cleanName = sanitizeText(accountName, 100);
  if (!cleanName || cleanName.length < 2) {
    throw new Error('Account Name must be at least 2 characters long.');
  }

  const db = getDatabase();
  // Clear any legacy custom override so new number & name take effect
  db.prepare("DELETE FROM settings WHERE key = 'bank_info'").run();

  setSetting('cbe_account_number', cleanAcc, actorTelegramId);
  setSetting('cbe_account_name', cleanName, actorTelegramId);

  return {
    accountNumber: cleanAcc,
    accountName: cleanName,
  };
}

function getBankInfo(lang = 'en') {
  const isAm = lang === 'am';
  const custom = getSetting('bank_info', null);
  if (custom) return custom;

  const accNum = getCbeAccountNumber();
  const accName = getCbeAccountName();

  if (isAm) {
    return (
      `🏦 <b>የናታኒም ፈንድ የባንክ ሂሳብ (CBE)</b>\n\n` +
      `• <b>ባንክ፦</b> የኢትዮጵያ ንግድ ባንክ (CBE)\n` +
      `• <b>የሂሳብ ቁጥር፦</b> <code>${accNum}</code>\n` +
      `• <b>የሂሳብ ስም፦</b> ${accName}\n\n` +
      `💡 <i>የሂሳብ ቁጥሩን ነክተው በቀላሉ ኮፒ ማድረግ ይችላሉ።</i>\n\n` +
      `📌 <b>ቀላል መመሪያ፦</b>\n` +
      `1. በCBE ሞባይል ባንኪንግ ወይም ሲቢኢ ብር ይላኩ።\n` +
      `2. የከፈሉበትን ደረሰኝ (ስክሪንሾት) እዚህ ይላኩ።`
    );
  }

  return (
    `🏦 <b>Arbaminch University Christian Students Natanim Fund — CBE Account</b>\n\n` +
    `• <b>Bank:</b> Commercial Bank of Ethiopia (CBE)\n` +
    `• <b>Account Number:</b> <code>${accNum}</code>\n` +
    `• <b>Account Name:</b> ${accName}\n\n` +
    `💡 <i>Tip: Tap the account number above to copy it instantly.</i>\n\n` +
    `📌 <b>Instructions:</b>\n` +
    `1. Transfer via CBE Mobile Banking, CBE Birr, or branch deposit.\n` +
    `2. Upload a screenshot of your payment receipt below.`
  );
}

function setBankInfo(text, actorTelegramId) {
  if (!text || text.trim().length < 10) {
    throw new Error('Bank account details cannot be empty (must be at least 10 characters).');
  }
  setSetting('bank_info', text.trim(), actorTelegramId);
}

function getCurrency() {
  return getSetting('currency', 'ETB');
}

function getDueDayOfMonth() {
  const val = getSetting('due_day_of_month');
  return val ? parseInt(val, 10) : 30;
}

function generateTxId() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TX-${dateStr}-${randomPart}`;
}

function getOrCreateObligation(memberId, yearMonth) {
  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`Invalid year-month format: "${yearMonth}". Expected YYYY-MM.`);
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM obligations WHERE member_id = ? AND year_month = ?').get(memberId, yearMonth);
  if (existing) {
    return existing;
  }

  const standardAmount = getStandardAmountCents();
  const dueDay = getDueDayOfMonth();
  const dueDate = getDueDateForMonth(yearMonth, dueDay);

  db.prepare(`
    INSERT INTO obligations (member_id, year_month, amount_due_cents, amount_paid_cents, status, due_date)
    VALUES (?, ?, ?, 0, 'UNPAID', ?)
  `).run(memberId, yearMonth, standardAmount, dueDate);

  return db.prepare('SELECT * FROM obligations WHERE member_id = ? AND year_month = ?').get(memberId, yearMonth);
}

function ensureMonthlyObligations(yearMonth) {
  const db = getDatabase();
  const activeMembers = db.prepare("SELECT id FROM members WHERE status = 'active'").all();
  const standardAmount = getStandardAmountCents();
  const dueDay = getDueDayOfMonth();
  const dueDate = getDueDateForMonth(yearMonth, dueDay);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO obligations (member_id, year_month, amount_due_cents, amount_paid_cents, status, due_date)
    VALUES (?, ?, ?, 0, 'UNPAID', ?)
  `);

  const runAll = db.transaction((members) => {
    let createdCount = 0;
    for (const m of members) {
      const res = insertStmt.run(m.id, yearMonth, standardAmount, dueDate);
      if (res.changes > 0) createdCount++;
    }
    return createdCount;
  });

  return runAll(activeMembers);
}

function updateObligationStatus(db, obligationId) {
  const obligation = db.prepare('SELECT * FROM obligations WHERE id = ?').get(obligationId);
  if (!obligation) return null;

  // Calculate sum of valid, non-reversed payments
  const sumRow = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total_paid
    FROM payments
    WHERE obligation_id = ? AND is_reversed = 0
  `).get(obligationId);

  const totalPaid = sumRow.total_paid;
  let newStatus = 'UNPAID';

  if (totalPaid >= obligation.amount_due_cents) {
    newStatus = 'FULLY_PAID';
  } else if (totalPaid > 0) {
    newStatus = 'PARTIALLY_PAID';
  } else {
    // Check if overdue
    const today = new Date().toISOString().slice(0, 10);
    if (today > obligation.due_date) {
      newStatus = 'OVERDUE';
    } else {
      newStatus = 'UNPAID';
    }
  }

  db.prepare(`
    UPDATE obligations
    SET amount_paid_cents = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(totalPaid, newStatus, obligationId);

  return db.prepare('SELECT * FROM obligations WHERE id = ?').get(obligationId);
}

function recordPayment({
  memberId,
  yearMonth,
  amountCents,
  paymentMethod,
  referenceNumber,
  notes,
  recordedBy,
}) {
  if (!isValidPaymentMethod(paymentMethod)) {
    throw new Error(`Invalid payment method: "${paymentMethod}". Allowed: cash, bank_transfer, mobile_money.`);
  }

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Payment amount must be a positive integer in minor units (cents).');
  }

  const cleanRef = sanitizeText(referenceNumber, 100);
  const cleanNotes = sanitizeText(notes, 255);
  const month = yearMonth || getCurrentYearMonth();

  const db = getDatabase();

  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) {
    throw new Error('Member not found.');
  }

  const tx = db.transaction(() => {
    // 1. Get or create obligation
    const obligation = getOrCreateObligation(memberId, month);
    if (obligation.status === 'FULLY_PAID') {
      throw new Error(`የ${formatDualMonth(month)} መዋጮ አስቀድሞ ሙሉ በሙሉ ተከፍሏል።`);
    }

    // 2. Generate unique TX ID
    const txId = generateTxId();

    // 3. Insert payment record
    const insertRes = db.prepare(`
      INSERT INTO payments (
        tx_id, member_id, obligation_id, amount_cents, payment_method,
        reference_number, notes, recorded_by, created_at, is_reversed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
    `).run(
      txId,
      memberId,
      obligation.id,
      amountCents,
      paymentMethod,
      cleanRef,
      cleanNotes,
      String(recordedBy)
    );

    const paymentId = insertRes.lastInsertRowid;

    // 4. Update obligation status and total paid
    const updatedObligation = updateObligationStatus(db, obligation.id);

    // 5. Audit log
    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('RECORD_PAYMENT', 'payments', String(paymentId), String(recordedBy), JSON.stringify({
      txId,
      memberId,
      memberName: member.full_name,
      amountCents,
      month,
      paymentMethod,
      referenceNumber: cleanRef,
    }));

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    return {
      payment,
      obligation: updatedObligation,
      member,
    };
  });

  return tx();
}

function recordMultiMonthPayment({
  memberId,
  startYearMonth,
  monthsCount = 1,
  totalAmountCents,
  paymentMethod,
  referenceNumber,
  notes,
  recordedBy,
}) {
  if (!isValidPaymentMethod(paymentMethod)) {
    throw new Error(`Invalid payment method: "${paymentMethod}". Allowed: cash, bank_transfer, mobile_money.`);
  }

  const cleanRef = sanitizeText(referenceNumber, 100);
  const cleanNotes = sanitizeText(notes, 255);
  const startMonth = startYearMonth || getCurrentYearMonth();
  const months = getNextMonthsList(startMonth, monthsCount);
  const standardAmount = getStandardAmountCents();
  const db = getDatabase();

  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) {
    throw new Error('Member not found.');
  }

  let remainingPool = totalAmountCents || (standardAmount * monthsCount);
  if (!Number.isInteger(remainingPool) || remainingPool <= 0) {
    throw new Error('Payment amount must be a positive integer in minor units (cents).');
  }

  const tx = db.transaction(() => {
    const recordedPayments = [];
    const updatedObligations = [];
    const batchTxId = generateTxId();

    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      const obligation = getOrCreateObligation(memberId, month);
      const neededForMonth = Math.max(0, obligation.amount_due_cents - obligation.amount_paid_cents);

      // If this month is already fully settled and subsequent months need payment, advance forward
      if (neededForMonth === 0 && remainingPool > 0 && i < months.length - 1) {
        continue;
      }

      let payForThisMonth = 0;
      if (i === months.length - 1) {
        payForThisMonth = remainingPool;
      } else {
        payForThisMonth = Math.min(remainingPool, neededForMonth > 0 ? neededForMonth : standardAmount);
      }

      if (payForThisMonth <= 0) continue;
      remainingPool -= payForThisMonth;

      const subTxId = `${batchTxId}-${i + 1}`;
      const insertRes = db.prepare(`
        INSERT INTO payments (
          tx_id, member_id, obligation_id, amount_cents, payment_method,
          reference_number, notes, recorded_by, created_at, is_reversed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
      `).run(
        subTxId,
        memberId,
        obligation.id,
        payForThisMonth,
        paymentMethod,
        cleanRef,
        cleanNotes ? `${cleanNotes} (${month})` : `Multi-month advance payment for ${month}`,
        String(recordedBy)
      );

      const paymentId = insertRes.lastInsertRowid;
      const updatedObl = updateObligationStatus(db, obligation.id);
      const paymentObj = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);

      recordedPayments.push(paymentObj);
      updatedObligations.push(updatedObl);
    }

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('RECORD_MULTI_MONTH_PAYMENT', 'payments', batchTxId, String(recordedBy), JSON.stringify({
      batchTxId,
      memberId,
      memberName: member.full_name,
      monthsCovered: months,
      totalAmountCents: (totalAmountCents || (standardAmount * monthsCount)),
      paymentMethod,
      referenceNumber: cleanRef,
    }));

    return {
      batchTxId,
      member,
      monthsCovered: months,
      payments: recordedPayments,
      obligations: updatedObligations,
      totalAmountCents: (totalAmountCents || (standardAmount * monthsCount)),
    };
  });

  return tx();
}

function reversePayment({ paymentId, txId, reason, reversedBy }) {
  const cleanReason = sanitizeText(reason, 255);
  if (!cleanReason || cleanReason.length < 3) {
    throw new Error('A reversal reason is required (at least 3 characters).');
  }

  const db = getDatabase();

  const tx = db.transaction(() => {
    let payment = null;
    if (paymentId) {
      payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    } else if (txId) {
      payment = db.prepare('SELECT * FROM payments WHERE tx_id = ?').get(txId);
    }

    if (!payment) {
      throw new Error('Payment record not found.');
    }

    if (payment.is_reversed === 1) {
      throw new Error(`Payment ${payment.tx_id} is already reversed.`);
    }

    // Mark payment as reversed
    db.prepare(`
      UPDATE payments
      SET is_reversed = 1,
          reversed_at = datetime('now'),
          reversed_by = ?,
          reversal_reason = ?
      WHERE id = ?
    `).run(String(reversedBy), cleanReason, payment.id);

    // Insert payment_reversals audit entry
    db.prepare(`
      INSERT INTO payment_reversals (payment_id, tx_id, reversed_by, reason)
      VALUES (?, ?, ?, ?)
    `).run(payment.id, payment.tx_id, String(reversedBy), cleanReason);

    // Recalculate obligation
    const updatedObligation = updateObligationStatus(db, payment.obligation_id);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('REVERSE_PAYMENT', 'payments', String(payment.id), String(reversedBy), JSON.stringify({
      txId: payment.tx_id,
      amountCents: payment.amount_cents,
      reason: cleanReason,
    }));

    const reversedPayment = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
    return {
      payment: reversedPayment,
      obligation: updatedObligation,
    };
  });

  return tx();
}

function getMemberObligation(memberId, yearMonth) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM obligations WHERE member_id = ? AND year_month = ?').get(memberId, yearMonth);
}

function listMemberObligations(memberId, limit = 12) {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM obligations
    WHERE member_id = ?
    ORDER BY year_month DESC
    LIMIT ?
  `).all(memberId, limit);
}

function listMemberPayments(memberId, limit = 15) {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, o.year_month
    FROM payments p
    JOIN obligations o ON p.obligation_id = o.id
    WHERE p.member_id = ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `).all(memberId, limit);
}

function getMemberOutstandingTotal(memberId, upToMonth = null) {
  const db = getDatabase();
  const cutoff = upToMonth || getCurrentYearMonth();
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount_due_cents - amount_paid_cents), 0) AS total_outstanding
    FROM obligations
    WHERE member_id = ? 
      AND year_month <= ?
      AND amount_paid_cents < amount_due_cents
  `).get(memberId, cutoff);
  return row ? row.total_outstanding : 0;
}

function getMemberPrepaidMonths(memberId) {
  const db = getDatabase();
  const currentMonth = getCurrentYearMonth();
  return db.prepare(`
    SELECT year_month, amount_due_cents, amount_paid_cents, status
    FROM obligations
    WHERE member_id = ? 
      AND year_month > ? 
      AND status = 'FULLY_PAID'
    ORDER BY year_month ASC
  `).all(memberId, currentMonth);
}

function listUnpaidMembersForMonth(yearMonth) {
  const db = getDatabase();
  return db.prepare(`
    SELECT m.id AS member_id, m.full_name, m.telegram_id, m.phone,
           o.year_month, o.amount_due_cents, o.amount_paid_cents,
           (o.amount_due_cents - o.amount_paid_cents) AS balance_cents,
           o.status, o.due_date
    FROM members m
    JOIN obligations o ON m.id = o.member_id
    WHERE m.status = 'active'
      AND o.year_month = ?
      AND o.amount_paid_cents < o.amount_due_cents
    ORDER BY m.full_name COLLATE NOCASE ASC
  `).all(yearMonth);
}

function getPaymentByTxId(txId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, m.full_name, o.year_month
    FROM payments p
    JOIN members m ON p.member_id = m.id
    JOIN obligations o ON p.obligation_id = o.id
    WHERE p.tx_id = ?
  `).get(txId);
}

function createPaymentSubmission({
  memberId,
  telegramId,
  yearMonth,
  amountCents,
  paymentMethod,
  referenceNumber,
  monthsCount = 1,
  fileId,
  fileUniqueId,
  caption,
}) {
  const db = getDatabase();
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member || member.status !== 'active') {
    throw new Error('Active member not found.');
  }

  if (!isValidYearMonth(yearMonth)) {
    throw new Error('Invalid year-month format (expected YYYY-MM).');
  }

  const cleanMonthsCount = Math.max(1, parseInt(monthsCount, 10) || 1);

  // Check 1: Obligation cannot be already FULLY_PAID
  const existingObligation = db.prepare('SELECT status FROM obligations WHERE member_id = ? AND year_month = ?').get(memberId, yearMonth);
  if (existingObligation && existingObligation.status === 'FULLY_PAID') {
    throw new Error(`የ${formatDualMonth(yearMonth)} መዋጮ አስቀድሞ ሙሉ በሙሉ ተከፍሏል። ደጋግሞ መክፈል አይቻልም።`);
  }

  // Check 2: No duplicate PENDING submission
  const pendingSub = db.prepare(`
    SELECT id FROM payment_submissions 
    WHERE member_id = ? AND year_month = ? AND status = 'PENDING'
  `).get(memberId, yearMonth);
  if (pendingSub) {
    throw new Error(`ለ${formatDualMonth(yearMonth)} ያስገቡት ደረሰኝ በአስተዳዳሪዎች በመታየት ላይ ነው። እባክዎ በትዕግስት ይጠብቁ።`);
  }

  // Check 3: Minimum payment amount check (minimum standardAmount * cleanMonthsCount)
  const standardAmount = getStandardAmountCents();
  const minRequiredCents = cleanMonthsCount * standardAmount;
  if (!Number.isInteger(amountCents) || amountCents < minRequiredCents) {
    throw new Error(`አነስተኛው የክፍያ መጠን ${formatMoney(minRequiredCents, getCurrency())} ነው።`);
  }

  if (!isValidPaymentMethod(paymentMethod)) {
    throw new Error('Invalid payment method.');
  }

  if (!fileId) {
    throw new Error('Screenshot photo or receipt image is required.');
  }

  const cleanRef = sanitizeText(referenceNumber, 100);
  const cleanCap = sanitizeText(caption, 255);

  const res = db.prepare(`
    INSERT INTO payment_submissions (
      member_id, telegram_id, year_month, amount_cents, payment_method,
      reference_number, months_count, file_id, file_unique_id, caption, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(
    memberId,
    String(telegramId),
    yearMonth,
    amountCents,
    paymentMethod,
    cleanRef,
    cleanMonthsCount,
    fileId,
    fileUniqueId || null,
    cleanCap
  );

  const submissionId = res.lastInsertRowid;

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('SUBMIT_PAYMENT_PROOF', 'payment_submissions', String(submissionId), String(telegramId), JSON.stringify({
    memberId,
    yearMonth,
    amountCents,
    monthsCount: cleanMonthsCount,
    paymentMethod,
    referenceNumber: cleanRef,
  }));

  return getPaymentSubmissionById(submissionId);
}

function getPendingPaymentSubmissions() {
  const db = getDatabase();
  return db.prepare(`
    SELECT s.*, m.full_name, m.phone, m.telegram_id as member_telegram_id
    FROM payment_submissions s
    JOIN members m ON s.member_id = m.id
    WHERE s.status = 'PENDING'
    ORDER BY s.created_at ASC
  `).all();
}

function getPaymentSubmissionById(id) {
  const db = getDatabase();
  return db.prepare(`
    SELECT s.*, m.full_name, m.phone, m.telegram_id as member_telegram_id
    FROM payment_submissions s
    JOIN members m ON s.member_id = m.id
    WHERE s.id = ?
  `).get(id);
}

function approvePaymentSubmission(submissionId, reviewerTelegramId, monthsCount = null) {
  const db = getDatabase();
  const sub = db.prepare('SELECT * FROM payment_submissions WHERE id = ?').get(submissionId);
  if (!sub) {
    throw new Error('Payment submission not found.');
  }

  if (sub.status !== 'PENDING') {
    throw new Error(`This payment submission has already been ${sub.status.toLowerCase()}.`);
  }

  const monthsNum = monthsCount !== null && monthsCount !== undefined
    ? (parseInt(monthsCount, 10) || 1)
    : (parseInt(sub.months_count, 10) || 1);

  const tx = db.transaction(() => {
    let payment = null;
    let obligation = null;
    let monthsCovered = [sub.year_month];
    let txId = null;

    if (monthsNum > 1) {
      const multi = recordMultiMonthPayment({
        memberId: sub.member_id,
        startYearMonth: sub.year_month,
        monthsCount: monthsNum,
        totalAmountCents: sub.amount_cents,
        paymentMethod: sub.payment_method,
        referenceNumber: sub.reference_number,
        notes: `Approved from receipt submission #${sub.id} (${monthsNum} months)`,
        recordedBy: reviewerTelegramId,
      });
      payment = multi.payments[0] || null;
      obligation = multi.obligations[0] || null;
      monthsCovered = multi.monthsCovered;
      txId = multi.batchTxId;
    } else {
      const single = recordPayment({
        memberId: sub.member_id,
        yearMonth: sub.year_month,
        amountCents: sub.amount_cents,
        paymentMethod: sub.payment_method,
        referenceNumber: sub.reference_number,
        notes: `Approved from member receipt submission #${sub.id}`,
        recordedBy: reviewerTelegramId,
      });
      payment = single.payment;
      obligation = single.obligation;
      monthsCovered = [sub.year_month];
      txId = single.payment.tx_id;
    }

    db.prepare(`
      UPDATE payment_submissions
      SET status = 'APPROVED', reviewed_by = ?, reviewed_at = datetime('now'), payment_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(String(reviewerTelegramId), payment ? payment.id : null, submissionId);

    db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('APPROVE_PAYMENT_SUBMISSION', 'payment_submissions', String(submissionId), String(reviewerTelegramId), JSON.stringify({
      paymentId: payment ? payment.id : null,
      txId,
      memberId: sub.member_id,
      amountCents: sub.amount_cents,
      monthsCount: monthsNum,
      monthsCovered,
    }));

    return {
      payment,
      obligation,
      monthsCovered,
      txId,
      monthsCount: monthsNum,
      submission: getPaymentSubmissionById(submissionId),
    };
  });

  return tx();
}

function rejectPaymentSubmission(submissionId, reviewerTelegramId, reason = 'Declined by staff') {
  const db = getDatabase();
  const sub = db.prepare('SELECT * FROM payment_submissions WHERE id = ?').get(submissionId);
  if (!sub) {
    throw new Error('Payment submission not found.');
  }

  if (sub.status !== 'PENDING') {
    throw new Error(`This payment submission has already been ${sub.status.toLowerCase()}.`);
  }

  const cleanReason = sanitizeText(reason, 255) || 'Declined by staff';

  db.prepare(`
    UPDATE payment_submissions
    SET status = 'REJECTED', reviewed_by = ?, reviewed_at = datetime('now'), rejection_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(String(reviewerTelegramId), cleanReason, submissionId);

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('REJECT_PAYMENT_SUBMISSION', 'payment_submissions', String(submissionId), String(reviewerTelegramId), JSON.stringify({
    memberId: sub.member_id,
    amountCents: sub.amount_cents,
    reason: cleanReason,
  }));

  return getPaymentSubmissionById(submissionId);
}

async function notifyStaffNewPaymentSubmission(telegram, submission) {
  const { getStaffTelegramIds } = require('./permissions');
  const { Markup } = require('telegraf');
  const { formatMoney, formatPaymentMethod, escapeHtml } = require('../utils/formatters');

  const staffIds = getStaffTelegramIds();
  const currency = getCurrency();
  const monthsCount = submission.months_count || 1;

  let periodDisplay = submission.year_month;
  if (monthsCount > 1) {
    let currentYm = submission.year_month;
    for (let i = 1; i < monthsCount; i++) {
      const [y, m] = currentYm.split('-').map(Number);
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      currentYm = `${nextY}-${String(nextM).padStart(2, '0')}`;
    }
    periodDisplay = `${submission.year_month} to ${currentYm} (${monthsCount} Months)`;
  }

  const caption =
    `💳 <b>New Payment Receipt Submitted!</b>\n\n` +
    `• <b>Member:</b> ${escapeHtml(submission.full_name)} (#${submission.member_id})\n` +
    `• <b>Period:</b> ${escapeHtml(periodDisplay)}\n` +
    `• <b>Months Stated:</b> ${monthsCount} Month${monthsCount > 1 ? 's' : ''}\n` +
    `• <b>Amount:</b> <b>${escapeHtml(formatMoney(submission.amount_cents, currency))}</b>\n` +
    `• <b>Method:</b> ${escapeHtml(formatPaymentMethod(submission.payment_method))}\n` +
    `• <b>Ref / Tx:</b> ${escapeHtml(submission.reference_number || 'None')}\n` +
    `• <b>Submitted:</b> ${escapeHtml(submission.created_at)}\n\n` +
    `Please verify receipt in church account and choose an action:`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Verify & Approve', `sub_approve_${submission.id}`),
      Markup.button.callback('❌ Reject', `sub_reject_${submission.id}`),
    ],
  ]);

  for (const staffId of staffIds) {
    try {
      await telegram.sendPhoto(staffId, submission.file_id, {
        caption,
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (err) {
      console.warn(`[Payment] Could not send receipt photo to staff ${staffId}:`, err.message);
    }
  }
}

function getEligibleSubmissionMonths(memberId, count = 3) {
  const db = getDatabase();
  const curMonth = getCurrentYearMonth();
  const startAcademic = isAcademicMonth(curMonth) ? curMonth : getNextAcademicMonth(curMonth, 1);
  const prevAcademic = getNextAcademicMonth(startAcademic, -1);

  // Check candidate academic months starting from previous month, current, and upcoming
  const candidates = [prevAcademic, startAcademic];
  let cur = startAcademic;
  for (let i = 1; i <= 8; i++) {
    cur = getNextAcademicMonth(cur, 1);
    candidates.push(cur);
  }

  const eligible = [];
  for (const m of candidates) {
    if (!isAcademicMonth(m)) continue;
    // Check if fully paid
    const obl = db.prepare('SELECT status FROM obligations WHERE member_id = ? AND year_month = ?').get(memberId, m);
    if (obl && obl.status === 'FULLY_PAID') {
      continue;
    }
    // Check if pending submission exists
    const pending = db.prepare("SELECT id FROM payment_submissions WHERE member_id = ? AND year_month = ? AND status = 'PENDING'").get(memberId, m);
    if (pending) {
      continue;
    }
    if (!eligible.includes(m)) {
      eligible.push(m);
    }
    if (eligible.length >= count) break;
  }

  return eligible;
}

function validateSubmissionMonth(memberId, month) {
  if (!isValidYearMonth(month)) {
    return {
      ok: false,
      error: '❌ የተሳሳተ የወር ቅርጸት። እባክዎ YYYY-MM (ለምሳሌ <code>2026-10</code>) ያስገቡ።',
    };
  }
  if (!isAcademicMonth(month)) {
    return {
      ok: false,
      error: `⚠️ <b>${formatDualMonth(month)} የዕረፍት ወር ነው።</b>\nመዋጮ የሚሰበሰበው ከጥቅምት እስከ ሰኔ ባሉት 9 ወራት ብቻ ነው። እባክዎ የትምህርት ወር ይምረጡ።`,
    };
  }
  const db = getDatabase();
  const existingObl = db.prepare('SELECT status FROM obligations WHERE member_id = ? AND year_month = ?').get(memberId, month);
  if (existingObl && existingObl.status === 'FULLY_PAID') {
    return {
      ok: false,
      error: `⚠️ <b>የ${formatDualMonth(month)} መዋጮዎን አስቀድመው ሙሉ በሙሉ ከፍለዋል!</b>\nእባክዎ ያልተከፈለ ወር ይምረጡ።`,
    };
  }
  const pending = db.prepare("SELECT id FROM payment_submissions WHERE member_id = ? AND year_month = ? AND status = 'PENDING'").get(memberId, month);
  if (pending) {
    return {
      ok: false,
      error: `⏳ <b>ለ${formatDualMonth(month)} ያስገቡት ደረሰኝ በአስተዳዳሪዎች በመታየት ላይ ነው!</b>\nእባክዎ ማረጋገጫውን በትዕግስት ይጠብቁ።`,
    };
  }
  return { ok: true };
}

module.exports = {
  getSetting,
  setSetting,
  getStandardAmountCents,
  setStandardAmountCents,
  getCurrency,
  getDueDayOfMonth,
  getOrCreateObligation,
  ensureMonthlyObligations,
  recordPayment,
  recordMultiMonthPayment,
  reversePayment,
  getMemberObligation,
  listMemberObligations,
  listMemberPayments,
  getMemberOutstandingTotal,
  getMemberPrepaidMonths,
  listUnpaidMembersForMonth,
  getPaymentByTxId,
  createPaymentSubmission,
  getEligibleSubmissionMonths,
  validateSubmissionMonth,
  getPendingPaymentSubmissions,
  getPaymentSubmissionById,
  approvePaymentSubmission,
  rejectPaymentSubmission,
  notifyStaffNewPaymentSubmission,
  getBankInfo,
  setBankInfo,
  getCbeAccountNumber,
  getCbeAccountName,
  setCbeAccountDetails,
  DEFAULT_CBE_ACCOUNT_NUMBER,
  DEFAULT_CBE_ACCOUNT_NAME,
};

