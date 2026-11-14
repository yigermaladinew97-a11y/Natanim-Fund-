const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase } = require('../src/db');
const { registerAdminHandlers } = require('../src/handlers/admin');
const { registerWizardHandler } = require('../src/handlers/wizard');
const { registerPaymentHandlers } = require('../src/handlers/payments');
const { registerStartHandlers } = require('../src/handlers/start');
const { registerReminderHandlers } = require('../src/handlers/reminders');
const { registerBroadcastHandlers } = require('../src/handlers/broadcast');

test('Bot Handler Registration & Loading Integrity Tests', async (t) => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_handlers_integrity.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  initDatabase(testDbPath);

  const cleanup = () => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  };

  const createMockBot = () => {
    const commands = {};
    const actions = {};
    const hears = [];
    const ons = {};
    return {
      command(name, ...handlers) {
        const names = Array.isArray(name) ? name : [name];
        for (const n of names) commands[n] = handlers;
      },
      action(trigger, ...handlers) {
        actions[String(trigger)] = handlers;
      },
      hears(pattern, ...handlers) {
        hears.push({ pattern, handlers });
      },
      on(event, ...handlers) {
        ons[event] = handlers;
      },
      use() {},
      commands,
      actions,
      hearsList: hears,
      onsList: ons,
    };
  };

  await t.test('1. All handler registration modules load and bind to mock bot cleanly', () => {
    const bot = createMockBot();
    assert.doesNotThrow(() => {
      registerAdminHandlers(bot);
      registerWizardHandler(bot);
      registerPaymentHandlers(bot);
      registerStartHandlers(bot);
      registerReminderHandlers(bot);
      registerBroadcastHandlers(bot);
    });

    assert.ok(bot.commands['roles'], '/roles command must be registered');
    assert.ok(bot.commands['stafflink'], '/stafflink command must be registered');
    assert.ok(bot.commands['sendstafflink'], '/sendstafflink command must be registered');
    assert.ok(bot.commands['setstafflink'], '/setstafflink command must be registered');
    assert.ok(bot.actions['admin_role_get_link'], 'admin_role_get_link action must be registered');
  });

  cleanup();
});
