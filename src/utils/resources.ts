/**
 * CPU and memory per account, from Electron's per-process metrics
 * (app.getAppMetrics), for the Resource Usage panel and the resource test.
 */

/** The fields of Electron's ProcessMetric that are used here. */
export type ProcessUsage = {
  pid: number;
  /** "Browser", "Tab", "GPU", "Utility", ... */
  type: string;
  /** Utility processes, e.g. "network.mojom.NetworkService". */
  serviceName?: string;
  /**
   * Since the previous getAppMetrics() call, as a share of the whole
   * computer: Electron already divides by the number of logical CPUs.
   */
  cpuPercent: number;
  /** Windows only. */
  privateKB?: number;
  workingSetKB: number;
};

export type ResourceKind =
  | "account"
  | "window"
  | "main"
  | "gpu"
  | "network"
  | "audio"
  | "service"
  | "workers"
  | "other";

export type ResourceGroup = {
  kind: ResourceKind;
  /** Accounts only. */
  tabId?: string;
  name?: string;
  processes: number;
  /** Share of the whole computer, as in Task Manager. */
  cpuPercent: number;
  privateMB: number;
  workingSetMB: number;
};

export type ProcessOwners = {
  /** In tab order; pid is the account's renderer, if it is running. */
  accounts: { tabId: string; name: string; pid?: number }[];
  /** The renderer of the app window. */
  windowPid?: number;
  /**
   * Renderers that run only WhatsApp's service workers (one per account).
   * Electron does not give their system PIDs, only how many there are.
   */
  workerProcesses?: number;
};

// The service workers belong to the accounts, so they come right after them.
const OTHER_KINDS: ResourceKind[] = ["workers", "window", "main", "gpu", "network", "audio", "service", "other"];

function kindOf(process: ProcessUsage, owners: ProcessOwners): ResourceKind {
  switch (process.type) {
    case "Browser":
      return "main";
    case "GPU":
      return "gpu";
    case "Tab":
      return process.pid === owners.windowPid ? "window" : "other";
    case "Utility":
      if (process.serviceName?.startsWith("network.")) return "network";
      if (process.serviceName?.startsWith("audio.")) return "audio";
      return "service";
    default:
      return "service";
  }
}

const roundOne = (value: number) => Math.round(value * 10) / 10;

/**
 * One group per account (in tab order, also when its page is not running),
 * then the app's own processes by kind; kinds without processes are left out.
 */
export function groupProcessUsage(processes: ProcessUsage[], owners: ProcessOwners): ResourceGroup[] {
  const accounts: ResourceGroup[] = owners.accounts.map((account) => ({
    kind: "account",
    tabId: account.tabId,
    name: account.name,
    processes: 0,
    cpuPercent: 0,
    privateMB: 0,
    workingSetMB: 0,
  }));
  const others = new Map<ResourceKind, ResourceGroup>();
  const counted = new Set<number>();
  for (const process of processes) {
    // A process listed twice is counted once.
    if (counted.has(process.pid)) continue;
    counted.add(process.pid);
    const accountIndex =
      process.type === "Tab" ? owners.accounts.findIndex((account) => account.pid === process.pid) : -1;
    let group: ResourceGroup | undefined;
    if (accountIndex >= 0) {
      group = accounts[accountIndex];
    } else {
      const kind = kindOf(process, owners);
      group = others.get(kind);
      if (!group) {
        group = { kind, processes: 0, cpuPercent: 0, privateMB: 0, workingSetMB: 0 };
        others.set(kind, group);
      }
    }
    group.processes += 1;
    group.cpuPercent += Number.isFinite(process.cpuPercent) ? process.cpuPercent : 0;
    group.privateMB += (process.privateKB ?? 0) / 1024;
    group.workingSetMB += process.workingSetKB / 1024;
  }
  // The renderers left over are the service workers when the counts match.
  const leftOver = others.get("other");
  if (leftOver && owners.workerProcesses && leftOver.processes === owners.workerProcesses) {
    others.delete("other");
    others.set("workers", { ...leftOver, kind: "workers" });
  }
  return [...accounts, ...OTHER_KINDS.flatMap((kind) => others.get(kind) ?? [])].map((group) => ({
    ...group,
    cpuPercent: roundOne(group.cpuPercent),
    privateMB: roundOne(group.privateMB),
    workingSetMB: roundOne(group.workingSetMB),
  }));
}

export function totalUsage(groups: ResourceGroup[]) {
  const sum = (key: "processes" | "cpuPercent" | "privateMB" | "workingSetMB") =>
    groups.reduce((total, group) => total + group[key], 0);
  return {
    processes: sum("processes"),
    cpuPercent: roundOne(sum("cpuPercent")),
    privateMB: roundOne(sum("privateMB")),
    workingSetMB: roundOne(sum("workingSetMB")),
  };
}
