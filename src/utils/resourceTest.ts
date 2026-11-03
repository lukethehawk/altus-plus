/**
 * Help → Run Resource Test: the app restarts with RESOURCE_TEST_FLAG and
 * records CPU and memory from startup into a CSV file, plus a summary when
 * the test ends. Pure helpers; the recorder is in src/resourceTest.ts.
 */
import { type ResourceGroup, totalUsage } from "./resources";
import { AUTOSTART_FLAG } from "./startup";

export const RESOURCE_TEST_FLAG = "--resource-test";
/** Inside the profile folder. */
export const RESOURCE_TEST_FOLDER = "resource-tests";
export const KEPT_TESTS = 10;

const SECOND = 1000;
const FAST_PERIOD_MS = 5 * 60 * SECOND;
const MAX_DURATION_MS = 24 * 60 * 60 * SECOND;
const CALM_CPU_PERCENT = 2;
const CALM_SECONDS = 15;
const MIN_GROWTH_SECONDS = 30 * 60;

/**
 * Every second during startup, then every 10 seconds; nothing after 24 hours,
 * which keeps the file to a few MB.
 */
export function nextSampleDelay(elapsedMs: number): number | null {
  if (elapsedMs >= MAX_DURATION_MS) return null;
  return elapsedMs < FAST_PERIOD_MS ? SECOND : 10 * SECOND;
}

/**
 * The arguments to restart with: the same ones (profile folder included),
 * with or without the test flag. Without the autostart flag, so that the
 * window opens instead of staying in the tray.
 */
export function relaunchArgs(args: string[], resourceTest: boolean): string[] {
  const kept = args.filter((arg) => arg !== RESOURCE_TEST_FLAG && arg !== AUTOSTART_FLAG);
  return resourceTest ? [...kept, RESOURCE_TEST_FLAG] : kept;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Local date and time, "2026-11-03 17:02:11". */
export function localTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "resource-test-2026-11-03_17-02-11": sorts by date, valid on Windows. */
export function testBaseName(date: Date): string {
  return `resource-test-${localTime(date).replace(" ", "_").replace(/:/g, "-")}`;
}

const TEST_FILE = /^(resource-test-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.(csv|txt)$/;

/**
 * Files of all but the newest `keep` tests, so that a new test can be added
 * without the folder growing forever. Other files are never touched.
 */
export function testFilesToRemove(fileNames: string[], keep = KEPT_TESTS): string[] {
  const tests = [...new Set(fileNames.flatMap((name) => TEST_FILE.exec(name)?.[1] ?? []))].sort();
  const removed = new Set(tests.slice(0, Math.max(0, tests.length - keep)));
  return fileNames.filter((name) => removed.has(TEST_FILE.exec(name)?.[1] ?? ""));
}

/**
 * A CSV field. Text starting with = + - @ (a tab name, say) would be run as a
 * formula by spreadsheet programs, so it is prefixed with an apostrophe.
 */
export function csvField(value: string | number | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value.replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[",;]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_HEADER = "seconds,time,kind,name,processes,cpu_percent,private_mb,working_set_mb";

const csvLine = (fields: (string | number | undefined)[]) => fields.map(csvField).join(",");
const roundSeconds = (seconds: number) => Math.round(seconds * 10) / 10;

/** One row per group and one for the total; accounts are named after their tab. */
export function sampleCsvLines(seconds: number, time: Date, groups: ResourceGroup[]): string[] {
  const at = [roundSeconds(seconds), localTime(time)];
  const total = totalUsage(groups);
  return [
    ...groups.map((group) =>
      csvLine([...at, group.kind, group.name ?? "", group.processes, group.cpuPercent, group.privateMB, group.workingSetMB])
    ),
    csvLine([...at, "total", "", total.processes, total.cpuPercent, total.privateMB, total.workingSetMB]),
  ];
}

export function eventCsvLine(seconds: number, time: Date, description: string): string {
  return csvLine([roundSeconds(seconds), localTime(time), "event", description]);
}

/** What the summary needs from each sample. */
export type TestSample = {
  seconds: number;
  cpuPercent: number;
  privateMB: number;
  accounts: { tabId: string; name: string; privateMB: number; running: boolean }[];
};

export function toTestSample(seconds: number, groups: ResourceGroup[]): TestSample {
  const total = totalUsage(groups);
  return {
    seconds,
    cpuPercent: total.cpuPercent,
    privateMB: total.privateMB,
    accounts: groups
      .filter((group) => group.kind === "account" && group.tabId)
      .map((group) => ({
        tabId: group.tabId as string,
        name: group.name ?? "",
        privateMB: group.privateMB,
        running: group.processes > 0,
      })),
  };
}

export type TestEvent =
  | { type: "window-shown"; seconds: number }
  | { type: "account-loaded"; seconds: number; tabId: string; name: string };

export type TestSummary = {
  durationSeconds: number;
  windowShownSeconds?: number;
  accountsLoaded: { name: string; seconds: number }[];
  peakCpu?: { value: number; seconds: number };
  peakMemory?: { value: number; seconds: number };
  /** When the total CPU first stayed below 2 % for 15 seconds, after the pages loaded. */
  calmSeconds?: number;
  accounts: {
    name: string;
    startMB: number;
    endMB: number;
    maxMB: number;
    /** Only when the test ran long enough after startup. */
    growthMBPerHour?: number;
  }[];
  end?: { cpuPercent: number; privateMB: number };
};

export function summarizeResourceTest(
  samples: TestSample[],
  events: TestEvent[],
  durationSeconds: number
): TestSummary {
  const accountsLoaded = events.flatMap((event) =>
    event.type === "account-loaded" ? [{ name: event.name, seconds: event.seconds }] : []
  );
  const startup = samples.filter((sample) => sample.seconds * SECOND <= FAST_PERIOD_MS);
  const peak = (key: "cpuPercent" | "privateMB") =>
    startup.reduce<{ value: number; seconds: number } | undefined>(
      (best, sample) => (!best || sample[key] > best.value ? { value: sample[key], seconds: sample.seconds } : best),
      undefined
    );

  const loadedBy = accountsLoaded.reduce((latest, account) => Math.max(latest, account.seconds), 0);
  let calmSeconds: number | undefined;
  for (let start = 0; start < samples.length && calmSeconds === undefined; start++) {
    if (samples[start].seconds < loadedBy) continue;
    for (let index = start; index < samples.length && samples[index].cpuPercent < CALM_CPU_PERCENT; index++) {
      if (samples[index].seconds - samples[start].seconds >= CALM_SECONDS) {
        calmSeconds = samples[start].seconds;
        break;
      }
    }
  }

  // Memory "after startup" is taken once the CPU is calm (or at the first
  // sample with the page running, if it never was).
  const settled = calmSeconds ?? loadedBy;
  const names = new Map<string, string>();
  for (const sample of samples) for (const account of sample.accounts) names.set(account.tabId, account.name);
  const accounts = [...names].flatMap(([tabId, name]) => {
    const running = samples.flatMap((sample) => {
      const account = sample.accounts.find((entry) => entry.tabId === tabId);
      return account?.running ? [{ seconds: sample.seconds, privateMB: account.privateMB }] : [];
    });
    if (!running.length) return [];
    const start = running.find((entry) => entry.seconds >= settled) ?? running[0];
    const end = running[running.length - 1];
    const hours = (end.seconds - start.seconds) / 3600;
    return [{
      name,
      startMB: start.privateMB,
      endMB: end.privateMB,
      maxMB: Math.max(...running.map((entry) => entry.privateMB)),
      growthMBPerHour:
        end.seconds - start.seconds >= MIN_GROWTH_SECONDS
          ? Math.round(((end.privateMB - start.privateMB) / hours) * 10) / 10
          : undefined,
    }];
  });

  const last = samples[samples.length - 1];
  return {
    durationSeconds,
    windowShownSeconds: events.find((event) => event.type === "window-shown")?.seconds,
    accountsLoaded,
    peakCpu: peak("cpuPercent"),
    peakMemory: peak("privateMB"),
    calmSeconds,
    accounts,
    end: last && { cpuPercent: last.cpuPercent, privateMB: last.privateMB },
  };
}

/** "{name}: {value}" templates from the translations. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  return minutes ? `${minutes} min ${total % 60} s` : `${total} s`;
}

/** The summary file, in the app's language. */
export function formatSummary(
  summary: TestSummary,
  info: { title: string; started: string; computer: string; samplesFile: string; capped: boolean },
  translate: (key: string) => string,
  language: string
): string {
  const number = (value: number, digits = 0) =>
    new Intl.NumberFormat(language, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  const seconds = (value: number) => number(value, 1);
  const line = (key: string, values: Record<string, string> = {}) => fill(translate(key), values);
  const lines = [
    line("resourceTestSummaryTitle", { app: info.title }),
    line("resourceTestSummaryStarted", { start: info.started, duration: formatDuration(summary.durationSeconds) }),
    info.computer,
    "",
    line("resourceTestSummaryStartup"),
  ];
  if (summary.windowShownSeconds !== undefined) {
    lines.push(`- ${line("resourceTestSummaryWindowShown", { seconds: seconds(summary.windowShownSeconds) })}`);
  }
  if (summary.accountsLoaded.length) {
    const accounts = summary.accountsLoaded.map((account) => `${account.name || "—"} ${seconds(account.seconds)} s`).join(", ");
    lines.push(`- ${line("resourceTestSummaryAccountsLoaded", { accounts })}`);
  }
  if (summary.peakCpu && summary.peakMemory) {
    lines.push(`- ${line("resourceTestSummaryPeak", {
      cpu: number(summary.peakCpu.value, 1),
      cpuAt: seconds(summary.peakCpu.seconds),
      memory: number(summary.peakMemory.value),
      memoryAt: seconds(summary.peakMemory.seconds),
    })}`);
  }
  lines.push(`- ${summary.calmSeconds === undefined
    ? line("resourceTestSummaryNotCalm")
    : line("resourceTestSummaryCalm", { seconds: seconds(summary.calmSeconds) })}`);
  lines.push("", line("resourceTestSummaryMemory"));
  for (const account of summary.accounts) {
    const text = line("resourceTestSummaryAccount", {
      name: account.name || "—",
      start: number(account.startMB),
      end: number(account.endMB),
      max: number(account.maxMB),
    });
    const growth = account.growthMBPerHour === undefined
      ? ""
      : `, ${line("resourceTestSummaryGrowth", { growth: `${account.growthMBPerHour > 0 ? "+" : ""}${number(account.growthMBPerHour, 1)}` })}`;
    lines.push(`- ${text}${growth}`);
  }
  if (summary.accounts.some((account) => account.growthMBPerHour === undefined)) {
    lines.push(line("resourceTestSummaryTooShort"));
  }
  if (summary.end) {
    lines.push("", line("resourceTestSummaryTotal", { memory: number(summary.end.privateMB), cpu: number(summary.end.cpuPercent, 1) }));
  }
  if (info.capped) lines.push(line("resourceTestSummaryCapped"));
  lines.push("", line("resourceTestSummaryFile", { file: info.samplesFile }));
  return `${lines.join("\r\n")}\r\n`;
}
