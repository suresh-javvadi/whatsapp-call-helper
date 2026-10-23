// Small logger with timestamps: prints to the console and also appends to
// logs/YYYY-MM-DD.log (one file per day).
// Everything passes through sanitize() so phone numbers never appear in logs,
// even inside error messages that contain URLs.
const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
let fileLoggingFailed = false;

function timestamp() {
  return new Date().toLocaleTimeString();
}

// Local date as YYYY-MM-DD, used for the log file name.
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function writeToFile(line) {
  if (fileLoggingFailed) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, `${today()}.log`), `${today()} ${line}\n`);
  } catch (err) {
    // Keep running even if the log file can't be written; warn once.
    fileLoggingFailed = true;
    console.warn(`[${timestamp()}] WARNING: could not write log file (${err.code || err.message}). Logging to console only.`);
  }
}

function output(consoleFn, line) {
  consoleFn(line);
  writeToFile(line);
}

// Replace any run of 7+ digits (optionally starting with +) with a masked form.
function sanitize(text) {
  return String(text).replace(/\+?\d{7,}/g, (match) => maskPhone(match.replace('+', '')));
}

// "919876543210" -> "+**********10"
function maskPhone(digits) {
  const visible = digits.slice(-2);
  return '+' + '*'.repeat(Math.max(0, digits.length - 2)) + visible;
}

// Only log the first line of an error message: stack traces and Playwright
// call logs are noisy and may contain page details.
function describeError(err) {
  const message = err && err.message ? err.message : String(err);
  return sanitize(message.split('\n')[0]);
}

const log = {
  info: (msg) => output(console.log, `[${timestamp()}] ${sanitize(msg)}`),
  warn: (msg) => output(console.warn, `[${timestamp()}] WARNING: ${sanitize(msg)}`),
  error: (msg) => output(console.error, `[${timestamp()}] ERROR: ${sanitize(msg)}`),
  // Terminal bell, so you notice the reminder even if the window is in the background.
  bell: () => process.stdout.write('\x07'),
};

module.exports = { log, sanitize, maskPhone, describeError };
