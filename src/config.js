// Loads and validates settings from .env.
const path = require('node:path');

class ConfigError extends Error {}

const PROJECT_ROOT = path.join(__dirname, '..');

// Accepts "+91 98765-43210" style input and returns digits only ("919876543210").
// E.164 rules: starts with +, country code cannot start with 0, 8 to 15 digits total.
function parsePhone(raw, name = 'FRIEND_PHONE') {
  if (!raw || !raw.trim()) {
    throw new ConfigError(`${name} is missing. Add it to your .env file (see .env.example).`);
  }
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!cleaned.startsWith('+')) {
    throw new ConfigError(`${name} must start with + and the country code, e.g. +14155552671.`);
  }
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    throw new ConfigError(
      `${name} is not a valid international number. ` +
        'Use + country code + number (8-15 digits), e.g. +14155552671.'
    );
  }
  return cleaned.slice(1);
}

function parseInterval(raw) {
  if (raw === undefined || raw.trim() === '') return 5;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    throw new ConfigError('INTERVAL_MINUTES must be a number between 1 and 1440.');
  }
  return minutes;
}

function parseAutoCall(raw) {
  if (raw === undefined || raw.trim() === '') return false;
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ConfigError('AUTO_CALL must be true or false.');
}

function parseMaxCalls(raw) {
  if (raw === undefined || raw.trim() === '') return 3;
  const calls = Number(raw);
  if (!Number.isInteger(calls) || calls < 1) {
    throw new ConfigError('MAX_CALLS must be a whole number of 1 or more.');
  }
  return calls;
}

// Email is optional: leave EMAIL_TO empty to turn it off.
function parseEmail(env) {
  const to = (env.EMAIL_TO || '').trim();
  if (!to) return null;

  const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const smtpUser = (env.SMTP_USER || '').trim();
  const smtpPass = (env.SMTP_PASS || '').replace(/\s/g, ''); // Gmail shows app passwords with spaces

  if (!isEmail(to)) throw new ConfigError('EMAIL_TO is not a valid email address.');
  if (!isEmail(smtpUser)) throw new ConfigError('SMTP_USER must be the Gmail address that sends the email.');
  if (!smtpPass) return null; // not set up yet - email stays off (index.js warns)

  return { to, smtpUser, smtpPass };
}

function loadConfig(env = process.env) {
  return {
    phoneDigits: parsePhone(env.FRIEND_PHONE),
    intervalMinutes: parseInterval(env.INTERVAL_MINUTES),
    autoCall: parseAutoCall(env.AUTO_CALL),
    maxCalls: parseMaxCalls(env.MAX_CALLS),
    email: parseEmail(env),
    // Optional: WhatsApp number that gets a message after an answered call.
    notifyPhoneDigits: env.NOTIFY_PHONE && env.NOTIFY_PHONE.trim() ? parsePhone(env.NOTIFY_PHONE, 'NOTIFY_PHONE') : null,
    chromePath: env.CHROME_PATH && env.CHROME_PATH.trim() ? env.CHROME_PATH.trim() : null,
    profileDir: path.join(PROJECT_ROOT, '.wa-profile'),
  };
}

// Reads .env from the project folder into process.env.
function loadEnvFile() {
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
}

module.exports = {
  loadConfig,
  loadEnvFile,
  parsePhone,
  parseInterval,
  parseAutoCall,
  parseMaxCalls,
  ConfigError,
};
