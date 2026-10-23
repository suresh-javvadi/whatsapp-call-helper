// Starts your installed Google Chrome with a dedicated profile folder.
// The profile keeps the WhatsApp Web login between runs, so you only scan
// the QR code once. It is separate from your everyday Chrome profile.
const { chromium } = require('playwright-core');

const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';

async function launchBrowser({ profileDir, chromePath }) {
  const options = {
    headless: false,
    viewport: null, // use the real window size instead of a fixed viewport
    args: ['--start-maximized'],
    // We handle Ctrl+C ourselves so Chrome is closed cleanly.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
  if (chromePath) options.executablePath = chromePath;
  else options.channel = 'chrome';

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, options);
  } catch (err) {
    const hint =
      'Could not start Chrome. Check that Google Chrome is installed (or set CHROME_PATH in .env) ' +
      'and that another copy of this program is not already running.';
    throw new Error(`${hint} Details: ${err.message.split('\n')[0]}`);
  }

  // Allow the microphone for WhatsApp Web only, so voice calls work without
  // a permission popup. No other site gets this permission.
  await context.grantPermissions(['microphone'], { origin: WHATSAPP_ORIGIN });

  // Reuse the tab Chrome opened and close any extras (e.g. restored tabs),
  // so we always work in exactly one tab.
  const [firstPage, ...extraPages] = context.pages();
  const page = firstPage || (await context.newPage());
  for (const extra of extraPages) await extra.close().catch(() => {});

  return { context, page };
}

module.exports = { launchBrowser, WHATSAPP_ORIGIN };
