const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { isTursoConfigured, buildUpsertSql, pullFromTurso, pushToTurso } = require('../src/services/tursoService');
const { config } = require('../src/config');
const { initDatabase, closeDatabase } = require('../src/db');

describe('Turso Cloud SQLite Synchronization Service Tests', () => {
  before(() => {
    initDatabase(':memory:');
  });

  after(() => {
    closeDatabase();
  });

  test('1. isTursoConfigured reflects config environment values', () => {
    const originalUrl = config.tursoDatabaseUrl;
    const originalToken = config.tursoAuthToken;

    config.tursoDatabaseUrl = '';
    config.tursoAuthToken = '';
    assert.strictEqual(isTursoConfigured(), false);

    config.tursoDatabaseUrl = 'libsql://example.turso.io';
    config.tursoAuthToken = 'sample_token';
    assert.strictEqual(isTursoConfigured(), true);

    // Restore
    config.tursoDatabaseUrl = originalUrl;
    config.tursoAuthToken = originalToken;
  });

  test('2. buildUpsertSql constructs ON CONFLICT DO UPDATE query for primary keys', () => {
    const memberCols = ['id', 'telegram_id', 'full_name', 'phone', 'status', 'joined_date', 'notes'];
    const memberSql = buildUpsertSql('members', memberCols);
    assert.ok(memberSql.includes('INSERT INTO members'));
    assert.ok(memberSql.includes('ON CONFLICT(id) DO UPDATE SET'));
    assert.ok(memberSql.includes('full_name = excluded.full_name'));

    // Composite primary key (group_topics)
    const topicCols = ['group_id', 'topic_key', 'topic_name', 'thread_id'];
    const topicSql = buildUpsertSql('group_topics', topicCols);
    assert.ok(topicSql.includes('INSERT INTO group_topics'));
    assert.ok(topicSql.includes('ON CONFLICT(group_id, topic_key) DO UPDATE SET'));
    assert.ok(topicSql.includes('topic_name = excluded.topic_name'));
  });

  test('3. pullFromTurso and pushToTurso return graceful unconfigured result when missing credentials', async () => {
    const originalUrl = config.tursoDatabaseUrl;
    config.tursoDatabaseUrl = '';

    const pushRes = await pushToTurso();
    assert.strictEqual(pushRes.synced, false);
    assert.strictEqual(pushRes.reason, 'Turso not configured');

    const pullRes = await pullFromTurso();
    assert.strictEqual(pullRes.synced, false);
    assert.strictEqual(pullRes.reason, 'Turso not configured');

    config.tursoDatabaseUrl = originalUrl;
  });
});
