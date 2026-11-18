// Drives src/utils/webview/formatSelectedText.ts (Ctrl+B/I/S/M in a WhatsApp
// tab) in a real Electron page shaped like a WhatsApp Web chat: a received
// message and the message being written (#main footer div[contenteditable]).
// Run with `yarn test:keys` (needs a desktop session; Windows in CI).
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

const root = path.resolve(import.meta.dirname, "../..");
// The page runs the module as a plain script: types stripped, imports and
// exports dropped (escapeHtml, included first, is its only import).
const script = ["src/utils/escapeHtml.ts", "src/utils/webview/formatSelectedText.ts"]
  .map((file) => stripTypeScriptTypes(fs.readFileSync(path.join(root, file), "utf8")))
  .join("\n")
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "");

const chat = `<div id="main">
  <div id="received"><span>ciao mondo</span></div>
  <footer><div contenteditable="true"><p><span>bozza testo</span></p></div></footer>
</div>`;
const received = "#received span";
const draft = "footer span";

// [name, selection from [element, offset] to [element, offset], wrapper, texts afterwards]
const cases = [
  ["Ctrl+B on a word of a received message: nothing changes", [received, 5], [received, 10], "*",
    { received: "ciao mondo", draft: "bozza testo" }],
  ["Ctrl+B from a received message into the draft: nothing changes", [received, 5], [draft, 5], "*",
    { received: "ciao mondo", draft: "bozza testo" }],
  ["Ctrl+B on a word of the draft: bold", [draft, 6], [draft, 11], "*",
    { received: "ciao mondo", draft: "bozza *testo*" }],
  ["Ctrl+I on a word of the draft: italic", [draft, 0], [draft, 5], "_",
    { received: "ciao mondo", draft: "_bozza_ testo" }],
  ["Ctrl+S on the whole draft: strikethrough", [draft, 0], [draft, 11], "~",
    { received: "ciao mondo", draft: "~bozza testo~" }],
  ["Ctrl+M on a word of the draft: monospace", [draft, 6], [draft, 11], "```",
    { received: "ciao mondo", draft: "bozza ```testo```" }],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Never hang a CI job.
setTimeout(() => {
  console.log("FAIL timed out");
  app.exit(1);
}, 60_000).unref();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 200, show: true });
  await win.loadURL("data:text/html,<body></body>");
  // Ends with undefined: a function cannot travel back from the page.
  await win.webContents.executeJavaScript(`${script}\nwindow.formatSelectedText = formatSelectedText;\nundefined;`);

  let failed = 0;
  for (const [name, [startElement, startOffset], [endElement, endOffset], wrapper, expected] of cases) {
    await win.webContents.executeJavaScript(`(() => {
      document.body.innerHTML = ${JSON.stringify(chat)};
      const range = document.createRange();
      range.setStart(document.querySelector(${JSON.stringify(startElement)}).firstChild, ${startOffset});
      range.setEnd(document.querySelector(${JSON.stringify(endElement)}).firstChild, ${endOffset});
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      formatSelectedText(${JSON.stringify(wrapper)});
    })()`);
    // The draft is rewritten in timeouts.
    await sleep(100);
    const got = await win.webContents.executeJavaScript(`({
      received: document.querySelector("#received").textContent,
      draft: document.querySelector("footer [contenteditable]").textContent,
    })`);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
  }
  console.log(failed ? `${failed} case(s) failed` : "all cases passed");
  app.exit(failed ? 1 : 0);
}).catch((error) => {
  console.log(`FAIL ${error.message}`);
  app.exit(1);
});
