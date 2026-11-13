import test from "node:test";
import assert from "node:assert/strict";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_TICK_MS,
  isUpdateCheckDue,
} from "../src/utils/updates.ts";

const HOUR = 60 * 60 * 1000;
const start = Date.UTC(2026, 10, 13, 8, 0, 0);

test("a running app checks again every 6 hours, looking every hour", () => {
  assert.equal(UPDATE_CHECK_INTERVAL_MS, 6 * HOUR);
  assert.equal(UPDATE_CHECK_TICK_MS, HOUR);
});

test("a check is due only once the last one is 6 hours old", () => {
  assert.equal(isUpdateCheckDue(start, start), false);
  assert.equal(isUpdateCheckDue(start, start + 5 * HOUR), false);
  assert.equal(isUpdateCheckDue(start, start + 6 * HOUR - 1), false);
  assert.equal(isUpdateCheckDue(start, start + 6 * HOUR), true);
  // A PC that slept overnight checks at the first look after waking up.
  assert.equal(isUpdateCheckDue(start, start + 14 * HOUR), true);
});

test("never checked, or a clock moved back, counts as due", () => {
  assert.equal(isUpdateCheckDue(null, start), true);
  assert.equal(isUpdateCheckDue(start, start - HOUR), true);
});

test("the interval can be shortened for local update tests", () => {
  assert.equal(isUpdateCheckDue(start, start + 59_000, 60_000), false);
  assert.equal(isUpdateCheckDue(start, start + 60_000, 60_000), true);
});
