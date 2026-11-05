import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import {
  AUTOSTART_FLAG,
  autostartChange,
  autostartCommand,
  autostartEntryName,
  autostartPathFor,
  getStartupWindowMode,
} from "../src/utils/startup.ts";

const AutoLaunch = createRequire(import.meta.url)("auto-launch");

const base = { startedByAutostart: true, launchToTray: true, trayIcon: true, launchMinimized: false };

test("autostart with the option stays in the tray", () => {
  assert.equal(getStartupWindowMode(base), "tray");
  // Wins over "Start minimized".
  assert.equal(getStartupWindowMode({ ...base, launchMinimized: true }), "tray");
});

test("a manual start always opens the window", () => {
  assert.equal(getStartupWindowMode({ ...base, startedByAutostart: false }), "normal");
  assert.equal(getStartupWindowMode({ ...base, startedByAutostart: false, launchMinimized: true }), "minimized");
});

test("never hidden without a tray icon to bring it back", () => {
  assert.equal(getStartupWindowMode({ ...base, trayIcon: false }), "normal");
  assert.equal(getStartupWindowMode({ ...base, trayIcon: false, launchMinimized: true }), "minimized");
});

test("without the option, autostart behaves as before", () => {
  assert.equal(getStartupWindowMode({ ...base, launchToTray: false }), "normal");
  assert.equal(getStartupWindowMode({ ...base, launchToTray: false, launchMinimized: true }), "minimized");
});

// auto-launch only accepts Windows paths on Windows. The smoke test (check 5)
// covers the same on every PR with the real registry.
test("the legacy cleanup targets the test build's entry, not this app's", { skip: process.platform !== "win32" }, () => {
  const exe = "C:\\Users\\me\\AppData\\Local\\Programs\\Altus +\\Altus +.exe";
  // auto-launch names the Run value after the exe and ignores `name`...
  assert.equal(new AutoLaunch({ name: "Altus Electron 44 Test", path: exe }).opts.appName, "Altus +");
  // ...so the cleanup passes a path ending in the test build's exe name.
  const legacy = new AutoLaunch({ name: "Altus Electron 44 Test", path: autostartPathFor("Altus Electron 44 Test", exe) });
  assert.equal(legacy.opts.appName, "Altus Electron 44 Test");
  assert.equal(new AutoLaunch({ name: "Altus +", path: exe }).opts.appName, "Altus +");
});

test("the flag matches what auto-launch adds for isHidden", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../node_modules/auto-launch/dist/AutoLaunchWindows.js", import.meta.url), "utf8");
  assert.ok(source.includes(`args += ' ${AUTOSTART_FLAG}'`), "auto-launch no longer appends " + AUTOSTART_FLAG);
});

// Windows paths built from forward slashes, so these run on any OS.
const installedExe = path.win32.normalize("C:/Users/me/AppData/Local/Programs/altus-plus/Altus +.exe");

test("the autostart entry is named and written as auto-launch does", () => {
  assert.equal(autostartEntryName(installedExe), "Altus +");
  assert.equal(autostartCommand(installedExe), `"${installedExe}" ${AUTOSTART_FLAG}`);
});

test("auto-launch names the entry like autostartEntryName", { skip: process.platform !== "win32" }, () => {
  assert.equal(new AutoLaunch({ name: "Altus +", path: installedExe }).opts.appName, autostartEntryName(installedExe));
});

test("startup only runs reg.exe when the autostart entry has to change", () => {
  const command = autostartCommand(installedExe);
  const entry = { name: "Altus +", scope: "user" };
  const change = (wanted, entries, written) => autostartChange({ wanted, entries, name: "Altus +", written, command });
  // On, written by this installation and still there: nothing to do.
  assert.equal(change(true, [entry], command), "none");
  // Registry value names and Windows paths ignore case.
  assert.equal(change(true, [{ name: "ALTUS +", scope: "user" }], command.toUpperCase()), "none");
  // On, but missing, never written by this check, or written for another folder: write it.
  assert.equal(change(true, [], command), "enable");
  assert.equal(change(true, [entry], null), "enable");
  assert.equal(change(true, [entry], autostartCommand(path.win32.normalize("D:/Altus +/Altus +.exe"))), "enable");
  // Only this app's value in the user's Run key counts.
  assert.equal(change(true, [{ name: "Altus +", scope: "machine" }, { name: "Other", scope: "user" }], command), "enable");
  // Off: remove it only when it is there.
  assert.equal(change(false, [entry], command), "disable");
  assert.equal(change(false, [entry], null), "disable");
  assert.equal(change(false, [], null), "none");
  assert.equal(change(false, [{ name: "Other", scope: "user" }], command), "none");
});
