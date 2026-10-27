const { createClient } = require('@libsql/client');
const { config } = require('../config');
const { getDatabase } = require('../db');

/**
 * Turso Cloud Database Synchronization Service
 * 
 * Provides automated, seamless two-way synchronization between the local
 * high-performance SQLite engine (better-sqlite3) and the permanent
 * cloud storage on Turso (libSQL).
 * 
 * - On Render startup: pulls down all members, payments, and settings from Turso.
 * - On data mutation / intervals / shutdown: pushes updates up to Turso.
 */

let tursoClient = null;

function getTursoClient() {
  if (tursoClient) return tursoClient;
  if (!config.tursoDatabaseUrl || !config.tursoAuthToken) {
    return null;
  }

  tursoClient = createClient({
    url: config.tursoDatabaseUrl,
    authToken: config.tursoAuthToken,
  });

  return tursoClient;
}

function isTursoConfigured() {
  return Boolean(config.tursoDatabaseUrl && config.tursoAuthToken);
}

const SYNCED_TABLES = [
  'settings',
  'roles',
  'members',
  'obligations',
  'payments',
  'payment_reversals',
  'registration_requests',
  'payment_submissions',
  'user_preferences',
  'group_topics',
];

const TABLE_PRIMARY_KEYS = {
  settings: ['key'],
  roles: ['telegram_id'],
  members: ['id'],
  obligations: ['id'],
  payments: ['id'],
  payment_reversals: ['id'],
  registration_requests: ['id'],
  payment_submissions: ['id'],
  user_preferences: ['telegram_id'],
  group_topics: ['group_id', 'topic_key'],
};

function buildUpsertSql(table, columns) {
  const pkCols = TABLE_PRIMARY_KEYS[table] || ['id'];
  const updateCols = columns.filter((c) => !pkCols.includes(c));
  const placeholders = columns.map(() => '?').join(', ');
  const colNames = columns.join(', ');

  if (updateCols.length === 0) {
    return `INSERT OR IGNORE INTO ${table} (${colNames}) VALUES (${placeholders})`;
  }

  const updateClause = updateCols.map((c) => `${c} = excluded.${c}`).join(', ');
  const conflictTarget = pkCols.join(', ');

  return `INSERT INTO ${table} (${colNames}) VALUES (${placeholders}) ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updateClause}`;
}

/**
 * Pull all data from Turso Cloud into local SQLite database.
 * Run on application startup so Render restores its state immediately.
 */
async function pullFromTurso() {
  const client = getTursoClient();
  if (!client) return { synced: false, reason: 'Turso not configured' };

  const db = getDatabase();
  console.log('[Turso] Synchronizing state from Turso Cloud...');

  let totalRowsPulled = 0;
  db.pragma('foreign_keys = OFF');

  try {
    for (const table of SYNCED_TABLES) {
      try {
        const result = await client.execute(`SELECT * FROM ${table}`);
        if (!result.rows || result.rows.length === 0) continue;

        const rows = result.rows;
        const columns = Object.keys(rows[0]);
        const upsertSql = buildUpsertSql(table, columns);
        const insertStmt = db.prepare(upsertSql);

        const insertAll = db.transaction((items) => {
          for (const item of items) {
            const values = columns.map((c) => item[c]);
            insertStmt.run(...values);
          }
        });

        insertAll(rows);
        totalRowsPulled += rows.length;
      } catch (tblErr) {
        console.warn(`[Turso] Could not pull table ${table}:`, tblErr.message);
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }

  console.log(`✅ [Turso] Cloud synchronization complete! Restored ${totalRowsPulled} records into local database.`);
  return { synced: true, totalRowsPulled };
}

/**
 * Push local database state up to Turso Cloud.
 * Uses atomic batches to ensure remote persistence.
 */
async function pushToTurso() {
  const client = getTursoClient();
  if (!client) return { synced: false, reason: 'Turso not configured' };

  const db = getDatabase();
  let totalRowsPushed = 0;

  for (const table of SYNCED_TABLES) {
    try {
      const localRows = db.prepare(`SELECT * FROM ${table}`).all();
      if (!localRows || localRows.length === 0) continue;

      const columns = Object.keys(localRows[0]);
      const upsertSql = buildUpsertSql(table, columns);

      const statements = localRows.map((row) => ({
        sql: upsertSql,
        args: columns.map((c) => row[c] === undefined ? null : row[c]),
      }));

      // Send in batches of 50 statements
      for (let i = 0; i < statements.length; i += 50) {
        const batch = statements.slice(i, i + 50);
        await client.batch(batch, 'write');
      }

      totalRowsPushed += localRows.length;
    } catch (tblErr) {
      console.warn(`[Turso] Could not push table ${table} to cloud:`, tblErr.message);
    }
  }

  return { synced: true, totalRowsPushed };
}

module.exports = {
  isTursoConfigured,
  pullFromTurso,
  pushToTurso,
  getTursoClient,
  buildUpsertSql,
};
