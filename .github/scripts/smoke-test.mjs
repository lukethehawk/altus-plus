// Smoke test of the packaged Windows app, run by CI after `yarn make`.
//
//   node .github/scripts/smoke-test.mjs              checks 1-6 (`yarn smoke`)
//   node .github/scripts/smoke-test.mjs --installer  checks 1-9
//
// 1. fuses baked into the executable;
// 2. a modified app.asar is refused at startup;
// 3. a fresh profile (--user-data-dir) opens the window and a WhatsApp Web tab,
//    with no errors in the app window;
// 4. "Start in tray with Windows": started with the autostart flag the window
//    stays hidden while the tab still loads; started by hand it opens;
// 5. tabs in the background, also with the whole app in the tray, keep
//    playing sound (also after switching tab) and show notifications labelled
//    with their account, and a muted account's notification is suppressed.
//    Tabs move by dragging only once "Allow Moving Tabs" is on, and
//    Help → Resource Usage lists every account and recognises every process.
//    It plays a near-silent tone and shows a silent notification for a moment;
// 6. Help → Run Resource Test restarts the app into the test, which records
//    the three accounts into a CSV file; Help → End Resource Test writes the
//    summary and restarts the app normally (it also opens Explorer there);
// 7. the installer replaces a fake original Altus (/S --replace-altus), the
//    installed app opens its tabs and settings and registers autostart;
// 8. reinstalling never migrates again or touches the Altus + profile;
// 9. uninstalling removes the program and keeps the profile.
//
// Checks 7-9 install Altus +, write %APPDATA% and uninstall, so they only run
// on a GitHub-hosted runner, which is discarded afterwards. The app is
// observed through Chromium's DevTools protocol (--remote-debugging-port) and
// stopped by PID. Failures leave logs and screenshots in smoke-artifacts/.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
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

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- check 3/4: the running app --------------------------------------------

/**
 * Starts the app, reloads its window with DevTools attached and checks the
 * window, its tabs and every tab's WhatsApp Web page. Returns failure messages.
 * expected: { label, otherLabel, tabNames, tabIds? (exact, in any order), tabCount,
 *   windowShown, afterLoad?({ cdp, port, failures, notes }) }
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
      if (!/^https:\/\/web\.whatsapp\.com(\/|$)/.test(webview.src ?? "")) failures.push(`tab ${id} loads ${webview.src}`);
    }
    if (expected.tabIds && !sameJson([...tabIds].sort(), [...expected.tabIds].sort())) {
      failures.push(`tab IDs ${tabIds.join(", ")} instead of ${expected.tabIds.join(", ")}`);
    }
    const loadFailures = failures.length;

    // Each tab reaches WhatsApp Web and its preload reports the tab's ID.
    for (const id of tabIds) {
      const loaded = async () => {
        for (const target of await targets(port)) {
          if (target.type !== "webview" || !target.url.startsWith("https://web.whatsapp.com/")) continue;
          const webview = await Cdp.connect(target.webSocketDebuggerUrl);
          try {
            const value = await webview.evaluate(`({ tabId: document.body?.dataset.tabId ?? null, title: document.title })`);
            if (value.tabId === id && value.title.includes("WhatsApp")) return value;
          } finally {
            webview.close();
          }
        }
        return null;
      };
      try {
        await waitFor(`WhatsApp Web in tab ${id}`, 90_000, loaded);
      } catch {
        notes.push(`tab ${id}: WhatsApp Web did not load in 90s, reloaded it once`);
        await cdp.evaluate(`document.getElementById(${JSON.stringify(`webview-${id}`)}).reload()`);
        try {
          await waitFor(`WhatsApp Web in tab ${id}`, 60_000, loaded);
        } catch (error) {
          failures.push(error.message);
        }
      }
    }

    // Further checks on the loaded tabs, unless they did not all load.
    if (expected.afterLoad && failures.length === loadFailures) {
      await expected.afterLoad({ cdp, port, failures, notes });
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
      const appErrors = [...new Set(app.output.split(/\r?\n/).filter((line) => /Failed to load|ERR_|FATAL|Error:/.test(line)))];
      failures.push(...appErrors.slice(0, 3).map((line) => `app log: ${line.trim()}`));
    }
  }
  return { failures, notes, output: app.output };
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
  return { failures, notes: [] };
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
  }, 9411);
  if (!fs.existsSync(path.join(profile, "tabs.json"))) result.failures.push("the app did not save its tabs in --user-data-dir");
  if (!realProfileExisted && fs.existsSync(realProfile)) {
    result.failures.push(`--user-data-dir was ignored: ${realProfile} was created`);
  }
  removeTemp(profile);
  return result;
}

async function checkStartInTray() {
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ launchToTray: { value: true } }));
  const expected = { label: ADD_TAB_LABEL.en, otherLabel: ADD_TAB_LABEL.it, tabNames: ["New Tab"], tabCount: 1 };
  // What the autostart entry runs (auto-launch isHidden adds --hidden).
  const atLogin = await checkRunningApp("start-in-tray", PACKAGED_EXE, [`--user-data-dir=${profile}`, "--hidden"], {
    ...expected,
    windowShown: false,
  }, 9413);
  const byHand = await checkRunningApp("start-in-tray-manual", PACKAGED_EXE, [`--user-data-dir=${profile}`], {
    ...expected,
    windowShown: true,
  }, 9414);
  removeTemp(profile);
  return {
    failures: [
      ...atLogin.failures.map((line) => `with Windows: ${line}`),
      ...byHand.failures.map((line) => `by hand: ${line}`),
    ],
    notes: [...atLogin.notes, ...byHand.notes],
  };
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

/** DevTools connection to the WhatsApp page of a tab; the caller closes it. */
async function connectToTab(port, id) {
  for (const target of await targets(port)) {
    if (target.type !== "webview" || !target.url.startsWith("https://web.whatsapp.com/")) continue;
    const page = await Cdp.connect(target.webSocketDebuggerUrl);
    const tabId = await page.evaluate("document.body?.dataset.tabId ?? null").catch(() => null);
    if (tabId === id) return page;
    page.close();
  }
  throw new Error(`no WhatsApp page for tab ${id}`);
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

        await checkMovingTabs(cdp, profile, failures);
        await checkResourcePanel(cdp, failures, notes);
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
  return {
    failures: [
      ...shown.failures.map((line) => `window shown: ${line}`),
      ...inTray.failures.map((line) => `in the tray: ${line}`),
    ],
    notes: [...shown.notes, ...inTray.notes],
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

async function checkResourceTest() {
  const failures = [];
  const notes = [];
  const port = 9417;
  const profile = fs.mkdtempSync(path.join(TEMP, "as-p-"));
  const folder = path.join(profile, "resource-tests");
  fs.writeFileSync(path.join(profile, "tabs.json"), JSON.stringify({
    tabs: BACKGROUND_TABS, previouslyClosedTab: null, selectedTabId: ALFA.id,
  }));
  const first = launch(PACKAGED_EXE, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`]);
  let cdp;
  try {
    // Help → Run Resource Test… → Restart and Measure.
    cdp = await attachWhen(port, "Help → Run Resource Test", 90_000, async (page) => (await menuIds(page)).includes("resource-test"));
    await cdp.evaluate('window.clickMenuItem("resource-test")');
    await waitFor("the Resource Test dialog", 10_000, () => cdp.evaluate('!!document.querySelector("[data-resource-test-start]")'));
    await cdp.evaluate('document.querySelector("[data-resource-test-start]").click()').catch(() => undefined);
    cdp.close();
    cdp = undefined;
    await waitFor("the app to restart into the test", 30_000, () => first.exited);

    cdp = await attachWhen(port, "the app restarted in the resource test", 90_000, async (page) => (await menuIds(page)).includes("end-resource-test"));
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
      // Startup moments, in order (Node.js's start only when counting from the process's creation).
      const at = (event) => csv.text.match(new RegExp(`^([\\d.]+),[^,]+,event,${event}\\r?$`, "m"))?.[1];
      const startup = ["Node.js started", "main script started", "Electron ready", "window created"].map((event) => [event, at(event)]);
      const found = startup.filter(([, seconds]) => seconds !== undefined);
      for (const [event, seconds] of startup.slice(1)) if (seconds === undefined) failures.push(`the test file has no "${event}"`);
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
  const expectedEntry = `"${install.exe}" --hidden`;
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
  return { failures, notes: [] };
}

async function checkUninstall() {
  const programDir = path.dirname(install.exe);
  const uninstaller = fs.readdirSync(programDir).find((file) => /^Uninstall .*\.exe$/.test(file));
  if (!uninstaller) return { failures: [`no uninstaller in ${programDir}`], notes: [] };
  const profile = path.join(APPDATA, PROFILE_FOLDER);
  const profileExisted = fs.existsSync(path.join(profile, "tabs.json"));
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
  ["1. Fuses", checkFuses],
  ["2. Modified app.asar is refused", checkTamperedAsar],
  ["3. Fresh profile: window, tab, WhatsApp Web, no errors", checkFreshProfile],
  ["4. Start in tray with Windows: hidden but connected; opens when started by hand", checkStartInTray],
  ["5. Three accounts: background sound and notifications, muted account, moving tabs, Resource Usage", checkBackgroundTabs],
  ["6. Resource test: restart into it, record three accounts, summary, normal restart", checkResourceTest],
];
if (runInstaller) {
  checks.push(
    ["7. Installer replaces the original Altus; app opens its tabs and settings", checkInstallReplacingOriginal],
    ["8. Reinstall leaves the profile and the original data alone", checkReinstall],
    ["9. Uninstall removes the program and keeps the profile", checkUninstall],
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
  // Checks 8 and 9 need the installed app.
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
