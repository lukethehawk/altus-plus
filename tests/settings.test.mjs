import test from "node:test";
import assert from "node:assert/strict";
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

const { DefaultSettingValues, SettingsSchema, getDefaultSettings } =
  await import("../src/stores/settings/common.ts");

// main.ts validates each "settings-store-set" call with
// SettingsSchema.shape[key].safeParse({ value }).
const accepts = (key, value) =>
  SettingsSchema.shape[key].safeParse({ value }).success;

test("the default settings match the schema", () => {
  assert.equal(SettingsSchema.safeParse(getDefaultSettings()).success, true);
  for (const [key, value] of Object.entries(DefaultSettingValues)) {
    assert.equal(accepts(key, value), true, key);
  }
});

test("accepts valid values for each kind of setting", () => {
  assert.equal(accepts("trayIcon", false), true);
  assert.equal(accepts("tabBarPosition", "bottom"), true);
  assert.equal(accepts("language", "it"), true);
  assert.equal(accepts("defaultDownloadDir", "C:\\Downloads"), true);
});

test("rejects values of the wrong type or outside the allowed set", () => {
  assert.equal(accepts("trayIcon", "yes"), false);
  assert.equal(accepts("tabBarPosition", "left"), false);
  assert.equal(accepts("language", "de"), false);
  assert.equal(accepts("defaultDownloadDir", 42), false);
  assert.equal(SettingsSchema.shape.trayIcon.safeParse({}).success, false);
  assert.equal(SettingsSchema.shape.trayIcon.safeParse(null).success, false);
});

test("tabs cannot be moved by dragging until the user allows it", () => {
  assert.equal(DefaultSettingValues.tabReordering, false);
  assert.equal(accepts("tabReordering", true), true);
  assert.equal(accepts("tabReordering", "true"), false);
});
