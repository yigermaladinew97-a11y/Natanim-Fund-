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
        { command: 'mystatus', description: 'Check monthly contribution status' },
        { command: 'history', description: 'View payment & obligation history' },
        { command: 'myprofile', description: 'View church member profile' },
        { command: 'paid', description: 'Record verified payment (Staff)' },
        { command: 'report', description: 'View monthly financial report (Staff)' },
        { command: 'unpaid', description: 'List members with unpaid balances (Staff)' },
        { command: 'members', description: 'Browse active members directory (Staff)' },
        { command: 'remind', description: 'Send reminders to unpaid members (Staff)' },
        { command: 'addmember', description: 'Register new member (Admin)' },
        { command: 'help', description: 'Show all bot commands and guide' },
        { command: 'cancel', description: 'Cancel current operation' },
      ]);
      console.log('[Bot] Telegram bot menu commands configured successfully.');
    } catch (cmdErr) {
      console.warn('[Bot] Note: Could not set Telegram menu commands:', cmdErr.message);
    }

    // Start Telegram polling
    console.log('[Bot] Launching Natanim Fund Telegram bot (long polling)...');
    await bot.launch();
    console.log('✅ Natanim Fund Bot is now online and listening for messages.');

    // Graceful Shutdown handlers
    const shutdown = async (signal) => {
      console.log(`\n[Shutdown] Received ${signal}. Stopping services gracefully...`);
      stopScheduler();
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

