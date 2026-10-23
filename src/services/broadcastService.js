const { getDatabase } = require('../db');

function getActiveBroadcastRecipients() {
  const db = getDatabase();
  return db.prepare(`
    SELECT id, full_name, telegram_id, phone
    FROM members
    WHERE status = 'active'
      AND telegram_id IS NOT NULL
      AND TRIM(telegram_id) != ''
      AND telegram_id NOT LIKE 'CHURCH_MEMBER_%'
      AND telegram_id GLOB '[0-9]*'
    ORDER BY id ASC
  `).all();
}

async function sendChurchBroadcast({
  telegram,
  messageType = 'text',
  text = null,
  fileId = null,
  caption = null,
  actorTelegramId,
  throttleMs = 35,
}) {
  const recipients = getActiveBroadcastRecipients();
  const startTime = Date.now();

  const results = {
    totalRecipients: recipients.length,
    sentCount: 0,
    failedCount: 0,
    blockedCount: 0,
    durationMs: 0,
    details: [],
  };

  for (const m of recipients) {
    try {
      if (messageType === 'photo') {
        await telegram.sendPhoto(m.telegram_id, fileId, {
          caption: caption || undefined,
          parse_mode: 'HTML',
        });
      } else if (messageType === 'document') {
        await telegram.sendDocument(m.telegram_id, fileId, {
          caption: caption || undefined,
          parse_mode: 'HTML',
        });
      } else {
        await telegram.sendMessage(m.telegram_id, text, {
          parse_mode: 'HTML',
        });
      }

      results.sentCount++;
      results.details.push({
        memberId: m.id,
        telegramId: m.telegram_id,
        status: 'SENT',
      });
    } catch (err) {
      let status = 'FAILED';
      const errMsg = err.message || 'Unknown Telegram error';

      if (
        errMsg.includes('bot was blocked by the user') ||
        errMsg.includes('chat not found') ||
        errMsg.includes('user is deactivated')
      ) {
        status = 'BLOCKED';
        results.blockedCount++;
      } else {
        results.failedCount++;
      }

      results.details.push({
        memberId: m.id,
        telegramId: m.telegram_id,
        status,
        error: errMsg,
      });
    }

    // Gentle throttling to respect Telegram limits
    if (throttleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }

  results.durationMs = Date.now() - startTime;

  // Record audit log entry
  const db = getDatabase();
  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, actor_telegram_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('SEND_BROADCAST', 'broadcast', String(Date.now()), String(actorTelegramId), JSON.stringify({
    messageType,
    totalRecipients: results.totalRecipients,
    sentCount: results.sentCount,
    failedCount: results.failedCount,
    blockedCount: results.blockedCount,
    durationMs: results.durationMs,
    previewSnippet: (text || caption || '').slice(0, 100),
  }));

  return results;
}

module.exports = {
  getActiveBroadcastRecipients,
  sendChurchBroadcast,
};
