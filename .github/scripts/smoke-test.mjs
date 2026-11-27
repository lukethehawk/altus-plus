// Smoke test of the packaged Windows app, run by CI after `yarn make`.
//
//   node .github/scripts/smoke-test.mjs              checks 1-6 (`yarn smoke`)
//   node .github/scripts/smoke-test.mjs --installer  checks 1-10
//
// 1. fuses baked into the executable; app.asar holds only the built app,
//    with the main and preload bundles, the window page, and the tray icons
//    and translations the main process reads (an English run would not miss
//    the translations);
// 2. a modified app.asar is refused at startup;
// 3. a fresh profile (--user-data-dir) opens the window and a WhatsApp Web tab,
//    with no errors in the app window; a WhatsApp address that redirects to
//    another site leaves the tab on WhatsApp, opening nothing; started by a
//    whatsapp:// link, its only account opens the chat (and a run on its own
//    profile never registers the app for the links), and the window opens
//    on screen although its remembered position is on no connected display;
// 4. "Start in tray with Windows": started with the autostart flag the window
//    stays hidden while the tab still loads; started by hand it opens.
//    The profile starts without tabs.json, as if it were lost: the first
//    start saves a new tab, and the second one must keep the data of the
//    accounts the list no longer names (it used to delete them), delete only
//    the folder of a tab closed earlier, and record the tab closed by hand.
//    Saved files left unreadable (cut off, NUL bytes) no longer stop the
//    start: each is kept as <name>.corrupt-<time>.json, the app starts with
//    defaults and says so, and the tab list is rebuilt from the account
//    folders (minus the tab closed earlier), deleting nothing; a folder
//    with Telegram's data comes back as a Telegram tab;
// 5. tabs in the background, also with the whole app in the tray, keep
//    playing sound (also after switching tab) and show notifications labelled
//    with their account, and a muted account's notification is suppressed.
//    Permissions come from the main process: a location request is refused,
//    and turning a tab's Notifications and Microphone and Camera off (in the
//    saved tab list) makes it report and get "denied" at once, until they
//    are turned on again. (The microphone only where WhatsApp's page allows
//    it: its login page at times blocks it by Permissions-Policy.)
//    A page's unread count goes to its own tab even when the page claims
//    another tab's ID, a replaced <title> is still counted, and a click on
//    a notification made by a script does not bring the tab forward.
//    The window cannot save a tab list main could misread (a tab ID that
//    cannot name a partition folder, the same account twice, no list at
//    all) or a theme list of the wrong shape; tabs as earlier versions saved
//    them are still accepted.
//    Tabs move by dragging only once "Allow Moving Tabs" is on, and
//    Help → Resource Usage lists every account and recognises every process.
//    A whatsapp:// link reaching the running app asks which account opens it
//    (Cancel opens nothing; a link that is not a chat or invite is ignored).
//    It plays a near-silent tone and shows a silent notification for a moment.
//    A Telegram account next to a WhatsApp one: the Telegram tab reaches
//    Telegram Web (K version) with its own preload, gets notifications
//    labelled with its account (none while muted) and its unread count from
//    the page's app badge, on its own tab; it stays on the K version and on
//    Telegram (a redirect to WhatsApp is cancelled, as one from WhatsApp to
//    Telegram), opens nothing without a click, and the window cannot change
//    a tab's service. "+" asks for the service, WhatsApp first;
// 6. With the custom title bar, turning it off and reloading the page's
//    settings keeps it until the restart, which comes without it. The
//    window's listeners get the message alone, not Electron's event, and
//    the title bar's blur listener can be removed.
//    Help → Run Resource Test restarts the app into the test, which records
//    the three accounts into a CSV file; a file downloaded in a tab during
//    the test lands in the folder from Settings with "Attachment saved";
//    Help → End Resource Test writes the
//    summary and restarts the app normally (it also opens Explorer there).
//    The tabs send unread counts nonstop while the app closes to restart;
//    one reaching the destroyed window used to hold it with an error box;
// 7. the installer replaces a fake original Altus (/S --replace-altus), the
//    installed app opens its tabs and settings and registers autostart; on
//    the next start it leaves the entry alone (no reg.exe), and writes it
//    again once deleted; Windows' installed programs list shows the version
//    and lukethehawk as publisher (with the original's publisher, WinGet and
//    UniGetUI offered the original's updates as updates of Altus +);
//    with "Open whatsapp:// links" on, the app registers for the links, a
//    link started through Windows asks which account opens it, and turning
//    the setting off removes the registration; turning "Launch at system
//    startup" off and on removes and writes the autostart entry at once,
//    also after quick changes in a row;
// 8. reinstalling never migrates again or touches the Altus + profile, and
//    leaves one entry in the installed programs list, the link
//    registration and the autostart entry;
// 9. uninstalling removes the program, its link registration and its
//    autostart entry, and keeps the profile;
// 10. an install for all users (with administrator rights) replacing an
//    original Altus that HKCU says is installed for the user moves the data,
//    closes the running Altus and removes its autostart entry, but runs no
//    "Uninstall Altus.exe" from the folder HKCU names, which any program of
//    the user could have pointed at its own.
//
// Checks 7-10 install Altus +, write %APPDATA% and uninstall, so they only run
// on a GitHub-hosted runner, which is discarded afterwards. The app is
// observed through Chromium's DevTools protocol (--remote-debugging-port) and
// stopped by PID. Failures leave logs and screenshots in smoke-artifacts/.
// A tab that does not reach its service's page in 90 s is reloaded once, and
// the notes say what every page of the app was doing then.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const PACKAGED_EXE = path.join(root, "out", `${packageJson.productName}-win32-x64`, `${packageJson.productName}.exe`);
const PROFILE_FOLDER = read("src/utils/isolation.ts").match(/LEGACY_TEST_BUILD_NAME = "([^"]+)"/)[1];
const ADD_TAB_LABEL = {
  en: JSON.parse(read("public/locales/en/translation.json"))["Add New Tab"],
  it: JSON.parse(read("public/locales/it/translation.json"))["Add New Tab"],
};
const ARTIFACTS = path.join(root, "smoke-artifacts");
const TEMP = process.env.RUNNER_TEMP || os.tmpdir();
const APPDATA = process.env.APPDATA;
const runInstaller = process.argv.includes("--installer");

// --- helpers ---------------------------------------------------------------

async function waitFor(what, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}${lastError ? ` (${lastError.message})` : ""}`);
}

function launch(exe, args) {
  const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
  const app = { child, output: "", exited: false, exitCode: null };
  child.stdout.on("data", (data) => (app.output += data));
  child.stderr.on("data", (data) => (app.output += data));
  child.on("exit", (code) => Object.assign(app, { exited: true, exitCode: code }));
  child.on("error", (error) => Object.assign(app, { exited: true, output: app.output + String(error) }));
  return app;
}

/** Stops the app and its Chromium child processes by PID, never by name. */
async function stop(app) {
  if (!app.exited) spawnSync("taskkill", ["/PID", String(app.child.pid), "/T", "/F"], { stdio: "ignore" });
  await waitFor("the app to exit", 30_000, () => app.exited);
  await sleep(2000); // let Chromium release the profile's files
}

/**
 * Visible top-level Chromium windows of a process (Win32 IsWindowVisible).
 * Unlike document.visibilityState it does not depend on the window being
 * covered or the screen being locked.
 */
function visibleWindowCount(pid) {
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class SmokeWindows {
  public delegate bool Callback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  public static int CountVisible(uint pid) {
    int count = 0;
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      var name = new StringBuilder(64); GetClassName(window, name, 64);
      if (owner == pid && name.ToString() == "Chrome_WidgetWin_1" && IsWindowVisible(window)) count++;
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
"@
[SmokeWindows]::CountVisible(${Number(pid)})`;
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  const count = Number.parseInt(result.stdout.trim(), 10);
  if (Number.isNaN(count)) throw new Error(`could not read the app's windows: ${result.stderr.trim().slice(0, 200)}`);
  return count;
}

/** Titles of the message boxes (Win32 dialog class #32770) a process shows. */
function visibleDialogTitles(pid) {
  const script = `
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class SmokeDialogs {
  public delegate bool Callback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
  public static string Titles(uint pid) {
    var titles = new List<string>();
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      var name = new StringBuilder(64); GetClassName(window, name, 64);
      if (owner == pid && name.ToString() == "#32770" && IsWindowVisible(window)) {
        var text = new StringBuilder(256); GetWindowText(window, text, 256); titles.Add(text.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return string.Join("\\n", titles);
  }
}
"@
[SmokeDialogs]::Titles(${Number(pid)})`;
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`could not read the app's dialogs: ${result.stderr.trim().slice(0, 200)}`);
  return result.stdout.trim().split("\n").map((title) => title.trim()).filter(Boolean);
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

class Cdp {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
    });
    return new Cdp(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      const pending = data.id && this.pending.get(data.id);
      if (pending) {
        this.pending.delete(data.id);
        if (data.error) pending.reject(new Error(data.error.message));
        else pending.resolve(data.result);
      } else if (data.method) {
        for (const listener of this.listeners) listener(data);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return Promise.race([
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ws.send(JSON.stringify({ id, method, params }));
      }),
      sleep(30_000).then(() => {
        throw new Error(`${method} got no answer`);
      }),
    ]);
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

/** Console errors, uncaught exceptions and browser log errors (CSP included). */
function recordProblems(cdp) {
  const problems = { errors: [], warnings: [] };
  cdp.listeners.push(({ method, params }) => {
    if (method === "Runtime.consoleAPICalled") {
      const text = params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      if (params.type === "error" || params.type === "assert") problems.errors.push(`console.error: ${text}`);
      else if (params.type === "warning") problems.warnings.push(`console.warn: ${text}`);
    } else if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      problems.errors.push(`exception: ${details.exception?.description ?? details.text}`);
    } else if (method === "Log.entryAdded") {
      const { level, source, text, url } = params.entry;
      const line = `${source}: ${text}${url ? ` (${url})` : ""}`;
      if (level === "error") problems.errors.push(line);
      else if (level === "warning") problems.warnings.push(line);
    }
  });
  return problems;
}

function saveArtifact(name, contents) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, name), contents);
}

/** Lines of the app's output that look like errors, each once. */
const appErrorLines = (output) =>
  [...new Set(output.split(/\r?\n/).filter((line) => /Failed to load|ERR_|FATAL|Error:/.test(line)))].map((line) => line.trim());

/** What a page or worker says about itself, in any DevTools target. */
const TARGET_STATE = `(() => {
  const page = typeof document === "undefined" ? null : document;
  return {
    ready: page?.readyState, title: page?.title, tabId: page?.body?.dataset.tabId, visibility: page?.visibilityState,
    serviceWorker: typeof navigator.serviceWorker === "undefined" ? undefined : Boolean(navigator.serviceWorker.controller),
  };
})()`;

/**
 * Every DevTools target of the app and what it says within 5 s, to show
 * where a tab that does not load is stuck: still loading, not answering, or
 * with no WhatsApp page at all.
 */
async function describeTargets(port) {
  let list;
  try {
    list = await targets(port);
  } catch (error) {
    return [`no DevTools targets: ${error.message}`];
  }
  const lines = [];
  for (const target of list) {
    let state;
    try {
      const page = await Cdp.connect(target.webSocketDebuggerUrl);
      try {
        state = await Promise.race([page.evaluate(TARGET_STATE), sleep(5000).then(() => "no answer in 5s")]);
      } finally {
        page.close();
      }
    } catch (error) {
      state = error.message;
    }
    lines.push(`${target.type} ${target.url.slice(0, 80)}: ${typeof state === "string" ? state : JSON.stringify(state)}`);
  }
  return lines;
}

/** The page each service's tabs reach: src, the address and the title. */
const SERVICE_PAGES = {
  whatsapp: { name: "WhatsApp Web", src: /^https:\/\/web\.whatsapp\.com(\/|$)/, prefix: "https://web.whatsapp.com/", title: "WhatsApp" },
  telegram: { name: "Telegram Web", src: /^https:\/\/web\.telegram\.org\/k\//, prefix: "https://web.telegram.org/k/", title: "Telegram" },
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- check 3/4: the running app --------------------------------------------

/**
 * Starts the app, reloads its window with DevTools attached and checks the
 * window, its tabs and every tab's page. Returns failure messages.
 * expected: { label, otherLabel, tabNames, tabIds? (exact, in any order), tabCount,
 *   services? ({ [tabId]: "telegram" }; the others WhatsApp), windowShown,
 *   afterLoad?({ cdp, port, failures, notes }) }
 */
async function checkRunningApp(name, exe, args, expected, port) {
  const failures = [];
  const notes = [];
  const app = launch(exe, [...args, `--remote-debugging-port=${port}`]);
  let cdp;
  try {
    const page = await waitFor("the app window", 90_000, async () => {
      if (app.exited) throw new Error(`the app exited (code ${app.exitCode})`);
      return (await targets(port)).find((target) => target.type === "page" && target.url.startsWith("file:"));
    });
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    const problems = recordProblems(cdp);
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    // Reload so that errors from the very start of the window are recorded.
    await cdp.send("Page.reload", { ignoreCache: true });

    const state = await waitFor(`${expected.tabCount} tab(s) in the app window`, 60_000, async () => {
      const value = await cdp.evaluate(`(() => ({
        ready: document.readyState,
        root: document.getElementById("root")?.children.length ?? 0,
        text: document.body?.textContent ?? "",
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "",
        webviews: [...document.querySelectorAll("webview")].map((webview) => ({
          id: webview.id, partition: webview.getAttribute("partition"), src: webview.getAttribute("src"),
        })),
      }))()`);
      return value.ready === "complete" && value.root > 0 && value.webviews.length >= expected.tabCount ? value : null;
    });

    const shown = visibleWindowCount(app.child.pid);
    if (expected.windowShown && shown === 0) failures.push("the app window was not shown");
    if (!expected.windowShown && shown > 0) failures.push("the app window was shown instead of staying in the tray");
    if (!state.csp.includes("default-src 'self'")) failures.push("the app window has no Content-Security-Policy");
    if (!state.text.includes(expected.label)) failures.push(`the window is not in the expected language (no "${expected.label}")`);
    if (state.text.includes(expected.otherLabel)) failures.push(`the window shows "${expected.otherLabel}" from the other language`);
    for (const tabName of expected.tabNames) {
      if (!state.text.includes(tabName)) failures.push(`tab "${tabName}" is not shown`);
    }
    if (state.webviews.length !== expected.tabCount) {
      failures.push(`expected ${expected.tabCount} tab(s), found ${state.webviews.length}`);
    }
    const tabIds = [];
    for (const webview of state.webviews) {
      const id = webview.id.replace(/^webview-/, "");
      tabIds.push(id);
      if (webview.partition !== `persist:${id}`) failures.push(`tab ${id} uses partition ${webview.partition}`);
      // src follows navigation (e.g. WhatsApp's /login/), so only the origin is fixed.
      if (!SERVICE_PAGES[expected.services?.[id] ?? "whatsapp"].src.test(webview.src ?? "")) failures.push(`tab ${id} loads ${webview.src}`);
    }
    if (expected.tabIds && !sameJson([...tabIds].sort(), [...expected.tabIds].sort())) {
      failures.push(`tab IDs ${tabIds.join(", ")} instead of ${expected.tabIds.join(", ")}`);
    }
    const loadFailures = failures.length;

    // Each tab reaches its service's page and its preload reports the tab's ID.
    for (const id of tabIds) {
      const service = SERVICE_PAGES[expected.services?.[id] ?? "whatsapp"];
      const loaded = async () => {
        for (const target of await targets(port)) {
          if (target.type !== "webview" || !target.url.startsWith(service.prefix)) continue;
          const webview = await Cdp.connect(target.webSocketDebuggerUrl);
          try {
            const value = await webview.evaluate(`({ tabId: document.body?.dataset.tabId ?? null, title: document.title })`);
            if (value.tabId === id && value.title.includes(service.title)) return value;
          } finally {
            webview.close();
          }
        }
        return null;
      };
      try {
        await waitFor(`${service.name} in tab ${id}`, 90_000, loaded);
      } catch {
        notes.push(`tab ${id}: ${service.name} did not load in 90s, reloaded it once`);
        // Where it was stuck, noted even when the reload helps.
        notes.push(...(await describeTargets(port)).map((line) => `tab ${id} at 90s: ${line}`));
        notes.push(...appErrorLines(app.output).slice(0, 3).map((line) => `tab ${id} at 90s, app log: ${line}`));
        await cdp.evaluate(`document.getElementById(${JSON.stringify(`webview-${id}`)}).reload()`);
        try {
          await waitFor(`${service.name} in tab ${id}`, 60_000, loaded);
        } catch (error) {
          failures.push(error.message);
        }
      }
    }

    // Further checks on the loaded tabs, unless they did not all load.
    if (expected.afterLoad && failures.length === loadFailures) {
      await expected.afterLoad({ cdp, port, failures, notes, app });
    }

    await sleep(3000);
    // The same error usually shows up in both page loads (before and after the reload).
    failures.push(...new Set(problems.errors.map((error) => `app window: ${error}`)));
    if (problems.warnings.length) notes.push(`${problems.warnings.length} warning(s) in the app window`);
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (failures.length && cdp) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" }).catch(() => null);
      if (shot) saveArtifact(`${name}.png`, Buffer.from(shot.data, "base64"));
    }
    cdp?.close();
    await stop(app).catch((error) => failures.push(error.message));
    if (failures.length) {
      saveArtifact(`${name}.log`, app.output);
      failures.push(...appErrorLines(app.output).slice(0, 3).map((line) => `app log: ${line}`));
    }
  }
  return { failures, notes, output: app.output };
}

// A window size and position saved on a display that is gone.
const OFF_SCREEN_WINDOW = { x: -5000, y: -5000, width: 800, height: 600 };

/**
 * Where the app window is, and whether its top-left corner is on the screen
 * it is nearest to (a few pixels of Windows' invisible frame allowed).
 */
const WINDOW_POSITION = `(() => {
  const x = window.screenX;
  const y = window.screenY;
  const onScreen = x >= screen.availLeft - 16 && x < screen.availLeft + screen.availWidth - 100 &&
    y >= screen.availTop - 16 && y < screen.availTop + screen.availHeight - 32;
  return { x, y, onScreen };
})()`;

/** Where the test's redirect starts: a WhatsApp address no page uses. */
const REDIRECT_START = "https://web.whatsapp.com/altus-plus-smoke-redirect";

/**
 * A WhatsApp address that answers with a redirect to another site (a local
 * server of the test) is not followed: the tab stays on WhatsApp, and the
 * other site is neither loaded in the account's session nor opened in the
 * browser, so the server is never asked. A redirect emits no will-navigate:
 * the tab used to load the other site.
 */
async function checkRedirectBlocked(cdp, port, failures) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.end("<title>Elsewhere</title>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const elsewhere = `http://127.0.0.1:${server.address().port}/elsewhere`;
  let page;
  try {
    const id = await cdp.evaluate('document.querySelector("webview").id.replace(/^webview-/, "")');
    page = await connectToTab(port, id);
    let redirected = false;
    page.listeners.push(({ method, params }) => {
      if (method !== "Fetch.requestPaused") return;
      redirected = true;
      page.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 302,
        responseHeaders: [{ name: "Location", value: elsewhere }],
      }).catch(() => {});
    });
    // Past WhatsApp's service worker, straight to the interception.
    await page.send("Network.enable");
    await page.send("Network.setBypassServiceWorker", { bypass: true });
    await page.send("Fetch.enable", { patterns: [{ urlPattern: `${REDIRECT_START}*` }] });
    await page.evaluate(`location.href = ${JSON.stringify(REDIRECT_START)}; true`);
    await sleep(5000);
    const url = await cdp.evaluate(webviewCall(id, "getURL"));
    if (!redirected) {
      failures.push("redirect: the test's WhatsApp address was never requested");
    } else if (requests.length) {
      failures.push(`a WhatsApp redirect to another site was followed: ${requests.length} request(s) reached it, the tab shows ${url}`);
    } else if (!url.startsWith("https://web.whatsapp.com/")) {
      failures.push(`after a redirect to another site the tab left WhatsApp for ${url}`);
    }
  } catch (error) {
    failures.push(`redirect: ${error.message}`);
  } finally {
    await page?.send("Fetch.disable").catch(() => {});
    page?.close();
    server.close();
  }
}

// --- checks ----------------------------------------------------------------

async function checkFuses() {
  const fuses = await import("@electron/fuses");
  const { getCurrentFuseWire, FuseV1Options } = fuses.default ?? fuses;
  // Same switches as forge.config.ts. "1"/"0" in the fuse wire (FuseState).
  const ENABLE = 49;
  const DISABLE = 48;
  const expected = {
    RunAsNode: DISABLE,
    EnableCookieEncryption: DISABLE,
    EnableNodeOptionsEnvironmentVariable: DISABLE,
    EnableNodeCliInspectArguments: DISABLE,
    EnableEmbeddedAsarIntegrityValidation: ENABLE,
    OnlyLoadAppFromAsar: ENABLE,
    GrantFileProtocolExtraPrivileges: ENABLE,
  };
  const wire = await getCurrentFuseWire(PACKAGED_EXE);
  const failures = [];
  for (const [fuse, state] of Object.entries(expected)) {
    const actual = wire[FuseV1Options[fuse]];
    if (actual !== state) {
      failures.push(`${fuse} is ${actual === ENABLE ? "on" : actual === DISABLE ? "off" : actual}, expected ${state === ENABLE ? "on" : "off"}`);
    }
  }
  failures.push(...checkAppFiles());
  return { failures, notes: [] };
}

// File paths inside app.asar, from its header: a pickled size, then a pickled
// JSON string ({ files: { name: { files: ... } | { size, ... } } }).
function asarFiles(asar) {
  const fd = fs.openSync(asar, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const json = Buffer.alloc(head.readUInt32LE(12));
    fs.readSync(fd, json, 0, json.length, 16);
    const files = new Set();
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files)) {
        const file = prefix ? `${prefix}/${name}` : name;
        if (entry.files) walk(entry, file);
        else files.add(file);
      }
    };
    walk(JSON.parse(json.toString("utf8")), "");
    return files;
  } finally {
    fs.closeSync(fd);
  }
}

function checkAppFiles() {
  const files = asarFiles(path.join(path.dirname(PACKAGED_EXE), "resources", "app.asar"));
  const build = path.posix.dirname(packageJson.main);
  const publicFiles = (dir) => fs.readdirSync(path.join(root, "public", dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(path.join(root, "public"), path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
  const expected = [
    "package.json",
    packageJson.main,
    `${build}/preload.cjs`,
    `${build}/whatsapp.preload.cjs`,
    `${build}/telegram.preload.cjs`,
    ".vite/renderer/main_window/index.html",
    ...publicFiles("assets/icons").map((file) => `${build}/${file}`),
    ...publicFiles("locales").filter((file) => file.endsWith("/translation.json")).map((file) => `${build}/${file}`),
  ];
  const failures = expected.filter((file) => !files.has(file)).map((file) => `app.asar has no ${file}`);
  const extra = [...new Set([...files].map((file) => file.split("/")[0]))].filter((top) => top !== ".vite" && top !== "package.json");
  if (extra.length) failures.push(`app.asar also holds ${extra.join(", ")}`);
  return failures;
}

async function checkTamperedAsar() {
  const copy = fs.mkdtempSync(path.join(TEMP, "as-tamper-"));
  const failures = [];
  try {
    fs.cpSync(path.dirname(PACKAGED_EXE), copy, { recursive: true });
    fs.mkdirSync(path.join(copy, "profile"));
    // Change one character of the archive header, which the exe validates.
    const asar = path.join(copy, "resources", "app.asar");
    const bytes = fs.readFileSync(asar);
    const at = bytes.indexOf('"files"');
    if (at < 0) throw new Error("app.asar has no header");
    bytes[at + 1] = "F".charCodeAt(0);
    fs.writeFileSync(asar, bytes);

    const app = launch(path.join(copy, path.basename(PACKAGED_EXE)), [`--user-data-dir=${path.join(copy, "profile")}`]);
    try {
      await waitFor("the modified app to exit", 30_000, () => app.exited);
      // Electron reports a changed header either way, depending on where it checks it.
      if (app.exitCode === 0 || !/ASAR Integrity Violation|Integrity check failed for asar archive/.test(app.output)) {
        failures.push(`exited (code ${app.exitCode}) without reporting an integrity violation: ${app.output.trim().slice(0, 300)}`);
      }
    } catch {
      failures.push("the app kept running with a modified app.asar");
      await stop(app);
    }
  } finally {
    removeTemp(copy);
  }
  return { failures, notes: [] };
}

const removeTemp = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });

// --- whatsapp:// links (checks 3, 5 and 7) ----------------------------------

// Links as a website's "Chat on WhatsApp" button and a group invite start
// them, and the WhatsApp Web addresses the app must open for them.
const CHAT_LINK = {
  link: "whatsapp://send/?phone=390000000001&text=Prova%20smoke&type=phone_number&app_absent=0",
  address: "https://web.whatsapp.com/send?phone=390000000001&text=Prova+smoke",
  shown: "+390000000001",
};
const INVITE_LINK = {
  link: "whatsapp://chat/?code=SmokeInvite0000000001",
  address: "https://web.whatsapp.com/accept?code=SmokeInvite0000000001",
};
// Not a chat or an invite: ignored.
const BAD_LINK = "whatsapp://send?phone=javascript:alert(1)";

/** The command Windows runs for whatsapp:// links, or null. */
function readProtocolCommand() {
  const Winreg = createRequire(import.meta.url)(path.join(root, "node_modules", "winreg"));
  const key = new Winreg({ hive: Winreg.HKCU, key: "\\Software\\Classes\\whatsapp\\shell\\open\\command" });
  return new Promise((resolve) => key.get(Winreg.DEFAULT_VALUE, (error, item) => resolve(error ? null : item.value)));
}

/** The dialog asking which account opens a link, or null when it is not shown. */
function linkDialog(cdp, tabIds) {
  return cdp.evaluate(`(() => {
    const dialog = document.querySelector("[data-whatsapp-link-dialog]");
    if (!dialog) return null;
    const ids = ${JSON.stringify(tabIds)};
    return {
      text: dialog.textContent,
      accounts: [...dialog.querySelectorAll("button[data-tab-id]")].map((button) => button.dataset.tabId),
      focused: document.activeElement?.dataset?.tabId ?? null,
      selected: ids.find((id) => document.getElementById(id)?.getAttribute("aria-selected") === "true") ?? null,
    };
  })()`);
}

/** What the app last opened in a tab from a link (src follows redirects). */
const openedLink = (cdp, tabId) =>
  cdp.evaluate(`document.getElementById(${JSON.stringify(`webview-${tabId}`)})?.dataset.openedLink ?? null`);

/** Clicks the dialog's button for an account, or Cancel (null). */
const answerLinkDialog = (cdp, tabId) =>
  cdp.evaluate(`document.querySelector(${JSON.stringify(
    tabId ? `[data-whatsapp-link-dialog] button[data-tab-id="${tabId}"]` : "[data-whatsapp-link-dialog] [data-cancel]",
  )}).click()`);

/**
 * Asks with a link, then answers for `choose` (a tab) and checks that only it
 * opened the link and is selected. Returns failure messages.
 */
async function chooseAccountForLink(cdp, tabs, choose, link) {
  const failures = [];
  const ids = tabs.map((tab) => tab.id);
  const shown = await waitFor("the dialog asking which account opens the link", 30_000, () => linkDialog(cdp, ids));
  if (!sameJson([...shown.accounts].sort(), [...ids].sort())) {
    failures.push(`the link dialog offers ${shown.accounts.join(", ")} instead of every account`);
  }
  if (link.shown && !shown.text.includes(link.shown)) failures.push(`the link dialog does not show ${link.shown}`);
  const focus = await waitFor("the selected account to have the focus", 5_000, async () => {
    const state = await linkDialog(cdp, ids);
    return state?.focused ? state : null;
  }).catch(() => shown);
  if (focus.focused !== focus.selected) {
    failures.push(`the link dialog's focus is on ${focus.focused}, not on the selected account ${focus.selected}`);
  }
  await answerLinkDialog(cdp, choose.id);
  try {
    await waitFor(`${choose.name} to open the link`, 10_000, async () => (await openedLink(cdp, choose.id)) === link.address);
    await waitFor(`${choose.name} to be selected`, 10_000, () =>
      cdp.evaluate(`document.getElementById(${JSON.stringify(choose.id)}).getAttribute("aria-selected") === "true"`));
  } catch (error) {
    failures.push(error.message);
  }
  if (await linkDialog(cdp, ids)) failures.push("the link dialog stayed open after choosing an account");
  for (const tab of tabs) {
    if (tab !== choose && (await openedLink(cdp, tab.id)) === link.address) failures.push(`${tab.name} opened the link too`);
  }
  return failures;
}

/**
 * Started by a whatsapp:// link, as Windows starts it ("<exe>" -- "<link>"),
 * the only account opens the chat without asking. The run's own
 * --user-data-dir keeps the app from registering itself for the links.
 */
async function checkLinkAtStart() {
  const failures = [];
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  const port = 9417;
  // "Remember window position" on, with the position saved on a display
  // that is no longer connected (far left of any screen).
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({
    rememberWindowPosition: { value: true }, rememberWindowSize: { value: true },
  }));
  fs.writeFileSync(path.join(profile, "windowState.json"), JSON.stringify(OFF_SCREEN_WINDOW));
  const before = await readProtocolCommand();
  // Chromium reads no switches after "--": the port goes before it.
  const app = launch(PACKAGED_EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--", CHAT_LINK.link]);
  let cdp;
  try {
    const page = await waitFor("the app window", 90_000, async () => {
      if (app.exited) throw new Error(`the app exited (code ${app.exitCode})`);
      return (await targets(port)).find((target) => target.type === "page" && target.url.startsWith("file:"));
    });
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    const tab = await waitFor("the tab", 60_000, () =>
      cdp.evaluate(`document.querySelector("webview")?.id.replace(/^webview-/, "") ?? null`));
    await waitFor("the link to open in the only account", 30_000, async () => (await openedLink(cdp, tab)) === CHAT_LINK.address);
    if (await linkDialog(cdp, [tab])) failures.push("with a single account, the app still asked which one opens the link");
    const position = await cdp.evaluate(WINDOW_POSITION);
    if (!position.onScreen) {
      failures.push(`the window opened off screen at ${position.x}, ${position.y}, its remembered position on no connected display`);
    }
  } catch (error) {
    failures.push(`started by a link: ${error.message}`);
  } finally {
    cdp?.close();
    await stop(app).catch((error) => failures.push(error.message));
    if (failures.length) saveArtifact("link-at-start.log", app.output);
  }
  const after = await readProtocolCommand();
  if (after !== before) failures.push(`a run on its own profile changed the whatsapp:// registration to ${after ?? "none"}`);
  removeTemp(profile);
  return failures;
}

async function checkFreshProfile() {
  const realProfile = path.join(APPDATA, PROFILE_FOLDER);
  const realProfileExisted = fs.existsSync(realProfile);
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  const result = await checkRunningApp("fresh-profile", PACKAGED_EXE, [`--user-data-dir=${profile}`], {
    label: ADD_TAB_LABEL.en,
    otherLabel: ADD_TAB_LABEL.it,
    tabNames: ["New Tab"],
    tabCount: 1,
    windowShown: true,
    afterLoad: ({ cdp, port, failures }) => checkRedirectBlocked(cdp, port, failures),
  }, 9411);
  if (!fs.existsSync(path.join(profile, "tabs.json"))) result.failures.push("the app did not save its tabs in --user-data-dir");
  if (!realProfileExisted && fs.existsSync(realProfile)) {
    result.failures.push(`--user-data-dir was ignored: ${realProfile} was created`);
  }
  removeTemp(profile);
  result.failures.push(...(await checkLinkAtStart()));
  return result;
}

// The profile has no tabs.json, as if it had been lost, but holds the data of
// three accounts and of a tab the user closed earlier.
const UNLISTED_ACCOUNT_FOLDERS = ["smokeunlistedalfa1", "smokeunlistedbeta2", "smokeunlistedgamma3"];
const EARLIER_CLOSED_TAB = "SmokeClosedEarlier01";

/** The closed tabs the app recorded in the profile. */
function recordedClosedTabs(profile) {
  try {
    return JSON.parse(fs.readFileSync(path.join(profile, "closed-tabs.json"), "utf8")).ids ?? [];
  } catch {
    return [];
  }
}

async function checkStartInTray() {
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({
    launchToTray: { value: true }, tabClosePrompt: { value: false },
  }));
  const partitions = path.join(profile, "Partitions");
  for (const folder of [...UNLISTED_ACCOUNT_FOLDERS, EARLIER_CLOSED_TAB.toLowerCase()]) {
    fs.mkdirSync(path.join(partitions, folder), { recursive: true });
    fs.writeFileSync(path.join(partitions, folder, "marker"), "");
  }
  fs.writeFileSync(path.join(profile, "closed-tabs.json"), JSON.stringify({ ids: [EARLIER_CLOSED_TAB] }));

  const expected = { label: ADD_TAB_LABEL.en, otherLabel: ADD_TAB_LABEL.it, tabNames: ["New Tab"], tabCount: 1 };
  // What the autostart entry runs (auto-launch isHidden adds --hidden). It
  // finds no tabs and saves a new one.
  const atLogin = await checkRunningApp("start-in-tray", PACKAGED_EXE, [`--user-data-dir=${profile}`, "--hidden"], {
    ...expected,
    windowShown: false,
  }, 9413);
  // The second start knows only that new tab; then the user closes it.
  let closedByHand = null;
  const byHand = await checkRunningApp("start-in-tray-manual", PACKAGED_EXE, [`--user-data-dir=${profile}`], {
    ...expected,
    windowShown: true,
    afterLoad: async ({ cdp, failures }) => {
      const id = await cdp.evaluate(`document.querySelector("webview")?.id.replace(/^webview-/, "") ?? null`);
      await cdp.evaluate(`document.querySelector(${JSON.stringify(`[data-close-tab="${id}"]`)})?.click()`);
      try {
        await waitFor("the closed tab in closed-tabs.json", 10_000, async () => recordedClosedTabs(profile).includes(id));
        closedByHand = id;
      } catch (error) {
        failures.push(error.message);
      }
    },
  }, 9414);

  const dataFailures = [];
  const deleted = UNLISTED_ACCOUNT_FOLDERS.filter((folder) => !fs.existsSync(path.join(partitions, folder, "marker")));
  if (deleted.length) dataFailures.push(`deleted the data of accounts the lost tab list did not name: ${deleted.join(", ")}`);
  if (fs.existsSync(path.join(partitions, EARLIER_CLOSED_TAB.toLowerCase()))) {
    dataFailures.push("kept the folder of a tab closed before these starts");
  }
  const recorded = recordedClosedTabs(profile);
  if (recorded.includes(EARLIER_CLOSED_TAB)) dataFailures.push("still lists the deleted closed tab in closed-tabs.json");
  if (closedByHand && !sameJson(recorded, [closedByHand])) {
    dataFailures.push(`closed-tabs.json lists ${JSON.stringify(recorded)} instead of the tab closed by hand`);
  }
  removeTemp(profile);
  const unreadable = await checkUnreadableStores();
  return {
    failures: [
      ...atLogin.failures.map((line) => `with Windows: ${line}`),
      ...byHand.failures.map((line) => `by hand: ${line}`),
      ...dataFailures.map((line) => `account data: ${line}`),
      ...unreadable.failures.map((line) => `unreadable files: ${line}`),
    ],
    notes: [...atLogin.notes, ...byHand.notes, ...unreadable.notes],
  };
}

// Saved files a power cut or a disk fault left unreadable, in a profile that
// holds two accounts, a tab closed earlier and a stray file.
const REBUILT_ACCOUNT_FOLDERS = ["smokerebuiltalfa01", "smokerebuiltbeta02"];
// Holds Telegram's data, in the folder Chromium names after its site.
const REBUILT_TELEGRAM_FOLDER = "smokerebuilttango04";
const REBUILT_CLOSED_TAB = "SmokeRebuiltClosed3";
const UNREADABLE_FILES = {
  // Cut off mid-write; Italian and Start in tray would show if it were read.
  settings: '{"language":{"value":"it"},"launchToTray":{"value":true},"tabBar":',
  tabs: Buffer.alloc(512),
  themes: "not JSON",
  windowState: "{",
};
const UNREADABLE_NOTICE_TITLE = "Some saved data could not be read";

/**
 * Unreadable settings, tabs, themes and window size: the app still starts,
 * on defaults (English, window shown), with the accounts rebuilt as
 * "Account 1" and "Account 2" from their folders, and "Account 3" as a
 * Telegram tab from the folder with Telegram's data, and a notice; each file
 * is kept, byte for byte, next to the new one; nothing is deleted.
 */
async function checkUnreadableStores() {
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  for (const [name, contents] of Object.entries(UNREADABLE_FILES)) fs.writeFileSync(path.join(profile, `${name}.json`), contents);
  const partitions = path.join(profile, "Partitions");
  for (const folder of [...REBUILT_ACCOUNT_FOLDERS, REBUILT_TELEGRAM_FOLDER, REBUILT_CLOSED_TAB.toLowerCase()]) {
    fs.mkdirSync(path.join(partitions, folder), { recursive: true });
    fs.writeFileSync(path.join(partitions, folder, "marker"), "");
  }
  fs.mkdirSync(path.join(partitions, REBUILT_TELEGRAM_FOLDER, "IndexedDB", "https_web.telegram.org_0.indexeddb.leveldb"), { recursive: true });
  fs.writeFileSync(path.join(partitions, "smokestrayfile"), "");
  fs.writeFileSync(path.join(profile, "closed-tabs.json"), JSON.stringify({ ids: [REBUILT_CLOSED_TAB] }));

  const result = await checkRunningApp("unreadable-stores", PACKAGED_EXE, [`--user-data-dir=${profile}`], {
    label: ADD_TAB_LABEL.en,
    otherLabel: ADD_TAB_LABEL.it,
    tabNames: ["Account 1", "Account 2", "Account 3"],
    tabIds: [...REBUILT_ACCOUNT_FOLDERS, REBUILT_TELEGRAM_FOLDER],
    tabCount: REBUILT_ACCOUNT_FOLDERS.length + 1,
    services: { [REBUILT_TELEGRAM_FOLDER]: "telegram" },
    windowShown: true,
    afterLoad: async ({ app, failures }) => {
      try {
        await waitFor("the notice about the unreadable files", 15_000, () =>
          visibleDialogTitles(app.child.pid).includes(UNREADABLE_NOTICE_TITLE));
      } catch (error) {
        failures.push(error.message);
      }
    },
  }, 9419);

  const files = fs.readdirSync(profile);
  for (const [name, contents] of Object.entries(UNREADABLE_FILES)) {
    const copies = files.filter((file) => new RegExp(`^${name}\\.corrupt-\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.json$`).test(file));
    if (copies.length !== 1) {
      result.failures.push(`${name}.json: ${copies.length} copies of the unreadable file instead of one`);
    } else if (!fs.readFileSync(path.join(profile, copies[0])).equals(Buffer.from(contents))) {
      result.failures.push(`${copies[0]} does not hold the unreadable file's bytes`);
    }
  }
  try {
    const saved = readJson(path.join(profile, "tabs.json"));
    const names = saved.tabs.map((tab) => `${tab.id}=${tab.name}${tab.service ? ` (${tab.service})` : ""}`);
    if (!sameJson(names, ["smokerebuiltalfa01=Account 1", "smokerebuiltbeta02=Account 2", "smokerebuilttango04=Account 3 (telegram)"])) {
      result.failures.push(`the new tabs.json holds ${names.join(", ")}`);
    }
  } catch (error) {
    result.failures.push(`the new tabs.json cannot be read: ${error.message}`);
  }
  const deleted = [...REBUILT_ACCOUNT_FOLDERS, REBUILT_TELEGRAM_FOLDER, REBUILT_CLOSED_TAB.toLowerCase()].filter((folder) => !fs.existsSync(path.join(partitions, folder, "marker")));
  if (deleted.length) result.failures.push(`deleted account data while rebuilding the tab list: ${deleted.join(", ")}`);
  if (!recordedClosedTabs(profile).includes(REBUILT_CLOSED_TAB)) result.failures.push("forgot the tab closed earlier in closed-tabs.json");
  removeTemp(profile);
  return result;
}

// --- check 5: background tabs ----------------------------------------------

// Alfa is selected; Beta and Gamma are in the background, Gamma muted.
const BACKGROUND_TABS = [
  ["smokeAlfaTab000000001", "Alfa", {}],
  ["smokeBetaTab000000002", "Beta", {}],
  ["smokeGammaTab00000003", "Gamma", { notificationsMutedUntil: Number.MAX_SAFE_INTEGER }],
].map(([id, name, config]) => ({
  id,
  name,
  messageCount: 0,
  config: { theme: "dark", notifications: true, media: true, sound: true, color: null, spellChecker: true, ...config },
}));
const [ALFA, BETA, GAMMA] = BACKGROUND_TABS;

/** DevTools connection to the service's page of a tab; the caller closes it. */
async function connectToTab(port, id, service = "whatsapp") {
  for (const target of await targets(port)) {
    if (target.type !== "webview" || !target.url.startsWith(SERVICE_PAGES[service].prefix)) continue;
    const page = await Cdp.connect(target.webSocketDebuggerUrl);
    const tabId = await page.evaluate("document.body?.dataset.tabId ?? null").catch(() => null);
    if (tabId === id) return page;
    page.close();
  }
  throw new Error(`no ${SERVICE_PAGES[service].name} page for tab ${id}`);
}

// A 440 Hz tone at about -57 dBFS: above the level Chromium counts as
// audible, too quiet to hear when the test runs on a real PC.
const START_TONE = `(async () => {
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0.002;
  const oscillator = context.createOscillator();
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  window.smokeTone = context;
  const start = context.currentTime;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return { state: context.state, advanced: context.currentTime - start, visibility: document.visibilityState };
})()`;
const TONE_STATE = `(async () => {
  const context = window.smokeTone;
  const start = context.currentTime;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return { state: context.state, advanced: context.currentTime - start, visibility: document.visibilityState };
})()`;
const STOP_TONE = "window.smokeTone?.close()";

/** A notification from a page, as WhatsApp Web creates them; closed at once. */
const NOTIFY = `(async () => {
  const permission = Notification.permission;
  const requested = await Notification.requestPermission();
  const notification = new Notification("Smoke", { body: "Altus + smoke test", silent: true });
  const event = await new Promise((resolve) => {
    for (const type of ["show", "error", "close"]) notification.addEventListener(type, () => resolve(type));
    setTimeout(() => resolve("none"), 5000);
  });
  notification.close();
  // The muted stand-in is not an instance of the browser's Notification.
  const real = notification instanceof Object.getPrototypeOf(Notification);
  return { permission, requested, title: notification.title, real, event };
})()`;

/** What a tab is granted: the notification check and request, the microphone check. */
const PERMISSION_STATE = `(async () => ({
  permission: Notification.permission,
  requested: await Notification.requestPermission(),
  microphone: (await navigator.permissions.query({ name: "microphone" })).state,
}))()`;

/** A location request: 1 is PERMISSION_DENIED. */
const GEOLOCATION = `new Promise((resolve) => navigator.geolocation.getCurrentPosition(
  () => resolve("position"), (error) => resolve(error.code), { timeout: 5000 }))`;

const webviewCall = (id, method) => `document.getElementById(${JSON.stringify(`webview-${id}`)}).${method}()`;

/**
 * Drags one tab onto another with the mouse, through Chromium's own drag
 * handling (intercepted, so no OS drag loop starts). Returns whether a drag
 * started at all.
 */
async function dragTab(cdp, fromId, toId) {
  const center = (id) => cdp.evaluate(`(() => {
    const rect = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  const from = await center(fromId);
  const to = await center(toId);
  let data;
  const listener = ({ method, params }) => {
    if (method === "Input.dragIntercepted") data = params.data;
  };
  cdp.listeners.push(listener);
  try {
    await cdp.send("Input.setInterceptDrags", { enabled: true });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 10; step++) {
      const x = from.x + ((to.x - from.x) * step) / 10;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: from.y, button: "left", buttons: 1 });
    }
    await sleep(300);
    if (data) {
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await cdp.send("Input.dispatchDragEvent", { type, ...to, data });
      }
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
    return Boolean(data);
  } finally {
    await cdp.send("Input.setInterceptDrags", { enabled: false }).catch(() => undefined);
    cdp.listeners.splice(cdp.listeners.indexOf(listener), 1);
  }
}

/**
 * Help → Resource Usage lists every account with its own process and the
 * app's main process and window, then closes.
 */
async function checkResourcePanel(cdp, failures, notes) {
  await cdp.evaluate('window.clickMenuItem("resource-usage")');
  const rows = () => cdp.evaluate(`[...document.querySelectorAll("[data-resource-row]")].map((row) => ({
    kind: row.dataset.kind,
    tabId: row.dataset.tabId ?? null,
    privateMB: Number(row.dataset.privateMb),
    processes: Number(row.dataset.processes),
  }))`);
  let shown;
  try {
    shown = await waitFor("Resource Usage to list every account with its memory", 15_000, async () => {
      const value = await rows();
      const accounts = value.filter((row) => row.kind === "account");
      return accounts.length === BACKGROUND_TABS.length && accounts.every((row) => row.processes > 0 && row.privateMB > 0)
        ? value
        : null;
    });
  } catch (error) {
    failures.push(`Resource Usage: ${error.message} (rows: ${JSON.stringify(await rows().catch(() => []))})`);
    return;
  }
  const accountIds = shown.filter((row) => row.kind === "account").map((row) => row.tabId);
  if (!sameJson([...accountIds].sort(), BACKGROUND_TABS.map((tab) => tab.id).sort())) {
    failures.push(`Resource Usage lists accounts ${accountIds.join(", ")}`);
  }
  for (const kind of ["main", "window"]) {
    if (!shown.some((row) => row.kind === kind && row.privateMB > 0)) failures.push(`Resource Usage has no ${kind} row`);
  }
  // Every renderer here is an account, the window or a WhatsApp service
  // worker: "Other processes" means one was not recognised. The panel
  // refreshes every 2 seconds while open, so a few refreshes are looked at.
  for (let refresh = 0; refresh < 3; refresh++) {
    const current = refresh === 0 ? shown : await rows().catch(() => []);
    const other = current.find((row) => row.kind === "other");
    if (other) {
      failures.push(`Resource Usage shows ${other.processes} unrecognised process(es) (rows: ${JSON.stringify(current)})`);
      break;
    }
    await sleep(2000);
  }
  notes.push(`Resource Usage: ${shown.map((row) => `${row.tabId ? BACKGROUND_TABS.find((tab) => tab.id === row.tabId)?.name : row.kind} ${Math.round(row.privateMB)} MB`).join(", ")}`);
  await cdp.evaluate('document.querySelector("[data-resource-usage-close]").click()');
  try {
    await waitFor("Resource Usage to close", 5_000, async () => !(await cdp.evaluate('!!document.querySelector("[data-resource-usage]")')));
  } catch (error) {
    failures.push(error.message);
  }
}

/**
 * What a WhatsApp page sends is tied to its own tab. Beta's page claims
 * Alfa's tab ID (document.body.dataset.tabId, which the page can change):
 * its unread count still goes to Beta. A <title> element replaced by a new
 * one is still counted. A click on a notification made by a script, not by
 * the user, does not bring Beta forward. (Alfa is selected throughout.)
 */
async function checkPageMessages(cdp, beta, failures) {
  const badge = (tab) => cdp.evaluate(
    `document.getElementById(${JSON.stringify(tab.id)})?.querySelector(".bg-red-600")?.textContent ?? ""`);
  const selected = (tab) => cdp.evaluate(
    `document.getElementById(${JSON.stringify(tab.id)}).getAttribute("aria-selected") === "true"`);
  const replaceTitle = (text) => beta.evaluate(`(() => {
    const title = document.createElement("title");
    title.textContent = ${JSON.stringify(text)};
    document.querySelector("title").replaceWith(title);
  })()`);
  const clearCount = async () => {
    await replaceTitle("WhatsApp");
    await waitFor("Beta's count to clear", 5_000, async () => (await badge(BETA)) === "").catch(() => {});
  };

  try {
    await beta.evaluate(`document.body.dataset.tabId = ${JSON.stringify(ALFA.id)}; document.title = "(7) WhatsApp"`);
    try {
      await waitFor("the count of Beta's page on Beta", 5_000, async () => (await badge(BETA)) === "7");
    } catch {
      failures.push(`Beta's page claimed Alfa's tab ID: its count shows on Alfa "${await badge(ALFA)}", on Beta "${await badge(BETA)}"`);
    }
  } finally {
    await beta.evaluate(`document.body.dataset.tabId = ${JSON.stringify(BETA.id)}`);
  }
  await clearCount();

  await replaceTitle("(5) WhatsApp");
  try {
    await waitFor("the count in Beta's replaced <title>", 5_000, async () => (await badge(BETA)) === "5");
  } catch {
    failures.push(`a replaced <title> in Beta's page was not counted (Beta shows "${await badge(BETA)}")`);
  }
  await clearCount();

  await beta.evaluate(`(() => {
    const notification = new Notification("Smoke", { body: "Altus + smoke test", silent: true });
    notification.dispatchEvent(new Event("click"));
    notification.close();
  })()`);
  await sleep(2000);
  if (await selected(BETA) || !(await selected(ALFA))) {
    failures.push("a notification click made by Beta's page script, not by the user, brought Beta forward");
    await cdp.evaluate(`document.getElementById(${JSON.stringify(ALFA.id)}).click()`);
  }
}

/**
 * Main checks what the window saves in the tab and theme lists: a tab whose
 * ID cannot name a partition folder, a list that is not a list, the same
 * account twice, a theme without an ID are refused and change nothing on
 * disk. Tabs as earlier versions saved them (no Microphone and Camera
 * switch, fields this version does not know) are still accepted.
 */
async function checkStoreWrites(cdp, profile, failures) {
  const tabsFile = path.join(profile, "tabs.json");
  const themesFile = path.join(profile, "themes.json");
  const save = (call) => cdp.evaluate(`${call}.then(() => "saved", () => "refused")`);
  const saveTabs = (tabs) => save(`window.electronTabStore.set("tabs", ${JSON.stringify(tabs)})`);
  const saveThemes = (themes) => save(`window.electronThemeStore.setThemes(${JSON.stringify(themes)})`);
  const tabsBefore = fs.readFileSync(tabsFile, "utf8");
  const themesBefore = fs.readFileSync(themesFile, "utf8");
  const refused = [
    ["a tab whose ID leaves the Partitions folder", `window.electronTabStore.set("tabs", ${JSON.stringify([...BACKGROUND_TABS, { ...BETA, id: "../smokeEscape" }])})`],
    ["a tab list that is not a list", `window.electronTabStore.set("tabs", "smoke")`],
    ["the same account twice", `window.electronTabStore.set("tabs", ${JSON.stringify([...BACKGROUND_TABS, ALFA])})`],
    ["no tab list at all", `window.electronTabStore.set("tabs", undefined)`],
    ["a selected tab that is not a tab ID", `window.electronTabStore.set("selectedTabId", 42)`],
    ["a closed tab without an ID", `window.electronTabStore.set("previouslyClosedTab", { name: "Smoke" })`],
    ["a theme without an ID", `window.electronThemeStore.setThemes([{ name: "Smoke" }])`],
    ["a theme list that is not a list", `window.electronThemeStore.setThemes({})`],
  ];
  for (const [what, call] of refused) {
    if ((await save(call)) !== "refused") failures.push(`the window could save ${what}`);
  }
  if (fs.readFileSync(tabsFile, "utf8") !== tabsBefore) failures.push("a refused write changed tabs.json");
  if (fs.readFileSync(themesFile, "utf8") !== themesBefore) failures.push("a refused write changed themes.json");

  // As earlier versions saved them; then the window's own lists again.
  const older = BACKGROUND_TABS.map(({ config: { media, spellChecker, ...config }, ...tab }) => ({ ...tab, smokeExtra: 1, config }));
  if ((await saveTabs(older)) !== "saved") failures.push("tabs as earlier versions saved them were refused");
  if ((await saveTabs(BACKGROUND_TABS)) !== "saved") failures.push("the window's own tab list was refused");
  const themes = JSON.parse(themesBefore).themes;
  const custom = { id: "smokeTheme00000000001", name: "Smoke", colors: { bg: "#10151E", fg: "#eeeeee", ac: "#40C486" } };
  if ((await saveThemes([...themes, custom])) !== "saved") failures.push("a theme as the theme dialog saves it was refused");
  if ((await saveThemes(themes)) !== "saved") failures.push("the window's own theme list was refused");
}

/**
 * Moving tabs is off by default; turned on (as the Tab menu does), a tab
 * dropped on another moves there and the order is saved.
 */
async function checkMovingTabs(cdp, profile, failures) {
  const order = () => cdp.evaluate(`[...document.querySelectorAll('[role="tab"]')].map((tab) => tab.id)`);
  const savedOrder = () => readJson(path.join(profile, "tabs.json")).tabs.map((tab) => tab.id);
  const names = (ids) => ids.map((id) => BACKGROUND_TABS.find((tab) => tab.id === id)?.name ?? id).join(", ");
  const draggable = (id) => cdp.evaluate(`document.getElementById(${JSON.stringify(id)}).draggable`);
  const menuItem = async () => {
    const find = (items) => {
      for (const item of items ?? []) {
        const found = item.id === "allow-moving-tabs" ? item : find(item.submenu);
        if (found) return found;
      }
      return null;
    };
    return find(await cdp.evaluate("window.getAppMenu()"));
  };
  const initial = BACKGROUND_TABS.map((tab) => tab.id);

  const item = await menuItem();
  if (!item) failures.push('no "Allow Moving Tabs" item in the Tab menu');
  else if (item.checked) failures.push('"Allow Moving Tabs" is ticked on a new profile');
  if (await draggable(ALFA.id)) failures.push("tabs can be dragged although moving tabs is off");
  const dragged = await dragTab(cdp, ALFA.id, GAMMA.id);
  if (dragged) failures.push("dragging a tab started although moving tabs is off");
  if (!sameJson(await order(), initial)) failures.push(`moving tabs is off, yet the order became ${names(await order())}`);

  // The same setting the Tab menu item saves; main ticks the item and tells the window.
  await cdp.evaluate('window.electronSettingsStore.setSetting("tabReordering", true)');
  try {
    await waitFor("tabs to become draggable", 10_000, () => draggable(ALFA.id));
  } catch (error) {
    failures.push(`after allowing moving tabs: ${error.message}`);
    return;
  }
  if (!(await menuItem())?.checked) failures.push('"Allow Moving Tabs" is not ticked after turning it on');
  if (!(await dragTab(cdp, ALFA.id, GAMMA.id))) {
    failures.push("dragging a tab did not start with moving tabs on");
    return;
  }
  const expected = [BETA.id, GAMMA.id, ALFA.id];
  try {
    await waitFor("the new tab order", 5_000, async () => sameJson(await order(), expected));
    await waitFor("the new tab order to be saved", 5_000, () => sameJson(savedOrder(), expected));
  } catch {
    failures.push(`after dragging Alfa onto Gamma the tabs are ${names(await order())}, saved ${names(savedOrder())}; expected Beta, Gamma, Alfa`);
  }
}

/**
 * Background tabs keep their sound and notifications. Chromium reports a tab
 * as audible while its stream plays, even when the tab is muted, so muting is
 * checked separately. Audibility is compared with the selected tab: a runner
 * without audio output reports no tab as audible, which is noted rather than
 * failed.
 */
function exerciseBackgroundTabs(run, audio, profile) {
  return async ({ cdp, port, failures, notes }) => {
    const pages = {};
    try {
      for (const tab of BACKGROUND_TABS) pages[tab.id] = await connectToTab(port, tab.id);
      await sleep(1000); // the account name and mute arrive with the tab ID

      const notified = await pages[BETA.id].evaluate(NOTIFY);
      if (notified.permission !== "granted" || notified.requested !== "granted") {
        failures.push(`Beta: notification permission is ${notified.permission}, request answered ${notified.requested}`);
      }
      if (!notified.real) failures.push("Beta: the notification was suppressed although Beta is not muted");
      if (notified.title !== "Beta · Smoke") failures.push(`Beta: notification title is "${notified.title}", expected "Beta · Smoke"`);
      if (notified.event === "error") failures.push("Beta: the notification reported an error");
      notes.push(`${run}: Beta notification ${notified.event === "show" ? "shown" : `event: ${notified.event}`}`);

      const muted = await pages[GAMMA.id].evaluate(NOTIFY);
      if (muted.real) failures.push("Gamma: muted, but a real notification was created");
      if (muted.title !== "Smoke") failures.push(`Gamma: stand-in title is "${muted.title}"`);
      if (muted.event !== "close") failures.push(`Gamma: the stand-in did not report itself closed (${muted.event})`);

      // Permissions come from the main process and the tab's saved switches:
      // anything else is refused, and a switch turned off while the app runs
      // applies at once, to requests and to checks alike.
      const location = await pages[ALFA.id].evaluate(GEOLOCATION);
      if (location !== 1) failures.push(`Alfa: a location request was not refused (${location})`);
      if (run === "window shown") {
        const setBetaSwitches = (switches) => cdp.evaluate(`window.electronTabStore.set("tabs", ${JSON.stringify(
          BACKGROUND_TABS.map((tab) => (tab.id === BETA.id ? { ...tab, config: { ...tab.config, ...switches } } : tab))
        )})`);
        // WhatsApp's login page, where the test's accounts stay, at times
        // blocks the microphone and camera in its Permissions-Policy. Chromium
        // then answers "denied" itself, without asking the app, so the
        // Microphone and Camera switch only shows where the page allows them.
        const microphoneAllowed = await pages[BETA.id].evaluate(`document.featurePolicy?.allowsFeature("microphone") ?? true`);
        if (!microphoneAllowed) {
          notes.push(`${run}: WhatsApp's page blocks the microphone (Permissions-Policy), so only the Notifications switch is checked`);
        }
        const answers = (state, expected) => state.permission === expected && state.requested === expected &&
          (!microphoneAllowed || state.microphone === expected);
        await setBetaSwitches({ notifications: false, media: false });
        const off = await pages[BETA.id].evaluate(PERMISSION_STATE);
        if (!answers(off, "denied")) {
          failures.push(`Beta with Notifications and Microphone and Camera off: ${JSON.stringify(off)}`);
        }
        await setBetaSwitches({});
        const on = await pages[BETA.id].evaluate(PERMISSION_STATE);
        if (!answers(on, "granted")) {
          failures.push(`Beta with the switches on again: ${JSON.stringify(on)}`);
        }
        await checkPageMessages(cdp, pages[BETA.id], failures);
      }

      for (const tab of [ALFA, BETA]) {
        const tone = await pages[tab.id].evaluate(START_TONE);
        if (tone.state !== "running" || tone.advanced < 1) {
          failures.push(`${tab.name}: audio is ${tone.state}, advanced ${tone.advanced.toFixed(2)}s in 2s (page ${tone.visibility})`);
        }
        if (tab === BETA) notes.push(`${run}: Beta page visibilityState ${tone.visibility}`);
      }
      for (const tab of BACKGROUND_TABS) {
        if (await cdp.evaluate(webviewCall(tab.id, "isAudioMuted"))) failures.push(`${tab.name}: the tab's audio is muted`);
      }

      const audible = (tab) => cdp.evaluate(webviewCall(tab.id, "isCurrentlyAudible"));
      const expectAudible = async (tab, when) => {
        try {
          await waitFor(`${tab.name} to be audible`, 10_000, () => audible(tab));
        } catch {
          failures.push(`${tab.name}: no sound ${when}`);
        }
      };
      if (audio.monitored === undefined) {
        // The selected tab of the visible window shows whether this machine has audio output.
        audio.monitored = await waitFor("the selected tab to be audible", 10_000, () => audible(ALFA)).catch(() => false);
        if (!audio.monitored) notes.push("no tab is reported audible on this machine (no audio output?): sound not checked");
      }
      if (audio.monitored) {
        await expectAudible(ALFA, "in the selected tab");
        await expectAudible(BETA, "in a background tab");
      }

      if (run === "window shown") {
        // A voice message keeps playing when another account is opened.
        await cdp.evaluate(`document.getElementById(${JSON.stringify(BETA.id)}).click()`);
        await waitFor("Beta to be selected", 10_000, () =>
          cdp.evaluate(`document.getElementById(${JSON.stringify(BETA.id)}).getAttribute("aria-selected") === "true"`));
        const tone = await pages[ALFA.id].evaluate(TONE_STATE);
        if (tone.state !== "running" || tone.advanced < 1) {
          failures.push(`Alfa after switching to Beta: audio is ${tone.state}, advanced ${tone.advanced.toFixed(2)}s in 2s`);
        }
        if (await cdp.evaluate(webviewCall(ALFA.id, "isAudioMuted"))) failures.push("Alfa after switching to Beta: audio muted");
        if (audio.monitored) await expectAudible(ALFA, "after switching to Beta");

        await checkStoreWrites(cdp, profile, failures);
        await checkMovingTabs(cdp, profile, failures);
        await checkResourcePanel(cdp, failures, notes);
        await checkLinkChooser(cdp, profile, failures);
      }
    } catch (error) {
      failures.push(error.message);
    } finally {
      for (const page of Object.values(pages)) {
        await page.evaluate(STOP_TONE).catch(() => undefined);
        page.close();
      }
    }
  };
}

/**
 * A link reaching the running app through a second start (as Windows makes
 * it) asks which account opens it, and only the chosen one does. Cancel opens
 * nothing; a link that is not a chat or an invite does not even ask.
 */
async function checkLinkChooser(cdp, profile, failures) {
  const secondStart = async (link) => {
    const second = launch(PACKAGED_EXE, [`--user-data-dir=${profile}`, "--", link]);
    try {
      await waitFor("the second start to pass the link on and exit", 30_000, () => second.exited);
    } finally {
      if (!second.exited) await stop(second);
    }
  };
  const ids = BACKGROUND_TABS.map((tab) => tab.id);
  try {
    await secondStart(CHAT_LINK.link);
    failures.push(...(await chooseAccountForLink(cdp, BACKGROUND_TABS, GAMMA, CHAT_LINK)));

    await secondStart(INVITE_LINK.link);
    await waitFor("the dialog for the group invite", 30_000, () => linkDialog(cdp, ids));
    await answerLinkDialog(cdp, null);
    await waitFor("the dialog to close on Cancel", 5_000, async () => !(await linkDialog(cdp, ids)));
    for (const tab of BACKGROUND_TABS) {
      if ((await openedLink(cdp, tab.id)) === INVITE_LINK.address) failures.push(`${tab.name} opened a cancelled link`);
    }

    await secondStart(BAD_LINK);
    await sleep(3000);
    if (await linkDialog(cdp, ids)) failures.push("a link that is not a chat or an invite asked for an account");
  } catch (error) {
    failures.push(`whatsapp:// link: ${error.message}`);
  }
}

// --- check 5: a Telegram account next to a WhatsApp one --------------------

// Alfa (WhatsApp) is selected; Tango (Telegram) is in the background.
const TANGO = { ...ALFA, id: "smokeTangoTab00000004", name: "Tango", service: "telegram" };
const TELEGRAM_TABS = [ALFA, TANGO];
/** Where the test's redirect in Tango starts: a Telegram address no page uses. */
const TELEGRAM_REDIRECT_START = "https://web.telegram.org/k/altus-plus-smoke-redirect";
const EN = JSON.parse(read("public/locales/en/translation.json"));

/** Whether the page has a function of its own in place of the browser's. */
const hooked = (expression) => `!String(${expression}).includes("[native code]")`;

/**
 * A page of the tab's service that answers with a redirect to target is not
 * followed: the tab stays on prefix. Returns what went wrong, or null.
 */
async function followedRedirect(cdp, page, tabId, start, target, prefix) {
  let redirected = false;
  const listener = ({ method, params }) => {
    if (method !== "Fetch.requestPaused") return;
    redirected = true;
    page.send("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: 302,
      responseHeaders: [{ name: "Location", value: target }],
    }).catch(() => {});
  };
  page.listeners.push(listener);
  try {
    // Past the service worker, straight to the interception.
    await page.send("Network.enable");
    await page.send("Network.setBypassServiceWorker", { bypass: true });
    await page.send("Fetch.enable", { patterns: [{ urlPattern: `${start}*` }] });
    await page.evaluate(`location.href = ${JSON.stringify(start)}; true`);
    await sleep(5000);
    const url = await cdp.evaluate(webviewCall(tabId, "getURL"));
    if (!redirected) return `${start} was never requested`;
    return url.startsWith(prefix) ? null : `a redirect to ${target} was followed: the tab shows ${url}`;
  } finally {
    await page.send("Fetch.disable").catch(() => {});
    await page.send("Network.setBypassServiceWorker", { bypass: false }).catch(() => {});
    page.listeners.splice(page.listeners.indexOf(listener), 1);
  }
}

/** Clicks the middle of the element find (an expression) returns, with the mouse. */
async function mouseClick(cdp, find, button = "left") {
  const point = await cdp.evaluate(`(() => {
    const box = (${find})?.getBoundingClientRect();
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  })()`);
  if (!point) throw new Error(`nothing to click: ${find}`);
  // Released with no button held, or the next press counts as a chord.
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button, buttons: button === "right" ? 2 : 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button, buttons: 0, clickCount: 1 });
}

/** Chooses an item of a tab's context menu (right click), as a user does. */
async function chooseFromTabMenu(cdp, tab, label) {
  const item = `[...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === ${JSON.stringify(label)})`;
  await mouseClick(cdp, `document.getElementById(${JSON.stringify(tab.id)})`, "right");
  await waitFor(`"${label}" in ${tab.name}'s menu`, 5_000, () => cdp.evaluate(`!!${item}`));
  await mouseClick(cdp, item);
  await waitFor("the tab menu to close", 5_000, async () => !(await cdp.evaluate(`!!${item}`)));
}

/**
 * "+" asks for the new tab's service, WhatsApp first (Enter keeps opening a
 * WhatsApp tab); Cancel adds nothing; Telegram adds a Telegram tab, saved as
 * one and marked with its icon, which is then closed.
 */
async function checkNewTabChooser(cdp, profile, failures) {
  const dialogOpen = () => cdp.evaluate('!!document.querySelector("[data-new-tab-dialog]")');
  const webviews = () => cdp.evaluate('document.querySelectorAll("webview").length');
  const savedTabs = () => readJson(path.join(profile, "tabs.json")).tabs;
  try {
    await cdp.evaluate('document.querySelector("[data-add-tab]").click()');
    await waitFor("the new tab's service to be asked", 10_000, dialogOpen);
    const focused = await waitFor("a service to have the focus", 5_000, () =>
      cdp.evaluate("document.activeElement?.dataset.service ?? null")).catch(() => null);
    if (focused !== "whatsapp") failures.push(`new tab: ${focused ?? "nothing"} has the focus instead of WhatsApp`);
    await cdp.evaluate('document.querySelector("[data-new-tab-dialog] [data-cancel]").click()');
    await waitFor("the dialog to close on Cancel", 5_000, async () => !(await dialogOpen()));
    if ((await webviews()) !== TELEGRAM_TABS.length) failures.push("new tab: Cancel added a tab");

    await cdp.evaluate('document.querySelector("[data-add-tab]").click()');
    await waitFor("the new tab's service to be asked", 10_000, dialogOpen);
    await cdp.evaluate('document.querySelector(\'[data-new-tab-dialog] [data-service="telegram"]\').click()');
    const added = await waitFor("the new tab to be saved", 10_000, () =>
      savedTabs().find((tab) => !TELEGRAM_TABS.some((known) => known.id === tab.id)));
    if (added.service !== "telegram") failures.push(`new tab: saved with service ${added.service}`);
    const shown = await waitFor("the new tab's webview", 10_000, () => cdp.evaluate(`(() => {
      const webview = document.getElementById(${JSON.stringify(`webview-${added.id}`)});
      return webview && {
        src: webview.getAttribute("src"),
        icon: !!document.getElementById(${JSON.stringify(added.id)})?.querySelector('[data-service-icon="telegram"]'),
      };
    })()`));
    if (!SERVICE_PAGES.telegram.src.test(shown.src ?? "")) failures.push(`new tab: the Telegram tab loads ${shown.src}`);
    if (!shown.icon) failures.push("new tab: the Telegram tab has no Telegram icon");
    if (await cdp.evaluate(`!!document.getElementById(${JSON.stringify(ALFA.id)})?.querySelector("[data-service-icon]")`)) {
      failures.push("Alfa, a WhatsApp tab, shows a service icon");
    }
    await cdp.evaluate(`document.querySelector(${JSON.stringify(`[data-close-tab="${added.id}"]`)}).click()`);
    await waitFor("the new tab to close", 10_000, () => savedTabs().length === TELEGRAM_TABS.length);
  } catch (error) {
    failures.push(`new tab: ${error.message}`);
  }
}

function exerciseTelegramTabs(profile) {
  return async ({ cdp, port, failures, notes }) => {
    let alfa;
    let tango;
    const server = http.createServer((request, response) => {
      server.requests.push(request.url);
      response.end("<title>Elsewhere</title>");
    });
    server.requests = [];
    try {
      alfa = await connectToTab(port, ALFA.id);
      tango = await connectToTab(port, TANGO.id, "telegram");
      await sleep(1000); // the account name and mute arrive with the tab ID

      // Telegram's preload, in Telegram's tab only.
      const hooks = await tango.evaluate(`({ badge: ${hooked("navigator.setAppBadge")}, open: ${hooked("window.open")} })`);
      if (!hooks.badge || !hooks.open) failures.push(`Tango: Telegram's hooks are missing (${JSON.stringify(hooks)})`);
      if (await alfa.evaluate(hooked("window.open"))) failures.push("Alfa: a WhatsApp tab has Telegram's window.open");

      // A link the page opens on its own, without the user's click, goes
      // nowhere (it would only show here where a browser opens it).
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      await tango.evaluate(`window.open(${JSON.stringify(`http://127.0.0.1:${server.address().port}/opened`)}); true`);
      await sleep(5000);
      if (server.requests.length) failures.push("Tango: window.open without a click opened the link in the browser");

      // Host-level trust: a permission check names only the origin.
      const notified = await tango.evaluate(NOTIFY);
      if (notified.permission !== "granted" || notified.requested !== "granted") {
        failures.push(`Tango: notification permission is ${notified.permission}, request answered ${notified.requested}`);
      }
      if (!notified.real) failures.push("Tango: the notification was suppressed although Tango is not muted");
      if (notified.title !== "Tango · Smoke") failures.push(`Tango: notification title is "${notified.title}", expected "Tango · Smoke"`);
      if (notified.event === "error") failures.push("Tango: the notification reported an error");
      notes.push(`telegram: Tango notification ${notified.event === "show" ? "shown" : `event: ${notified.event}`}`);

      // The unread count is the page's app badge, on the page's own tab.
      const badge = (tab) => cdp.evaluate(
        `document.getElementById(${JSON.stringify(tab.id)})?.querySelector(".bg-red-600")?.textContent ?? ""`);
      await tango.evaluate("navigator.setAppBadge(3)");
      try {
        await waitFor("Tango's count from its app badge", 5_000, async () => (await badge(TANGO)) === "3");
      } catch {
        failures.push(`Tango: setAppBadge(3) shows "${await badge(TANGO)}" on its tab`);
      }
      try {
        await tango.evaluate(`document.body.dataset.tabId = ${JSON.stringify(ALFA.id)}; navigator.setAppBadge(4)`);
        await waitFor("the count of Tango's page on Tango", 5_000, async () => (await badge(TANGO)) === "4");
      } catch {
        failures.push(`Tango's page claimed Alfa's tab ID: its count shows on Alfa "${await badge(ALFA)}", on Tango "${await badge(TANGO)}"`);
      } finally {
        await tango.evaluate(`document.body.dataset.tabId = ${JSON.stringify(TANGO.id)}`);
      }
      if ((await badge(ALFA)) !== "") failures.push(`Alfa shows Tango's count "${await badge(ALFA)}"`);
      await tango.evaluate("navigator.clearAppBadge()");
      await waitFor("Tango's count to clear", 5_000, async () => (await badge(TANGO)) === "").catch(() =>
        failures.push("Tango: clearAppBadge() left a count on its tab"));

      // The window cannot save a tab under another service, not even as the
      // last closed tab; nothing of a refused write is saved.
      const tabsFile = path.join(profile, "tabs.json");
      const tabsBefore = fs.readFileSync(tabsFile, "utf8");
      const save = (key, value) => cdp.evaluate(
        `window.electronTabStore.set(${JSON.stringify(key)}, ${JSON.stringify(value)}).then(() => "saved", () => "refused")`);
      for (const [what, key, value] of [
        ["Tango without its service", "tabs", [ALFA, { ...TANGO, service: undefined }]],
        ["Tango as a WhatsApp tab", "tabs", [ALFA, { ...TANGO, service: "whatsapp" }]],
        ["Alfa as a Telegram tab", "tabs", [{ ...ALFA, service: "telegram" }, TANGO]],
        ["Tango as a closed WhatsApp tab", "previouslyClosedTab", { ...TANGO, service: "whatsapp" }],
      ]) {
        if ((await save(key, value)) !== "refused") failures.push(`the window could save ${what}`);
      }
      if (fs.readFileSync(tabsFile, "utf8") !== tabsBefore) failures.push("a refused write changed tabs.json");

      // Each tab stays on its service: Telegram on its K version.
      await tango.evaluate('location.href = "https://web.telegram.org/a/"; true');
      await sleep(3000);
      const afterA = await cdp.evaluate(webviewCall(TANGO.id, "getURL"));
      if (!afterA.startsWith(SERVICE_PAGES.telegram.prefix)) failures.push(`Tango left the K version for ${afterA}`);
      const toWhatsApp = await followedRedirect(cdp, tango, TANGO.id, TELEGRAM_REDIRECT_START, "https://web.whatsapp.com/", SERVICE_PAGES.telegram.prefix);
      if (toWhatsApp) failures.push(`Tango: ${toWhatsApp}`);
      const toTelegram = await followedRedirect(cdp, alfa, ALFA.id, REDIRECT_START, "https://web.telegram.org/k/", SERVICE_PAGES.whatsapp.prefix);
      if (toTelegram) failures.push(`Alfa: ${toTelegram}`);

      // Muted from its tab's menu: no notification until unmuted.
      await chooseFromTabMenu(cdp, TANGO, EN["Mute notifications for 1 hour"]);
      await waitFor("Tango to show it is muted", 5_000, () => cdp.evaluate(
        `!!document.getElementById(${JSON.stringify(TANGO.id)})?.querySelector(${JSON.stringify(`[aria-label="${EN["Notifications muted"]}"]`)})`));
      await sleep(1000); // the mute reaches the page
      const muted = await tango.evaluate(NOTIFY);
      if (muted.real) failures.push("Tango: muted, but a real notification was created");
      if (muted.event !== "close") failures.push(`Tango: the stand-in did not report itself closed (${muted.event})`);
      await chooseFromTabMenu(cdp, TANGO, EN["Unmute notifications"]);

      await checkNewTabChooser(cdp, profile, failures);
    } catch (error) {
      failures.push(error.message);
    } finally {
      alfa?.close();
      tango?.close();
      server.close();
    }
  };
}

async function checkTelegramTabs() {
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ tabClosePrompt: { value: false } }));
  fs.writeFileSync(path.join(profile, "tabs.json"), JSON.stringify({
    tabs: TELEGRAM_TABS, previouslyClosedTab: null, selectedTabId: ALFA.id,
  }));
  const result = await checkRunningApp("telegram-tabs", PACKAGED_EXE, [`--user-data-dir=${profile}`], {
    label: ADD_TAB_LABEL.en,
    otherLabel: ADD_TAB_LABEL.it,
    tabNames: TELEGRAM_TABS.map((tab) => tab.name),
    tabIds: TELEGRAM_TABS.map((tab) => tab.id),
    tabCount: TELEGRAM_TABS.length,
    services: { [TANGO.id]: "telegram" },
    windowShown: true,
    afterLoad: exerciseTelegramTabs(profile),
  }, 9420);
  removeTemp(profile);
  return result;
}

async function checkBackgroundTabs() {
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  const seed = (settings) => {
    fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(settings));
    fs.writeFileSync(path.join(profile, "tabs.json"), JSON.stringify({
      tabs: BACKGROUND_TABS, previouslyClosedTab: null, selectedTabId: ALFA.id,
    }));
  };
  const expected = {
    label: ADD_TAB_LABEL.en,
    otherLabel: ADD_TAB_LABEL.it,
    tabNames: BACKGROUND_TABS.map((tab) => tab.name),
    tabIds: BACKGROUND_TABS.map((tab) => tab.id),
    tabCount: BACKGROUND_TABS.length,
  };
  const audio = {};
  seed({});
  const shown = await checkRunningApp("background-tabs", PACKAGED_EXE, [`--user-data-dir=${profile}`], {
    ...expected,
    windowShown: true,
    afterLoad: exerciseBackgroundTabs("window shown", audio, profile),
  }, 9415);
  // Started with Windows into the tray: every tab is in a hidden window.
  seed({ launchToTray: { value: true } });
  const inTray = await checkRunningApp("background-tabs-tray", PACKAGED_EXE, [`--user-data-dir=${profile}`, "--hidden"], {
    ...expected,
    windowShown: false,
    afterLoad: exerciseBackgroundTabs("in the tray", audio, profile),
  }, 9416);
  removeTemp(profile);
  const telegram = await checkTelegramTabs();
  return {
    failures: [
      ...shown.failures.map((line) => `window shown: ${line}`),
      ...inTray.failures.map((line) => `in the tray: ${line}`),
      ...telegram.failures.map((line) => `telegram: ${line}`),
    ],
    notes: [...shown.notes, ...inTray.notes, ...telegram.notes],
  };
}

// --- check 6: resource test --------------------------------------------------

/** IDs of every item in the app menu. */
async function menuIds(cdp) {
  const ids = [];
  const walk = (items) => {
    for (const item of items ?? []) {
      if (item.id) ids.push(item.id);
      walk(item.submenu);
    }
  };
  walk(await cdp.evaluate("window.getAppMenu()"));
  return ids;
}

/**
 * Connects to the app window on a DevTools port once `ready` holds; across a
 * restart the port first belongs to the old instance, then to the new one.
 */
function attachWhen(port, what, timeoutMs, ready) {
  return waitFor(what, timeoutMs, async () => {
    const page = (await targets(port)).find((target) => target.type === "page" && target.url.startsWith("file:"));
    if (!page) return null;
    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    try {
      if (await ready(cdp)) return cdp;
    } catch {
      // The window is still loading, or its instance is quitting.
    }
    cdp.close();
    return null;
  });
}

/**
 * Main processes of the app running on a profile. A restarted instance is
 * not a child of this script, so it is found by its --user-data-dir.
 */
function instancesOnProfile(profile) {
  const exe = `${packageJson.productName}.exe`.replace(/'/g, "''");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='${exe}'" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`],
  { encoding: "utf8" });
  const parsed = JSON.parse(result.stdout.trim() || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((process) => process.CommandLine?.includes(`--user-data-dir=${profile}`) && !process.CommandLine.includes("--type="))
    .map((process) => process.ProcessId);
}

/**
 * Run in a WhatsApp tab's page: changes its title every 20 ms (faster floods
 * the app window), so its preload sends unread counts nonstop.
 */
const TITLE_FLOOD = `(() => {
  let count = 0;
  setInterval(() => { document.title = "(" + (++count % 100) + ") WhatsApp"; }, 20);
})()`;

/**
 * The custom title bar stays as the window was created until the next start.
 * Turning the setting off and then reloading the page's settings, as "Allow
 * Moving Tabs" or a language change does, used to remove it from a window
 * without a frame, leaving no buttons and no menu.
 */
async function checkTitlebarKept(cdp) {
  const count = () => cdp.evaluate('document.querySelectorAll("[data-custom-titlebar]").length');
  try {
    const before = await count();
    if (before !== 1) return [`custom title bar: ${before} on a window created with it, expected 1`];
    await cdp.evaluate('window.electronSettingsStore.setSetting("customTitlebar", false)');
    // Tab → Allow Moving Tabs: the page reloads its settings.
    await cdp.evaluate('window.electronSettingsStore.setSetting("tabReordering", true)');
    await sleep(2000);
    const after = await count();
    await cdp.evaluate('window.electronSettingsStore.setSetting("tabReordering", false)');
    return after === 1 ? [] : [`custom title bar: ${after} after turning it off and reloading the settings, expected 1 until the next start`];
  } catch (error) {
    return [`custom title bar: ${error.message}`];
  }
}

/**
 * The window's listeners for messages from main get the message alone, not
 * Electron's event object (which carries the sender), and each returns a
 * remover, the title bar's focus and blur listeners included (they had none).
 */
async function checkWindowListeners(cdp, notes) {
  const failures = [];
  try {
    await cdp.evaluate(`(() => {
      window.smokeMessages = [];
      window.smokeStopMessages = window.electronIPCHandlers.onReloadSettings((...args) => window.smokeMessages.push(args));
      return true;
    })()`);
    // Tab → Allow Moving Tabs: the page reloads its settings; again once
    // the listener is removed.
    await cdp.evaluate('window.electronSettingsStore.setSetting("tabReordering", true)');
    await waitFor("the page to reload its settings", 5_000, () => cdp.evaluate("window.smokeMessages.length > 0")).catch(() => {});
    await cdp.evaluate("window.smokeStopMessages()");
    await cdp.evaluate('window.electronSettingsStore.setSetting("tabReordering", false)');
    await sleep(1000);
    const messages = await cdp.evaluate("window.smokeMessages");
    if (messages.length !== 1) {
      failures.push(`window listeners: ${messages.length} message(s) for one settings reload and one after removing the listener, expected 1`);
    }
    if (messages.flat().some((arg) => arg !== null)) {
      failures.push(`window listeners: a listener got ${JSON.stringify(messages[0])}, not the message alone`);
    }

    const remover = await cdp.evaluate(`(() => {
      window.smokeBlurs = { removed: 0, kept: 0 };
      const stop = window.windowActions.onBlurred(() => window.smokeBlurs.removed++);
      window.smokeStopBlurs = window.windowActions.onBlurred(() => window.smokeBlurs.kept++);
      if (typeof stop !== "function") return typeof stop;
      stop();
      return "function";
    })()`);
    if (remover !== "function") {
      failures.push(`window listeners: the title bar's blur listener returns ${remover}, not a remover`);
    } else {
      // Minimizing takes the focus away (if the window had it).
      await cdp.evaluate("window.windowActions.minimize()");
      await sleep(1000);
      await cdp.evaluate("window.windowActions.restore()");
      await sleep(1000);
      const blurs = await cdp.evaluate("window.smokeBlurs");
      if (blurs.removed) failures.push("window listeners: a removed blur listener still ran");
      else if (!blurs.kept) notes.push("window listeners: the window lost no focus when minimized (it had none), removal not observed");
    }
    await cdp.evaluate('typeof window.smokeStopBlurs === "function" && window.smokeStopBlurs()');
  } catch (error) {
    failures.push(`window listeners: ${error.message}`);
  }
  return failures;
}

/**
 * An item of the custom title bar's menu reaches the window even when no
 * window has the focus, here because it is minimized. Before, only Help →
 * Resource Usage and Run Resource Test did; the others did nothing.
 */
async function checkMenuWithoutFocus(cdp) {
  const settingsOpen = () => cdp.evaluate('!!document.querySelector("[data-settings-dialog]")');
  try {
    if (await settingsOpen()) return ["menu without focus: Settings was open before the click"];
    await cdp.evaluate("window.windowActions.minimize()");
    await waitFor("the minimized window to lose the focus", 5_000, () => cdp.evaluate("window.windowActions.isBlurred()"));
    await cdp.evaluate('window.clickMenuItem("open-settings")');
    const opened = await waitFor("Settings to open", 5_000, settingsOpen).then(() => true, () => false);
    await cdp.evaluate("window.windowActions.restore()");
    if (!opened) return ["menu without focus: Settings → Settings did nothing while the window was minimized"];
    // Its close button comes first, next to the title.
    await cdp.evaluate('document.querySelector("[data-settings-dialog] button").click()');
    await waitFor("Settings to close", 5_000, async () => !(await settingsOpen()));
    return [];
  } catch (error) {
    return [`menu without focus: ${error.message}`];
  }
}

/**
 * An attachment downloaded during the resource test goes through electron-dl
 * like any other: into the folder from Settings, with "Attachment saved".
 * The test's first sample creates the tabs' sessions, which used to happen
 * before electron-dl was set up, so their downloads got neither.
 */
async function checkDownloadDuringTest(cdp, downloads) {
  const name = "smoke-download.txt";
  const download = `(() => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["smoke"], { type: "text/plain" }));
    link.download = ${JSON.stringify(name)};
    document.body.append(link);
    link.click();
    link.remove();
  })()`;
  try {
    await cdp.evaluate(`document.querySelector("webview").executeJavaScript(${JSON.stringify(download)}, true)`);
    // The notice shows for 6 s once the file is saved.
    await waitFor(`${name} in the download folder from Settings, with "Attachment saved"`, 30_000, async () =>
      fs.existsSync(path.join(downloads, name)) &&
      cdp.evaluate(`!!document.querySelector('[role="status"][title=${JSON.stringify(name)}]')`));
    return [];
  } catch (error) {
    const saved = fs.existsSync(downloads) ? fs.readdirSync(downloads) : [];
    return [`download during the resource test: ${error.message} (download folder: ${saved.length ? saved.join(", ") : "empty"})`];
  }
}

async function checkResourceTest() {
  const failures = [];
  const notes = [];
  const port = 9417;
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  const folder = path.join(profile, "resource-tests");
  fs.writeFileSync(path.join(profile, "tabs.json"), JSON.stringify({
    tabs: BACKGROUND_TABS, previouslyClosedTab: null, selectedTabId: ALFA.id,
  }));
  // Downloads go straight into this folder, without the save dialog.
  const downloads = path.join(profile, "downloads");
  fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({
    showSaveDialog: { value: false }, defaultDownloadDir: { value: downloads },
    // Turned off during the first run: the restart into the test has a frame.
    customTitlebar: { value: true },
  }));
  const first = launch(PACKAGED_EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`]);
  let cdp;
  try {
    // Help → Run Resource Test… → Restart and Measure.
    cdp = await attachWhen(port, "Help → Run Resource Test", 90_000, async (page) => (await menuIds(page)).includes("resource-test"));
    failures.push(...(await checkTitlebarKept(cdp)));
    failures.push(...(await checkWindowListeners(cdp, notes)));
    failures.push(...(await checkMenuWithoutFocus(cdp)));
    // Unread counts in flight while the app closes, as when the accounts sync
    // right after a start: every tab changes its title nonstop. A count that
    // reached the destroyed window stopped the restart with an error box.
    await waitFor("the tabs to know their IDs", 60_000, () => cdp.evaluate(`Promise.all([...document.querySelectorAll("webview")]
      .map((webview) => webview.executeJavaScript("document.body?.dataset.tabId ?? ''").catch(() => "")))
      .then((ids) => ids.length === ${BACKGROUND_TABS.length} && ids.every(Boolean))`));
    await cdp.evaluate(`Promise.all([...document.querySelectorAll("webview")]
      .map((webview) => webview.executeJavaScript(${JSON.stringify(TITLE_FLOOD)})))`);
    await cdp.evaluate('window.clickMenuItem("resource-test")');
    await waitFor("the Resource Test dialog", 10_000, () => cdp.evaluate('!!document.querySelector("[data-resource-test-start]")'));
    await cdp.evaluate('document.querySelector("[data-resource-test-start]").click()').catch(() => undefined);
    cdp.close();
    cdp = undefined;
    try {
      await waitFor("the app to restart into the test", 30_000, () => first.exited);
    } catch (error) {
      const errors = first.output.split(/\r?\n/).filter((line) => /Exception|Error/.test(line)).slice(0, 3);
      throw new Error(`${error.message}; ${errors.length ? `app log: ${errors.join(" | ")}` : "no error in its log (an error box may be holding it)"}`);
    }

    cdp = await attachWhen(port, "the app restarted in the resource test", 90_000, async (page) => (await menuIds(page)).includes("end-resource-test"));
    // Turned off before the restart, so this window has a frame and no custom title bar.
    const titlebars = await cdp.evaluate('document.querySelectorAll("[data-custom-titlebar]").length');
    if (titlebars !== 0) failures.push(`custom title bar: ${titlebars} after restarting with the setting off`);
    const names = BACKGROUND_TABS.map((tab) => tab.name);
    let csv;
    try {
      csv = await waitFor("samples and page loads of the three accounts in the test file", 90_000, () => {
        const file = fs.existsSync(folder) && fs.readdirSync(folder).find((name) => name.endsWith(".csv"));
        if (!file) return null;
        const text = fs.readFileSync(path.join(folder, file), "utf8");
        const done = text.includes(",event,window shown") &&
          names.every((name) => text.includes(`,event,WhatsApp page loaded: ${name}`)) &&
          names.every((name) => new RegExp(`^[\\d.]+,[^,]+,account,${name},1,`, "m").test(text));
        return done ? { file, text } : null;
      });
    } catch (error) {
      failures.push(error.message);
    }
    if (csv) {
      if (!csv.text.startsWith("seconds,time,kind,name,processes,cpu_percent,private_mb,working_set_mb,js_heap_used_mb,js_heap_total_mb,js_external_mb")) {
        failures.push("the test file has no header");
      }
      // Quoted: the description has commas.
      if (!/,event,"test started: Altus \+ /.test(csv.text)) failures.push("the test file does not say what was tested");
      // Startup moments, in order (Node.js's start only when counting from the
      // process's creation), from Electron's "ready" on with the main
      // process's CPU time since the previous one.
      const cpuText = " \\(main process CPU since the previous step: [\\d.]+ s\\)";
      const at = (event, cpu) => csv.text.match(new RegExp(`^([\\d.]+),[^,]+,event,${event}${cpu ? cpuText : ""}\\r?$`, "m"))?.[1];
      const startup = [
        ["Node.js started"], ["main script started"], ["Electron ready", true], ["partitions checked", true],
        ["autostart checked", true], ["window created", true],
      ].map(([event, cpu]) => [event, at(event, cpu)]);
      const found = startup.filter(([, seconds]) => seconds !== undefined);
      for (const [event, seconds] of startup.slice(1)) if (seconds === undefined) failures.push(`the test file has no "${event}" (with its CPU time from "Electron ready" on)`);
      if (found.some(([, seconds], index) => index > 0 && Number(seconds) < Number(found[index - 1][1]))) {
        failures.push(`startup moments out of order: ${JSON.stringify(found)}`);
      }
      // The main process's rows carry its JavaScript memory.
      const mainRows = csv.text.split(/\r?\n/).filter((line) => /^[\d.]+,[^,]+,main,/.test(line)).map((line) => line.split(","));
      if (!mainRows.length || !mainRows.every((fields) => fields.length === 11 && Number(fields[8]) > 0 && Number(fields[9]) >= Number(fields[8]))) {
        failures.push(`the main process rows lack its JavaScript memory: ${mainRows.slice(0, 2).map((fields) => fields.join(",")).join(" | ")}`);
      }
      notes.push(`${csv.file}: ${csv.text.split(/\r?\n/).filter(Boolean).length} rows after the pages loaded`);
      notes.push(`startup: ${found.map(([event, seconds]) => `${event} ${seconds} s`).join(", ")}; main JavaScript ${mainRows.at(-1)?.[8]} MB`);
    }

    failures.push(...(await checkDownloadDuringTest(cdp, downloads)));

    // Help → End Resource Test: summary, then a normal restart.
    await cdp.evaluate('window.clickMenuItem("end-resource-test")').catch(() => undefined);
    cdp.close();
    cdp = undefined;
    let summary;
    try {
      summary = await waitFor("the summary file", 30_000, () => {
        const file = fs.existsSync(folder) && fs.readdirSync(folder).find((name) => name.endsWith(".txt"));
        return file && fs.readFileSync(path.join(folder, file), "utf8");
      });
    } catch (error) {
      failures.push(error.message);
    }
    if (summary) {
      for (const name of names) if (!summary.includes(`${name}:`)) failures.push(`the summary does not list ${name}`);
      if (!summary.includes("resource test")) failures.push(`the summary has no title: ${summary.slice(0, 80)}`);
      if (!/Times since (Windows created the process|Node\.js started):/.test(summary)) failures.push("the summary has no startup times");
      if (!/Longest step: .+ → .+, [\d.]+ s/.test(summary)) failures.push("the summary has no longest startup step");
      if (!summary.includes("Main process (private memory)")) failures.push("the summary has no main process section");
    }
    const samples = fs.readdirSync(folder).filter((name) => name.endsWith(".csv"));
    if (samples.length !== 1 || !fs.readFileSync(path.join(folder, samples[0]), "utf8").includes(",event,test ended")) {
      failures.push("the test file was not closed with \"test ended\"");
    }
    cdp = await attachWhen(port, "the app restarted normally", 90_000, async (page) => (await menuIds(page)).includes("resource-test"));
  } catch (error) {
    failures.push(error.message);
  } finally {
    cdp?.close();
    if (!first.exited) await stop(first).catch(() => undefined);
    // The restarted instances are not children of this script: stop them by PID.
    for (const pid of instancesOnProfile(profile)) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    }
    await waitFor("every instance on the test profile to exit", 30_000, () => instancesOnProfile(profile).length === 0)
      .catch((error) => failures.push(error.message));
    await sleep(2000);
    removeTemp(profile);
  }
  return { failures, notes };
}

// Fake data of the original Altus (same file formats as Altus +).
const ORIGINAL_TABS = [
  ["smokePersonaleTab0001", "Personale"],
  ["smokeLavoroTab0000002", "Lavoro"],
].map(([id, name]) => ({
  id,
  name,
  messageCount: 0,
  config: { theme: "dark", notifications: true, media: true, sound: true, color: null, spellChecker: true },
}));

function seedOriginalAltus(tabs) {
  const original = path.join(APPDATA, "Altus");
  const files = {
    "settings.json": { language: { value: "it" }, tabBarPosition: { value: "bottom" }, autoLaunch: { value: true } },
    "tabs.json": { tabs, previouslyClosedTab: null, selectedTabId: tabs[0].id },
  };
  for (const [file, data] of Object.entries(files)) {
    fs.mkdirSync(original, { recursive: true });
    fs.writeFileSync(path.join(original, file), JSON.stringify(data, null, 2));
  }
  fs.mkdirSync(path.join(original, "Partitions", tabs[0].id.toLowerCase()), { recursive: true });
  fs.writeFileSync(path.join(original, "Partitions", tabs[0].id.toLowerCase(), "smoke-marker"), "original");
  return files;
}

const backups = () => fs.readdirSync(APPDATA).filter((entry) => /^Altus \(backup \d{4}-\d{2}-\d{2}( \d{4})?\)$/.test(entry));

function runSetup(installer, installDir) {
  const result = spawnSync(installer, ["/S", "--replace-altus", `/D=${installDir}`], { timeout: 300_000 });
  if (result.status !== 0) throw new Error(`the installer exited with ${result.status ?? result.error}`);
}

function findInstalledExe(installDir) {
  for (const dir of [installDir, ...fs.readdirSync(installDir).map((entry) => path.join(installDir, entry))]) {
    const exe = path.join(dir, `${packageJson.productName}.exe`);
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

const install = { dir: path.join(TEMP, "as-install"), exe: null };

/**
 * HKCU\...\Run through winreg, the library the app writes it with (through
 * auto-launch).
 */
function runKey() {
  const Winreg = createRequire(import.meta.url)(path.join(root, "node_modules", "winreg"));
  return { Winreg, key: new Winreg({ hive: Winreg.HKCU, key: "\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" }) };
}

function readRunEntry(name) {
  return new Promise((resolve) => {
    runKey().key.get(name, (error, item) => resolve(error ? { error: error.message.split(/\r?\n/)[0] } : { value: item.value }));
  });
}

function writeRunEntry(name, value) {
  const { Winreg, key } = runKey();
  return new Promise((resolve, reject) => key.set(name, Winreg.REG_SZ, value, (error) => (error ? reject(error) : resolve())));
}

function removeRunEntry(name) {
  return new Promise((resolve, reject) => runKey().key.remove(name, (error) => (error ? reject(error) : resolve())));
}

/** Values of every program in HKCU's installed programs list (Settings → Apps). */
async function installedPrograms() {
  const Winreg = createRequire(import.meta.url)(path.join(root, "node_modules", "winreg"));
  const list = new Winreg({ hive: Winreg.HKCU, key: "\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" });
  const keys = await new Promise((resolve, reject) => list.keys((error, found) => (error ? reject(error) : resolve(found))));
  return Promise.all(keys.map((key) => new Promise((resolve) => {
    key.values((error, items) => resolve(error ? {} : Object.fromEntries(items.map((item) => [item.name, item.value]))));
  })));
}

// Publisher of the original Altus in its WinGet manifest (AmanHarwara.Altus).
const ORIGINAL_PUBLISHER = "Aman Harwara";

/**
 * Altus +'s entry in the installed programs list, which WinGet and UniGetUI
 * read. WinGet treats an installed program as one of its packages when name
 * and publisher match once normalized (case, spaces, symbols and versions
 * dropped, so "Altus + 5.8.1-plus.22" becomes "altus"): with the original's
 * publisher, UniGetUI offered the original's updates as updates of Altus +.
 */
async function checkProgramsEntry() {
  const entries = (await installedPrograms()).filter((values) => values.DisplayName?.startsWith(packageJson.productName));
  if (entries.length !== 1) {
    return [`expected one "${packageJson.productName}" entry in the installed programs list, found ${entries.length}`];
  }
  const [entry] = entries;
  const failures = [];
  const normalize = (value) => String(value ?? "").replace(/[^\p{L}\p{Nd}]/gu, "").toLowerCase();
  if (normalize(entry.Publisher) === normalize(ORIGINAL_PUBLISHER)) {
    failures.push(`installed programs list: the publisher is the original's ('${entry.Publisher}'), so WinGet takes Altus + for it`);
  } else if (entry.Publisher !== packageJson.author.name) {
    failures.push(`installed programs list: publisher '${entry.Publisher}', expected '${packageJson.author.name}'`);
  }
  if (entry.DisplayVersion !== packageJson.version) {
    failures.push(`installed programs list: version '${entry.DisplayVersion}', expected '${packageJson.version}'`);
  }
  return failures;
}

/** The command the installed app registers for whatsapp:// links. */
const installedLinkCommand = () => `"${install.exe}" -- "%1"`;
const isInstalledLinkCommand = (command) => command?.toLowerCase() === installedLinkCommand().toLowerCase();

/** What the installed app's autostart entry runs: the flag "Start in tray with Windows" relies on. */
const installedAutostartEntry = () => `"${install.exe}" --hidden`;

/**
 * Settings → "Launch at system startup" on the running installed app: off
 * removes the entry and on writes it again, without a restart (it used to
 * change only at the app's next start). Quick changes in a row run reg.exe
 * one at a time and leave the entry as the last one says. Left on.
 */
async function checkAutostartSwitch(cdp, app) {
  const entry = async () => (await readRunEntry(packageJson.productName)).value?.trim();
  const isInstalledEntry = async () => (await entry())?.toLowerCase() === installedAutostartEntry().toLowerCase();
  const failures = [];
  const setAutoLaunch = (values) =>
    cdp.evaluate(`Promise.all(${JSON.stringify(values)}.map((value) => window.electronSettingsStore.setSetting("autoLaunch", value)))`);
  try {
    if (!(await isInstalledEntry())) return [`autostart switch: the entry is ${(await entry()) ?? "missing"} before the check`];
    const logBefore = app.output.length;
    await setAutoLaunch([false]);
    await waitFor("the autostart entry to be removed when the setting is turned off", 15_000, async () => !(await entry()));
    await setAutoLaunch([true]);
    await waitFor("the autostart entry to return when the setting is turned on", 15_000, isInstalledEntry);
    await setAutoLaunch([false, true, false, true, false]);
    await waitFor("the entry to be removed after quick changes ending off", 20_000, async () => !(await entry()));
    // Nothing still queued may write it again.
    await sleep(5_000);
    if (await entry()) failures.push("after quick changes ending off, the autostart entry came back");
    await setAutoLaunch([true]);
    await waitFor("the autostart entry to return at the end", 15_000, isInstalledEntry);
    const failed = app.output.slice(logBefore).match(/Autostart update failed[^\r\n]*/);
    if (failed) failures.push(`app log: ${failed[0].trim()}`);
  } catch (error) {
    failures.push(`autostart switch: ${error.message}`);
  }
  return failures;
}

/**
 * Settings → "Open whatsapp:// links" on the installed app: on, the app
 * registers for the links, and a link started through Windows (as a browser
 * does) asks which account opens it; off, the registration goes. It is left
 * on for checks 8 (kept on reinstall) and 9 (removed on uninstall).
 */
async function checkLinkRegistration() {
  const failures = [];
  const before = await readProtocolCommand();
  if (before) return [`a whatsapp:// registration exists before the check: ${before}`];
  const settingsFile = path.join(APPDATA, PROFILE_FOLDER, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ ...readJson(settingsFile), registerProtocol: { value: true } }, null, 2));
  const port = 9418;
  const app = launch(install.exe, [`--remote-debugging-port=${port}`]);
  let cdp;
  try {
    const page = await waitFor("the installed app window", 90_000, async () => {
      if (app.exited) throw new Error(`the app exited (code ${app.exitCode})`);
      return (await targets(port)).find((target) => target.type === "page" && target.url.startsWith("file:"));
    });
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await waitFor("the app to register for whatsapp:// links", 30_000, async () => isInstalledLinkCommand(await readProtocolCommand()))
      .catch(async (error) => {
        throw new Error(`${error.message}; the command is ${(await readProtocolCommand()) ?? "missing"}`);
      });

    // Through Windows, which runs the registered command, as a browser does.
    const started = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Start-Process '${CHAT_LINK.link}'`], { timeout: 60_000 });
    if (started.status !== 0) failures.push(`Start-Process of the link exited with ${started.status ?? started.error}`);
    const tabs = ORIGINAL_TABS.map((tab) => ({ id: tab.id, name: tab.name }));
    failures.push(...(await chooseAccountForLink(cdp, tabs, tabs[1], CHAT_LINK)));

    // Turned off and on again from the app, as the Settings switch does.
    await cdp.evaluate(`window.electronSettingsStore.setSetting("registerProtocol", false)`);
    await waitFor("the registration to be removed when the setting is off", 15_000, async () => !(await readProtocolCommand()));
    await cdp.evaluate(`window.electronSettingsStore.setSetting("registerProtocol", true)`);
    await waitFor("the registration to return when the setting is on", 15_000, async () => isInstalledLinkCommand(await readProtocolCommand()));

    failures.push(...(await checkAutostartSwitch(cdp, app)));
  } catch (error) {
    failures.push(`whatsapp:// links: ${error.message}`);
  } finally {
    cdp?.close();
    await stop(app).catch((error) => failures.push(error.message));
    if (failures.length) saveArtifact("installed-app-links.log", app.output);
  }
  return failures;
}

/**
 * Two more starts of the installed app once its autostart entry is set: the
 * first leaves the entry alone without running reg.exe; after the entry is
 * deleted, the second writes it again although the app remembers writing it.
 */
async function checkAutostartOnRestarts(expectedEntry) {
  const failures = [];
  // The app's first autostart line, then it is stopped.
  const start = async (what) => {
    const app = launch(install.exe, []);
    try {
      return await waitFor(`the app's autostart line (${what})`, 60_000, () => {
        const line = app.output.match(/Autostart (entry (unchanged|set|removed)|update failed)[^\r\n]*/)?.[0];
        if (!line && app.exited) throw new Error(`the app exited (code ${app.exitCode})`);
        return line;
      });
    } finally {
      await stop(app);
    }
  };
  try {
    const unchanged = await start("entry already set");
    if (unchanged !== "Autostart entry unchanged (set)") failures.push(`next start: "${unchanged}" instead of leaving the entry alone`);
    const record = readJson(path.join(APPDATA, PROFILE_FOLDER, "autostart.json"));
    if (record.written?.toLowerCase() !== expectedEntry.toLowerCase() || record.legacyRemoved !== true) {
      failures.push(`autostart.json is ${JSON.stringify(record)}, expected the entry written and the old one removed`);
    }
    await removeRunEntry(packageJson.productName);
    const rewritten = await start("entry deleted");
    if (rewritten !== "Autostart entry set") failures.push(`after deleting the entry: "${rewritten}" instead of writing it again`);
    const { value } = await readRunEntry(packageJson.productName);
    if (value?.trim().toLowerCase() !== expectedEntry.toLowerCase()) {
      failures.push(`after deleting the entry, it is ${value ? `'${value}'` : "still missing"}`);
    }
  } catch (error) {
    failures.push(error.message);
  }
  return failures;
}

async function checkInstallReplacingOriginal() {
  const installer = findInstaller();
  const profile = path.join(APPDATA, PROFILE_FOLDER);
  for (const existing of [path.join(APPDATA, "Altus"), profile]) {
    if (fs.existsSync(existing)) throw new Error(`${existing} already exists; this check needs a clean runner`);
  }
  const seeded = seedOriginalAltus(ORIGINAL_TABS);
  runSetup(installer, install.dir);

  const failures = [];
  install.exe = findInstalledExe(install.dir);
  if (!install.exe) failures.push(`no ${packageJson.productName}.exe under ${install.dir}`);
  for (const [file, data] of Object.entries(seeded)) {
    const copied = path.join(profile, file);
    if (!fs.existsSync(copied)) failures.push(`${file} was not copied into the Altus + profile`);
    else if (!sameJson(readJson(copied), data)) failures.push(`${file} differs from the original`);
  }
  const marker = path.join(profile, "Partitions", ORIGINAL_TABS[0].id.toLowerCase(), "smoke-marker");
  if (!fs.existsSync(marker)) failures.push("the original's Partitions were not copied");
  if (fs.existsSync(path.join(APPDATA, "Altus"))) failures.push("%APPDATA%\\Altus was not renamed");
  const found = backups();
  if (found.length !== 1) failures.push(`expected one "Altus (backup <date>)" folder, found ${found.length}`);
  else if (!fs.existsSync(path.join(APPDATA, found[0], "tabs.json"))) failures.push(`${found[0]} has no tabs.json`);
  if (failures.length || !install.exe) return { failures, notes: [] };

  // An entry left by the "Altus Electron 44 Test" builds, which the app
  // removes on start (named after that build's exe).
  const legacyName = PROFILE_FOLDER;
  await writeRunEntry(legacyName, `"C:\\Program Files\\${legacyName}\\${legacyName}.exe"`);

  const result = await checkRunningApp("installed-app", install.exe, [], {
    label: ADD_TAB_LABEL.it,
    otherLabel: ADD_TAB_LABEL.en,
    tabNames: ORIGINAL_TABS.map((tab) => tab.name),
    tabIds: ORIGINAL_TABS.map((tab) => tab.id),
    tabCount: ORIGINAL_TABS.length,
    windowShown: true,
  }, 9412);
  result.notes.unshift(`installed to ${path.dirname(install.exe)}, backup ${found[0]}`);

  // The migrated settings turn autostart on: the entry must start the
  // installed exe with the flag "Start in tray with Windows" relies on.
  const { value: entry, error } = await readRunEntry(packageJson.productName);
  const expectedEntry = installedAutostartEntry();
  const legacy = await readRunEntry(legacyName);
  if (legacy.value) result.failures.push(`the "${legacyName}" autostart entry was not removed`);
  if (entry?.trim().toLowerCase() !== expectedEntry.toLowerCase()) {
    result.failures.push(`autostart entry is ${entry ? `'${entry}'` : `missing (${error})`}, expected '${expectedEntry}'`);
    const autostartLog = (result.output ?? "").split(/\r?\n/).filter((line) => /autostart|auto-launch|winreg|reg\.exe/i.test(line));
    result.failures.push(autostartLog.length
      ? `app log: ${autostartLog.slice(0, 3).map((line) => line.trim()).join(" | ")}`
      : "app log: no autostart line (the update never finished)");
    saveArtifact("installed-app.log", result.output ?? "");
  }
  if (!result.failures.length) result.failures.push(...(await checkAutostartOnRestarts(expectedEntry)));
  result.failures.push(...(await checkProgramsEntry()));
  result.failures.push(...(await checkLinkRegistration()));
  return result;
}

async function checkReinstall() {
  const profile = path.join(APPDATA, PROFILE_FOLDER);
  if (!fs.existsSync(path.join(profile, "tabs.json"))) {
    return { failures: ["no Altus + profile to compare: the migration in check 7 did not create it"], notes: [] };
  }
  const before = Object.fromEntries(["settings.json", "tabs.json"].map((file) => [file, readJson(path.join(profile, file))]));
  // Original data shows up again: a reinstall must still leave it alone.
  const otherTabs = [{ ...ORIGINAL_TABS[0], id: "smokeAltroTab00000003", name: "Altro" }];
  seedOriginalAltus(otherTabs);
  runSetup(findInstaller(), install.dir);

  const failures = [];
  for (const [file, data] of Object.entries(before)) {
    if (!sameJson(readJson(path.join(profile, file)), data)) failures.push(`${file} in the Altus + profile changed`);
  }
  if (!fs.existsSync(path.join(APPDATA, "Altus", "tabs.json"))) failures.push("%APPDATA%\\Altus was moved or changed");
  if (backups().length !== 1) failures.push(`a reinstall created another backup (${backups().length} now)`);
  failures.push(...(await checkProgramsEntry()));
  const command = await readProtocolCommand();
  if (!isInstalledLinkCommand(command)) failures.push(`after reinstalling, the whatsapp:// registration is ${command ?? "gone"}`);
  const { value: entry } = await readRunEntry(packageJson.productName);
  if (entry?.trim().toLowerCase() !== installedAutostartEntry().toLowerCase()) {
    failures.push(`after reinstalling, the autostart entry is ${entry ? `'${entry}'` : "gone"}`);
  }
  return { failures, notes: [] };
}

async function checkUninstall() {
  const programDir = path.dirname(install.exe);
  const uninstaller = fs.readdirSync(programDir).find((file) => /^Uninstall .*\.exe$/.test(file));
  if (!uninstaller) return { failures: [`no uninstaller in ${programDir}`], notes: [] };
  const profile = path.join(APPDATA, PROFILE_FOLDER);
  const profileExisted = fs.existsSync(path.join(profile, "tabs.json"));
  // Check 7 leaves autostart on.
  const entryBefore = (await readRunEntry(packageJson.productName)).value;
  // Without _?= the uninstaller copies itself to %TEMP% and returns at once.
  spawnSync(path.join(programDir, uninstaller), ["/currentuser", "/S"], { timeout: 120_000 });
  const failures = [];
  try {
    await waitFor("the program files to be removed", 120_000, () => !fs.existsSync(install.exe));
  } catch (error) {
    failures.push(error.message);
  }
  if (!profileExisted) failures.push("no Altus + profile to check: the migration in check 7 did not create it");
  else if (!fs.existsSync(path.join(profile, "tabs.json"))) failures.push("the uninstaller removed the Altus + profile");
  const command = await readProtocolCommand();
  if (command) failures.push(`the whatsapp:// registration outlived the uninstall: ${command}`);
  if (!entryBefore) failures.push("no autostart entry to check before uninstalling: check 7 should leave it on");
  const entryAfter = (await readRunEntry(packageJson.productName)).value;
  if (entryAfter) failures.push(`the autostart entry outlived the uninstall: ${entryAfter}`);
  return { failures, notes: [] };
}

/** HKCU's key of the original Altus (electron-builder's GUID of its appId). */
function originalAltusKey() {
  const guid = read("makers/nsis/replaceAltus.nsh").match(/!define ORIGINAL_ALTUS_GUID "([^"]+)"/)[1];
  const Winreg = createRequire(import.meta.url)(path.join(root, "node_modules", "winreg"));
  return { Winreg, key: new Winreg({ hive: Winreg.HKCU, key: `\\Software\\${guid}` }) };
}

/**
 * An install for all users runs with administrator rights, so it must not
 * run an "Uninstall Altus.exe" from a folder HKCU names: any program the user
 * runs can write HKCU. HKCU names a folder with a stand-in uninstaller (a
 * copy of whoami) and a stand-in Altus, running (a copy of ping). The data
 * still moves to Altus +, the running Altus is closed and its autostart
 * entry removed; the stand-in uninstaller is neither run nor deleted (it
 * used to be run, then deleted).
 */
async function checkAllUsersInstall() {
  const failures = [];
  const profile = path.join(APPDATA, PROFILE_FOLDER);
  // A first install again: the Altus + profile of checks 7-9 set aside.
  if (fs.existsSync(profile)) fs.renameSync(profile, `${profile} (checks 7-9)`);
  const seeded = seedOriginalAltus(ORIGINAL_TABS);
  const userInstall = fs.mkdtempSync(path.join(TEMP, "as-user-altus-"));
  const system32 = path.join(process.env.SystemRoot, "System32");
  const uninstaller = path.join(userInstall, "Uninstall Altus.exe");
  fs.copyFileSync(path.join(system32, "whoami.exe"), uninstaller);
  const originalExe = path.join(userInstall, "Altus.exe");
  fs.copyFileSync(path.join(system32, "PING.EXE"), originalExe);
  const { Winreg, key } = originalAltusKey();
  await new Promise((resolve, reject) =>
    key.set("InstallLocation", Winreg.REG_SZ, userInstall, (error) => (error ? reject(error) : resolve())));
  await writeRunEntry("Altus", `"${originalExe}" --hidden`);
  const running = launch(originalExe, ["-n", "600", "127.0.0.1"]);
  const installDir = path.join(TEMP, "as-install-all");
  try {
    const result = spawnSync(findInstaller(), ["/S", "/allusers", "--replace-altus", `/D=${installDir}`], { timeout: 300_000 });
    if (result.status !== 0) throw new Error(`the installer exited with ${result.status ?? result.error}`);
    if (!fs.existsSync(uninstaller)) {
      failures.push(`the install for all users ran the "Uninstall Altus.exe" of the folder HKCU names (it is gone)`);
    }
    const copied = path.join(profile, "tabs.json");
    if (!fs.existsSync(copied) || !sameJson(readJson(copied), seeded["tabs.json"])) {
      failures.push("the original's tabs did not move into the Altus + profile");
    }
    if (fs.existsSync(path.join(APPDATA, "Altus"))) failures.push("%APPDATA%\\Altus was not renamed");
    await waitFor("the running Altus to be closed", 5_000, () => running.exited)
      .catch(() => failures.push("the installer did not close the running Altus"));
    const { value: entry } = await readRunEntry("Altus");
    if (entry) failures.push(`the original's autostart entry was kept: ${entry}`);

    const exe = fs.existsSync(installDir) ? findInstalledExe(installDir) : null;
    if (!exe) {
      failures.push(`no ${packageJson.productName}.exe under ${installDir}`);
    } else {
      const programDir = path.dirname(exe);
      const own = fs.readdirSync(programDir).find((file) => /^Uninstall .*\.exe$/.test(file));
      // Without _?= the uninstaller copies itself to %TEMP% and returns at once.
      if (own) spawnSync(path.join(programDir, own), ["/allusers", "/S"], { timeout: 120_000 });
      await waitFor("the program for all users to be removed", 120_000, () => !fs.existsSync(exe))
        .catch((error) => failures.push(error.message));
    }
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (!running.exited) spawnSync("taskkill", ["/PID", String(running.child.pid), "/F"], { stdio: "ignore" });
    await new Promise((resolve) => key.destroy(() => resolve()));
    await removeRunEntry("Altus").catch(() => {});
  }
  return { failures, notes: [] };
}

function findInstaller() {
  const name = `Altus-Plus-Setup-${packageJson.version}.exe`;
  const found = fs.readdirSync(path.join(root, "out", "make"), { recursive: true })
    .find((file) => path.basename(String(file)) === name);
  if (!found) throw new Error(`${name} not found under out/make; run yarn make -p win32 first`);
  return path.join(root, "out", "make", String(found));
}

// --- main ------------------------------------------------------------------

const checks = [
  ["1. Fuses; app.asar has the bundles, page, icons and translations", checkFuses],
  ["2. Modified app.asar is refused", checkTamperedAsar],
  ["3. Fresh profile: window, tab, WhatsApp Web, no errors, redirect off WhatsApp cancelled; started by a whatsapp:// link, on screen though remembered off it", checkFreshProfile],
  ["4. Start in tray with Windows: hidden but connected; opens when started by hand; a lost tab list deletes no account; unreadable saved files are set aside and the accounts come back, a Telegram one as Telegram", checkStartInTray],
  ["5. Three accounts: background sound and notifications, muted account, permissions follow the tab's switches, counts and clicks tied to their tab, invalid tab and theme lists refused, moving tabs, Resource Usage, link asks for the account; a Telegram account next to a WhatsApp one", checkBackgroundTabs],
  ["6. Resource test: title bar kept until restart, window listeners, menu without focus, restart into it, record three accounts, download during the test, summary, normal restart", checkResourceTest],
];
if (runInstaller) {
  checks.push(
    ["7. Installer replaces the original Altus; app opens its tabs and settings; autostart written only when needed and follows its setting at once; whatsapp:// links registered while on", checkInstallReplacingOriginal],
    ["8. Reinstall leaves the profile, the original data, the link registration and autostart alone", checkReinstall],
    ["9. Uninstall removes the program, its link registration and its autostart entry, keeps the profile", checkUninstall],
    ["10. Install for all users runs no uninstaller HKCU names; data moved, running Altus closed, its autostart removed", checkAllUsersInstall],
  );
}

if (process.platform !== "win32") throw new Error("the smoke test needs Windows");
if (!fs.existsSync(PACKAGED_EXE)) throw new Error(`${PACKAGED_EXE} not found; run yarn package -p win32 first`);
if (runInstaller && !(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted")) {
  throw new Error("--installer installs Altus + and writes %APPDATA%: it only runs on a GitHub-hosted runner");
}
fs.rmSync(ARTIFACTS, { recursive: true, force: true });

const results = [];
let blocked = false;
for (const [name, check] of checks) {
  if (blocked) {
    results.push({ name, failures: [], notes: ["skipped: Altus + was not installed"], skipped: true });
    continue;
  }
  const started = Date.now();
  let result;
  try {
    result = await check();
  } catch (error) {
    result = { failures: [error.message], notes: [] };
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ name, ...result, seconds });
  console.log(`${result.failures.length ? "FAIL" : "ok  "} ${name} (${seconds}s)`);
  for (const line of result.failures) console.log(`       - ${line}`);
  for (const line of result.notes) console.log(`       ${line}`);
  // Checks 8-10 need the installed app (10, its uninstall in check 9).
  if (name.startsWith("7.") && !install.exe) blocked = true;
}

const failed = results.filter((result) => result.failures.length);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((result) => {
    const status = result.skipped ? "⏭️" : result.failures.length ? "❌" : "✅";
    const detail = [...result.failures, ...result.notes].join("<br>").replaceAll("|", "\\|");
    return `| ${status} | ${result.name} | ${result.skipped ? "-" : `${result.seconds}s`} | ${detail} |`;
  });
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `## Smoke test: ${failed.length ? `${failed.length} check(s) failed` : "all checks passed"}`,
    "",
    "| | Check | Time | Details |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"));
}
process.exitCode = failed.length ? 1 : 0;
