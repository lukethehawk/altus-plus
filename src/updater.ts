import { app, dialog, shell, type NativeImage } from "electron";
import { autoUpdater } from "electron-updater";
import { APP_NAME } from "./utils/isolation";
import {
  REPOSITORY_URL,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_TICK_MS,
  isUpdateCheckDue,
} from "./utils/updates";

type Translate = (key: string) => string;

let translate: Translate = (key) => key;
let getLanguage: () => string = () => "en";
let dialogIcon: NativeImage | undefined;
let configured = false;
let interactiveCheck = false;
/** True while asking the feed whether there is a newer release. */
let checking = false;
/** When a check last started, for the background checks. */
let lastCheckAt: number | null = null;
let downloadingVersion: string | null = null;
let downloadedVersion: string | null = null;
let quittingForUpdate = false;

/**
 * In-app updates from this repository's GitHub releases. A newer release is
 * downloaded in the background and checked against the SHA512 in its
 * latest.yml; the user then restarts now or lets it install silently the
 * next time the app quits.
 */
export function setupAutoUpdater(options: {
  translate: Translate;
  getLanguage: () => string;
  icon: NativeImage;
}) {
  translate = options.translate;
  getLanguage = options.getLanguage;
  dialogIcon = options.icon;
  if (configured) return;
  configured = true;

  // Local update tests point a build at a generic feed; release builds
  // never set this variable and always use GitHub.
  const testFeed = ALTUS_TEST_UPDATE_FEED;
  autoUpdater.setFeedURL(
    testFeed
      ? { provider: "generic", url: testFeed }
      : { provider: "github", owner: "lukethehawk", repo: "altus-plus" }
  );
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Fork versions look like 5.8.1-plus.3; only published, non-prerelease
  // GitHub releases count, and never an older one.
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  // Releases ship the full NSIS installer, not a web installer.
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = {
    info: () => undefined,
    warn: (message) => console.warn("[updater]", message),
    error: (message) => console.error("[updater]", message),
  };

  autoUpdater.on("update-not-available", () => {
    if (!interactiveCheck) return;
    interactiveCheck = false;
    void dialog.showMessageBox({
      type: "info",
      message: translate("You are using the latest version"),
      detail: `${APP_NAME} ${app.getVersion()}`,
      icon: dialogIcon,
    });
  });

  autoUpdater.on("update-available", (info) => {
    downloadingVersion = info.version;
    // Stay interactive until the download finishes, so a failed download is
    // reported to the user who asked for the check.
    if (!interactiveCheck) return;
    showDownloading(info.version);
  });

  autoUpdater.on("update-downloaded", (info) => {
    interactiveCheck = false;
    downloadingVersion = null;
    downloadedVersion = info.version;
    passLanguageToInstaller();
    promptToRestart(info.version);
  });

  autoUpdater.on("error", (error) => {
    downloadingVersion = null;
    if (!interactiveCheck) return;
    interactiveCheck = false;
    void dialog
      .showMessageBox({
        type: "warning",
        message: translate("Could not check for updates"),
        detail: `${translate("Try again later or open the releases page.")}\n\n${error.message}`,
        buttons: [translate("Open Releases Page"), "OK"],
      })
      .then(({ response }) => {
        if (response === 0) void shell.openExternal(`${REPOSITORY_URL}/releases`);
      });
  });
}

export async function checkForUpdates({ interactive }: { interactive: boolean }) {
  // The menu can be used before startup has configured the feed.
  if (!configured) return;
  if (!app.isPackaged) {
    if (interactive) {
      void dialog.showMessageBox({
        type: "info",
        message: translate("Updates are only available in the installed app."),
      });
    }
    return;
  }
  if (downloadedVersion) {
    if (interactive) promptToRestart(downloadedVersion);
    return;
  }
  if (downloadingVersion) {
    if (interactive) showDownloading(downloadingVersion);
    return;
  }
  if (checking) {
    // A background check never takes over the one the user asked for; the
    // user's request joins a running background check and gets its answer.
    if (interactive) interactiveCheck = true;
    return;
  }
  checking = true;
  lastCheckAt = Date.now();
  interactiveCheck = interactive;
  try {
    const result = await autoUpdater.checkForUpdates();
    // The background download rejects on failure; that is also reported
    // through the "error" event.
    result?.downloadPromise?.catch(() => undefined);
  } catch {
    // Reported through the "error" event. Offline (say, right after
    // waking up): the next hourly look tries again.
    lastCheckAt = null;
  } finally {
    checking = false;
  }
}

/**
 * Checks again in the background while the app keeps running, when the
 * setting allows it. Local update test builds check every minute.
 */
export function scheduleUpdateChecks(isEnabled: () => boolean) {
  const testing = !!ALTUS_TEST_UPDATE_FEED;
  const intervalMs = testing ? 60_000 : UPDATE_CHECK_INTERVAL_MS;
  // Startup has its own check; count from here, so that a setting turned on
  // later still gets one within the interval.
  lastCheckAt ??= Date.now();
  setInterval(() => {
    if (!isEnabled() || !isUpdateCheckDue(lastCheckAt, Date.now(), intervalMs)) return;
    void checkForUpdates({ interactive: false });
  }, testing ? 10_000 : UPDATE_CHECK_TICK_MS);
}

function showDownloading(version: string) {
  void dialog.showMessageBox({
    type: "info",
    message: `${translate("Downloading update")}: ${APP_NAME} ${version}`,
    detail: translate(
      "It is downloading in the background. You will be asked to restart when it is ready."
    ),
    icon: dialogIcon,
  });
}

function promptToRestart(version: string) {
  void dialog
    .showMessageBox({
      type: "info",
      message: `${translate("Update ready")}: ${APP_NAME} ${version}`,
      detail: `${translate(
        "Restart now to install it, or it will be installed the next time you quit Altus +."
      )}\n\n${translate(
        "Installing takes about a minute: a small notice stays on screen until it is done. Wait for it before opening Altus + again."
      )}`,
      buttons: [translate("Restart now"), translate("Later")],
      defaultId: 0,
      cancelId: 1,
      icon: dialogIcon,
    })
    .then(({ response }) => {
      if (response === 0) installDownloadedUpdate({ relaunch: true });
    });
}

/**
 * The installer inherits this process's environment; its update notice
 * (makers/nsis/updateBanner.nsh) uses this to match the app's language.
 * Set again right before installing in case the language changed since.
 */
function passLanguageToInstaller() {
  process.env.ALTUS_UPDATE_LANGUAGE = getLanguage();
}

/** True while quitting to install, so close-to-tray must not cancel it. */
export function isQuittingForUpdate() {
  return quittingForUpdate;
}

/**
 * Exit paths that bypass Electron's quit event (app.exit) call this so a
 * downloaded update is still installed. Returns false when there is none.
 */
export function installDownloadedUpdate({ relaunch }: { relaunch: boolean }) {
  if (!downloadedVersion) return false;
  quittingForUpdate = true;
  passLanguageToInstaller();
  // Silent NSIS install; relaunch only when the user asked to restart.
  autoUpdater.quitAndInstall(true, relaunch);
  return true;
}
