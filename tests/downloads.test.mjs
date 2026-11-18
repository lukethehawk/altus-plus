import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isFullFolderPath } from "../src/utils/downloads.ts";

const full = ["C:\\Users\\Luca\\Downloads", "d:/Scaricati", "C:\\", "\\\\nas\\condivisa", "\\\\nas\\condivisa\\Allegati", "//nas/condivisa"];
const notFull = ["", "Downloads", "Scaricati\\Allegati", "C:", "C:Downloads", "\\Downloads", "\\\\nas", "\\\\nas\\", " C:\\Users", ".\\Downloads", "..\\Downloads"];

test("a Windows download folder is used only when it is a full path", () => {
  for (const folder of full) assert.equal(isFullFolderPath(folder, "win32"), true, folder);
  for (const folder of notFull) assert.equal(isFullFolderPath(folder, "win32"), false, folder);
  for (const value of [undefined, null, 3, ["C:\\"]]) assert.equal(isFullFolderPath(value, "win32"), false, String(value));
});

test("every folder it accepts is one electron-dl accepts", () => {
  // electron-dl throws inside each download unless path.isAbsolute holds.
  for (const folder of full) assert.equal(path.win32.isAbsolute(folder), true, folder);
});

test("elsewhere a full path starts at the root", () => {
  assert.equal(isFullFolderPath("/Users/luca/Downloads", "darwin"), true);
  assert.equal(isFullFolderPath("Downloads", "linux"), false);
  assert.equal(isFullFolderPath("C:\\Users", "linux"), false);
});
