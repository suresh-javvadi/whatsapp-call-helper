// Sends email notifications through Gmail (needs a Gmail App Password).
// The password is only read from .env and is never logged.
const nodemailer = require('nodemailer');
const { log, describeError } = require('./logger');

// Returns null when email is not configured, so callers can just skip it.
function createMailer(email) {
  if (!email) return null;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: email.smtpUser, pass: email.smtpPass },
  });

  return {
    // Checks the Gmail login once at startup so problems show up early.
    async verify() {
      try {
        await transporter.verify();
        log.info('Email notifications ready.');
      } catch (err) {
        log.warn(`Email login failed - check SMTP_USER and SMTP_PASS in .env (${describeError(err)}).`);
      }
    },

    // Never throws: a failed email must not stop the program.
    async send(subject, text) {
      try {
        await transporter.sendMail({ from: email.smtpUser, to: email.to, subject, text });
        log.info('Email sent.');
      } catch (err) {
        log.warn(`Could not send email (${describeError(err)}).`);
      }
    },
  };
}

module.exports = { createMailer };
