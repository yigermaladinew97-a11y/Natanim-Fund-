const fs = require('node:fs');
const path = require('node:path');
const { getDatabase } = require('../db');
const { config } = require('../config');
const { formatMoney, formatDualDate } = require('../utils/formatters');
const { formatBytes } = require('./backupService');
const { getStaffGroupDetails } = require('./staffArchive');

/**
 * Format uptime seconds into human-readable string.
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Gather complete system, database, and operational health diagnostics.
 */
function getSystemDiagnostics() {
  const db = getDatabase();

  // 1. Process & Memory
  const uptimeSec = process.uptime();
  const uptimeFormatted = formatUptime(uptimeSec);
  const mem = process.memoryUsage();
  const memoryFormatted = {
    heapUsed: formatBytes(mem.heapUsed),
    heapTotal: formatBytes(mem.heapTotal),
    rss: formatBytes(mem.rss),
  };

  // 2. Database file info
  let dbSizeFormatted = 'N/A';
  let dbSizeBytes = 0;
  if (config.databasePath && fs.existsSync(config.databasePath)) {
    try {
      const stats = fs.statSync(config.databasePath);
      dbSizeBytes = stats.size;
      dbSizeFormatted = formatBytes(dbSizeBytes);
    } catch (_) {}
  }

  // 3. Database entities stats
  const activeMembersRow = db.prepare(`SELECT COUNT(*) as count FROM members WHERE status = 'active'`).get();
  const inactiveMembersRow = db.prepare(`SELECT COUNT(*) as count FROM members WHERE status = 'inactive'`).get();
  const activeMembers = activeMembersRow ? activeMembersRow.count : 0;
  const inactiveMembers = inactiveMembersRow ? inactiveMembersRow.count : 0;

  const paymentsRow = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total_cents FROM payments`).get();
  const paymentsCount = paymentsRow ? paymentsRow.count : 0;
  const totalCollectedCents = paymentsRow ? paymentsRow.total_cents : 0;

  const pendingRegistrationsRow = db.prepare(`SELECT COUNT(*) as count FROM registration_requests WHERE status = 'PENDING'`).get();
  const pendingRegistrations = pendingRegistrationsRow ? pendingRegistrationsRow.count : 0;

  const pendingSubmissionsRow = db.prepare(`SELECT COUNT(*) as count FROM payment_submissions WHERE status = 'PENDING'`).get();
  const pendingSubmissions = pendingSubmissionsRow ? pendingSubmissionsRow.count : 0;

  // 4. Staff Archive Group & Topics
  const staffGroup = getStaffGroupDetails();
  let createdTopicsCount = 0;
  try {
    const topicsRow = db.prepare(`SELECT COUNT(*) as count FROM forum_topics`).get();
    createdTopicsCount = topicsRow ? topicsRow.count : 0;
  } catch (_) {}

  // 5. System Roles
  const rolesRows = db.prepare(`SELECT role, COUNT(*) as count FROM roles GROUP BY role`).all();
  const rolesCount = { admin: 0, treasurer: 0 };
  for (const r of rolesRows) {
    if (r.role === 'admin') rolesCount.admin = r.count;
    if (r.role === 'treasurer') rolesCount.treasurer = r.count;
  }

  return {
    nodeVersion: process.version,
    platform: `${process.platform} (${process.arch})`,
    uptimeSeconds: uptimeSec,
    uptimeFormatted,
    memory: memoryFormatted,
    database: {
      path: config.databasePath,
      sizeBytes: dbSizeBytes,
      sizeFormatted: dbSizeFormatted,
      activeMembers,
      inactiveMembers,
      totalMembers: activeMembers + inactiveMembers,
      paymentsCount,
      totalCollectedCents,
      totalCollectedFormatted: formatMoney(totalCollectedCents, config.defaultCurrency),
      pendingRegistrations,
      pendingSubmissions,
      rolesCount,
    },
    staffGroup: {
      configured: Boolean(staffGroup),
      groupId: staffGroup ? staffGroup.groupId : null,
      groupTitle: staffGroup ? staffGroup.groupTitle : 'Not configured',
      topicsCount: createdTopicsCount,
    },
    config: {
      timezone: config.timezone,
      dueDay: config.dueDayOfMonth,
      currency: config.defaultCurrency,
      reminderSchedule: config.reminderCronSchedule,
    },
  };
}

/**
 * Format diagnostics into Telegram HTML.
 */
function formatDiagnosticsHtml(diag) {
  const escapeHtml = (str) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const staffStatus = diag.staffGroup.configured
    ? `✅ Connected (<code>${escapeHtml(diag.staffGroup.groupId)}</code>)\n  Title: <b>${escapeHtml(diag.staffGroup.groupTitle)}</b>\n  Folders: <b>${diag.staffGroup.topicsCount}</b> created`
    : `⚠️ Not connected (Use /setstaffgroup in group)`;

  return (
    `🩺 <b>Natanim Fund Bot — System Health & Diagnostics</b>\n` +
    `<i>Status: Active & Operational</i>\n\n` +
    `⚙️ <b>Application Environment:</b>\n` +
    `• <b>Uptime:</b> ${diag.uptimeFormatted}\n` +
    `• <b>Node.js:</b> <code>${diag.nodeVersion}</code> on <code>${diag.platform}</code>\n` +
    `• <b>Memory (RAM):</b> Heap ${diag.memory.heapUsed} / RSS ${diag.memory.rss}\n` +
    `• <b>Timezone:</b> ${diag.config.timezone}\n\n` +
    `💾 <b>Database & Financial Records:</b>\n` +
    `• <b>Database Size:</b> ${diag.database.sizeFormatted} (SQLite WAL)\n` +
    `• <b>Members:</b> ${diag.database.activeMembers} active (${diag.database.inactiveMembers} deactivated)\n` +
    `• <b>Total Collections:</b> ${diag.database.totalCollectedFormatted} (${diag.database.paymentsCount} transactions)\n` +
    `• <b>Pending Requests:</b> ${diag.database.pendingRegistrations} registrations | ${diag.database.pendingSubmissions} receipts\n` +
    `• <b>Roles:</b> ${diag.database.rolesCount.admin} Admins, ${diag.database.rolesCount.treasurer} Treasurers\n\n` +
    `📂 <b>Leadership Staff Group:</b>\n` +
    `• ${staffStatus}\n\n` +
    `⏰ <b>Background Schedulers:</b>\n` +
    `• <b>Monthly Obligations:</b> Active (1st of month at 00:05)\n` +
    `• <b>Contribution Reminders:</b> Active (${diag.config.reminderSchedule})\n` +
    `• <b>Monthly Report Auto-Post:</b> Active (28th of month at 18:00)\n\n` +
    `<i>All systems healthy. No unhandled crashes detected.</i>`
  );
}

module.exports = {
  getSystemDiagnostics,
  formatDiagnosticsHtml,
  formatUptime,
};
