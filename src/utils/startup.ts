import path from "path";

/**
 * The autostart entry starts the app with this flag (auto-launch's isHidden),
 * so "Start in tray with Windows" never hides a window the person opened.
 */
export const AUTOSTART_FLAG = "--hidden";

/**
 * On Windows auto-launch names the Run value after the exe file and ignores
 * its `name` option, so an entry left by another build (named after that
 * build's exe) is only reached through a path ending in that exe's name.
 * The file does not need to exist.
 */
export function autostartPathFor(appName: string, execPath: string): string {
  return path.win32.join(path.win32.dirname(execPath), `${appName}.exe`);
}

/**
 * The Run value auto-launch writes for an exe: the file name without its
 * last four characters (".exe"), as auto-launch's fixOpts does.
 */
export function autostartEntryName(execPath: string): string {
  const file = path.win32.basename(execPath);
  return file.slice(0, file.length - ".exe".length);
}

/** What the autostart entry of this exe runs: auto-launch writes this with isHidden. */
export function autostartCommand(execPath: string): string {
  return `"${execPath}" ${AUTOSTART_FLAG}`;
}

/** A Run entry as app.getLoginItemSettings() lists it (its args leave out switches such as --hidden). */
export type AutostartEntry = { name: string; scope: string };

/**
 * Whether the autostart entry needs writing or removing, judged without
 * running reg.exe: Electron lists the Run entries that start this exe, and
 * the app remembers what it last wrote, since Electron's list does not show
 * the --hidden flag. Anything uncertain writes the entry again, as every
 * start used to.
 */
export function autostartChange(options: {
  wanted: boolean;
  /** app.getLoginItemSettings({ path: execPath }).launchItems */
  entries: AutostartEntry[];
  /** autostartEntryName(execPath) */
  name: string;
  /** What the app last wrote (autostartCommand), or null. */
  written: string | null;
  /** autostartCommand(execPath) */
  command: string;
}): "enable" | "disable" | "none" {
  // Registry value names ignore case.
  const present = options.entries.some(
    (entry) => entry.scope === "user" && entry.name.toLowerCase() === options.name.toLowerCase()
  );
  if (!options.wanted) return present ? "disable" : "none";
  return present && options.written?.toLowerCase() === options.command.toLowerCase() ? "none" : "enable";
}

export type StartupWindowMode = "tray" | "minimized" | "normal";

/**
 * How the main window appears when the app starts. It only stays hidden when
 * the tray icon exists, so the window can always be reopened.
 */
export function getStartupWindowMode(options: {
  startedByAutostart: boolean;
  launchToTray: boolean;
  trayIcon: boolean;
  launchMinimized: boolean;
}): StartupWindowMode {
  if (options.startedByAutostart && options.launchToTray && options.trayIcon) {
    return "tray";
  }
  return options.launchMinimized ? "minimized" : "normal";
}
