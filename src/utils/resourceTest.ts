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
/** JavaScript memory rises and falls with garbage collection: the lowest value over this long is compared. */
const JS_WINDOW_SECONDS = 10 * 60;

/** Moments of the startup, in ms since the epoch. */
export type StartupTimes = {
  /** When Windows created the main process, as Electron reports it. */
  processCreatedAt?: number;
  /** When Node.js started inside it (now minus process.uptime()). */
  nodeStartedAt: number;
  /** When Altus +'s own code started (src/startTime.ts). */
  mainScriptStartedAt: number;
  /** Electron's "ready" event. */
  electronReadyAt?: number;
};

/**
 * Where the test's seconds count from: when Windows created the process, if
 * Electron gives a plausible time (not after Node.js started, nor more than a
 * minute before), else when Node.js started.
 */
export function testStartTime(times: StartupTimes): number {
  const created = times.processCreatedAt;
  const plausible =
    created !== undefined &&
    Number.isFinite(created) &&
    created <= times.nodeStartedAt + 1000 &&
    times.nodeStartedAt - created < 60 * SECOND;
  return plausible ? Math.min(created, times.nodeStartedAt) : times.nodeStartedAt;
}

/**
 * The startup moments as events, in seconds from the test's start; Node.js's
 * start only when the test counts from the process's creation.
 */
export function startupEvents(times: StartupTimes, startedAt: number): StartupEvent[] {
  const at = (time: number) => Math.max(0, (time - startedAt) / SECOND);
  return [
    ...(startedAt < times.nodeStartedAt ? [{ mark: "node" as const, seconds: at(times.nodeStartedAt) }] : []),
    { mark: "script" as const, seconds: at(times.mainScriptStartedAt) },
    ...(times.electronReadyAt === undefined ? [] : [{ mark: "ready" as const, seconds: at(times.electronReadyAt) }]),
  ].map((event) => ({ type: "startup" as const, ...event }));
}

export const STARTUP_EVENT_TEXT: Record<StartupEvent["mark"], string> = {
  node: "Node.js started",
  script: "main script started",
  ready: "Electron ready",
  window: "window created",
};

/** The main process's JavaScript memory (process.memoryUsage()), in MB. */
export type MainMemory = { jsHeapUsedMB: number; jsHeapTotalMB: number; jsExternalMB: number };

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

/** The last three columns are filled on the main process's rows only. */
export const CSV_HEADER =
  "seconds,time,kind,name,processes,cpu_percent,private_mb,working_set_mb,js_heap_used_mb,js_heap_total_mb,js_external_mb";

const csvLine = (fields: (string | number | undefined)[]) => fields.map(csvField).join(",");
const roundSeconds = (seconds: number) => Math.round(seconds * 10) / 10;
const roundOne = (value: number) => Math.round(value * 10) / 10;

/**
 * One row per group and one for the total; accounts are named after their
 * tab. The main process's row also has its JavaScript memory, if known.
 */
export function sampleCsvLines(seconds: number, time: Date, groups: ResourceGroup[], mainMemory?: MainMemory): string[] {
  const at = [roundSeconds(seconds), localTime(time)];
  const total = totalUsage(groups);
  const js = mainMemory
    ? [mainMemory.jsHeapUsedMB, mainMemory.jsHeapTotalMB, mainMemory.jsExternalMB].map(roundOne)
    : [];
  return [
    ...groups.map((group) =>
      csvLine([
        ...at, group.kind, group.name ?? "", group.processes, group.cpuPercent, group.privateMB, group.workingSetMB,
        ...(group.kind === "main" ? js : []),
      ])
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
  mainPrivateMB?: number;
  jsHeapUsedMB?: number;
};

export function toTestSample(seconds: number, groups: ResourceGroup[], mainMemory?: MainMemory): TestSample {
  const total = totalUsage(groups);
  return {
    seconds,
    cpuPercent: total.cpuPercent,
    privateMB: total.privateMB,
    mainPrivateMB: groups.find((group) => group.kind === "main")?.privateMB,
    jsHeapUsedMB: mainMemory && roundOne(mainMemory.jsHeapUsedMB),
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

export type StartupEvent = { type: "startup"; mark: "node" | "script" | "ready" | "window"; seconds: number };

export type TestEvent =
  | StartupEvent
  | { type: "window-shown"; seconds: number }
  | { type: "account-loaded"; seconds: number; tabId: string; name: string };

type Growth = {
  startMB: number;
  endMB: number;
  /** Only when the test ran long enough after startup. */
  growthMBPerHour?: number;
};

export type TestSummary = {
  durationSeconds: number;
  /** Seconds of each startup moment; "node" only when counting from the process's creation. */
  startup: Partial<Record<StartupEvent["mark"], number>>;
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
  /** The main process; its JavaScript memory only for tests long enough to tell. */
  main?: Growth & { maxMB: number; js?: Growth };
  end?: { cpuPercent: number; privateMB: number };
};

const growthPerHour = (startMB: number, endMB: number, seconds: number) =>
  Math.round(((endMB - startMB) / (seconds / 3600)) * 10) / 10;

/**
 * The main process's memory after startup and at the end. JavaScript memory
 * is compared by its lowest value over the first and the last 10 minutes,
 * so that garbage not collected yet does not look like growth.
 */
function summarizeMain(samples: TestSample[], settled: number): TestSummary["main"] {
  const known = samples.filter((sample) => sample.mainPrivateMB !== undefined);
  if (!known.length) return undefined;
  const start = known.find((sample) => sample.seconds >= settled) ?? known[0];
  const end = known[known.length - 1];
  const span = end.seconds - start.seconds;
  const main: NonNullable<TestSummary["main"]> = {
    startMB: start.mainPrivateMB as number,
    endMB: end.mainPrivateMB as number,
    maxMB: Math.max(...known.map((sample) => sample.mainPrivateMB as number)),
    growthMBPerHour:
      span >= MIN_GROWTH_SECONDS ? growthPerHour(start.mainPrivateMB as number, end.mainPrivateMB as number, span) : undefined,
  };
  if (span < MIN_GROWTH_SECONDS) return main;
  const lowestJs = (from: number, to: number) => {
    const values = known.flatMap((sample) =>
      sample.seconds >= from && sample.seconds <= to && sample.jsHeapUsedMB !== undefined ? [sample.jsHeapUsedMB] : []
    );
    return values.length ? Math.min(...values) : undefined;
  };
  const jsStart = lowestJs(start.seconds, start.seconds + JS_WINDOW_SECONDS);
  const jsEnd = lowestJs(end.seconds - JS_WINDOW_SECONDS, end.seconds);
  if (jsStart !== undefined && jsEnd !== undefined) {
    main.js = { startMB: jsStart, endMB: jsEnd, growthMBPerHour: growthPerHour(jsStart, jsEnd, span - JS_WINDOW_SECONDS) };
  }
  return main;
}

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
  const startupTimes: TestSummary["startup"] = {};
  for (const event of events) if (event.type === "startup") startupTimes[event.mark] = event.seconds;
  return {
    durationSeconds,
    startup: startupTimes,
    windowShownSeconds: events.find((event) => event.type === "window-shown")?.seconds,
    accountsLoaded,
    peakCpu: peak("cpuPercent"),
    peakMemory: peak("privateMB"),
    calmSeconds,
    accounts,
    main: summarizeMain(samples, settled),
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
  const { node, script, ready, window } = summary.startup;
  if (script !== undefined) {
    const times = {
      script: seconds(script),
      ready: ready === undefined ? "—" : seconds(ready),
      window: window === undefined ? "—" : seconds(window),
    };
    lines.push(`- ${node === undefined
      ? line("resourceTestSummaryStartupTimesFromNode", times)
      : line("resourceTestSummaryStartupTimes", { ...times, node: seconds(node) })}`);
  }
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
  const growth = (value: number | undefined) =>
    value === undefined
      ? ""
      : `, ${line("resourceTestSummaryGrowth", { growth: `${value > 0 ? "+" : ""}${number(value, 1)}` })}`;
  lines.push("", line("resourceTestSummaryMemory"));
  for (const account of summary.accounts) {
    const text = line("resourceTestSummaryAccount", {
      name: account.name || "—",
      start: number(account.startMB),
      end: number(account.endMB),
      max: number(account.maxMB),
    });
    lines.push(`- ${text}${growth(account.growthMBPerHour)}`);
  }
  if (summary.main) {
    const { main } = summary;
    lines.push("", line("resourceTestSummaryMainTitle"));
    lines.push(`- ${line("resourceTestSummaryMain", {
      start: number(main.startMB),
      end: number(main.endMB),
      max: number(main.maxMB),
    })}${growth(main.growthMBPerHour)}`);
    if (main.js) {
      lines.push(`- ${line("resourceTestSummaryMainJs", {
        start: number(main.js.startMB, 1),
        end: number(main.js.endMB, 1),
      })}${growth(main.js.growthMBPerHour)}`);
    }
  }
  if (
    summary.accounts.some((account) => account.growthMBPerHour === undefined) ||
    (summary.main && summary.main.growthMBPerHour === undefined)
  ) {
    lines.push(line("resourceTestSummaryTooShort"));
  }
  if (summary.end) {
    lines.push("", line("resourceTestSummaryTotal", { memory: number(summary.end.privateMB), cpu: number(summary.end.cpuPercent, 1) }));
  }
  if (info.capped) lines.push(line("resourceTestSummaryCapped"));
  lines.push("", line("resourceTestSummaryFile", { file: info.samplesFile }));
  return `${lines.join("\r\n")}\r\n`;
}
