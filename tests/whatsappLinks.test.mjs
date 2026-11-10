import test from "node:test";
import assert from "node:assert/strict";
import {
  findWhatsAppLink,
  whatsAppWebAddress,
  describeWhatsAppWebAddress,
} from "../src/utils/whatsappLinks.ts";
import { isTrustedWhatsAppURL } from "../src/utils/security.ts";

test("finds the link among the arguments Windows passes", () => {
  const exe = "C:\\Users\\a\\AppData\\Local\\Programs\\altus-plus\\Altus +.exe";
  assert.equal(findWhatsAppLink([exe, "--", "whatsapp://send?phone=393331234567"]), "whatsapp://send?phone=393331234567");
  assert.equal(findWhatsAppLink([exe, "--", "WhatsApp://send?phone=1"]), "WhatsApp://send?phone=1");
  // Paths or switches that merely contain the word are not links.
  assert.equal(findWhatsAppLink([exe, "--user-data-dir=C:\\whatsapp-test", "C:\\whatsapp\\x"]), null);
  assert.equal(findWhatsAppLink([exe, "--hidden"]), null);
});

test("chat links become WhatsApp Web chats", () => {
  const cases = [
    ["whatsapp://send?phone=393331234567", "https://web.whatsapp.com/send?phone=393331234567"],
    ["whatsapp://send/?phone=393331234567&text=Ciao%20Luca&type=phone_number&app_absent=0",
      "https://web.whatsapp.com/send?phone=393331234567&text=Ciao+Luca"],
    ["whatsapp://send?phone=+39%20333%20123-4567", "https://web.whatsapp.com/send?phone=393331234567"],
    ["WHATSAPP://SEND?phone=12345", "https://web.whatsapp.com/send?phone=12345"],
    // Share buttons: a message without a number, the person picks the chat.
    ["whatsapp://send?text=Guarda%20qui%20https%3A%2F%2Fexample.org", "https://web.whatsapp.com/send?text=Guarda+qui+https%3A%2F%2Fexample.org"],
  ];
  for (const [link, address] of cases) {
    assert.equal(whatsAppWebAddress(link), address, link);
    assert.ok(isTrustedWhatsAppURL(address), address);
  }
});

test("group invites become WhatsApp Web invites", () => {
  assert.equal(whatsAppWebAddress("whatsapp://chat?code=AbCdEf123456GhIj"), "https://web.whatsapp.com/accept?code=AbCdEf123456GhIj");
  assert.equal(whatsAppWebAddress("whatsapp://chat/?code=AbCdEf123456GhIj"), "https://web.whatsapp.com/accept?code=AbCdEf123456GhIj");
});

test("anything else is refused", () => {
  const refused = [
    "whatsapp://send",
    "whatsapp://send?phone=",
    "whatsapp://send?phone=abc",
    "whatsapp://send?phone=1234",
    "whatsapp://send?phone=1234567890123456",
    "whatsapp://send?phone=39333&phone=x",
    `whatsapp://send?text=${"a".repeat(4097)}`,
    `whatsapp://send?phone=393331234567&x=${"a".repeat(9000)}`,
    "whatsapp://chat?code=short",
    "whatsapp://chat?code=AbCdEf123456%2F..%2Fx",
    "whatsapp://chat?code=AbCdEf123456GhIj&code=x",
    "whatsapp://call?phone=393331234567",
    "whatsapp://send/../../evil?phone=393331234567",
    "whatsapp://send/extra?phone=393331234567",
    "whatsapp://user:pass@send?phone=393331234567",
    "whatsapp://send:8080?phone=393331234567",
    "whatsapp://send?phone=393331234567#x",
    "whatsapp:send?phone=393331234567",
    "https://web.whatsapp.com/send?phone=393331234567",
    "javascript:alert(1)",
    "whatsapp://javascript:alert(1)",
    "--inspect=9229",
    "",
    "not a link",
  ];
  for (const link of refused) assert.equal(whatsAppWebAddress(link), null, link);
  assert.equal(whatsAppWebAddress(undefined), null);
  assert.equal(whatsAppWebAddress(42), null);
});

test("describes what an address opens", () => {
  assert.deepEqual(describeWhatsAppWebAddress("https://web.whatsapp.com/send?phone=393331234567&text=Ciao"),
    { kind: "chat", phone: "393331234567", text: "Ciao" });
  assert.deepEqual(describeWhatsAppWebAddress("https://web.whatsapp.com/send?text=Ciao"),
    { kind: "chat", phone: null, text: "Ciao" });
  assert.deepEqual(describeWhatsAppWebAddress("https://web.whatsapp.com/accept?code=AbCdEf123456GhIj"), { kind: "group" });
  for (const address of ["https://evil.example/send?phone=1", "https://web.whatsapp.com/", "nonsense"]) {
    assert.equal(describeWhatsAppWebAddress(address), null, address);
  }
});
