// Reads the state of the WhatsApp Web page and opens a chat by phone number.
//
// WhatsApp Web has no public API for this. We only use:
//   - the public click-to-chat link  https://web.whatsapp.com/send?phone=<number>
//   - read-only checks of what is visible on the page.
// WhatsApp changes its page layout from time to time. If detection stops
// working, update the selectors below.
const { WHATSAPP_ORIGIN } = require('./browser');

const SELECTORS = {
  chatList: '#pane-side', // left-hand chat list, visible when logged in
  qrCode: 'canvas[aria-label], div[data-ref]', // QR code on the login screen
  openChatTitle: '#main header span[dir="auto"]', // name at the top of the open chat
  composeBox: '#main footer div[contenteditable="true"]', // message box of the open chat
  // Voice-call button in the chat header (only present if web calling is enabled).
  voiceCallButton: '#main header button[aria-label="Voice call" i], #main header [title="Voice call" i]',
  // Buttons that only exist while a call is in progress.
  endCallButton: '[aria-label*="end call" i], [aria-label*="hang up" i], [aria-label*="leave call" i]',
};

// Shown by WhatsApp when the number is malformed or not on WhatsApp.
const INVALID_NUMBER_TEXT = /phone number shared via url is invalid/i;

const STATES = {
  CHAT_OPEN: 'chat-open',
  INVALID_NUMBER: 'invalid-number',
  NEEDS_LOGIN: 'needs-login',
  LOGGED_IN: 'logged-in',
  LOADING: 'loading',
};

async function isVisible(locator) {
  return locator.first().isVisible().catch(() => false);
}

// One quick look at the page; never waits.
async function detectState(page) {
  if (await isVisible(page.getByText(INVALID_NUMBER_TEXT))) return STATES.INVALID_NUMBER;
  if (await isVisible(page.locator(SELECTORS.composeBox))) return STATES.CHAT_OPEN;
  if (await isVisible(page.locator(SELECTORS.qrCode))) return STATES.NEEDS_LOGIN;
  if (await isVisible(page.locator(SELECTORS.chatList))) return STATES.LOGGED_IN;
  return STATES.LOADING;
}

// Polls detectState() until one of the wanted states appears or the time runs out.
async function waitForState(page, wanted, timeoutMs, shouldStop = () => false) {
  const deadline = Date.now() + timeoutMs;
  let state = await detectState(page);
  while (!wanted.includes(state) && Date.now() < deadline && !shouldStop()) {
    await page.waitForTimeout(1000);
    state = await detectState(page);
  }
  return state;
}

async function openWhatsApp(page) {
  await page.goto(`${WHATSAPP_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

// Opens the chat with the given number using the click-to-chat link.
// Returns the resulting state (chat-open, invalid-number, needs-login or loading on timeout).
async function openChat(page, phoneDigits) {
  await page.goto(`${WHATSAPP_ORIGIN}/send?phone=${phoneDigits}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  return waitForState(page, [STATES.CHAT_OPEN, STATES.INVALID_NUMBER, STATES.NEEDS_LOGIN], 60_000);
}

async function getOpenChatTitle(page) {
  const title = page.locator(SELECTORS.openChatTitle).first();
  if (!(await isVisible(title))) return null;
  return (await title.textContent().catch(() => null)) || null;
}

// Best-effort check for a call in progress. WhatsApp may show a call in a
// separate window or inside the page; we look for both. When in doubt, the
// caller leaves the browser alone.
async function looksLikeCallInProgress(context, mainPage) {
  const otherWindows = context.pages().filter((p) => p !== mainPage && !p.isClosed());
  if (otherWindows.length > 0) return true;
  return isVisible(mainPage.locator(SELECTORS.endCallButton));
}

const CALL_RESULTS = {
  CALL_UI_SHOWN: 'call-ui-shown', // a call window/screen appeared after the click
  NO_CALL_UI: 'no-call-ui', // clicked, but no call screen was detected
  NO_BUTTON: 'no-button', // no voice-call button in this chat
};

// Clicks the voice-call button of the open chat, then checks for up to
// 15 seconds whether a call screen appeared. This can confirm that a call
// screen opened - not that the call rang or was answered.
async function startVoiceCall(context, page) {
  // The header buttons render a moment after the chat itself, so wait for it.
  const button = page.locator(SELECTORS.voiceCallButton).first();
  const appeared = await button
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return CALL_RESULTS.NO_BUTTON;

  await button.click({ timeout: 10_000 });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await looksLikeCallInProgress(context, page)) return CALL_RESULTS.CALL_UI_SHOWN;
    await page.waitForTimeout(1000);
  }
  return CALL_RESULTS.NO_CALL_UI;
}

// ---- Call outcome detection (best effort) --------------------------------
// WhatsApp exposes no "answered"/"declined" event, so we read the text of the
// call screen only (never the chat list or messages):
//   - a running timer like 0:05  -> the call was answered
//   - words like Declined/Busy   -> declined
//   - call screen gone, no timer -> ended without being answered
const CALL_TIMER = /\b\d{1,2}:\d{2}(:\d{2})?\b/;
const DECLINE_WORDS = /declined|busy|unavailable|not answered|no answer|unanswered|couldn.t connect/i;

const OUTCOMES = {
  ANSWERED: 'answered',
  DECLINED: 'declined',
  ENDED_UNANSWERED: 'ended-unanswered',
  NO_ANSWER_TIMEOUT: 'no-answer-timeout',
};

async function readCallScreen(context, mainPage) {
  const texts = [];

  // Call shown in its own window.
  for (const p of context.pages()) {
    if (p === mainPage || p.isClosed()) continue;
    texts.push(await p.locator('body').innerText({ timeout: 2000 }).catch(() => ''));
  }

  // Call shown inside the main page: read only the small area around the
  // end-call button, stopping before the chat area.
  const inPageText = await mainPage
    .evaluate((selector) => {
      const button = document.querySelector(selector);
      if (!button) return null;
      let area = button;
      for (let i = 0; i < 5 && area.parentElement; i++) {
        const parent = area.parentElement;
        if (parent.id === 'main' || parent.id === 'app' || parent === document.body) break;
        area = parent;
      }
      return area.innerText || '';
    }, SELECTORS.endCallButton)
    .catch(() => null);
  if (inPageText !== null) texts.push(inPageText);

  return { active: texts.length > 0, text: texts.join('\n') };
}

// Watches a just-started call until it is answered, declined or ends.
async function waitForCallOutcome(context, page, ringTimeoutMs = 90_000) {
  const deadline = Date.now() + ringTimeoutMs;
  let lastText = '';
  while (Date.now() < deadline) {
    const screen = await readCallScreen(context, page);
    if (!screen.active) {
      const word = lastText.match(DECLINE_WORDS);
      return word ? { outcome: OUTCOMES.DECLINED, word: word[0] } : { outcome: OUTCOMES.ENDED_UNANSWERED };
    }
    if (CALL_TIMER.test(screen.text)) return { outcome: OUTCOMES.ANSWERED };
    const word = screen.text.match(DECLINE_WORDS);
    if (word) return { outcome: OUTCOMES.DECLINED, word: word[0] };
    lastText = screen.text;
    await page.waitForTimeout(1000);
  }
  return { outcome: OUTCOMES.NO_ANSWER_TIMEOUT };
}

// Waits until the call screen disappears; returns roughly how long that took.
async function waitForCallEnd(context, page) {
  const start = Date.now();
  while ((await readCallScreen(context, page)).active) {
    await page.waitForTimeout(2000);
  }
  return Date.now() - start;
}

// Sends a text message using the click-to-chat link with pre-filled text,
// then presses Enter. Must NOT be used during a call: opening another chat
// reloads WhatsApp Web and would drop the call.
// Returns true when the message box emptied after Enter (i.e. it was sent).
async function sendMessage(page, phoneDigits, text) {
  const url = `${WHATSAPP_ORIGIN}/send?phone=${phoneDigits}&text=${encodeURIComponent(text)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const state = await waitForState(page, [STATES.CHAT_OPEN, STATES.INVALID_NUMBER, STATES.NEEDS_LOGIN], 60_000);
  if (state !== STATES.CHAT_OPEN) return false;

  const box = page.locator(SELECTORS.composeBox).first();
  const hasText = async () => ((await box.innerText().catch(() => '')) || '').trim().length > 0;

  // Wait for WhatsApp to fill in the text from the link.
  const deadline = Date.now() + 10_000;
  while (!(await hasText()) && Date.now() < deadline) await page.waitForTimeout(500);
  if (!(await hasText())) return false;

  await box.press('Enter');

  const sentDeadline = Date.now() + 10_000;
  while ((await hasText()) && Date.now() < sentDeadline) await page.waitForTimeout(500);
  return !(await hasText());
}

module.exports = {
  STATES,
  CALL_RESULTS,
  OUTCOMES,
  sendMessage,
  startVoiceCall,
  waitForCallOutcome,
  waitForCallEnd,
  detectState,
  waitForState,
  openWhatsApp,
  openChat,
  getOpenChatTitle,
  looksLikeCallInProgress,
};
