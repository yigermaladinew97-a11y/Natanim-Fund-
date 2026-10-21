const cron = require('node-cron');
const { config } = require('../config');
const { sendMonthlyReminders } = require('./reminders');
const { ensureMonthlyObligations } = require('./accounting');
const { getCurrentYearMonth } = require('../utils/formatters');

let reminderTask = null;
let rolloverTask = null;

function initScheduler(bot) {
  // If already running, stop previous tasks to avoid duplicates on reload
  stopScheduler();

  const timezone = config.timezone || 'Africa/Addis_Ababa';
  const cronExpr = config.reminderCronSchedule || '0 9 5 * *';

  console.log(`[Scheduler] Initializing background tasks with timezone: ${timezone}`);

  // 1. Monthly Rollover Task: Runs at 00:05 on the 1st of every month to ensure obligations exist
  try {
    rolloverTask = cron.schedule('5 0 1 * *', () => {
      try {
        const currentMonth = getCurrentYearMonth();
        console.log(`[Scheduler] Generating obligations for new month: ${currentMonth}`);
        const count = ensureMonthlyObligations(currentMonth);
        console.log(`[Scheduler] Created ${count} obligations for month ${currentMonth}`);
      } catch (err) {
        console.error('[Scheduler Error] Monthly obligation rollover failed:', err.message);
      }
    }, {
      timezone,
    });
  } catch (err) {
    console.error('[Scheduler] Failed to schedule rollover task:', err.message);
  }

  // 2. Automated Payment Reminder Task
  if (cron.validate(cronExpr)) {
    try {
      reminderTask = cron.schedule(cronExpr, async () => {
        try {
          const currentMonth = getCurrentYearMonth();
          console.log(`[Scheduler] Executing scheduled monthly reminders for ${currentMonth}...`);
          const res = await sendMonthlyReminders({
            bot,
            yearMonth: currentMonth,
            sentBy: 'SYSTEM_SCHEDULER',
            force: false,
          });
          console.log(`[Scheduler] Reminders sent: ${res.sentCount}, blocked: ${res.blockedCount}, failed: ${res.failedCount}, skipped: ${res.skippedCooldownCount}`);
        } catch (err) {
          console.error('[Scheduler Error] Automated reminder job failed:', err.message);
        }
      }, {
        timezone,
      });
      console.log(`[Scheduler] Reminder task scheduled (${cronExpr}) in ${timezone}`);
    } catch (err) {
      console.error('[Scheduler] Failed to schedule reminder task:', err.message);
    }
  } else {
    console.warn(`[Scheduler Warning] Invalid cron expression: "${cronExpr}". Scheduled reminders disabled.`);
  }
}

function stopScheduler() {
  if (rolloverTask) {
    rolloverTask.stop();
    rolloverTask = null;
  }
  if (reminderTask) {
    reminderTask.stop();
    reminderTask = null;
  }
}

module.exports = {
  initScheduler,
  stopScheduler,
};

