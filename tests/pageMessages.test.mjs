import test from "node:test";
import assert from "node:assert/strict";
import { MAX_UNREAD, MAX_ZOOM, MIN_ZOOM, nextZoomFactor, reportedUnreadCount } from "../src/utils/pageMessages.ts";

test("an unread count is taken only when plausible", () => {
  for (const count of [0, 1, 42, MAX_UNREAD]) {
    assert.equal(reportedUnreadCount({ messageCount: count }), count, String(count));
  }
  for (const detail of [
    { messageCount: -1 },
    { messageCount: MAX_UNREAD + 1 },
    { messageCount: 1.5 },
    { messageCount: Number.NaN },
    { messageCount: Infinity },
    { messageCount: "3" },
    { messageCount: null },
    {},
    3,
    "3",
    null,
    undefined,
  ]) {
    assert.equal(reportedUnreadCount(detail), undefined, JSON.stringify(detail));
  }
});

test("zoom steps by a tenth between the limits", () => {
  assert.equal(nextZoomFactor(1, "in"), 1.1);
  assert.equal(nextZoomFactor(1, "out"), 0.9);
  assert.equal(nextZoomFactor(1.7, "reset"), 1);
  assert.equal(nextZoomFactor(MAX_ZOOM, "in"), MAX_ZOOM);
  assert.equal(nextZoomFactor(MIN_ZOOM, "out"), MIN_ZOOM);
  assert.equal(nextZoomFactor(2.45, "in"), MAX_ZOOM);
  assert.equal(nextZoomFactor(0.55, "out"), MIN_ZOOM);
});

test("a zoom message of another kind changes nothing", () => {
  for (const change of ["IN", "zoom", "", 1, null, undefined, { type: "in" }]) {
    assert.equal(nextZoomFactor(1, change), undefined, JSON.stringify(change));
  }
});
