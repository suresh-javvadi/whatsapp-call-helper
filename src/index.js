// Entry point: `npm start`. Press Ctrl+C to stop.
const { loadConfig, loadEnvFile, ConfigError } = require('./config');
const { log, maskPhone, describeError } = require('./logger');
const { launchBrowser } = require('./browser');
const wa = require('./whatsapp');
const { Scheduler } = require('./scheduler');
const { createReminderTask, InvalidNumberError } = require('./helper');
const { createMailer } = require('./mailer');

let context = null;
let scheduler = null;
let shuttingDown = false;

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (scheduler) scheduler.stop();
  log.info('Stopping... closing Chrome. Your WhatsApp login is kept for next time.');
  if (context) await context.close().catch(() => {});
  log.info('Stopped.');
  process.exit(exitCode);
}

// Waits (as long as needed) until you have scanned the QR code.
async function waitForLogin(page) {
  await wa.openWhatsApp(page);
  let state = await wa.waitForState(page, [wa.STATES.LOGGED_IN, wa.STATES.NEEDS_LOGIN], 60_000);

  if (state === wa.STATES.NEEDS_LOGIN) {
    log.info('Please log in: on your phone open WhatsApp > Settings > Linked devices > Link a device,');
    log.info('then scan the QR code shown in the Chrome window. (This program never sees your login.)');
  }
  while (state !== wa.STATES.LOGGED_IN && !shuttingDown) {
    state = await wa.waitForState(page, [wa.STATES.LOGGED_IN], 120_000, () => shuttingDown);
    if (state !== wa.STATES.LOGGED_IN && !shuttingDown) log.info('Still waiting for you to log in...');
  }
}

async function main() {
  loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  log.info(`Friend's number: ${maskPhone(config.phoneDigits)} | interval: ${config.intervalMinutes} min`);
  log.info(config.autoCall ? `Auto-call ON (max ${config.maxCalls} attempts).` : 'Auto-call OFF (reminders only).');
  const mailer = createMailer(config.email);
  if (mailer) await mailer.verify();
  else if ((process.env.EMAIL_TO || '').trim()) {
    log.warn('EMAIL_TO is set but SMTP_PASS is empty - email alerts are off. See README to create a Gmail App Password.');
  }

  log.info('Starting Chrome...');
  const browser = await launchBrowser(config);
  context = browser.context;
  const page = browser.page;

  // If you close the Chrome window, stop the program cleanly.
  context.on('close', () => {
    if (!shuttingDown) {
      log.warn('Chrome was closed.');
      shutdown(0);
    }
  });

  await waitForLogin(page);
  if (shuttingDown) return;
  log.info('Logged in to WhatsApp Web.');

  const remind = createReminderTask({
    context,
    page,
    phoneDigits: config.phoneDigits,
    autoCall: config.autoCall,
    maxCalls: config.maxCalls,
    mailer,
    notifyPhoneDigits: config.notifyPhoneDigits,
  });
  scheduler = new Scheduler(async () => {
    try {
      await remind();
    } catch (err) {
      if (shuttingDown) return;
      if (err instanceof InvalidNumberError) {
        log.error(err.message);
        await shutdown(1);
        return;
      }
      throw err;
    }
  }, config.intervalMinutes * 60_000);
  scheduler.start();
}

process.on('SIGINT', () => shutdown(0)); // Ctrl+C
process.on('SIGTERM', () => shutdown(0));
process.on('SIGBREAK', () => shutdown(0)); // Ctrl+Break on Windows
process.on('unhandledRejection', (err) => {
  if (!shuttingDown) log.error(describeError(err));
});

main().catch(async (err) => {
  if (shuttingDown) return;
  log.error(describeError(err));
  await shutdown(1);
});
