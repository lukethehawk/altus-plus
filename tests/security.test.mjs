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
          if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return next(specifier + ".ts", context);
          }
          throw error;
        }
      }`)
);

const {
  getSafeExternalHttpURL,
  isAltusPartition,
  isServicePage,
  isTrustedWhatsAppURL,
  lockDownWebview,
  onlyFromSender,
  webviewService,
} = await import("../src/utils/security.ts");

test("IPC external URL validation", () => {
  assert.equal(getSafeExternalHttpURL("https://example.org/path?a=b"), "https://example.org/path?a=b");
  assert.equal(getSafeExternalHttpURL("http://example.org"), "http://example.org/");
  for (const value of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,test",
    "ms-settings:privacy", "https://user:secret@example.org", "https://", "not a url", null, 7]) {
    assert.equal(getSafeExternalHttpURL(value), null, String(value));
  }
});

test("WhatsApp Web origin allow-list", () => {
  assert.equal(isTrustedWhatsAppURL("https://web.whatsapp.com/"), true);
  for (const value of ["https://web.whatsapp.com.evil.example",
    "http://web.whatsapp.com", "https://evil.example/?next=web.whatsapp.com",
    "file:///web.whatsapp.com", "not a url"]) {
    assert.equal(isTrustedWhatsAppURL(value), false, value);
  }
});

test("persistent partition IDs", () => {
  assert.equal(isAltusPartition("persist:AbC_-123"), true);
  for (const value of ["persist:../../secret", "persist:", "temporary", "persist:abc/def", 42, undefined]) {
    assert.equal(isAltusPartition(value), false, String(value));
  }
});

test("messages from a tab's own page", () => {
  const sender = (type, url) => ({ getType: () => type, getURL: () => url });
  assert.equal(isServicePage(sender("webview", "https://web.whatsapp.com/"), "whatsapp"), true);
  assert.equal(isServicePage(sender("webview", "https://web.telegram.org/k/#@telegram"), "telegram"), true);
  // A page of another service, or of the service's site outside its tabs' part.
  assert.equal(isServicePage(sender("webview", "https://web.whatsapp.com/"), "telegram"), false);
  assert.equal(isServicePage(sender("webview", "https://web.telegram.org/k/"), "whatsapp"), false);
  assert.equal(isServicePage(sender("webview", "https://web.telegram.org/a/"), "telegram"), false);
  // A session that is no tab's has no service: even a WhatsApp page in it.
  assert.equal(isServicePage(sender("webview", "https://web.whatsapp.com/"), undefined), false);
  for (const [type, url] of [
    ["window", "https://web.whatsapp.com/"], // the app window, even showing WhatsApp
    ["webview", "https://example.org/"], // a tab that left WhatsApp
    ["webview", "http://web.whatsapp.com/"],
    ["webview", "about:blank"],
    ["webview", ""],
  ]) {
    assert.equal(isServicePage(sender(type, url), "whatsapp"), false, `${type} ${url}`);
  }
});

test("invoke handlers answer only the app window", () => {
  const appWindow = { id: 1 };
  const calls = [];
  const handler = onlyFromSender(appWindow, "smoke-channel", (event, ...args) => {
    calls.push(args);
    return "answer";
  });
  assert.equal(handler({ sender: appWindow }, "key", 42), "answer");
  assert.deepEqual(calls, [["key", 42]]);
  for (const sender of [{ id: 1 }, { id: 2 }, undefined, null]) {
    assert.throws(() => handler({ sender }, "key", 42), /Unauthorized IPC sender for smoke-channel/);
  }
  assert.equal(calls.length, 1, "the listener ran for another sender");
});

test("the window attaches only tabs of a service, in their own partition", () => {
  assert.equal(webviewService("https://web.whatsapp.com/", "persist:smokeAlfaTab000000001"), "whatsapp");
  assert.equal(webviewService("https://web.whatsapp.com", "persist:smokeAlfaTab000000001"), "whatsapp");
  assert.equal(webviewService("https://web.telegram.org/k/", "persist:smokeTelegram00000001"), "telegram");
  for (const [src, partition] of [
    ["https://web.telegram.org/a/", "persist:smokeTelegram00000001"],
    ["https://web.telegram.org/", "persist:smokeTelegram00000001"],
    ["https://web.telegram.org/k/", "persist:../smokeEscape"],
    ["https://example.org/", "persist:smokeAlfaTab000000001"],
    ["http://web.whatsapp.com/", "persist:smokeAlfaTab000000001"],
    ["https://web.whatsapp.com/", "persist:../smokeEscape"],
    ["https://web.whatsapp.com/", "smokeAlfaTab000000001"], // in memory only
    ["https://web.whatsapp.com/", ""],
    ["https://web.whatsapp.com/", undefined],
    [undefined, "persist:smokeAlfaTab000000001"],
  ]) {
    assert.equal(webviewService(src, partition), undefined, `${src} in ${partition}`);
  }
});

test("every tab runs sandboxed, without Node.js, with our preload", () => {
  // What a window could ask for with the webview's attributes.
  const webPreferences = {
    preload: "C:\\smoke\\other.js",
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    contextIsolation: false,
    sandbox: false,
    spellcheck: true,
  };
  lockDownWebview(webPreferences, "C:\\app\\whatsapp.preload.cjs");
  assert.deepEqual(webPreferences, {
    preload: "C:\\app\\whatsapp.preload.cjs",
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    spellcheck: true,
  });
  const unset = {};
  lockDownWebview(unset, "preload.cjs");
  assert.deepEqual(unset, {
    preload: "preload.cjs",
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
  });
});
