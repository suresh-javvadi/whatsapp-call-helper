// `npm run check` - validates .env without opening the browser.
const { loadConfig, loadEnvFile, ConfigError } = require('./config');
const { maskPhone } = require('./logger');

loadEnvFile();

try {
  const config = loadConfig();
  console.log('Configuration looks good:');
  console.log(`  Friend's number : ${maskPhone(config.phoneDigits)} (masked)`);
  console.log(`  Interval        : every ${config.intervalMinutes} minute(s)`);
  console.log(
    `  Auto-call       : ${config.autoCall ? `ON (max ${config.maxCalls} attempts per run)` : 'OFF (reminders only)'}`
  );
  const emailStatus = config.email
    ? `ON (to ${config.email.to})`
    : (process.env.EMAIL_TO || '').trim()
      ? 'OFF - SMTP_PASS is empty (add a Gmail App Password)'
      : 'OFF';
  console.log(`  Email alerts    : ${emailStatus}`);
  console.log(
    `  WhatsApp alert  : ${config.notifyPhoneDigits ? `ON (to ${maskPhone(config.notifyPhoneDigits)}, after the call ends)` : 'OFF'}`
  );
  console.log(`  Chrome        : ${config.chromePath ? 'custom path from CHROME_PATH' : 'installed Google Chrome'}`);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
