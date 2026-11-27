import test from "node:test";
import assert from "node:assert/strict";
import { SERVICES, isServiceURL, serviceOfURL } from "../src/utils/services.ts";

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

test("the service of an address", () => {
  assert.equal(serviceOfURL("https://web.whatsapp.com"), "whatsapp");
  assert.equal(serviceOfURL("https://web.whatsapp.com/send?phone=1"), "whatsapp");
  for (const value of [...lookalikes("web.whatsapp.com"), "https://example.org/", undefined, null, 42, {}]) {
    assert.equal(serviceOfURL(value), undefined, String(value));
  }
});

test("every service is reached over https on its own host", () => {
  for (const [id, service] of Object.entries(SERVICES)) {
    assert.match(service.host, /^[a-z0-9.-]+$/, id);
    assert.equal(serviceOfURL(`https://${service.host}/`), id);
  }
});
