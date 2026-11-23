import test from "node:test";
import assert from "node:assert/strict";

const { positionOnScreen } = await import("../src/utils/windowPosition.ts");

// Work areas as screen.getAllDisplays() reports them (taskbar excluded).
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT = { x: -1920, y: 0, width: 1920, height: 1040 };
const SIZE = { width: 800, height: 600 };

test("a position on a connected display is kept", () => {
  assert.deepEqual(positionOnScreen({ x: 100, y: 80 }, SIZE, [PRIMARY]), { x: 100, y: 80 });
  assert.deepEqual(positionOnScreen({ x: -1500, y: 100 }, SIZE, [PRIMARY, LEFT]), { x: -1500, y: 100 });
});

test("a position on a display since disconnected is dropped", () => {
  assert.equal(positionOnScreen({ x: -1500, y: 100 }, SIZE, [PRIMARY]), undefined);
  assert.equal(positionOnScreen({ x: -5000, y: -5000 }, SIZE, [PRIMARY]), undefined);
  assert.equal(positionOnScreen({ x: 100, y: 80 }, SIZE, []), undefined);
});

test("enough of the title bar must be on a display to drag the window back", () => {
  // 150 px of its width on the display: kept; 50 px: dropped.
  assert.deepEqual(positionOnScreen({ x: 1770, y: 80 }, SIZE, [PRIMARY]), { x: 1770, y: 80 });
  assert.equal(positionOnScreen({ x: 1870, y: 80 }, SIZE, [PRIMARY]), undefined);
  assert.deepEqual(positionOnScreen({ x: -650, y: 80 }, SIZE, [PRIMARY]), { x: -650, y: 80 });
  assert.equal(positionOnScreen({ x: -750, y: 80 }, SIZE, [PRIMARY]), undefined);
  // The title bar just above the taskbar: kept; mostly behind it: dropped.
  assert.deepEqual(positionOnScreen({ x: 100, y: 1000 }, SIZE, [PRIMARY]), { x: 100, y: 1000 });
  assert.equal(positionOnScreen({ x: 100, y: 1030 }, SIZE, [PRIMARY]), undefined);
});

test("a title bar above the display is dropped, Windows' few pixels of frame are not", () => {
  assert.equal(positionOnScreen({ x: 100, y: -100 }, SIZE, [PRIMARY]), undefined);
  assert.deepEqual(positionOnScreen({ x: -7, y: -7 }, SIZE, [PRIMARY]), { x: -7, y: -7 });
});

test("a window across two connected displays is kept", () => {
  assert.deepEqual(positionOnScreen({ x: -400, y: 80 }, SIZE, [PRIMARY, LEFT]), { x: -400, y: 80 });
});

test("no saved position, or one that is not a number, gives none", () => {
  for (const saved of [
    { x: null, y: null },
    { x: undefined, y: 80 },
    { x: 100, y: null },
    { x: "100", y: 80 },
    { x: Number.NaN, y: 80 },
    { x: 100, y: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(positionOnScreen(saved, SIZE, [PRIMARY]), undefined, JSON.stringify(saved));
  }
});
