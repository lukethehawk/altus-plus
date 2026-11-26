import test from "node:test";
import assert from "node:assert/strict";
import {
  getSafeExternalHttpURL,
  isAllowedWebview,
  isAltusPartition,
  isTrustedWhatsAppURL,
  isWhatsAppPage,
  lockDownWebview,
  onlyFromSender,
} from "../src/utils/security.ts";

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

test("messages from WhatsApp tabs", () => {
  const sender = (type, url) => ({ getType: () => type, getURL: () => url });
  assert.equal(isWhatsAppPage(sender("webview", "https://web.whatsapp.com/")), true);
  for (const [type, url] of [
    ["window", "https://web.whatsapp.com/"], // the app window, even showing WhatsApp
    ["webview", "https://example.org/"], // a tab that left WhatsApp
    ["webview", "http://web.whatsapp.com/"],
    ["webview", "about:blank"],
    ["webview", ""],
  ]) {
    assert.equal(isWhatsAppPage(sender(type, url)), false, `${type} ${url}`);
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

test("the window attaches only WhatsApp tabs in their own partition", () => {
  assert.equal(isAllowedWebview("https://web.whatsapp.com/", "persist:smokeAlfaTab000000001"), true);
  for (const [src, partition] of [
    ["https://example.org/", "persist:smokeAlfaTab000000001"],
    ["http://web.whatsapp.com/", "persist:smokeAlfaTab000000001"],
    ["https://web.whatsapp.com/", "persist:../smokeEscape"],
    ["https://web.whatsapp.com/", "smokeAlfaTab000000001"], // in memory only
    ["https://web.whatsapp.com/", ""],
    ["https://web.whatsapp.com/", undefined],
    [undefined, "persist:smokeAlfaTab000000001"],
  ]) {
    assert.equal(isAllowedWebview(src, partition), false, `${src} in ${partition}`);
  }
});

test("every WhatsApp tab runs sandboxed, without Node.js, with our preload", () => {
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
