import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVICES,
  isServiceOrigin,
  isServiceURL,
  serviceOfIndexedDBFolders,
  serviceOfTab,
  serviceOfURL,
} from "../src/utils/services.ts";

// Addresses that must never count as a service's pages, whatever the host.
const lookalikes = (host) => [
  `http://${host}/`, // not https
  `https://${host}:8443/`, // another port
  `https://${host}.evil.example/`,
  `https://evil-${host}/`,
  `https://evil.example/?next=${host}`,
  `https://evil.example/${host}`,
  `https://user@evil.example/@${host}`,
  `file:///${host}`,
  `wss://${host}/`,
  "about:blank",
  "",
  "not a url",
];

test("WhatsApp Web pages", () => {
  for (const value of [
    "https://web.whatsapp.com",
    "https://web.whatsapp.com/",
    "https://web.whatsapp.com:443/",
    "https://WEB.WhatsApp.com/send?phone=393331234567",
    "https://web.whatsapp.com/accept?code=AbCdEf123456GhIj",
  ]) {
    assert.equal(isServiceURL("whatsapp", value), true, value);
  }
  for (const value of lookalikes("web.whatsapp.com")) {
    assert.equal(isServiceURL("whatsapp", value), false, value);
  }
  for (const value of ["https://whatsapp.com/", "https://wa.me/393331234567", "https://api.whatsapp.com/send"]) {
    assert.equal(isServiceURL("whatsapp", value), false, value);
  }
});

test("Telegram Web pages: the K version only", () => {
  for (const value of [
    "https://web.telegram.org/k/",
    "https://web.telegram.org/k", // redirected to /k/ by the server
    "https://web.telegram.org:443/k/",
    "https://WEB.Telegram.org/k/#@telegram",
    "https://web.telegram.org/k/?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3Dtelegram",
  ]) {
    assert.equal(isServiceURL("telegram", value), true, value);
    assert.equal(isServiceOrigin("telegram", value), true, value);
  }
  // The rest of the host: not a tab's page, but the service's own site.
  for (const value of [
    "https://web.telegram.org/",
    "https://web.telegram.org/a/",
    "https://web.telegram.org/kk/",
    "https://web.telegram.org/K/",
    "https://web.telegram.org/z/",
  ]) {
    assert.equal(isServiceURL("telegram", value), false, value);
    assert.equal(isServiceOrigin("telegram", value), true, value);
  }
  for (const value of [...lookalikes("web.telegram.org"), ...lookalikes("web.telegram.org").map((url) => `${url}k/`)]) {
    assert.equal(isServiceURL("telegram", value), false, value);
    assert.equal(isServiceOrigin("telegram", value), false, value);
  }
  for (const value of ["https://telegram.org/", "https://t.me/telegram", "https://web.whatsapp.com/k/"]) {
    assert.equal(isServiceURL("telegram", value), false, value);
    assert.equal(isServiceOrigin("telegram", value), false, value);
  }
  // A permission check names the origin only.
  assert.equal(isServiceOrigin("telegram", "https://web.telegram.org"), true);
  assert.equal(isServiceOrigin("whatsapp", "https://web.telegram.org"), false);
  assert.equal(isServiceOrigin("telegram", "https://web.whatsapp.com"), false);
});

test("the service of an address", () => {
  assert.equal(serviceOfURL("https://web.whatsapp.com"), "whatsapp");
  assert.equal(serviceOfURL("https://web.whatsapp.com/send?phone=1"), "whatsapp");
  assert.equal(serviceOfURL("https://web.telegram.org/k/"), "telegram");
  assert.equal(serviceOfURL("https://web.telegram.org/a/"), undefined);
  assert.equal(serviceOfURL("https://web.telegram.org/"), undefined);
  for (const value of [...lookalikes("web.whatsapp.com"), ...lookalikes("web.telegram.org"), "https://example.org/", undefined, null, 42, {}]) {
    assert.equal(serviceOfURL(value), undefined, String(value));
  }
});

test("every service starts over https on its own host, on a page of its own", () => {
  for (const [id, service] of Object.entries(SERVICES)) {
    assert.match(service.host, /^[a-z0-9.-]+$/, id);
    if (service.path !== undefined) assert.match(service.path, /^\/[a-z0-9]+\/$/, id);
    assert.equal(new URL(service.start).protocol, "https:", id);
    assert.equal(new URL(service.start).hostname, service.host, id);
    assert.equal(serviceOfURL(service.start), id);
  }
});

test("a saved tab without a known service shows WhatsApp", () => {
  assert.equal(serviceOfTab({ id: "smokeTelegram00000001", service: "telegram" }), "telegram");
  assert.equal(serviceOfTab({ id: "smokeWhatsApp00000001", service: "whatsapp" }), "whatsapp");
  // Earlier versions, the original Altus, a later version's service, nonsense.
  for (const tab of [
    { id: "smokeAlfaTab000000001" },
    { id: "smokeAlfaTab000000001", service: "signal" },
    { id: "smokeAlfaTab000000001", service: "TELEGRAM" },
    { id: "smokeAlfaTab000000001", service: "__proto__" },
    { id: "smokeAlfaTab000000001", service: "toString" },
    { id: "smokeAlfaTab000000001", service: 5 },
    { id: "smokeAlfaTab000000001", service: { telegram: true } },
    { id: "smokeAlfaTab000000001", service: null },
    null,
    undefined,
    "telegram",
  ]) {
    assert.equal(serviceOfTab(tab), "whatsapp", JSON.stringify(tab));
  }
});

test("an account folder's service, from the names of its IndexedDB folders", () => {
  const telegram = "https_web.telegram.org_0.indexeddb.leveldb";
  const whatsapp = "https_web.whatsapp.com_0.indexeddb.leveldb";
  assert.equal(serviceOfIndexedDBFolders([telegram]), "telegram");
  assert.equal(serviceOfIndexedDBFolders([telegram, "https_web.telegram.org_0.indexeddb.blob"]), "telegram");
  assert.equal(serviceOfIndexedDBFolders([telegram.toUpperCase()]), "telegram");
  // WhatsApp's, both, none, or only lookalikes: WhatsApp, as before services.
  for (const folders of [
    [whatsapp],
    [whatsapp, telegram],
    [],
    ["https_web.telegram.org.evil.example_0.indexeddb.leveldb"],
    ["http_web.telegram.org_0.indexeddb.leveldb"],
  ]) {
    assert.equal(serviceOfIndexedDBFolders(folders), "whatsapp", folders.join(", "));
  }
});
