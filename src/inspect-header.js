// `npm run inspect` - opens your friend's chat and lists the buttons in the
// chat header (labels and icon names only), so the call-button selector in
// src/whatsapp.js can be fixed when WhatsApp changes its layout.
// Read-only: it never clicks anything. Stop `npm start` before running it.
const { loadConfig, loadEnvFile } = require('./config');
const { log, sanitize, describeError } = require('./logger');
const { launchBrowser } = require('./browser');
const wa = require('./whatsapp');

async function main() {
  loadEnvFile();
  const config = loadConfig();
  let browser;
  try {
    browser = await launchBrowser(config);
  } catch (err) {
    log.error(describeError(err));
    process.exitCode = 1;
    return;
  }
  const { context, page } = browser;
  try {
    log.info("Opening your friend's chat (log in with the QR code if asked)...");
    let state = await wa.openChat(page, config.phoneDigits);
    if (state === wa.STATES.NEEDS_LOGIN) {
      state = await wa.waitForState(page, [wa.STATES.LOGGED_IN], 180_000);
      state = await wa.openChat(page, config.phoneDigits);
    }
    if (state !== wa.STATES.CHAT_OPEN) {
      log.error(`Chat did not open (state: ${state}).`);
      return;
    }
    await page.waitForTimeout(3000); // let the header icons finish loading

    const items = await page.$$eval(
      '#main header button, #main header [role="button"], #main header [data-icon]',
      (els) =>
        els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          title: el.getAttribute('title') || '',
          dataIcon: el.getAttribute('data-icon') || '',
        }))
    );

    console.log('\nButtons/icons found in the chat header:');
    for (const item of items) console.log('  ' + sanitize(JSON.stringify(item)));
    console.log('\nCopy the lines above and share them so the call-button selector can be updated.');
  } catch (err) {
    log.error(describeError(err));
  } finally {
    await context.close().catch(() => {});
  }
}

main();
