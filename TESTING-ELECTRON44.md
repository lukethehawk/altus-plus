# Altus + (Electron 44 fork)

Altus + installs and runs next to official Altus: it has its own Windows
installer identity, app title, autostart name and Electron user-data path, and
never reads or changes official Altus's sessions.

| Setting | Official Altus | Altus + |
|---|---|---|
| Product name | Altus | Altus + |
| App ID | harwara.aman.altus | com.lukethehawk.altusplus |
| Windows data directory | Usually `%APPDATA%\\Altus` | `%APPDATA%\\Altus Electron 44 Test` |
| whatsapp:// registration | Optional | **Disabled** |
| Electron | 35.1.5 | 44.10.1 |

The data directory keeps the name of the earlier "Altus Electron 44 Test"
builds, so accounts paired there stay logged in. A first install pairs new
WhatsApp Web sessions; nothing is copied from official Altus.

### Moving from "Altus Electron 44 Test" to Altus +

1. Quit the test build from the tray (both apps share the profile, so only
   one can run).
2. Install Altus +: the accounts are already there.
3. Uninstall "Altus Electron 44 Test" from Windows settings. Its uninstaller
   does not delete `%APPDATA%\\Altus Electron 44 Test`, and Altus + removes the
   test build's autostart entry on its first start.

## Build and installation on Windows

In GitHub Actions, open a successful **Altus + Windows installer** run on
`master` and download the `Altus-Plus-Windows` artifact. Extract the ZIP and
launch the contained installer.

Or locally, using Node.js 22 and Corepack:

```powershell
corepack enable
yarn install --immutable
yarn lint
yarn make -p win32
```

Verify the resulting installer/window says **Altus +** before
signing in. Windows SmartScreen may warn about unsigned binaries.

## Smoke tests

1. Launch official Altus and Altus + side by side; confirm their accounts and settings differ.
2. Pair a test WhatsApp account and verify it stays connected after closing/reopening.
3. Test download/upload, external links, clipboard copy/paste, media permissions,
   two accounts, notifications and close-to-tray.
4. Monitor idle CPU and RAM in Windows Task Manager with equal account counts.
5. Quit the test build and verify original Altus still starts with existing sessions.

## Regression checks for the hardening branches

Installing a newer Altus + build over an existing one keeps the same
`%APPDATA%\\Altus Electron 44 Test` profile, so paired accounts should stay
logged in.

1. **Voice message from a background tab:** with three accounts A, B, C,
   play a voice message in B, switch to A and then C: the audio keeps playing.
   Turning sound off for B silences only B.
2. **Notifications** arrive from all three accounts while another tab, or the
   tray, is in front.
3. **Links:** a link in a chat opens in the default browser; the tab stays on
   WhatsApp Web. Downloads, uploads, image previews and copy/paste still work.
4. **Reopen closed tab:** close a tab, use "Restore closed tab": the account
   is still logged in.
5. **Crash recovery:** in Task Manager end one of the "Altus +"
   renderer processes. The affected tab (or the whole window, if that
   renderer was the app UI) reloads within a few seconds on its own and stays
   logged in; other accounts are not reloaded.
6. Autostart on/off in settings still applies after a restart. With
   **Start in tray with Windows** also on, signing in to Windows shows only
   the tray icon. A message still notifies, and the tray icon or the
   notification opens the window with the accounts already connected.
   Opening Altus + from the Start menu always shows the window.
7. **Download notice:** download an attachment; "Attachment saved / Show in
   folder" appears for a few seconds and the button opens Explorer with the
   file selected. With "Show save dialog" on (the default) it appears after
   the file is saved.
8. **Multi-account notifications:** a message to a background account shows
   "<tab name> · <sender>" as title. Clicking it brings Altus forward (also
   from the tray), switches to that account and WhatsApp opens the chat.
9. **Per-account mute:** right-click a tab, "Mute notifications for 1 hour":
   that account shows a crossed bell and no desktop notifications, while
   unread counts still update and the other accounts still notify.
   "Unmute notifications" restores them; timed mutes expire on their own.
10. **In-app update:** with a newer release published (see
    `docs/RELEASING.md`), Help → Check for Updates says it is downloading,
    then offers "Restart now / Later". "Restart now" installs silently and
    reopens the new version with accounts and settings intact; "Later"
    installs it when the app is quit from the tray or menu. While it
    installs, a small "Updating Altus +" notice (in the app's language)
    stays on screen and closes when the install is done.
11. **Language:** a new profile starts in English. Settings → Language →
    Italiano switches menus, settings, tab dialogs, tray menu, the tab
    right-click menu and the exit prompt at once, with no English left;
    the choice survives a restart and English switches everything back.
12. **Original Altus on the PC (first install only):** the installer shows
    "Altus is already installed".
    - *Install next to Altus* leaves the original program, data and
      autostart untouched.
    - *Replace Altus* closes it and copies its profile into Altus +, which
      opens with the same tabs and settings and the accounts still logged in.
      It then renames `%APPDATA%\Altus` to `Altus (backup <date>)`,
      uninstalls the original and removes its `Altus` autostart entry.
    - Reinstalling or updating Altus + never shows the page.
13. **Enter keys**, in a real chat, with WhatsApp in Italian too:
    - with "Prevent sending message on Enter" on, Enter adds a new line and
      Ctrl+Enter sends;
    - with "Send with Right Shift + Enter" on, Right Shift + Enter sends
      (also twice in a row while holding Right Shift), and Left Shift +
      Enter adds a new line.

    `yarn test:keys` (also run in CI) checks the same key handling in an
    Electron window.
14. **Tray tooltip:** hovering the tray icon shows "Altus +" and one line per
    account in tab order, "<tab name>: <unread chats>", the same number as
    the tab badge. A muted account ends with "(muted)" ("(silenziato)" in
    Italian) until the mute expires. Renaming, reordering or closing a tab
    and switching language update it.
15. **Moving tabs:** by default dragging a tab does nothing. Tab → Allow
    Moving Tabs ticks the item; then dragging a tab onto another shows a
    blue line on the side it will land and moves it there on release, and
    the order survives a restart. Dropping a tab on the WhatsApp page or
    outside the window changes nothing. Unticking it stops dragging again,
    and the choice survives a restart. With the custom title bar on, the
    item shows a tick too.
16. **Resource Usage:** Help → Resource Usage lists every account in tab
    order with its CPU and memory, then WhatsApp's service workers and the
    app's own processes, with a total. It refreshes every 2 seconds while
    open; a busy account (e.g. scrolling a chat full of media) shows a
    higher CPU share. "Copy" puts the table on the clipboard.

### Automated smoke test

Every PR (`windows-package` check) and every `master` build run
`.github/scripts/smoke-test.mjs` on the packaged app. A `master` build that
fails it uploads no installer.

1. The fuses in the executable match `forge.config.ts`.
2. A modified `app.asar` is refused at startup.
3. On a fresh profile, the window loads in English with one tab. That tab
   reaches WhatsApp Web, and its preload reports the tab's ID. The app
   window has a Content-Security-Policy and logs no console errors,
   exceptions or CSP violations.
4. With "Start in tray with Windows" on, a start with `--hidden` (what the
   autostart entry runs) shows no window, yet the tab reaches WhatsApp
   Web. A start without it shows the window.
5. Three tabs: "Alfa" selected, "Beta" and "Gamma" in the background,
   Gamma with notifications muted. Run with the window shown and again
   started into the tray (`--hidden`):
   - a notification from Beta is real, titled "Beta · …", and its
     permission is granted; Gamma's is replaced by the silent stand-in;
   - a tone started in Alfa and in Beta keeps running and Chromium reports
     both as playing, so neither was stopped or suspended. No tab is muted,
     which is checked on its own: Chromium reports a muted tab as playing
     too;
   - with the window shown, switching to Beta leaves Alfa's tone playing;
   - with the window shown, dragging Alfa onto Gamma does nothing while
     "Allow Moving Tabs" is off (the default). Turned on with the setting
     the menu item saves, the item is ticked, and the same drag moves Alfa
     after Gamma, in the window and in `tabs.json`;
   - with the window shown, Help → Resource Usage lists the three accounts,
     each with its own memory, and the app's main process and window.

   Where the machine has no audio output (the selected tab is not reported
   as playing either), only the playing check is skipped, with a note. Run
   locally, the check plays a near-silent tone and shows a silent
   notification for a moment.
6. `Setup.exe /S --replace-altus` with fake original Altus data (Italian,
   tabs "Personale" and "Lavoro", autostart on):
   - the profile is copied and the backup folder is created;
   - the installed app opens those tabs, in Italian, on the original
     partitions;
   - the app's autostart entry runs the installed exe with `--hidden`.
7. A reinstall changes neither the Altus + profile nor the original data.
8. Uninstalling removes the program and keeps the profile.

Failures attach logs and screenshots (`smoke-artifacts`) to the run. Checks
6-8 install and uninstall for real, so they only run on GitHub's throwaway
runners. Locally, `yarn package -p win32` then `yarn smoke` runs checks 1-5
on a temporary profile.

### Packaged smoke run without touching your profile

`--user-data-dir` overrides the profile folder and skips autostart changes,
so a build can be checked on a throwaway profile. Keep the path short:
Chromium's CacheStorage fails beyond Windows' 260-character path limit.

```powershell
& ".\out\Altus +-win32-x64\Altus +.exe" --user-data-dir="$env:TEMP\altus-smoke"
```

Only use this branch for evaluation. Do not merge it into `master` until
Windows behavior and session isolation have been verified.
