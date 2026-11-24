import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the installer copies the original Altus into the profile the app opens", () => {
  const app = read("src/utils/isolation.ts").match(
    /LEGACY_TEST_BUILD_NAME = "([^"]+)"/
  )?.[1];
  const installer = read("makers/nsis/replaceAltus.nsh").match(
    /!define ALTUS_PLUS_PROFILE "([^"]+)"/
  )?.[1];
  assert.ok(app);
  assert.equal(installer, app);
});

// app-builder-lib before 26.12 read 8192 characters from the shorter
// per-user Programs path on every first install, which sometimes crashed the
// installer (System.dll access violation). Newer versions copy it safely;
// this keeps an older or regressed template out.
test("the installer copies the per-user Programs path without reading past it", () => {
  const template = read("node_modules/app-builder-lib/templates/nsis/multiUser.nsh");
  assert.doesNotMatch(template, /&w\$\{NSIS_MAX_STRLEN\}/);
  assert.match(template, /lstrcpynW\(w \.r0, p r2, i \$\{NSIS_MAX_STRLEN\}\)/);
});

test("NSIS scripts with accented text are saved with a UTF-8 BOM", () => {
  for (const file of ["updateBanner.nsh", "replaceAltus.nsh"]) {
    const bytes = fs.readFileSync(path.join(root, "makers/nsis", file));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], file);
  }
});

test("uninstalling removes the whatsapp:// registration the app writes", async () => {
  const { WHATSAPP_PROTOCOL, PROTOCOL_ARGS } = await import("../src/utils/whatsappLinks.ts");
  const script = read("makers/nsis/whatsappLinks.nsh");
  assert.ok(script.includes(`!define WHATSAPP_PROTOCOL_KEY "Software\\Classes\\${WHATSAPP_PROTOCOL}"`));
  // The uninstaller matches the start of the command Electron writes,
  // "<exe>" -- "%1", and keeps it on updates (--updated).
  assert.deepEqual(PROTOCOL_ARGS, ["--"]);
  assert.ok(script.includes(`StrCpy $1 '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}"'`));
  assert.match(script, /\$\{IfNot\} \$\{isUpdated\}/);
  assert.ok(read("makers/nsis/installer.nsh").includes(`!include "\${__FILEDIR__}\\whatsappLinks.nsh"`));
});

test("uninstalling removes the autostart entry the app writes", async () => {
  const { autostartCommand, autostartEntryName } = await import("../src/utils/startup.ts");
  const script = read("makers/nsis/autostart.nsh");
  assert.ok(script.includes(`!define AUTOSTART_RUN_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Run"`));
  // The value is named after the exe without ".exe", and its command starts
  // with the quoted exe path, which the uninstaller matches.
  const exe = "C:\\Users\\someone\\AppData\\Local\\Programs\\Altus +\\Altus +.exe";
  assert.equal(autostartEntryName(exe), "Altus +");
  assert.ok(autostartCommand(exe).startsWith(`"${exe}" `));
  assert.ok(script.includes(`StrCpy $3 "\${APP_EXECUTABLE_FILENAME}" -4`));
  assert.ok(script.includes(`StrCpy $1 '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}"'`));
  assert.match(script, /DeleteRegValue HKCU "\$\{AUTOSTART_RUN_KEY\}" \$3/);
  assert.match(script, /\$\{IfNot\} \$\{isUpdated\}/);
});

test("the one customUnInstall runs every uninstall step", () => {
  const scripts = fs.readdirSync(path.join(root, "makers/nsis")).filter((file) => file.endsWith(".nsh"));
  const defining = scripts.filter((file) => /^!macro customUnInstall\b/m.test(read(`makers/nsis/${file}`)));
  assert.deepEqual(defining, ["installer.nsh"]);
  const installer = read("makers/nsis/installer.nsh");
  for (const [file, macro] of [["whatsappLinks.nsh", "WHATSAPP_LINKS_UNINSTALL"], ["autostart.nsh", "AUTOSTART_UNINSTALL"]]) {
    assert.ok(installer.includes(`!include "\${__FILEDIR__}\\${file}"`), file);
    assert.match(read(`makers/nsis/${file}`), new RegExp(`^!macro ${macro}\\b`, "m"), macro);
    assert.match(installer, new RegExp(`!macro customUnInstall[\\s\\S]*!insertmacro ${macro}[\\s\\S]*!macroend`), macro);
  }
});

// Through cmd.exe, "taskkill" was looked up in the current folder first: the
// installer's, or the folder it was started from (Downloads).
test("the installer closes the original Altus with System32's taskkill, not through cmd.exe", () => {
  const script = read("makers/nsis/replaceAltus.nsh");
  assert.doesNotMatch(script, /cmd\.exe/);
  const calls = script.match(/nsExec::Exec `[^`]*taskkill[^`]*`/g) ?? [];
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call, /^nsExec::Exec `"\$SYSDIR\\taskkill\.exe" /);
});
