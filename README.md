# WhatsApp Call Helper

Every few minutes, this program opens a friend's chat in WhatsApp Web (in Google Chrome) and reminds you, so you can start a voice call with one click.

**Auto-call mode (`AUTO_CALL=true`):** at each interval the program clicks the **voice call** button in your friend's chat, up to `MAX_CALLS` times per run (default 3). After that it only sends reminders. It never clicks while a call seems to be in progress.

Things to know:

- WhatsApp has no supported API for this. The program clicks the button on the page, so it can break when WhatsApp changes its page layout.
- WhatsApp's terms forbid automated use of personal accounts, so there is a small risk to your account. Make sure your friend is happy to get these calls.
- It can only confirm that a call screen **opened**. It cannot confirm that the call rang or was answered.

With `AUTO_CALL=false` (the default), it only opens the chat and reminds you to click the call button yourself.

## What is automated vs. what you do

| Automated by the program | Done by you |
| --- | --- |
| Starting Chrome with its own profile folder | Scanning the QR code to log in (once) |
| Opening `web.whatsapp.com` and waiting for login | Clicking the **voice call** icon (only when `AUTO_CALL=false` or the limit is reached) |
| Opening your friend's chat with the official click-to-chat link | Talking, muting and ending the call |
| Bringing that tab to the front every *N* minutes, plus a terminal beep | Stopping the program with Ctrl+C |
| Clicking the voice-call button when `AUTO_CALL=true` (max `MAX_CALLS` per run) | |
| Skipping a round if a call seems to be in progress | |

The program never reads, sends or deletes messages, and never says a call was answered.

## Requirements

- Windows with **Node.js 18+** (`node --version`)
- **Google Chrome** installed
- A WhatsApp account on your phone. Calls from WhatsApp Web only work if WhatsApp has turned on web calling for your account. If you don't see a phone icon at the top of a chat in WhatsApp Web, use the WhatsApp desktop app or your phone instead.

## Setup

```powershell
cd S:\Projects\zzzzz\whatsapp-call-helper
npm install
Copy-Item .env.example .env
notepad .env
```

In `.env`, set:

```ini
FRIEND_PHONE=+91 98765 43210   # + country code + number
INTERVAL_MINUTES=5             # 1 to 1440
CHROME_PATH=                   # leave empty unless Chrome is in an unusual location
```

Check it:

```powershell
npm run check
```

## Email alert when your friend answers (optional)

The program can email you when your friend picks up. It sends through Gmail using an **App Password**, a separate 16-character password for apps. Your normal Gmail password is never used.

1. Turn on 2-Step Verification for your Google account (required for App Passwords).
2. Open <https://myaccount.google.com/apppasswords>, create an app password named "WhatsApp helper", and copy it.
3. In `.env`:

   ```ini
   EMAIL_TO=you@gmail.com     # where the alert goes
   SMTP_USER=you@gmail.com    # Gmail account that sends it
   SMTP_PASS=abcd efgh ijkl mnop
   ```

4. Run `npm run check`. It should show `Email alerts : ON`. When you `npm start`, the terminal shows `Email notifications ready.` if the Gmail login works.

The password is only read from `.env` and is never written to the terminal or log files. To remove access later, delete the app password on the same Google page.

## WhatsApp message when your friend answers (optional)

Set `NOTIFY_PHONE=+<country code><number>` in `.env`. After an answered call **ends**, the program sends that number a WhatsApp message from your account, saying when your friend answered and how long the call lasted. It waits for the call to end because opening another chat during a call would drop the call.

## Start and stop

```powershell
npm start
```

1. A Chrome window opens on WhatsApp Web.
2. **First run only:** on your phone, open WhatsApp > Settings > Linked devices > Link a device, and scan the QR code. The program does not see or store your login. The session is kept in the `.wa-profile` folder.
3. Your friend's chat opens, the terminal beeps, and it shows a reminder. Click the phone icon to call.
4. This repeats every `INTERVAL_MINUTES`.

**To stop:** press **Ctrl+C** in the terminal. Chrome closes cleanly. If Windows asks `Terminate batch job (Y/N)?`, type `Y`. Closing the Chrome window also stops the program.

## Testing safely with your own number first

1. Set `FRIEND_PHONE` to **your own** number (WhatsApp opens your "Message yourself" chat), and use `INTERVAL_MINUTES=1`.
2. Run `npm start`. Check that:
   - only one Chrome tab is used,
   - the chat opens and the reminder appears every minute,
   - the terminal shows your number masked (`+********10`), never in full.
3. Try the failure cases:
   - **Invalid number:** set `FRIEND_PHONE=12345`. `npm run check` should report the error.
   - **Number not on WhatsApp:** use a valid-looking number that isn't on WhatsApp. The program should report it and stop.
   - **Network:** turn Wi-Fi off for one round. You should see a warning, then a retry on the next round.
   - **Browser closed:** close the Chrome window. The program should stop.
4. When everything works, put your friend's number back and set the interval to 5.

## How it avoids disrupting calls

- If your friend's chat is already open, it does **not** reload the page. It only brings the tab to the front.
- If a second window is open (such as a call window) or an "end call" button is visible, it does nothing that round.
- Rounds never overlap. The next round is only scheduled after the current one finishes.

These checks rely on WhatsApp Web's page layout, which WhatsApp can change. If detection stops working, update `SELECTORS` in [src/whatsapp.js](src/whatsapp.js).

## Project structure

```text
src/
  index.js          entry point, startup, Ctrl+C handling
  config.js         reads and validates .env
  check-config.js   `npm run check`
  inspect-header.js `npm run inspect` - lists chat-header buttons (read-only)
  logger.js         timestamped logs with phone-number masking
  browser.js        starts Chrome (single tab, dedicated profile)
  whatsapp.js       page-state detection, click-to-chat link, call button
  helper.js         what happens at each round (call or reminder)
  scheduler.js      non-overlapping interval runner
```

## Privacy

- `.env` (your friend's number) and `.wa-profile/` (your WhatsApp session) are in `.gitignore`. Never share the `.wa-profile` folder: anyone who has it can use your WhatsApp Web session.
- To log out completely, remove the linked device on your phone (WhatsApp > Linked devices) and delete `.wa-profile`.
- The microphone permission is granted to `https://web.whatsapp.com` only, inside this program's own Chrome profile.
