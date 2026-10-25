const { Telegraf } = require('telegraf');
const { config, validateConfig } = require('./config');
const { initDatabase, closeDatabase } = require('./db');
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
        { command: 'addmember', description: 'Register new member (Admin backup)' },
        { command: 'calendar', description: 'View current Ethiopian Calendar (ዓ.ም.) date' },
        { command: 'help', description: 'Show all bot commands and guide' },
        { command: 'cancel', description: 'Cancel current operation' },
      ]);
      console.log('[Bot] Telegram bot menu commands configured successfully.');
    } catch (cmdErr) {
      console.warn('[Bot] Note: Could not set Telegram menu commands:', cmdErr.message);
    }

    // Process Crash Guards for 24/7 Production Stability
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Process CrashGuard] Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('[Process CrashGuard] Uncaught Exception:', err.message, err.stack);
    });

    // Start minimal HTTP health check server for cloud platforms (Render, Koyeb, etc.)
    const http = require('node:http');
    const port = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'Natanim Fund Telegram Bot', uptime: process.uptime() }));
    });
    server.listen(port, '0.0.0.0', () => {
      console.log(`[HTTP] Health check server listening on 0.0.0.0:${port}`);
    });

    // Start Telegram polling
    console.log('[Bot] Launching Natanim Fund Telegram bot (long polling)...');
    await bot.launch();
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

