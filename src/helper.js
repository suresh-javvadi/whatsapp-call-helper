// What happens at each scheduled round.
//
// Automated:  bringing the WhatsApp tab to the front, (re)opening the
//             friend's chat if it is not already open and, when AUTO_CALL=true,
//             clicking the voice-call button (up to MAX_CALLS times per run).
// Manual:     everything about the call itself (talking, ending it).
const { log, describeError } = require('./logger');
const wa = require('./whatsapp');

class InvalidNumberError extends Error {}

// The MAX_CALLS counter starts again from zero every hour.
const CALL_LIMIT_RESET_MS = 60 * 60_000;

function remindToCall(page) {
  log.bell();
  log.info("REMINDER: your friend's chat is open in Chrome.");
  log.info('To call, click the phone (voice call) icon at the top of the chat yourself.');
}

function createReminderTask({ context, page, phoneDigits, autoCall, maxCalls, mailer, notifyPhoneDigits }) {
  // Name shown at the top of the friend's chat; remembered (never logged)
  // so we don't reload WhatsApp when the chat is already open.
  let friendChatTitle = null;
  let callAttempts = 0;
  let limitWindowStart = Date.now();
  let answered = false; // once your friend picks up, stop auto-calling

  async function reportOutcome() {
    const { outcome, word } = await wa.waitForCallOutcome(context, page);
    log.bell();

    if (outcome === wa.OUTCOMES.ANSWERED) {
      answered = true;
      log.info('>>> ANSWERED: your friend picked up the call. <<<');
      const answeredAt = new Date().toLocaleString();
      if (mailer) {
        // Not awaited, so watching the call isn't delayed by the email.
        mailer.send(
          'Your friend answered your WhatsApp call',
          `Your friend answered your WhatsApp voice call at ${new Date().toLocaleString()}.`
        );
      }
      const ms = await wa.waitForCallEnd(context, page);
      const minutes = Math.max(1, Math.round(ms / 60_000));
      log.info(`Call ended (about ${minutes} min).`);

      // Only now, after the call, is it safe to open another chat.
      if (notifyPhoneDigits) {
        log.info('Sending WhatsApp message to your notify number...');
        const text = `Your friend answered the WhatsApp call at ${answeredAt}. The call lasted about ${minutes} min.`;
        const sent = await wa.sendMessage(page, notifyPhoneDigits, text).catch(() => false);
        if (sent) log.info('WhatsApp message sent.');
        else log.warn('Could not send the WhatsApp message (check NOTIFY_PHONE and the Chrome window).');
      }
      log.info('Auto-calling is now off for this run because the call was answered.');
    } else if (outcome === wa.OUTCOMES.DECLINED) {
      log.info(`>>> DECLINED: your friend declined or is busy (WhatsApp showed "${word}"). <<<`);
    } else if (outcome === wa.OUTCOMES.ENDED_UNANSWERED) {
      log.info('>>> NOT ANSWERED: the call ended without being picked up (declined, missed, or hung up). <<<');
    } else {
      log.info('>>> NO ANSWER: still not picked up after 90 seconds. <<<');
    }
  }

  return async function remind() {
    if (page.isClosed()) throw new Error('The WhatsApp tab was closed.');

    if (await wa.looksLikeCallInProgress(context, page)) {
      log.info('A call (or another window) seems to be open - leaving the browser alone this round.');
      return;
    }

    const state = await wa.detectState(page);
    if (state === wa.STATES.NEEDS_LOGIN) {
      log.warn('WhatsApp Web is logged out. Scan the QR code in the Chrome window to continue.');
      await page.bringToFront();
      return;
    }

    const currentTitle = state === wa.STATES.CHAT_OPEN ? await wa.getOpenChatTitle(page) : null;
    const alreadyOpen = friendChatTitle !== null && currentTitle === friendChatTitle;

    if (!alreadyOpen) {
      log.info("Opening your friend's chat...");
      let result;
      try {
        result = await wa.openChat(page, phoneDigits);
      } catch (err) {
        if (/net::ERR_/.test(err.message)) {
          log.warn(`Network problem while opening WhatsApp (${describeError(err)}). Will retry next round.`);
          return;
        }
        throw err;
      }

      if (result === wa.STATES.INVALID_NUMBER) {
        throw new InvalidNumberError(
          'WhatsApp says the number is invalid or not on WhatsApp. Check FRIEND_PHONE in your .env file.'
        );
      }
      if (result === wa.STATES.NEEDS_LOGIN) {
        log.warn('WhatsApp Web is logged out. Scan the QR code in the Chrome window to continue.');
        await page.bringToFront();
        return;
      }
      if (result !== wa.STATES.CHAT_OPEN) {
        log.warn('The chat did not finish loading within 60 seconds (slow network?). Will retry next round.');
        return;
      }
      friendChatTitle = await wa.getOpenChatTitle(page);
    }

    await page.bringToFront();

    if (Date.now() - limitWindowStart >= CALL_LIMIT_RESET_MS) {
      if (callAttempts > 0 && !answered) log.info('An hour has passed - call counter reset.');
      callAttempts = 0;
      limitWindowStart = Date.now();
    }

    if (!autoCall || answered || callAttempts >= maxCalls) {
      remindToCall(page);
      return;
    }

    callAttempts++;
    log.info(`Clicking the voice-call button (attempt ${callAttempts} of ${maxCalls})...`);
    const result = await wa.startVoiceCall(context, page);

    if (result === wa.CALL_RESULTS.CALL_UI_SHOWN) {
      log.info('Calling... waiting to see whether your friend answers.');
      await reportOutcome();
    } else if (result === wa.CALL_RESULTS.NO_CALL_UI) {
      log.warn('Clicked the call button, but no call screen was detected. Check the Chrome window.');
    } else {
      callAttempts--; // nothing was clicked, so this attempt doesn't count
      log.warn('No voice-call button found in this chat (web calling may not be enabled for your account).');
      remindToCall(page);
    }

    if (callAttempts >= maxCalls && !answered) {
      const resumeAt = new Date(limitWindowStart + CALL_LIMIT_RESET_MS).toLocaleTimeString();
      log.info(`Reached MAX_CALLS (${maxCalls}) for this hour. Calling resumes after ${resumeAt}; reminders until then.`);
    }
  };
}

module.exports = { createReminderTask, InvalidNumberError };
