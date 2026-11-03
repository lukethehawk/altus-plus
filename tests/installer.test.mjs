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
// installer (System.dll access violation); .yarn/patches applies the fix.
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
