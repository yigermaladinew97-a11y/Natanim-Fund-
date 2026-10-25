const fs = require('node:fs');
const path = require('node:path');
const { getDatabase } = require('../db');
const { config } = require('../config');

/**
 * Format bytes into human readable KB or MB string.
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Clean up older backup files to avoid filling up disk space.
 * Keeps the most recent maxBackups files.
 */
function pruneOldBackups(backupDir, maxBackups = 10) {
  try {
    if (!fs.existsSync(backupDir)) return;
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('natanim_fund_backup_') && f.endsWith('.db'))
      .map((f) => {
        const fullPath = path.join(backupDir, f);
        return { name: f, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    if (files.length > maxBackups) {
      const toDelete = files.slice(maxBackups);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.fullPath);
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[BackupService] Could not prune old backups:', err.message);
  }
}

/**
 * Create a point-in-time, non-blocking atomic backup of the active SQLite database.
 * @param {string} [customDir] - Optional directory to save the backup in.
 * @returns {Promise<{success: boolean, backupPath: string, filename: string, sizeBytes: number, sizeFormatted: string}>}
 */
async function createDatabaseBackup(customDir) {
  const db = getDatabase();
  const backupDir = customDir || path.resolve(process.cwd(), 'data', 'backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `natanim_fund_backup_${timestamp}.db`;
  const backupPath = path.join(backupDir, filename);

  // Perform atomic live online backup
  await db.backup(backupPath);

  const fileBuffer = fs.readFileSync(backupPath);
  const stats = fs.statSync(backupPath);
  const sizeBytes = stats.size;
  const sizeFormatted = formatBytes(sizeBytes);

  // Prune older backups
  pruneOldBackups(backupDir, 10);

  return {
    success: true,
    backupPath,
    filename,
    buffer: fileBuffer,
    sizeBytes,
    sizeFormatted,
  };
}

/**
 * Send database backup snapshot directly to a Telegram chat via native fetch.
 * Uses native FormData and Blob to prevent socket hang up on Windows.
 */
async function sendDatabaseBackupToChat(botToken, chatId) {
  const backupResult = await createDatabaseBackup();

  const caption =
    `💾 <b>Natanim Fund Database Backup</b>\n\n` +
    `• <b>File:</b> <code>${backupResult.filename}</code>\n` +
    `• <b>Size:</b> ${backupResult.sizeFormatted}\n` +
    `• <b>Date:</b> ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC\n\n` +
    `<i>Keep this file secure. It contains complete member and transaction records.</i>`;

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([backupResult.buffer]), backupResult.filename);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || 'Telegram API rejected document upload');
  }

  return {
    success: true,
    backupResult,
    data,
  };
}

module.exports = {
  createDatabaseBackup,
  sendDatabaseBackupToChat,
  formatBytes,
  pruneOldBackups,
};
