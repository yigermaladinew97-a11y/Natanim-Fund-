const { Telegraf } = require('telegraf');
const { config, validateConfig } = require('./config');
const { initDatabase, closeDatabase } = require('./db');
const { isTursoConfigured, pullFromTurso, pushToTurso } = require('./services/tursoService');
const { attachAuthContext } = require('./middleware/auth');
const { requirePrivateChat } = require('./middleware/chatType');
const { errorHandler } = require('./middleware/errorHandler');
const { initScheduler, stopScheduler } = require('./services/scheduler');

const { registerStartHandlers } = require('./handlers/start');
const { registerMemberHandlers } = require('./handlers/member');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerPaymentHandlers } = require('./handlers/payments');
const { registerReportHandlers } = require('./handlers/reports');
const { registerReminderHandlers } = require('./handlers/reminders');
const { registerWizardHandler } = require('./handlers/wizard');
const { registerBankInfoHandlers } = require('./handlers/bankInfo');
const { registerBroadcastHandlers } = require('./handlers/broadcast');

async function createBot() {
  validateConfig();

  // Initialize SQLite Database
  initDatabase();
  console.log(`[Database] SQLite connected at: ${config.databasePath}`);

  // Turso Cloud Sync on Startup (restores all records on cloud restarts)
  if (!config.isTest && isTursoConfigured()) {
    try {
      console.log('[Turso] Cloud database configured. Synchronizing initial state...');
      await pullFromTurso();
    } catch (tursoErr) {
      console.warn('⚠️ [Turso] Initial cloud synchronization warning:', tursoErr.message);
    }
  }

  // Create Telegraf Bot
  const bot = new Telegraf(config.botToken);

  // Catch unhandled errors
  bot.catch(errorHandler);

  // Middleware pipeline
  bot.use(requirePrivateChat);
  bot.use(attachAuthContext);

  // Register command and callback handlers
  registerStartHandlers(bot);
  registerMemberHandlers(bot);
  registerAdminHandlers(bot);
  registerPaymentHandlers(bot);
  registerBankInfoHandlers(bot);
  registerBroadcastHandlers(bot);
  registerReportHandlers(bot);
  registerReminderHandlers(bot);
  registerWizardHandler(bot);

  return bot;
}

async function main() {
  // Start minimal HTTP health check server immediately for cloud platforms (Render, Koyeb, etc.)
  const http = require('node:http');
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'Natanim Fund Telegram Bot',
      uptime: process.uptime(),
      tursoConfigured: isTursoConfigured(),
    }));
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[HTTP] Health check server listening on 0.0.0.0:${port}`);
  });

  // Process Crash Guards for 24/7 Production Stability
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Process CrashGuard] Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[Process CrashGuard] Uncaught Exception:', err.message, err.stack);
  });

  try {
    const bot = await createBot();

    // Start background cron jobs (scheduler)
    initScheduler(bot);

    // Register Telegram native Menu Button commands
    try {
      await bot.telegram.setMyCommands([
        { command: 'start', description: 'Open Main Menu & Welcome' },
        { command: 'bankinfo', description: 'View church contribution bank accounts' },
        { command: 'register', description: 'Register as a Church Fund Member' },
        { command: 'mystatus', description: 'Check monthly contribution status' },
        { command: 'submitpayment', description: 'Upload payment receipt / screenshot' },
        { command: 'history', description: 'View payment & obligation history' },
        { command: 'myprofile', description: 'View church member profile' },
        { command: 'language', description: 'Switch language / ቋንቋ ይምረጡ (አማርኛ / English)' },
        { command: 'submissions', description: 'Review submitted payment receipts (Staff)' },
        { command: 'paid', description: 'Record verified payment manually (Staff)' },
        { command: 'report', description: 'View monthly financial report (Staff)' },
        { command: 'unpaid', description: 'List members with unpaid balances (Staff)' },
        { command: 'members', description: 'Browse active members directory (Staff)' },
        { command: 'remind', description: 'Send reminders to unpaid members (Staff)' },
        { command: 'broadcast', description: 'Send announcement to members (Admin)' },
        { command: 'approvals', description: 'Review pending registrations (Admin)' },
        { command: 'setstaffgroup', description: 'Connect Telegram Staff Archive Group (Admin)' },
        { command: 'diagnostics', description: 'System health & operational diagnostics (Admin)' },
        { command: 'backup', description: 'Download live SQLite database backup (Admin)' },
        { command: 'restore', description: 'Restore SQLite database backup (Admin)' },
        { command: 'turso', description: 'Turso Cloud persistence sync (Admin)' },
        { command: 'addmember', description: 'Register new member (Admin backup)' },
        { command: 'calendar', description: 'View current Ethiopian Calendar (ዓ.ም.) date' },
        { command: 'help', description: 'Show all bot commands and guide' },
        { command: 'cancel', description: 'Cancel current operation' },
      ]);
      console.log('[Bot] Telegram bot menu commands configured successfully.');
    } catch (cmdErr) {
      console.warn('[Bot] Note: Could not set Telegram menu commands:', cmdErr.message);
    }

    // Ensure no stale webhooks block long polling
    try {
      console.log('[Bot] Clearing any leftover Telegram webhooks...');
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    } catch (whErr) {
      console.warn('[Bot] Note on deleteWebhook:', whErr.message);
    }

    // Start Telegram polling
    console.log('[Bot] Launching Natanim Fund Telegram bot (long polling)...');
    await bot.launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
    });
    console.log('✅ Natanim Fund Bot is now online and listening for messages.');

    // Graceful Shutdown handlers
    const shutdown = async (signal) => {
      console.log(`\n[Shutdown] Received ${signal}. Stopping services gracefully...`);
      stopScheduler();
      try {
        server.close();
      } catch (_) {}
      try {
        bot.stop(signal);
      } catch (_) {}
      if (isTursoConfigured()) {
        try {
          console.log('[Turso] Pushing state to Turso cloud before exit...');
          await pushToTurso();
          console.log('[Turso] Turso cloud state successfully persisted.');
        } catch (tursoErr) {
          console.warn('[Turso] Shutdown push warning:', tursoErr.message);
        }
      }
      closeDatabase();
      console.log('[Shutdown] All services stopped. Goodbye.');
      process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ Failed to start application:', err.message);
    process.exit(1);
  }
}

// Only launch automatically if executed directly from node CLI
if (require.main === module) {
  main();
}

module.exports = {
  createBot,
};

