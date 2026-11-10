// First, so that it records when the app's own code started.
import { cpuTimeMs, mainScriptCpuMs, mainScriptStartedAt } from "./startTime";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MenuItem,
  nativeImage,
  session,
  shell,
  Tray,
  webContents,
} from "electron";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { electronTabStore } from "./stores/tabs/electron";
import { Tab, TabStore } from "./stores/tabs/common";
import { electronThemeStore } from "./stores/themes/electron";
import { ThemeStore } from "./stores/themes/common";
import { electronSettingsStore } from "./stores/settings/electron";
import {
  fallbackLanguage,
  isSupportedLanguage,
  languageNames,
  languages,
  type Language,
} from "./i18n/langauges.config";
import os from "os";
import Store from "electron-store";
import { electronI18N } from "./i18n/electron";
import { contextMenuLabelKeys } from "./i18n/contextMenuLabels";
import {
  DefaultSettingValues,
  SettingKey,
  Settings,
} from "./stores/settings/common";
import AutoLaunch from "auto-launch";
import electronDl from "electron-dl";
import contextMenu from "electron-context-menu";
import {
  APP_ID,
  APP_NAME,
  LEGACY_TEST_BUILD_NAME,
  hasExplicitProfileDirectory,
} from "./utils/isolation";
import { getPartitionsToPrune } from "./utils/partitions";
import { recoverRendererOnFailure } from "./utils/rendererRecovery";
import { REPOSITORY_URL } from "./utils/updates";
import {
  AUTOSTART_FLAG,
  autostartChange,
  autostartCommand,
  autostartEntryName,
  autostartPathFor,
  getStartupWindowMode,
} from "./utils/startup";
import { attachEnterKeys } from "./utils/keyboard";
import { isMuteActive } from "./utils/notifications";
import { formatTrayTooltip } from "./utils/tray";
import { groupProcessUsage } from "./utils/resources";
import {
  RESOURCE_TEST_FLAG,
  RESOURCE_TEST_FOLDER,
  fill,
  formatSummary,
  localTime,
  relaunchArgs,
  type StartupMark,
  type StartupTimes,
} from "./utils/resourceTest";
import { ResourceTestRecorder } from "./resourceTest";
import {
  checkForUpdates,
  installDownloadedUpdate,
  isQuittingForUpdate,
  setupAutoUpdater,
} from "./updater";
import { isAltusPartition, isTrustedWhatsAppURL, getSafeExternalHttpURL } from "./utils/security";
import {
  PROTOCOL_ARGS,
  WHATSAPP_PROTOCOL,
  findWhatsAppLink,
  whatsAppWebAddress,
} from "./utils/whatsappLinks";
import { SettingsSchema } from "./stores/settings/common";

const windowState = new Store<{
  width: number | null;
  height: number | null;
  x: number | null;
  y: number | null;
}>({
  name: "windowState",
  defaults: {
    width: null,
    height: null,
    x: null,
    y: null,
  },
});

function getSettingWithDefault<Key extends SettingKey>(
  setting: Key
): Settings[Key]["value"] {
  const defaultValue = DefaultSettingValues[setting];
  try {
    const value = electronSettingsStore.get(setting).value;
    return value ?? defaultValue;
  } catch (error) {
    console.error(error);
    return defaultValue;
  }
}

let tray: Tray | undefined;
let trayTooltip = "";

// Unread chats per account, as counted in each WhatsApp page title.
const unreadByTab = new Map<string, number>();

/** Hovering the tray icon shows the unread chats of every account. */
function updateTrayTooltip(tabs?: Tab[]) {
  if (!tray || tray.isDestroyed()) return;
  // Only a label: it must never break the unread badge or saving the tabs.
  try {
    const now = Date.now();
    const text = formatTrayTooltip(
      APP_NAME,
      (tabs ?? electronTabStore.get("tabs")).map((tab) => ({
        name: typeof tab.name === "string" ? tab.name : "",
        unread: unreadByTab.get(tab.id) ?? 0,
        muted: isMuteActive(tab.config?.notificationsMutedUntil, now),
      })),
      electronI18N.t("trayMuted")
    );
    if (text === trayTooltip) return;
    trayTooltip = text;
    tray.setToolTip(text);
  } catch (error) {
    console.warn("Could not update the tray tooltip", error);
  }
}

// Help → Run Resource Test restarts the app with this flag; the test lasts
// until Help → End Resource Test or quitting, never past this process.
const resourceTestMode = process.argv.includes(RESOURCE_TEST_FLAG);
let resourceTest: ResourceTestRecorder | undefined;
const startupCpuMs: Partial<Record<StartupMark, number>> = { script: mainScriptCpuMs };
// The resource test's startup times; the steps of the "ready" handler are
// filled in as they finish.
const startupTimes: StartupTimes = {
  nodeStartedAt: Date.now() - process.uptime() * 1000,
  mainScriptStartedAt,
  cpuMs: startupCpuMs,
};
const MB = 1024 * 1024;

/** Now (ms since the epoch), noting the main process's CPU time at this startup moment. */
function startupMoment(mark: StartupMark): number {
  startupCpuMs[mark] = cpuTimeMs();
  return Date.now();
}

/** Restarts Altus + with the same arguments, in or out of the resource test. */
function relaunch(inResourceTest: boolean) {
  app.relaunch({ args: relaunchArgs(process.argv.slice(1), inResourceTest) });
  if (tray) tray.destroy();
  app.exit(0);
}

function startResourceTest(mainWindow: BrowserWindow) {
  const cpus = String(os.cpus().length);
  const ram = String(Math.round(os.totalmem() / 1024 ** 3));
  const recorder: ResourceTestRecorder = new ResourceTestRecorder({
    directory: path.join(app.getPath("userData"), RESOURCE_TEST_FOLDER),
    startup: startupTimes,
    sample: () => sampleResourceUsage(mainWindow),
    mainMemory: () => {
      const memory = process.memoryUsage();
      return { jsHeapUsedMB: memory.heapUsed / MB, jsHeapTotalMB: memory.heapTotal / MB, jsExternalMB: memory.external / MB };
    },
    description: `test started: ${APP_NAME} ${app.getVersion()}, Electron ${process.versions.electron}, ${cpus} logical CPUs, ${ram} GB RAM, ${os.type()} ${os.release()}`,
    summarize: (summary, info) =>
      formatSummary(
        summary,
        {
          title: `${APP_NAME} ${app.getVersion()}`,
          started: localTime(new Date(recorder.startedAt)),
          computer: fill(electronI18N.t("resourceTestSummaryComputer"), { cpus, ram }),
          ...info,
        },
        (key) => electronI18N.t(key),
        electronI18N.getLanguage()
      ),
  });
  try {
    recorder.start();
  } catch (error) {
    console.error("Could not start the resource test", error);
    return;
  }
  resourceTest = recorder;
  // The title says a test is running, whatever the page sets.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());
  if (mainWindow.isVisible()) recorder.windowShown();
  else mainWindow.once("show", () => recorder.windowShown());
}

/** Help → End Resource Test: shows the results and restarts normally. */
function endResourceTest() {
  if (resourceTest) {
    const files = resourceTest.finish();
    shell.showItemInFolder(fs.existsSync(files.summary) ? files.summary : files.samples);
  }
  relaunch(false);
}

/** CPU and memory of each account and of the app's own processes, now. */
function sampleResourceUsage(mainWindow: BrowserWindow) {
  const tabs = electronTabStore.get("tabs");
  const pidByTab = new Map<string, number>();
  // Chromium's own process IDs, which service workers are reported with.
  const pageProcessIds = new Set<number>();
  // System PIDs of every renderer showing a page or a frame of one.
  const pagePids = new Set<number>();
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    pageProcessIds.add(contents.getProcessId());
    pagePids.add(contents.getOSProcessId());
    try {
      for (const frame of contents.mainFrame.framesInSubtree) pagePids.add(frame.osProcessId);
    } catch {
      // The page is navigating or closing; its main renderer is counted above.
    }
    if (contents.getType() !== "webview") continue;
    const tab = tabs.find((tab) => contents.session === session.fromPartition(`persist:${tab.id}`));
    if (tab) pidByTab.set(tab.id, contents.getOSProcessId());
  }
  const workerProcessIds = new Set<number>();
  for (const tab of tabs) {
    const running = session.fromPartition(`persist:${tab.id}`).serviceWorkers.getAllRunning();
    for (const worker of Object.values(running)) {
      if (!pageProcessIds.has(worker.renderProcessId)) workerProcessIds.add(worker.renderProcessId);
    }
  }
  const processes = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    serviceName: metric.serviceName,
    cpuPercent: metric.cpu.percentCPUUsage,
    privateKB: metric.memory.privateBytes,
    workingSetKB: metric.memory.workingSetSize,
  }));
  return groupProcessUsage(
    processes,
    {
      accounts: tabs.map((tab) => ({ tabId: tab.id, name: tab.name, pid: pidByTab.get(tab.id) })),
      windowPid: mainWindow.isDestroyed() ? undefined : mainWindow.webContents.getOSProcessId(),
      pagePids: [...pagePids],
      workerProcesses: workerProcessIds.size,
    }
  );
}

/** What updateAutostart last did, in autostart.json in the profile. */
type AutostartRecord = {
  /** The command it wrote for the entry (autostartCommand), or null. */
  written: string | null;
  /** The old test builds' entry is gone, or was never there. */
  legacyRemoved: boolean;
};

/**
 * Writes or removes the autostart entry when it differs from the setting.
 * Checking goes through Electron, which reads the registry itself; reg.exe
 * (through auto-launch) only runs when something has to change, since
 * starting it blocks the app until Windows has launched it.
 */
function updateAutostart() {
  const wanted = getSettingWithDefault("autoLaunch");
  const execPath = process.execPath;
  const command = autostartCommand(execPath);
  let record: Store<AutostartRecord> | undefined;
  // Unsure: write or remove the entry, as every start used to.
  let change: "enable" | "disable" | "none" = wanted ? "enable" : "disable";
  let legacyRemoved = false;
  try {
    // What this installation last wrote, which Electron's list cannot show.
    record = new Store<AutostartRecord>({ name: "autostart", defaults: { written: null, legacyRemoved: false } });
    const { written } = record.store;
    legacyRemoved = record.store.legacyRemoved;
    change = autostartChange({
      wanted,
      entries: app.getLoginItemSettings({ path: execPath }).launchItems,
      name: autostartEntryName(execPath),
      written,
      command,
    });
  } catch (error) {
    console.warn("Could not check the autostart entry", error);
  }
  const remember = (values: Partial<AutostartRecord>) => {
    try {
      record?.set(values);
    } catch (error) {
      console.warn("Could not save the autostart state", error);
    }
  };

  if (change === "none") {
    console.info(`Autostart entry unchanged (${wanted ? "set" : "absent"})`);
  } else {
    // isHidden adds AUTOSTART_FLAG, so the app knows it started with Windows.
    const autoLauncher = new AutoLaunch({ name: APP_NAME, isHidden: true });
    (change === "enable" ? autoLauncher.enable() : autoLauncher.disable())
      .then(() => {
        remember({ written: change === "enable" ? command : null });
        console.info(`Autostart entry ${change === "enable" ? "set" : "removed"}`);
      })
      .catch((error) => console.warn("Autostart update failed", error));
  }

  // The test builds registered autostart under their own name; drop that
  // entry once so the old executable is not launched next to this one.
  // Without the path, auto-launch would remove this app's entry ("Altus +")
  // instead. It may point anywhere, so only reg.exe can remove it.
  if (legacyRemoved) return;
  new AutoLaunch({
    name: LEGACY_TEST_BUILD_NAME,
    path: autostartPathFor(LEGACY_TEST_BUILD_NAME, execPath),
  })
    .disable()
    .then(
      () => console.info("Autostart entry of the old test builds cleared"),
      // Also when there was none: reg.exe reports that in the system's language.
      () => undefined
    )
    .then(() => remember({ legacyRemoved: true }));
}

// Recently completed downloads by id: the UI asks to reveal an id, so a file
// path never travels back from the renderer to the main process.
const completedDownloads = new Map<number, string>();
const MAX_TRACKED_DOWNLOADS = 20;
let nextDownloadId = 1;

const iconsPath = path.join(__dirname, "assets", "icons");

const mainIcon = nativeImage.createFromPath(
  path.join(iconsPath, process.platform === "win32" ? "icon.ico" : "icon.png")
);

const mainNotificationIcon = nativeImage.createFromPath(
  path.join(iconsPath, "icon-notification.png")
);

const trayIcon = nativeImage.createFromPath(
  path.join(iconsPath, process.platform === "win32" ? "icon.ico" : "tray.png")
);

const trayNotificationIcon = nativeImage.createFromPath(
  path.join(iconsPath, "tray-notification.png")
);

function confirmAndExit() {
  dialog
    .showMessageBox({
      type: "question",
      buttons: [electronI18N.t("Exit"), electronI18N.t("Cancel")],
      title: electronI18N.t("Exit"),
      message: electronI18N.t("Are you sure you want to exit?"),
    })
    .then(({ response }) => {
      if (response !== 0) {
        return;
      }
      if (tray) tray.destroy();
      exitApp();
    });
}

function quitApp() {
  const shouldPrompt = getSettingWithDefault("exitPrompt");
  if (shouldPrompt) confirmAndExit();
  else exitApp();
}

// app.exit() skips the quit event the updater installs on, so a downloaded
// update is installed here explicitly (silently, without relaunching).
function exitApp() {
  resourceTest?.finish();
  if (!installDownloadedUpdate({ relaunch: false })) app.exit(0);
}

function createWindow() {
  const useCustomTitlebar =
    process.platform !== "darwin" && getSettingWithDefault("customTitlebar");
  const rememberWindowSize = getSettingWithDefault("rememberWindowSize");
  const rememberWindowPosition = getSettingWithDefault(
    "rememberWindowPosition"
  );

  const mainWindow = new BrowserWindow({
    minWidth: 520,
    minHeight: 395,
    width: rememberWindowSize ? windowState.get("width") || 800 : undefined,
    height: rememberWindowSize ? windowState.get("height") || 600 : undefined,
    x: rememberWindowPosition ? windowState.get("x") ?? undefined : undefined,
    y: rememberWindowPosition ? windowState.get("y") ?? undefined : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      webviewTag: true,
    },
    title: `${APP_NAME} ${app.getVersion()}`,
    show: false,
    frame: !useCustomTitlebar,
    titleBarStyle: useCustomTitlebar ? "hidden" : "default",
    icon: mainIcon,
  });

  // Every <webview> must be a WhatsApp Web tab in its own persistent
  // partition, running our preload without Node access, whatever the
  // renderer asked for.
  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      if (
        !isTrustedWhatsAppURL(params.src) ||
        !isAltusPartition(params.partition)
      ) {
        event.preventDefault();
        return;
      }
      webPreferences.preload = path.join(__dirname, "whatsapp.preload.cjs");
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
    }
  );
  // The app UI is a local page: it never navigates away or opens windows.
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  recoverRendererOnFailure(mainWindow.webContents, "App window");

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // The window starts hidden; minimizing it before ready-to-show could
  // leave it inaccessible on some systems. Wait until its first paint.
  // Started with Windows and "Start in tray": stay hidden; the tabs load and
  // notify as usual, and the tray icon or a notification opens the window.
  mainWindow.once("ready-to-show", () => {
    const mode = getStartupWindowMode({
      startedByAutostart: process.argv.includes(AUTOSTART_FLAG),
      launchToTray: getSettingWithDefault("launchToTray"),
      trayIcon: getSettingWithDefault("trayIcon"),
      launchMinimized: getSettingWithDefault("launchMinimized"),
    });
    if (mode === "minimized") {
      mainWindow.showInactive();
      mainWindow.minimize();
    } else if (mode === "normal") {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  changeAutoHideMenuBar(mainWindow, getSettingWithDefault("autoHideMenuBar"));

  // Resizing/moving can emit hundreds of events. Persist the normal bounds
  // once activity settles, without writing on every animation frame.
  let boundsSaveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveNormalBounds = () => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    windowState.store = mainWindow.getNormalBounds();
  };
  const scheduleBoundsSave = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(saveNormalBounds, 350);
  };
  mainWindow.on("resize", scheduleBoundsSave);
  mainWindow.on("move", scheduleBoundsSave);

  mainWindow.on("blur", () => mainWindow.webContents.send("window-blurred"));
  mainWindow.on("focus", () => mainWindow.webContents.send("window-focused"));

  mainWindow.on("close", (event) => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    saveNormalBounds();
    const shouldCloseToTray = getSettingWithDefault("closeToTray");
    const shouldPrompt = getSettingWithDefault("exitPrompt");
    if (isQuittingForUpdate()) {
      if (tray) tray.destroy();
    } else if (shouldCloseToTray) {
      event.preventDefault();
      mainWindow.hide();
    } else if (shouldPrompt) {
      event.preventDefault();
      confirmAndExit();
    } else if (tray) {
      tray.destroy();
    }
  });

  return mainWindow;
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.exit();
} else {
  app.on("second-instance", (_, argv) => {
    if (BrowserWindow.getAllWindows().length === 0) return;

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    handleWhatsappLinks(argv);
  });

  app.on("ready", () => {
    startupTimes.electronReadyAt = startupMoment("ready");
    if (resourceTestMode) {
      // Read here rather than when the test starts: a process's first CPU
      // reading only sets where its CPU counts from, so the test's first
      // sample then covers the rest of the startup instead of a millisecond.
      startupTimes.processCreatedAt = app.getAppMetrics().find((metric) => metric.pid === process.pid)?.creationTime;
    }
    if (process.platform === "win32") app.setAppUserModelId(APP_ID);
    const userAgentFallback = app.userAgentFallback;
    app.userAgentFallback = userAgentFallback.replace(
      /(Altus|Electron)([^\s]+\s)/g,
      ""
    );

    // Kept until the window can ask which account opens it.
    handleWhatsappLinks(process.argv);

    pruneUnusedPartitions(
      electronTabStore.get("tabs"),
      electronTabStore.get("previouslyClosedTab"),
      app.getPath("userData")
    );
    startupTimes.partitionsCheckedAt = startupMoment("partitions");

    // A smoke-test run on a throwaway profile must not rewrite the autostart
    // entry of the installed app, which shares the same name.
    if (!hasExplicitProfileDirectory()) updateAutostart();
    startupTimes.autostartCheckedAt = startupMoment("autostart");

    const mainWindow = createWindow();
    startupTimes.windowCreatedAt = startupMoment("window");
    if (resourceTestMode) startResourceTest(mainWindow);

    contextMenu();

    const defaultDownloadDir = getSettingWithDefault("defaultDownloadDir");
    electronDl({
      saveAs: getSettingWithDefault("showSaveDialog"),
      directory: defaultDownloadDir ? defaultDownloadDir : undefined,
      onCompleted: (file) => {
        const id = nextDownloadId++;
        completedDownloads.set(id, file.path);
        if (completedDownloads.size > MAX_TRACKED_DOWNLOADS) {
          completedDownloads.delete(id - MAX_TRACKED_DOWNLOADS);
        }
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("download-completed", {
          id,
          filename: file.filename,
        });
      },
    });

    initializeI18N(mainWindow).then(() => {
      toggleTray(mainWindow, getSettingWithDefault("trayIcon"));
      setupAutoUpdater({
        translate: (key) => electronI18N.t(key),
        getLanguage: () => electronI18N.getLanguage(),
        icon: mainIcon,
      });
      // Give the accounts time to load before downloading in the background.
      if (getSettingWithDefault("checkForUpdates")) {
        setTimeout(() => {
          void checkForUpdates({ interactive: false });
        }, 20_000);
      }
    });

    addIPCHandlers(mainWindow);
    updateProtocolRegistration();
  });

  // Closing the last window or an update quits without exitApp().
  app.on("will-quit", () => resourceTest?.finish());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("web-contents-created", (_, webContents) => {
    if (webContents.getType() === "webview") {
      // Popups stay disabled as before (no allowpopups); _blank links are
      // handled by the preload through the validated "open-link" channel.
      webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      // Keep each tab on WhatsApp Web; open other http(s) pages in the
      // default browser instead of inside the account's session.
      webContents.on("will-navigate", (event, url) => {
        if (isTrustedWhatsAppURL(url)) return;
        event.preventDefault();
        const externalURL = getSafeExternalHttpURL(url);
        if (!externalURL) return;
        void shell
          .openExternal(externalURL)
          .catch((error) => console.error("Failed to open external URL:", error));
      });
      // A crashed account reloads on its own without touching the others.
      recoverRendererOnFailure(webContents, "WhatsApp tab");

      contextMenu({
        window: {
          webContents: webContents,
          inspectElement: webContents.inspectElement.bind(webContents),
        } as unknown as BrowserWindow,
        showSaveImageAs: true,
        showInspectElement: true,
        labels: localizedContextMenuLabels,
        append: (def, params, window) => [
          {
            label: electronI18N.t("Bold"),
            visible: params.isEditable,
            click: () => {
              (window as BrowserWindow).webContents.send("format-text", "*");
            },
          },
          {
            label: electronI18N.t("Italic"),
            visible: params.isEditable,
            click: () => {
              (window as BrowserWindow).webContents.send("format-text", "_");
            },
          },
          {
            label: electronI18N.t("Strike"),
            visible: params.isEditable,
            click: () => {
              (window as BrowserWindow).webContents.send("format-text", "~");
            },
          },
          {
            label: electronI18N.t("Monospaced"),
            visible: params.isEditable,
            click: () => {
              (window as BrowserWindow).webContents.send("format-text", "```");
            },
          },
        ],
      });
    }

    // Enter as a new line, and the keys that send instead (Ctrl+Enter,
    // Right Shift+Enter): see src/utils/keyboard.ts.
    attachEnterKeys(webContents, () => ({
      preventEnter: getSettingWithDefault("preventEnter"),
      sendWithRightShiftEnter: getSettingWithDefault("sendWithRightShiftEnter"),
    }));
  });
}

// electron-context-menu reads these each time a menu opens, so the getters
// follow the current language.
const localizedContextMenuLabels = Object.defineProperties(
  {},
  Object.fromEntries(
    Object.entries(contextMenuLabelKeys).map(([id, key]) => [
      id,
      { enumerable: true, get: () => electronI18N.t(key) },
    ])
  )
) as Record<keyof typeof contextMenuLabelKeys, string>;

// A whatsapp:// link waiting for the window to be ready to ask which account
// opens it (the link the app was started with arrives before the window).
let pendingWhatsAppAddress: string | null = null;
let windowTakesWhatsAppLinks = false;

/**
 * Opens a whatsapp:// link from the command line: the one the app was started
 * with, or one that Windows passes to a second start while the app runs. Only
 * chats and group invites are accepted; the window asks which account opens
 * them.
 */
function handleWhatsappLinks(argv: string[]) {
  const link = findWhatsAppLink(argv);
  if (!link) return;
  const address = whatsAppWebAddress(link);
  if (!address || !isTrustedWhatsAppURL(address)) {
    // Not logged: the link may hold a phone number or a message.
    console.warn("Ignored a whatsapp:// link that is not a chat or a group invite");
    return;
  }
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (windowTakesWhatsAppLinks && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("open-whatsapp-link", address);
  } else {
    pendingWhatsAppAddress = address;
  }
}

/**
 * Makes Altus + the handler of whatsapp:// links while the setting is on, and
 * stops being it once the setting is off. Only a registration that points to
 * this installation is removed, so an app that took the links over since is
 * left alone. (Uninstalling removes it too: makers/nsis/whatsappLinks.nsh.)
 */
function updateProtocolRegistration() {
  // A development run would register electron.exe, and a run on a throwaway
  // profile (smoke test) must not change what the installed app does.
  if (!app.isPackaged || hasExplicitProfileDirectory()) return;
  try {
    const registered = app.isDefaultProtocolClient(WHATSAPP_PROTOCOL, process.execPath, PROTOCOL_ARGS);
    if (getSettingWithDefault("registerProtocol")) {
      if (!registered) app.setAsDefaultProtocolClient(WHATSAPP_PROTOCOL, process.execPath, PROTOCOL_ARGS);
    } else if (registered) {
      app.removeAsDefaultProtocolClient(WHATSAPP_PROTOCOL, process.execPath, PROTOCOL_ARGS);
    }
  } catch (error) {
    console.warn("Could not update the whatsapp:// registration", error);
  }
}

function pruneUnusedPartitions(
  tabs: Tab[],
  previouslyClosedTab: Tab | null,
  userDataPath: string
) {
  const partitionsDirectoryPath = path.join(userDataPath, "Partitions");

  const doesPartitionsDirectoryExist = fs.existsSync(partitionsDirectoryPath);
  if (!doesPartitionsDirectoryExist) return;

  const tabIds = tabs.map((tab) => tab.id);
  if (previouslyClosedTab) {
    tabIds.push(previouslyClosedTab.id);
  }

  let partitions: string[];
  try {
    partitions = fs.readdirSync(partitionsDirectoryPath);
  } catch (error) {
    console.error("Could not list partitions", error);
    return;
  }

  for (const id of getPartitionsToPrune(partitions, tabIds)) {
    // A locked file must not abort startup; retry on the next launch.
    try {
      fs.rmSync(path.join(partitionsDirectoryPath, id), { recursive: true });
    } catch (error) {
      console.warn("Could not remove unused partition", error);
    }
  }
}

/**
 * "Allow Moving Tabs" (Tab menu): saves it, ticks the menu item and lets the
 * tab bar know, whether it changed from the menu or from the window.
 */
function setTabReordering(enabled: boolean) {
  electronSettingsStore.set("tabReordering", { value: enabled });
  Menu.setApplicationMenu(getLocalizedMainMenu());
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("reload-custom-title-bar");
    window.webContents.send("reload-settings");
  }
}

function changeAutoHideMenuBar(mainWindow: BrowserWindow, value: boolean) {
  mainWindow.setAutoHideMenuBar(value);
  mainWindow.setMenuBarVisibility(!value);
}

function toggleTray(mainWindow: BrowserWindow, enabled: boolean) {
  // Recreating an enabled tray icon without destroying the previous one leaks
  // an OS tray resource and can leave duplicate icons after toggling settings.
  if (tray) tray.destroy();
  tray = undefined;
  if (!enabled) return;
  if (process.platform === "darwin") {
    app.dock?.setMenu(getLocalizedTrayMenu());
  }
  tray = new Tray(
    process.platform === "darwin"
      ? trayIcon.resize({
          width: 16,
          height: 16,
        })
      : trayIcon
  );
  trayTooltip = "";
  updateTrayTooltip();
  // A timed mute may have ended since the last update.
  tray.on("mouse-enter", () => updateTrayTooltip());
  tray.setContextMenu(getLocalizedTrayMenu());
  tray.on("click", () => {
    if (process.platform !== "darwin") {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
}

type PartitionID = string;
/**
 * For every permission that we want to handle, we keep track of the partitions
 * where it is enabled.
 */
const sessionPermissions = {
  notifications: new Set<PartitionID>(),
  media: new Set<PartitionID>(),
};
type SessionPermissionKey = keyof typeof sessionPermissions;
const HandledPermissions = Object.keys(sessionPermissions);

function addIPCHandlers(mainWindow: BrowserWindow) {
  // Every invoke channel serves the app's own UI. WhatsApp pages only use the
  // send channels below (zoom, open-link, message-count), which check their
  // sender themselves.
  const handle = (
    channel: string,
    listener: Parameters<typeof ipcMain.handle>[1]
  ) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== mainWindow.webContents) {
        throw new Error(`Unauthorized IPC sender for ${channel}`);
      }
      return listener(event, ...args);
    });

  handle("get-whatsapp-preload-path", () => {
    // Vite 8 does not turn import.meta.url into a file URL in the CommonJS
    // main bundle, so build it from __dirname.
    return pathToFileURL(path.join(__dirname, "whatsapp.preload.cjs")).href;
  });

  // The window asks which account opens a whatsapp:// link from now on; one
  // that arrived earlier (the link the app was started with) is handed over.
  handle("whatsapp-links-ready", () => {
    windowTakesWhatsAppLinks = true;
    const address = pendingWhatsAppAddress;
    pendingWhatsAppAddress = null;
    return address;
  });
  // While the window itself (re)loads, links wait for it to ask again.
  // (Navigation inside the account webviews is theirs, not the window's.)
  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) windowTakesWhatsAppLinks = false;
  });

  handle("settings-store-get", () => {
    return electronSettingsStore.store;
  });

  handle(
    "settings-store-set",
    (event, key: SettingKey, value: unknown) => {
      if (event.sender !== mainWindow.webContents) throw new Error("Unauthorized settings sender");
      if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(SettingsSchema.shape, key)) {
        throw new Error("Invalid setting key");
      }
      if (value === undefined) return electronSettingsStore.delete(key);
      const parsed = SettingsSchema.shape[key].safeParse({ value });
      if (!parsed.success) throw new Error("Invalid setting value");
      if (key === "autoHideMenuBar") {
        changeAutoHideMenuBar(mainWindow, value as boolean);
      } else if (key === "trayIcon") {
        toggleTray(mainWindow, value as boolean);
      } else if (key === "language") {
        // Saves the setting and relabels the menus, tray and window.
        electronI18N.setLanguage(value as Language);
        return;
      } else if (key === "tabReordering") {
        setTabReordering(value as boolean);
        return;
      } else if (key === "registerProtocol") {
        electronSettingsStore.set(key, { value });
        updateProtocolRegistration();
        return;
      }
      return electronSettingsStore.set(key, { value });
    }
  );

  handle("tab-store-get", () => {
    return electronTabStore.store;
  });

  handle(
    "tab-store-set",
    (event, key: keyof TabStore, value: unknown) => {
      if (event.sender !== mainWindow.webContents) throw new Error("Unauthorized tab sender");
      if (!["tabs", "selectedTabId", "previouslyClosedTab"].includes(key)) throw new Error("Invalid tab store key");
      if (value === undefined) electronTabStore.delete(key);
      else electronTabStore.set(key, value);
      // Names, order and mutes of the accounts.
      if (key === "tabs") updateTrayTooltip();
    }
  );

  // Polled by the Resource Usage panel while it is open.
  handle("get-resource-usage", () => sampleResourceUsage(mainWindow));

  // "Restart and Measure" in the Run Resource Test dialog.
  handle("start-resource-test", () => {
    if (!resourceTestMode) relaunch(true);
  });

  handle("theme-store-get", () => {
    return electronThemeStore.store;
  });

  handle(
    "theme-store-set",
    (event, key: keyof ThemeStore, value: unknown) => {
      if (event.sender !== mainWindow.webContents || key !== "themes") throw new Error("Unauthorized theme store update");
      if (value === undefined) return electronThemeStore.delete(key);
      return electronThemeStore.set(key, value);
    }
  );

  handle("init-permission-handler", (event, partitionId: unknown) => {
    if (event.sender !== mainWindow.webContents || !isAltusPartition(partitionId)) {
      throw new Error("Unauthorized session partition");
    }
    session
      .fromPartition(partitionId)
      .setPermissionRequestHandler((requestingContents, permission, callback) => {
        if (!isTrustedWhatsAppURL(requestingContents.getURL()) || !HandledPermissions.includes(permission)) {
          callback(false);
          return;
        }
        const isEnabled =
          sessionPermissions[permission as SessionPermissionKey].has(partitionId);
        callback(isEnabled);
      });
  });

  handle(
    "toggle-notifications",
    (event, enabled: boolean, partitionId: string) => {
      if (event.sender !== mainWindow.webContents || !isAltusPartition(partitionId) || typeof enabled !== "boolean") {
        throw new Error("Invalid notification permission update");
      }
      if (enabled) {
        sessionPermissions.notifications.add(partitionId);
      } else {
        sessionPermissions.notifications.delete(partitionId);
      }
    }
  );

  handle(
    "toggle-media-permission",
    (event, enabled: boolean, partitionId: string) => {
      if (event.sender !== mainWindow.webContents || !isAltusPartition(partitionId) || typeof enabled !== "boolean") {
        throw new Error("Invalid media permission update");
      }
      if (enabled) {
        sessionPermissions.media.add(partitionId);
      } else {
        sessionPermissions.media.delete(partitionId);
      }
    }
  );

  ipcMain.on("open-link", (event, rawURL: unknown) => {
    if (event.sender.getType() !== "webview" || !isTrustedWhatsAppURL(event.sender.getURL())) return;
    const url = getSafeExternalHttpURL(rawURL);
    if (!url) return;
    void shell.openExternal(url).catch((error) => console.error("Failed to open external URL:", error));
  });

  handle(
    "show-message-box",
    (_event, options: Electron.MessageBoxOptions) => {
      return dialog.showMessageBox(options);
    }
  );

  handle("show-download-in-folder", (_event, id: unknown) => {
    const filePath =
      typeof id === "number" ? completedDownloads.get(id) : undefined;
    if (!filePath) return;
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return;
    }
    // The file was moved or deleted meanwhile: open its folder if it is left.
    const directory = path.dirname(filePath);
    if (fs.existsSync(directory)) void shell.openPath(directory);
  });

  handle("get-app-menu", () => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    const cloneableMenu = getCloneableMenu(menu);
    return cloneableMenu;
  });

  handle("menu-item-click", (_event, id: string) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    const item = menu.getMenuItemById(id);
    if (!item) return;
    // The click comes from the app window, focused or not.
    const focusedWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const focusedWebContents = focusedWindow.webContents;
    item.click(undefined, focusedWindow, focusedWebContents);
  });

  handle("minimize-window", () => {
    mainWindow.minimize();
  });

  handle("maximize-window", () => {
    mainWindow.maximize();
  });

  handle("restore-window", () => {
    mainWindow.restore();
  });

  handle("close-window", () => {
    mainWindow.close();
  });

  handle("is-maximized", () => {
    return mainWindow.isMaximized();
  });

  handle("is-blurred", () => {
    return !mainWindow.isFocused();
  });

  // A notification of some account was clicked: show the window on that
  // account's tab. WhatsApp's own click handler then opens the chat.
  ipcMain.on("notification-clicked", (event, tabId: unknown) => {
    const { sender } = event;
    if (sender.getType() !== "webview" || !isTrustedWhatsAppURL(sender.getURL())) return;
    if (typeof tabId !== "string" || !isAltusPartition(`persist:${tabId}`)) return;
    if (!electronTabStore.get("tabs").some((tab) => tab.id === tabId)) return;
    // Only the tab's own session may bring that tab forward.
    if (sender.session !== session.fromPartition(`persist:${tabId}`)) return;
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("select-tab", tabId);
  });

  ipcMain.on("zoom", ({ sender }, type) => {
    if (sender.getType() !== "webview" || !isTrustedWhatsAppURL(sender.getURL())) return;
    if (!["in", "out", "reset"].includes(type)) return;
    const currentZoomFactor = sender.getZoomFactor();
    switch (type) {
      case "in":
        sender.setZoomFactor(Math.min(2.5, currentZoomFactor + 0.1));
        break;
      case "out":
        sender.setZoomFactor(Math.max(0.5, currentZoomFactor - 0.1));
        break;
      default:
        sender.setZoomFactor(1);
        break;
    }
  });

  ipcMain.on("message-count", (event, detail: unknown) => {
    // Quitting or restarting destroys the window first; counts the tabs sent
    // meanwhile still arrive (often right after a start, while they sync).
    if (mainWindow.isDestroyed()) return;
    if (event.sender.getType() !== "webview" || !isTrustedWhatsAppURL(event.sender.getURL())) return;
    if (!detail || typeof detail !== "object") return;
    const { tabId, messageCount } = detail as { tabId?: unknown; messageCount?: unknown };
    if (typeof tabId !== "string" || !Number.isSafeInteger(messageCount) ||
        (messageCount as number) < 0 || (messageCount as number) > 100000) return;
    const tabs = electronTabStore.get("tabs");
    const activeIds = new Set(tabs.map((tab) => tab.id));
    if (!activeIds.has(tabId)) return;
    for (const id of unreadByTab.keys()) {
      if (!activeIds.has(id)) unreadByTab.delete(id);
    }
    unreadByTab.set(tabId, messageCount as number);
    resourceTest?.accountLoaded(tabId, tabs.find((tab) => tab.id === tabId)?.name ?? "");
    mainWindow.webContents.send("message-count", { tabId, messageCount });
    updateTrayTooltip(tabs);
    if (!getSettingWithDefault("notificationBadge")) {
      return;
    }
    const totalUnread = [...unreadByTab.values()].reduce((sum, count) => sum + count, 0);
    if (totalUnread > 0) {
      switch (process.platform) {
        case "darwin":
          app.dock?.setBadge("·");
          break;
        default:
          if (tray) tray.setImage(trayNotificationIcon);
          mainWindow.setOverlayIcon(mainNotificationIcon, "Notification badge");
          break;
      }
    } else {
      switch (process.platform) {
        case "darwin":
          app.dock?.setBadge("");
          break;
        default:
          if (tray) tray.setImage(trayIcon);
          mainWindow.setOverlayIcon(null, "Notification badge empty");
          break;
      }
    }
  });
}

type CloneableMenuItem = Omit<MenuItem, "menu" | "submenu" | "click"> & {
  submenu?: CloneableMenu;
};
export type CloneableMenu = CloneableMenuItem[];

function getCloneableMenu(menu: Menu) {
  return menu.items.map(getCloneableMenuItem);
}

function getCloneableMenuItem(item: MenuItem): CloneableMenuItem {
  const cloneableItem = { ...item } as CloneableMenuItem & {
    menu?: Menu;
    submenu?: Menu;
    click?: () => void;
  };
  delete cloneableItem["menu"];
  delete cloneableItem["click"];
  if (cloneableItem.submenu) {
    (cloneableItem as CloneableMenuItem).submenu = getCloneableMenu(
      cloneableItem.submenu as Menu
    );
  }
  cloneableItem.checked = item.checked;
  return cloneableItem;
}

async function initializeI18N(mainWindow: BrowserWindow) {
  electronI18N.setLanguageChangeCallback((language) => {
    electronSettingsStore.set("language", {
      value: language,
    });
  });

  electronI18N.setLanguageLoadedCallback(() => {
    const menu = getLocalizedMainMenu();
    Menu.setApplicationMenu(menu);
    if (tray && !tray.isDestroyed()) {
      tray.setContextMenu(getLocalizedTrayMenu());
      updateTrayTooltip();
    }
    if (process.platform === "darwin" && tray) {
      app.dock?.setMenu(getLocalizedTrayMenu());
    }
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("reload-custom-title-bar");
    mainWindow.webContents.send("reload-translations");
    if (resourceTest) {
      mainWindow.setTitle(`${APP_NAME} ${app.getVersion()} — ${electronI18N.t("Resource test in progress")}`);
    }
  });

  try {
    await electronI18N.initialize();

    const savedLanguage = getSettingWithDefault("language");
    electronI18N.setLanguage(
      isSupportedLanguage(savedLanguage) ? savedLanguage : fallbackLanguage
    );
  } catch (error) {
    console.error(error);
  }
}

const versionInfo = `${APP_NAME}: ${app.getVersion()}
Electron: ${process.versions.electron}
Chrome: ${process.versions.chrome}
V8: ${process.versions.v8}
OS: ${os.type()} ${os.arch()} ${os.release()}`;

const aboutDialogText = `With help from: MarceloZapatta, Dafnik, dmcdo, insign, srevinsaju, maicol07, ngmoviedo.

Thanks to: vednoc for Dark WhatsApp theme.

${versionInfo}`;

function getLocalizedMainMenu() {
  const menuTemplate: (
    | Electron.MenuItemConstructorOptions
    | Electron.MenuItem
  )[] = [
    {
      label: electronI18N.t("&File"),
      submenu: [
        {
          label: electronI18N.t("Start &New Chat"),
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("new-chat");
          },
          id: "start-new-chat",
        },
        {
          label: electronI18N.t("Force &Reload"),
          role: "forceReload",
          id: "force-reload",
        },
        {
          label: electronI18N.t("&Quit"),
          id: "quit",
          accelerator: "CmdOrCtrl+Q",
          acceleratorWorksWhenHidden: false,
          click: quitApp,
        },
      ],
    },
    {
      label: electronI18N.t("&Edit"),
      submenu: [
        {
          label: electronI18N.t("Undo"),
          role: "undo",
          id: "undo",
        },
        {
          label: electronI18N.t("Redo"),
          role: "redo",
          id: "redo",
        },
        {
          type: "separator",
        },
        {
          label: electronI18N.t("Cut"),
          role: "cut",
          id: "cut",
        },
        {
          label: electronI18N.t("Copy"),
          role: "copy",
          id: "copy",
        },
        {
          label: electronI18N.t("Paste"),
          role: "paste",
          id: "paste",
        },
        {
          label: electronI18N.t("Select All"),
          role: "selectAll",
          id: "select-all",
        },
        {
          type: "separator",
        },
        {
          label: electronI18N.t("Language"),
          submenu: languages.map((lang) => {
            return {
              label: languageNames[lang],
              type: "radio",
              checked: electronI18N.getLanguage() === lang,
              click: () => {
                electronI18N.setLanguage(lang);
              },
              id: lang,
            };
          }),
        },
      ],
    },
    {
      label: electronI18N.t("Tab"),
      submenu: [
        {
          label: electronI18N.t("Add New Tab"),
          accelerator: "CmdOrCtrl+T",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("add-new-tab");
          },
          id: "add-new-tab",
        },
        {
          label: electronI18N.t("Edit Active Tab"),
          accelerator: "CmdOrCtrl+E",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("edit-active-tab");
          },
          id: "edit-active-tab",
        },
        {
          label: electronI18N.t("Close Active Tab"),
          accelerator: "CmdOrCtrl+W",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("close-active-tab");
          },
          id: "close-active-tab",
        },
        {
          label: electronI18N.t("Open Tab DevTools"),
          accelerator: "CmdOrCtrl+Shift+D",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("open-tab-devtools");
          },
          id: "open-tab-devtools",
        },
        {
          label: electronI18N.t("Restore Tab"),
          accelerator: "CmdOrCtrl+Shift+T",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("restore-tab");
          },
          id: "restore-tab",
        },
        {
          type: "separator",
        },
        {
          label: electronI18N.t("Go to Next Tab"),
          accelerator: "CmdOrCtrl+Tab",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("next-tab");
          },
          id: "next-tab",
        },
        {
          label: electronI18N.t("Go to Previous Tab"),
          accelerator: "CmdOrCtrl+Shift+Tab",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("previous-tab");
          },
          id: "previous-tab",
        },
        {
          type: "separator",
        },
        {
          label: electronI18N.t("Go to First Tab"),
          accelerator: "CmdOrCtrl+1",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("first-tab");
          },
          id: "first-tab",
        },
        {
          label: electronI18N.t("Go to Last Tab"),
          accelerator: "CmdOrCtrl+9",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("last-tab");
          },
          id: "last-tab",
        },
        {
          type: "separator",
        },
        {
          label: electronI18N.t("Allow Moving Tabs"),
          type: "checkbox",
          checked: getSettingWithDefault("tabReordering"),
          click() {
            setTabReordering(!getSettingWithDefault("tabReordering"));
          },
          id: "allow-moving-tabs",
        },
      ],
    },
    {
      label: electronI18N.t("Themes"),
      submenu: [
        {
          label: electronI18N.t("Theme Manager"),
          accelerator: "Alt+T",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("open-theme-manager");
          },
          id: "open-theme-manager",
        },
      ],
    },
    {
      label: electronI18N.t("&Settings"),
      submenu: [
        {
          label: electronI18N.t("&Settings"),
          accelerator: "Ctrl+,",
          click() {
            const window = BrowserWindow.getFocusedWindow();
            if (window) window.webContents.send("open-settings");
          },
          id: "open-settings",
        },
      ],
    },
    {
      label: electronI18N.t("&Help"),
      submenu: [
        {
          label: electronI18N.t("&About"),
          click() {
            dialog
              .showMessageBox({
                type: "info",
                title: `${APP_NAME} v${app.getVersion()}`,
                message: `${APP_NAME} ${app.getVersion()}`,
                detail: `${electronI18N.t("Maintained by lukethehawk. Fork of Altus by Aman Harwara.")}
${REPOSITORY_URL}

${aboutDialogText}`,
                icon: mainIcon,
                buttons: [
                  electronI18N.t("Open GitHub"),
                  electronI18N.t("Copy Version Info"),
                  "OK",
                ],
                defaultId: 2,
                cancelId: 2,
              })
              .then((res) => {
                const buttonClicked = res.response;
                switch (buttonClicked) {
                  case 0:
                    void shell.openExternal(REPOSITORY_URL);
                    break;
                  case 1:
                    void clipboard.writeText(versionInfo).catch(console.error);
                    break;
                }
              })
              .catch((err) => {
                console.error(err);
              });
          },
          id: "about",
        },
        {
          label: electronI18N.t("Check For &Updates"),
          accelerator: "CmdOrCtrl+Shift+U",
          click() {
            checkForUpdates({ interactive: true }).catch(console.error);
          },
          id: "check-for-updates",
        },
        {
          label: electronI18N.t("Resource Usage"),
          click() {
            const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (window) window.webContents.send("open-resource-usage");
          },
          id: "resource-usage",
        },
        resourceTestMode
          ? {
              label: electronI18N.t("End Resource Test"),
              click: endResourceTest,
              id: "end-resource-test",
            }
          : {
              label: electronI18N.t("Run Resource Test…"),
              click() {
                const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
                if (window) window.webContents.send("open-resource-test");
              },
              id: "resource-test",
            },
        {
          label: electronI18N.t("Links"),
          submenu: [
            {
              label: electronI18N.t("Repository"),
              click: () => {
                void shell.openExternal(REPOSITORY_URL);
              },
              id: "repository",
            },
            {
              label: electronI18N.t("Releases"),
              click: () => {
                void shell.openExternal(`${REPOSITORY_URL}/releases`);
              },
              id: "releases",
            },
            {
              label: electronI18N.t("Report Bugs/Issues"),
              click: () => {
                void shell.openExternal(`${REPOSITORY_URL}/issues`);
              },
              id: "report-bugs-issues",
            },
            {
              label: electronI18N.t("Original Altus project"),
              click: () => {
                void shell.openExternal("https://github.com/amanharwara/altus");
              },
              id: "original-project",
            },
          ],
        },
        {
          label: electronI18N.t("Open &DevTools"),
          role: "toggleDevTools",
          id: "toggle-dev-tools",
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(menuTemplate);
}

function getLocalizedTrayMenu() {
  const menuTemplate: (
    | Electron.MenuItemConstructorOptions
    | Electron.MenuItem
  )[] = [
    {
      label: electronI18N.t("Maximize"),
      click() {
        const window = BrowserWindow.getAllWindows()[0];
        if (window) window.show();
      },
    },
    {
      label: electronI18N.t("Minimize to Tray"),
      click() {
        const window = BrowserWindow.getAllWindows()[0];
        if (window) window.hide();
      },
    },
    {
      label: electronI18N.t("Quit"),
      click: quitApp,
    },
  ];

  return Menu.buildFromTemplate(menuTemplate);
}
