import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLOSED_TABS_FILE,
  getClosedTabIds,
  planPartitionCleanup,
  readClosedTabIds,
  writeClosedTabIds,
} from "../src/utils/partitions.ts";

const plan = (input) =>
  planPartitionCleanup({ partitionFolders: [], openTabIds: [], previouslyClosedTabId: null, closedTabIds: [], ...input });

test("closing a tab records it; moving or renaming records nothing", () => {
  assert.deepEqual(getClosedTabIds(["A1", "B2", "C3"], [{ id: "A1" }, { id: "C3" }]), ["B2"]);
  assert.deepEqual(getClosedTabIds(["A1", "B2"], [{ id: "B2", name: "x" }, { id: "A1" }]), []);
  assert.deepEqual(getClosedTabIds(["A1"], [{ id: "A1" }, { id: "New" }]), []);
  // Closing the last tab: the list is briefly empty before a new tab is added.
  assert.deepEqual(getClosedTabIds(["A1"], []), ["A1"]);
});

test("a list that drops several tabs at once, or is not a list, records nothing", () => {
  // A reset or a bug, not the user: their accounts must stay.
  assert.equal(getClosedTabIds(["A1", "B2", "C3"], []), null);
  assert.equal(getClosedTabIds(["A1", "B2", "C3"], [{ id: "New" }]), null);
  assert.equal(getClosedTabIds(["A1"], { tabs: [] }), null);
  assert.equal(getClosedTabIds(["A1"], "A1"), null);
});

test("after the tab list is lost, the new tab never costs the other accounts", () => {
  // Start 1 saw no tabs and saved a new one; start 2 only knows that one.
  const result = plan({ partitionFolders: ["alfa1", "beta2", "gamma3", "new"], openTabIds: ["New"] });
  assert.deepEqual(result, { remove: [], stillClosed: [] });
});

test("a closed tab's folder goes at the next start", () => {
  const result = plan({ partitionFolders: ["abc", "closed1"], openTabIds: ["ABC"], closedTabIds: ["Closed1"] });
  assert.deepEqual(result, { remove: ["closed1"], stillClosed: [] });
});

test("the last closed tab waits, since it can still be reopened", () => {
  const result = plan({
    partitionFolders: ["abc", "older", "last"],
    openTabIds: ["abc"],
    previouslyClosedTabId: "Last",
    closedTabIds: ["Older", "Last"],
  });
  assert.deepEqual(result, { remove: ["older"], stillClosed: ["Last"] });
});

test("a reopened tab is kept and leaves the list", () => {
  const result = plan({ partitionFolders: ["restore_me"], openTabIds: ["Restore_Me"], closedTabIds: ["Restore_Me"] });
  assert.deepEqual(result, { remove: [], stillClosed: [] });
});

test("an empty tab list deletes nothing and keeps the list", () => {
  const result = plan({ partitionFolders: ["abc", "closed1"], closedTabIds: ["Closed1"] });
  assert.deepEqual(result, { remove: [], stillClosed: ["Closed1"] });
});

test("closed tabs without a folder, duplicates and odd names are dropped", () => {
  const result = plan({
    partitionFolders: ["Default", "some%20name", "dup"],
    openTabIds: ["keep"],
    closedTabIds: ["gone", "Dup", "dup", "../x", "x".repeat(65)],
  });
  assert.deepEqual(result, { remove: ["dup"], stillClosed: [] });
});

test("the closed tabs file round-trips and is read defensively", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "altus-closed-"));
  try {
    assert.deepEqual(readClosedTabIds(profile), []);
    writeClosedTabIds(profile, ["A1", "B2", "A1"]);
    assert.deepEqual(readClosedTabIds(profile), ["A1", "B2"]);
    assert.equal(fs.existsSync(path.join(profile, `${CLOSED_TABS_FILE}.tmp`)), false);

    fs.writeFileSync(path.join(profile, CLOSED_TABS_FILE), JSON.stringify({ ids: ["ok", 3, "../x"] }));
    assert.deepEqual(readClosedTabIds(profile), ["ok"]);
    fs.writeFileSync(path.join(profile, CLOSED_TABS_FILE), "{");
    assert.equal(readClosedTabIds(profile), null);
    fs.writeFileSync(path.join(profile, CLOSED_TABS_FILE), JSON.stringify({ ids: "A1" }));
    assert.equal(readClosedTabIds(profile), null);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
