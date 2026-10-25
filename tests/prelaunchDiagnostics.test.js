const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { createDatabaseBackup, formatBytes, pruneOldBackups } = require('../src/services/backupService');
const { getSystemDiagnostics, formatDiagnosticsHtml, formatUptime } = require('../src/services/diagnosticsService');
const { registerMember } = require('../src/services/memberService');
const { setStaffGroupId } = require('../src/services/staffArchive');

test('Pre-Launch System Health, Backup & Diagnostics Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_prelaunch.db');
  const backupTestDir = path.resolve(process.cwd(), 'data', 'test_backups');

  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(backupTestDir)) fs.rmSync(backupTestDir, { recursive: true, force: true });

  initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(backupTestDir)) fs.rmSync(backupTestDir, { recursive: true, force: true });
  };

  await t.test('1. formatBytes formats B, KB, and MB accurately', () => {
    assert.strictEqual(formatBytes(500), '500 B');
    assert.strictEqual(formatBytes(2048), '2.0 KB');
    assert.strictEqual(formatBytes(2 * 1024 * 1024), '2.00 MB');
  });

  await t.test('2. formatUptime formats seconds into readable components', () => {
    assert.strictEqual(formatUptime(45), '45s');
    assert.strictEqual(formatUptime(125), '2m 5s');
    assert.strictEqual(formatUptime(3665), '1h 1m 5s');
    assert.strictEqual(formatUptime(90061), '1d 1h 1m 1s');
  });

  await t.test('3. createDatabaseBackup creates valid, readable SQLite snapshot', async () => {
    registerMember({
      telegramId: '99887766',
      fullName: 'Prelaunch Test Member',
      phone: '0911223344',
      status: 'active',
      joinedDate: '2026-10-01',
    });

    const res = await createDatabaseBackup(backupTestDir);
    assert.strictEqual(res.success, true);
    assert.ok(fs.existsSync(res.backupPath));
    assert.ok(res.sizeBytes > 0);
    assert.ok(res.filename.startsWith('natanim_fund_backup_'));
    assert.ok(res.filename.endsWith('.db'));
  });

  await t.test('4. pruneOldBackups retains only maxBackups newest files', () => {
    if (!fs.existsSync(backupTestDir)) fs.mkdirSync(backupTestDir, { recursive: true });

    // Create 5 dummy backups
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(backupTestDir, `natanim_fund_backup_2026-10-0${i}.db`), 'dummy');
    }

    pruneOldBackups(backupTestDir, 3);
    const remaining = fs.readdirSync(backupTestDir).filter((f) => f.startsWith('natanim_fund_backup_'));
    assert.strictEqual(remaining.length, 3);
  });

  await t.test('5. getSystemDiagnostics aggregates metrics and formatDiagnosticsHtml formats readable report', () => {
    setStaffGroupId('-100123456789', 'Prelaunch Leadership Staff', '123456');

    const diag = getSystemDiagnostics();
    assert.ok(diag.nodeVersion);
    assert.ok(diag.platform);
    assert.ok(diag.uptimeSeconds >= 0);
    assert.strictEqual(diag.database.activeMembers >= 1, true);
    assert.strictEqual(diag.staffGroup.configured, true);
    assert.strictEqual(diag.staffGroup.groupId, '-100123456789');

    const html = formatDiagnosticsHtml(diag);
    assert.ok(html.includes('System Health & Diagnostics'));
    assert.ok(html.includes('Database Size'));
    assert.ok(html.includes('Prelaunch Leadership Staff'));
    assert.ok(html.includes('Active & Operational'));
  });

  cleanup();
});
