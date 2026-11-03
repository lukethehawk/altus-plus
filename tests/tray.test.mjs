import test from "node:test";
import assert from "node:assert/strict";
import { formatTrayTooltip, TRAY_TOOLTIP_MAX_LENGTH } from "../src/utils/tray.ts";

const account = (name, unread = 0, muted = false) => ({ name, unread, muted });

test("lists every account in tab order under the app name", () => {
  assert.equal(
    formatTrayTooltip(
      "Altus +",
      [account("Lavoro", 3), account("Personale"), account("Casa", 1, true)],
      "silenziato"
    ),
    "Altus +\nLavoro: 3\nPersonale: 0\nCasa: 1 (silenziato)"
  );
  assert.equal(formatTrayTooltip("Altus +", [], "muted"), "Altus +");
});

test("shows invalid counts as zero", () => {
  for (const unread of [-1, 1.5, Number.NaN, undefined, "4"]) {
    assert.equal(
      formatTrayTooltip("Altus +", [account("Lavoro", unread)], "muted"),
      "Altus +\nLavoro: 0",
      String(unread)
    );
  }
});

test("keeps account names on one line and without text direction overrides", () => {
  assert.equal(
    formatTrayTooltip("Altus +", [account("  Lavoro\n\tUfficio\u0000 ")], "muted"),
    "Altus +\nLavoro Ufficio: 0"
  );
  assert.equal(
    formatTrayTooltip("Altus +", [account("\u202eorovaL\u202c")], "muted"),
    "Altus +\norovaL: 0"
  );
  assert.equal(formatTrayTooltip("Altus +", [account("Lavoro\u2028Casa")], "muted"), "Altus +\nLavoro Casa: 0");
});

test("names an account without a name by its position", () => {
  assert.equal(
    formatTrayTooltip("Altus +", [account("Lavoro"), account(" \n ")], "muted"),
    "Altus +\nLavoro: 0\n#2: 0"
  );
});

test("shortens long names without splitting characters", () => {
  const [, line] = formatTrayTooltip("Altus +", [account("A".repeat(40), 2)], "muted").split("\n");
  assert.equal(line, `${"A".repeat(19)}…: 2`);
  const emoji = "😀".repeat(30);
  const [, emojiLine] = formatTrayTooltip("Altus +", [account(emoji)], "muted").split("\n");
  assert.equal(emojiLine, `${"😀".repeat(19)}…: 0`);
  assert.doesNotMatch(emojiLine, /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test("fits the Windows limit by dropping whole lines", () => {
  const name = "N".repeat(40);
  const accounts = Array.from({ length: 6 }, () => account(name, 99999, true));
  const text = formatTrayTooltip("Altus +", accounts, "silenziato");
  assert.ok(text.length <= TRAY_TOOLTIP_MAX_LENGTH, `${text.length} characters`);
  const lines = text.split("\n");
  assert.equal(lines.at(-1), "…");
  assert.ok(lines.length < accounts.length + 1);
  for (const line of lines.slice(1, -1)) assert.match(line, /^N{19}…: 99999 \(silenziato\)$/);
});

test("three accounts fit in full with long names, mute labels and four-digit counts", () => {
  for (const mutedLabel of ["muted", "silenziato"]) {
    const accounts = ["Lavoro", "Personale", "Casa"].map((name) => account(name.padEnd(40, "x"), 9999, true));
    const text = formatTrayTooltip("Altus +", accounts, mutedLabel);
    assert.ok(text.length <= TRAY_TOOLTIP_MAX_LENGTH, `${mutedLabel}: ${text.length}`);
    assert.equal(text.split("\n").length, 4, text);
    assert.ok(text.endsWith(`(${mutedLabel})`), text);
  }
});

test("typical names fit without dropping anything", () => {
  const accounts = [account("Lavoro", 12, true), account("Personale", 3), account("Famiglia", 0, true)];
  const text = formatTrayTooltip("Altus +", accounts, "silenziato");
  assert.equal(text.split("\n").length, 4);
  assert.ok(!text.includes("…"));
});
