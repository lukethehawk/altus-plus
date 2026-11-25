import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the window shows the app's own name", () => {
  // The window page cannot import APP_NAME: isolation.ts runs in main.
  const name = read("src/utils/isolation.ts").match(/APP_NAME = "([^"]+)"/)?.[1];
  assert.equal(name, "Altus +");
  assert.ok(read("index.html").includes(`<title>${name}</title>`), "index.html <title>");
  assert.ok(read("src/components/CustomTitlebar.tsx").includes(`>${name}</div>`), "custom title bar");
});
