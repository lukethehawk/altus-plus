import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../src/utils/escapeHtml.ts";

// Ctrl+B/I/S put the message box's text back as HTML (formatSelectedText.ts).
test("text placed back as HTML stays text", () => {
  assert.equal(escapeHtml("*ciao*"), "*ciao*");
  assert.equal(escapeHtml(`*<img src=x onerror="alert(1)">*`), "*&lt;img src=x onerror=&quot;alert(1)&quot;&gt;*");
  assert.equal(escapeHtml("a & b < c > d ' e"), "a &amp; b &lt; c &gt; d &#39; e");
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
  assert.equal(escapeHtml(""), "");
});
