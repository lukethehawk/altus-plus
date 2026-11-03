import test from "node:test";
import assert from "node:assert/strict";
import { groupProcessUsage, totalUsage } from "../src/utils/resources.ts";

const owners = {
  accounts: [
    { tabId: "work", name: "Lavoro", pid: 30 },
    { tabId: "home", name: "Casa", pid: 31 },
    { tabId: "new", name: "Nuovo" },
  ],
  windowPid: 20,
};

// cpuPercent is already a share of the whole computer, as Electron reports it.
const processes = [
  { pid: 10, type: "Browser", cpuPercent: 1, privateKB: 100 * 1024, workingSetKB: 150 * 1024 },
  { pid: 11, type: "GPU", cpuPercent: 0.5, privateKB: 400 * 1024, workingSetKB: 200 * 1024 },
  { pid: 12, type: "Utility", serviceName: "network.mojom.NetworkService", cpuPercent: 0, privateKB: 20 * 1024, workingSetKB: 30 * 1024 },
  { pid: 13, type: "Utility", serviceName: "audio.mojom.AudioService", cpuPercent: 0, privateKB: 10 * 1024, workingSetKB: 15 * 1024 },
  { pid: 14, type: "Utility", serviceName: "storage.mojom.StorageService", cpuPercent: 0, privateKB: 5 * 1024, workingSetKB: 8 * 1024 },
  { pid: 20, type: "Tab", cpuPercent: 0.25, privateKB: 60 * 1024, workingSetKB: 90 * 1024 },
  { pid: 30, type: "Tab", cpuPercent: 2, privateKB: 512 * 1024, workingSetKB: 300 * 1024 },
  { pid: 31, type: "Tab", cpuPercent: 0.05, privateKB: 450.25 * 1024, workingSetKB: 280 * 1024 },
  { pid: 40, type: "Tab", cpuPercent: 0, privateKB: 15 * 1024, workingSetKB: 20 * 1024 },
];

const workers = [
  { pid: 50, type: "Tab", cpuPercent: 0, privateKB: 55 * 1024, workingSetKB: 60 * 1024 },
  { pid: 51, type: "Tab", cpuPercent: 0.1, privateKB: 60 * 1024, workingSetKB: 65 * 1024 },
];
const withoutStray = processes.filter((process) => process.pid !== 40);

test("groups processes by account in tab order, then by kind", () => {
  const groups = groupProcessUsage(processes, owners);
  assert.deepEqual(
    groups.map((group) => group.name ?? group.kind),
    ["Lavoro", "Casa", "Nuovo", "window", "main", "gpu", "network", "audio", "service", "other"]
  );
  const [work, home, notLoaded] = groups;
  assert.deepEqual(work, { kind: "account", tabId: "work", name: "Lavoro", processes: 1, cpuPercent: 2, privateMB: 512, workingSetMB: 300 });
  assert.equal(home.privateMB, 450.3);
  assert.equal(home.cpuPercent, 0.1);
  // An account whose page is not running yet is still listed.
  assert.deepEqual(notLoaded, { kind: "account", tabId: "new", name: "Nuovo", processes: 0, cpuPercent: 0, privateMB: 0, workingSetMB: 0 });
});

test("keeps Electron's CPU share as it is and ignores invalid values", () => {
  const [work] = groupProcessUsage([{ ...processes[6], cpuPercent: 10 }], owners);
  assert.equal(work.cpuPercent, 10);
  const [broken] = groupProcessUsage([{ ...processes[6], cpuPercent: Number.NaN }], owners);
  assert.equal(broken.cpuPercent, 0);
});

test("leaves out kinds without processes and counts each process once", () => {
  const groups = groupProcessUsage([processes[0], processes[0], processes[6]], {
    accounts: [{ tabId: "work", name: "Lavoro", pid: 30 }],
  });
  assert.deepEqual(groups.map((group) => group.name ?? group.kind), ["Lavoro", "main"]);
  assert.equal(groups[1].processes, 1);
});

test("a renderer that is neither an account nor the window is other", () => {
  const groups = groupProcessUsage(processes, { accounts: [] });
  const other = groups.find((group) => group.kind === "other");
  assert.equal(other.processes, 4);
  assert.equal(groups.some((group) => group.kind === "window"), false);
});

test("totals add up the rounded rows, as the panel shows them", () => {
  const total = totalUsage(groupProcessUsage(processes, owners));
  assert.equal(total.processes, processes.length);
  assert.equal(total.privateMB, 1572.3);
  // 0.25 and 0.05 are shown as 0.3 and 0.1.
  assert.equal(total.cpuPercent, 3.9);
});

test("left-over renderers are WhatsApp's service workers when the counts match", () => {
  const groups = groupProcessUsage([...withoutStray, ...workers], { ...owners, workerProcesses: 2 });
  // They belong to the accounts, so they come right after them.
  assert.deepEqual(
    groups.map((group) => group.name ?? group.kind).slice(3, 5),
    ["workers", "window"]
  );
  assert.deepEqual(groups[3], { kind: "workers", processes: 2, cpuPercent: 0.1, privateMB: 115, workingSetMB: 125 });
  const kinds = (workerProcesses, list) =>
    groupProcessUsage(list, { ...owners, workerProcesses }).map((group) => group.kind);
  // One renderer more than the service workers: it cannot be told apart.
  assert.equal(kinds(2, [...withoutStray, ...workers, processes.at(-1)]).includes("workers"), false);
  assert.equal(kinds(0, [...withoutStray, ...workers]).includes("workers"), false);
});
