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

const { isValidTabStoreValue, isValidThemeStoreValue, usableTabs } = await import(
  "../src/utils/storeValidation.ts"
);
const { ThemeStoreDefaults } = await import("../src/stores/themes/common.ts");

const config = { theme: "dark", notifications: true, media: true, sound: true, color: null, spellChecker: true };
// As the window saves them (getDefaultTab), and as the smoke test seeds them.
const alfa = { id: "smokeAlfaTab000000001", name: "Alfa", messageCount: 0, config };
const beta = { id: "V1StGXR8_Z5jdHi6B-myT", name: "Beta", messageCount: 0, config: { ...config, color: "#7289da" } };
const muted = { ...beta, id: "smokeGammaTab00000003", config: { ...config, notificationsMutedUntil: Number.MAX_SAFE_INTEGER } };

const tabsOk = (tabs) => isValidTabStoreValue("tabs", tabs);

test("tab lists the window saves are accepted", () => {
  assert.equal(tabsOk([]), true);
  assert.equal(tabsOk([alfa, beta, muted]), true);
  assert.equal(tabsOk([{ ...alfa, config: { ...config, notificationsMutedUntil: 1_800_000_000_000 } }]), true);
  assert.equal(tabsOk([{ ...alfa, name: "" }]), true);
});

test("tabs saved by earlier versions and by the original Altus are accepted", () => {
  // No Microphone and Camera switch yet (the window fills it in), no spell checker.
  const { media, spellChecker, ...older } = config;
  assert.equal(tabsOk([{ ...alfa, config: older }]), true);
  // Infinity, saved as JSON, came back as null.
  assert.equal(tabsOk([{ ...alfa, config: { ...config, notificationsMutedUntil: null } }]), true);
  // Fields this version does not know are kept.
  assert.equal(tabsOk([{ ...alfa, smokeExtra: 1, config: { ...config, zoom: 1.2 } }]), true);
  assert.equal(tabsOk([{ ...alfa, messageCount: undefined }]), true);
  assert.equal(tabsOk([{ id: alfa.id, name: "Alfa" }]), true);
  assert.equal(tabsOk([{ ...alfa, config: { ...config, theme: undefined, color: undefined } }]), true);
});

test("tab IDs that could not name a partition folder are refused", () => {
  for (const id of ["../smokeEscape", "a/b", "a\\b", "a.b", "a b", "", "x".repeat(65), 42, null, undefined]) {
    assert.equal(tabsOk([alfa, { ...beta, id }]), false, JSON.stringify(id));
  }
  assert.equal(tabsOk([{ ...beta, id: "x".repeat(64) }]), true);
});

test("the same account twice is refused, also when only the case differs", () => {
  assert.equal(tabsOk([alfa, beta, alfa]), false);
  // Chromium lower-cases partition folder names.
  assert.equal(tabsOk([alfa, { ...beta, id: alfa.id.toUpperCase() }]), false);
});

test("tab lists of the wrong shape are refused", () => {
  for (const value of [undefined, null, "smoke", 42, {}, { 0: alfa }, [null], ["smoke"], [[alfa]]]) {
    assert.equal(tabsOk(value), false, JSON.stringify(value));
  }
  assert.equal(tabsOk([{ ...alfa, name: 42 }]), false);
  assert.equal(tabsOk([{ ...alfa, name: undefined }]), false);
  assert.equal(tabsOk([{ ...alfa, name: "x".repeat(501) }]), false);
  assert.equal(tabsOk([{ ...alfa, config: "smoke" }]), false);
  assert.equal(tabsOk([{ ...alfa, config: { ...config, notifications: "yes" } }]), false);
  assert.equal(tabsOk([{ ...alfa, config: { ...config, media: 1 } }]), false);
  assert.equal(tabsOk([{ ...alfa, config: { ...config, notificationsMutedUntil: "forever" } }]), false);
  assert.equal(tabsOk([{ ...alfa, config: { ...config, color: { r: 1 } } }]), false);
  assert.equal(tabsOk([{ ...alfa, config: { ...config, theme: "x".repeat(65) } }]), false);
});

test("the selected tab is a tab ID or nothing", () => {
  assert.equal(isValidTabStoreValue("selectedTabId", alfa.id), true);
  assert.equal(isValidTabStoreValue("selectedTabId", undefined), true);
  for (const value of [42, null, "", "../smokeEscape", { id: alfa.id }]) {
    assert.equal(isValidTabStoreValue("selectedTabId", value), false, JSON.stringify(value));
  }
});

test("the last closed tab is a tab, null or nothing", () => {
  assert.equal(isValidTabStoreValue("previouslyClosedTab", alfa), true);
  assert.equal(isValidTabStoreValue("previouslyClosedTab", null), true);
  assert.equal(isValidTabStoreValue("previouslyClosedTab", undefined), true);
  for (const value of [{ name: "Smoke" }, { ...alfa, id: "../smokeEscape" }, "smoke", [alfa]]) {
    assert.equal(isValidTabStoreValue("previouslyClosedTab", value), false, JSON.stringify(value));
  }
});

test("other tab store keys are refused", () => {
  assert.equal(isValidTabStoreValue("smoke", []), false);
  assert.equal(isValidTabStoreValue("__proto__", []), false);
  assert.equal(isValidTabStoreValue(undefined, undefined), false);
});

const themesOk = (themes) => isValidThemeStoreValue("themes", themes);

test("theme lists the window saves are accepted", () => {
  const defaults = ThemeStoreDefaults().themes;
  assert.equal(themesOk(defaults), true);
  assert.equal(themesOk([]), true);
  // As the theme dialog saves them: colors or CSS, the other one undefined.
  const simple = { id: "V1StGXR8_Z5jdHi6B-myT", name: "Mint", colors: { bg: "#10151E", fg: "#eeeeee", ac: "#40C486" }, css: undefined };
  const css = { id: "Uakgb_J5m9g-0JDMbcJqL", name: "Custom", colors: undefined, css: "body { color: red; }\n".repeat(1000) };
  assert.equal(themesOk([...defaults, simple, css]), true);
  // Fields of earlier versions and of the original Altus.
  assert.equal(themesOk([{ id: "old", name: "Old", customCSS: true, preset: "dark", css: "", smokeExtra: 1 }]), true);
});

test("theme lists of the wrong shape are refused", () => {
  for (const value of [undefined, null, "smoke", {}, [null], ["dark"]]) {
    assert.equal(themesOk(value), false, JSON.stringify(value));
  }
  for (const theme of [
    { name: "Smoke" },
    { id: "", name: "Smoke" },
    { id: 42, name: "Smoke" },
    { id: "x".repeat(65), name: "Smoke" },
    { id: "smoke" },
    { id: "smoke", name: 42 },
    { id: "smoke", name: "Smoke", css: 42 },
    { id: "smoke", name: "Smoke", css: "x".repeat(1_000_001) },
    { id: "smoke", name: "Smoke", colors: { bg: "#000000", fg: "#ffffff" } },
    { id: "smoke", name: "Smoke", colors: "dark" },
    { id: "smoke", name: "Smoke", customCSS: "yes" },
  ]) {
    assert.equal(themesOk([theme]), false, JSON.stringify(theme).slice(0, 100));
  }
  assert.equal(isValidThemeStoreValue("smoke", []), false);
});

test("main reads only tabs with an ID, from a list", () => {
  assert.deepEqual(usableTabs(undefined), []);
  assert.deepEqual(usableTabs("smoke"), []);
  assert.deepEqual(usableTabs({ 0: alfa }), []);
  assert.deepEqual(usableTabs([alfa, null, "smoke", { name: "No ID" }, { ...beta, id: "../smokeEscape" }, beta]), [alfa, beta]);
  // Whatever else a saved tab holds is left to the readers, as before.
  const odd = { id: alfa.id, name: 42, config: "smoke" };
  assert.deepEqual(usableTabs([odd]), [odd]);
});
