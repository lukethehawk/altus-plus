import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

// The app's sources import each other without extensions (Vite resolves
// them); let Node try "<path>.ts" for those.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
            return next(specifier + ".ts", context);
          }
          throw error;
        }
      }`)
);

const { corruptCopyName, isUnreadableJson, openOrSetAside, setAsideUnreadableFile } = await import(
  "../src/utils/storeRecovery.ts"
);
const { tabsFromPartitionFolders } = await import("../src/stores/tabs/rebuild.ts");
const { isValidTabStoreValue } = await import("../src/utils/storeValidation.ts");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "altus-store-"));
const syntaxError = () => {
  try {
    JSON.parse("\0\0\0");
  } catch (error) {
    return error;
  }
};
const fsError = (code) => Object.assign(new Error(code), { code });

// How electron-store reads its file: a missing file is empty, anything else
// that is not JSON throws.
const readLikeElectronStore = (file) => () => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
};

test("the copy of an unreadable file is named after the store and the local time", () => {
  assert.equal(corruptCopyName("tabs", new Date(2026, 10, 23, 9, 5, 7)), "tabs.corrupt-2026-11-23_09-05-07.json");
  assert.equal(corruptCopyName("windowState", new Date(2026, 0, 2, 23, 59, 0)), "windowState.corrupt-2026-01-02_23-59-00.json");
});

test("only a file that is not JSON counts as unreadable", () => {
  assert.equal(isUnreadableJson(syntaxError()), true);
  for (const error of [fsError("ENOENT"), fsError("EPERM"), fsError("EBUSY"), new Error("other"), undefined, "SyntaxError"]) {
    assert.equal(isUnreadableJson(error), false, String(error?.code ?? error));
  }
});

test("an unreadable file is renamed with its bytes, never overwriting an earlier copy", () => {
  const dir = tempDir();
  const now = new Date(2026, 10, 23, 9, 5, 7);
  const bytes = Buffer.alloc(64); // NUL bytes, as a power cut can leave
  fs.writeFileSync(path.join(dir, "tabs.json"), bytes);
  assert.equal(setAsideUnreadableFile(dir, "tabs", now), "tabs.corrupt-2026-11-23_09-05-07.json");
  assert.equal(fs.existsSync(path.join(dir, "tabs.json")), false);
  assert.deepEqual(fs.readFileSync(path.join(dir, "tabs.corrupt-2026-11-23_09-05-07.json")), bytes);

  fs.writeFileSync(path.join(dir, "tabs.json"), "{");
  assert.equal(setAsideUnreadableFile(dir, "tabs", now), "tabs.corrupt-2026-11-23_09-05-07-2.json");
  assert.deepEqual(fs.readFileSync(path.join(dir, "tabs.corrupt-2026-11-23_09-05-07.json")), bytes);
  assert.equal(fs.readFileSync(path.join(dir, "tabs.corrupt-2026-11-23_09-05-07-2.json"), "utf8"), "{");
  fs.rmSync(dir, { recursive: true });
});

test("a store whose file is not JSON opens again empty, after its file is set aside", () => {
  const dir = tempDir();
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, '{"language":{"value":"it"},"launchToTray":');
  const opened = openOrSetAside(readLikeElectronStore(file), () => setAsideUnreadableFile(dir, "settings"));
  assert.deepEqual(opened.store, {});
  assert.match(opened.setAsideAs, /^settings\.corrupt-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
  assert.equal(fs.readFileSync(path.join(dir, opened.setAsideAs), "utf8"), '{"language":{"value":"it"},"launchToTray":');
  fs.rmSync(dir, { recursive: true });
});

test("a readable or missing file is left alone", () => {
  const dir = tempDir();
  const file = path.join(dir, "themes.json");
  let setAside = 0;
  assert.deepEqual(openOrSetAside(readLikeElectronStore(file), () => String(++setAside)), { store: {}, setAsideAs: null });
  fs.writeFileSync(file, '{"themes":[]}');
  assert.deepEqual(openOrSetAside(readLikeElectronStore(file), () => String(++setAside)), { store: { themes: [] }, setAsideAs: null });
  assert.equal(setAside, 0);
  fs.rmSync(dir, { recursive: true });
});

test("a file that cannot be opened for another reason is not set aside", () => {
  let setAside = 0;
  assert.throws(
    () => openOrSetAside(() => { throw fsError("EBUSY"); }, () => String(++setAside)),
    /EBUSY/
  );
  assert.equal(setAside, 0);
});

const config = { theme: "dark", notifications: true, media: true, sound: true, color: null, spellChecker: true };

test("the tab list is rebuilt from the account folders, without the tabs the user closed", () => {
  const tabs = tabsFromPartitionFolders(
    ["smokerebuiltbeta02", "smokerebuiltclosed3", "smokerebuiltalfa01"],
    ["SmokeRebuiltClosed3"]
  );
  assert.deepEqual(
    tabs.map(({ id, name, config }) => ({ id, name, config })),
    [
      { id: "smokerebuiltalfa01", name: "Account 1", config },
      { id: "smokerebuiltbeta02", name: "Account 2", config },
    ]
  );
  // Main accepts the rebuilt list (R03).
  assert.equal(isValidTabStoreValue("tabs", tabs), true);
});

test("folders that cannot be a tab's are skipped", () => {
  const tabs = tabsFromPartitionFolders(["Upper", "a.b", "", "x".repeat(65), "smokealfa"], []);
  assert.deepEqual(tabs.map((tab) => tab.id), ["smokealfa"]);
});

test("an unreadable closed-tab list hides no account", () => {
  const tabs = tabsFromPartitionFolders(["smokealfa", "smokebeta"], null);
  assert.deepEqual(tabs.map((tab) => tab.name), ["Account 1", "Account 2"]);
});

test("no account folders give no tabs (the window then opens a new one)", () => {
  assert.deepEqual(tabsFromPartitionFolders([], []), []);
  assert.deepEqual(tabsFromPartitionFolders(["smokeclosed"], ["smokeClosed"]), []);
});
