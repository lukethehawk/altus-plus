import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/** Every .ts and .tsx file under src/, but the preload that defines the listeners. */
const windowSources = () => {
  const texts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(entry.name) && entry.name !== "preload.ts") texts.push(fs.readFileSync(file, "utf8"));
    }
  };
  walk(path.join(root, "src"));
  return texts.join("\n");
};

// A misspelt channel would leave its menu item doing nothing, with no error.
test("every menu item that asks the window reaches a listener the window uses", () => {
  const channels = [...read("src/main.ts").matchAll(/sendToWindow\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(channels.length >= 14, `only ${channels.length} menu items found`);
  // The preload's listeners: `onOpenSettings: (callback) => on("open-settings", callback)`.
  const listeners = new Map(
    [...read("src/preload.ts").matchAll(/(\w+): \(callback\) => on\("([^"]+)"/g)].map((match) => [match[2], match[1]])
  );
  const sources = windowSources();
  for (const channel of channels) {
    const listener = listeners.get(channel);
    assert.ok(listener, `no listener in src/preload.ts for "${channel}"`);
    assert.ok(sources.includes(`electronIPCHandlers.${listener}(`), `the window never calls ${listener} ("${channel}")`);
  }
});
