import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

// resourceTest.ts imports its neighbours without extensions (Vite resolves
// them); let Node try "<path>.ts" for those.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
            return next(specifier + ".ts", context);
          }
          throw error;
        }
      }`)
);

const {
  RESOURCE_TEST_FLAG,
  csvField,
  eventCsvLine,
  formatDuration,
  formatSummary,
  nextSampleDelay,
  relaunchArgs,
  sampleCsvLines,
  startupEventText,
  startupEvents,
  summarizeResourceTest,
  testBaseName,
  testFilesToRemove,
  testStartTime,
  toTestSample,
} = await import("../src/utils/resourceTest.ts");

const root = path.resolve(import.meta.dirname, "..");
const translation = (language) =>
  JSON.parse(fs.readFileSync(path.join(root, "public/locales", language, "translation.json"), "utf8"));

test("restarts with the same arguments, adding or removing the test flag", () => {
  const args = ["--user-data-dir=C:\\p", "--hidden", "--remote-debugging-port=9417"];
  assert.deepEqual(relaunchArgs(args, true), ["--user-data-dir=C:\\p", "--remote-debugging-port=9417", RESOURCE_TEST_FLAG]);
  assert.deepEqual(relaunchArgs([...args, RESOURCE_TEST_FLAG], false), ["--user-data-dir=C:\\p", "--remote-debugging-port=9417"]);
  assert.deepEqual(relaunchArgs([RESOURCE_TEST_FLAG], true), [RESOURCE_TEST_FLAG]);
});

test("samples every second at startup, every 10 seconds later, never after 24 hours", () => {
  assert.equal(nextSampleDelay(0), 1000);
  assert.equal(nextSampleDelay(4 * 60_000), 1000);
  assert.equal(nextSampleDelay(5 * 60_000), 10_000);
  assert.equal(nextSampleDelay(23 * 3_600_000), 10_000);
  assert.equal(nextSampleDelay(24 * 3_600_000), null);
});

test("names test files by local date and keeps only the newest tests", () => {
  assert.equal(testBaseName(new Date(2026, 10, 3, 7, 2, 9)), "resource-test-2026-11-03_07-02-09");
  const names = [
    "resource-test-2026-11-01_10-00-00.csv",
    "resource-test-2026-11-01_10-00-00.txt",
    "resource-test-2026-11-02_10-00-00.csv",
    "resource-test-2026-11-03_10-00-00.csv",
    "resource-test-2026-11-03_10-00-00.txt",
    "notes.txt",
    "resource-test-2026-11-01_10-00-00.csv.bak",
  ];
  assert.deepEqual(testFilesToRemove(names, 2), ["resource-test-2026-11-01_10-00-00.csv", "resource-test-2026-11-01_10-00-00.txt"]);
  assert.deepEqual(testFilesToRemove(names, 10), []);
  assert.deepEqual(testFilesToRemove(names, 0).sort(), names.filter((name) => /\.(csv|txt)$/.test(name) && name !== "notes.txt").sort());
});

test("CSV fields are quoted when needed and never run as formulas", () => {
  assert.equal(csvField("Lavoro"), "Lavoro");
  assert.equal(csvField("Casa, mare"), '"Casa, mare"');
  assert.equal(csvField('Il "capo"'), '"Il ""capo"""');
  assert.equal(csvField("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvField("+39 333"), "'+39 333");
  assert.equal(csvField("-x"), "'-x");
  assert.equal(csvField("@x"), "'@x");
  assert.equal(csvField("a\r\nb"), "a b");
  assert.equal(csvField(12.5), "12.5");
  assert.equal(csvField(Number.NaN), "");
  assert.equal(csvField(undefined), "");
});

const groups = (lavoro, casa, cpu = 0.5, main = 90) => [
  { kind: "account", tabId: "work", name: "Lavoro", processes: 1, cpuPercent: cpu, privateMB: lavoro, workingSetMB: 100 },
  { kind: "account", tabId: "home", name: "=Casa", processes: casa ? 1 : 0, cpuPercent: 0, privateMB: casa, workingSetMB: 50 },
  { kind: "main", processes: 1, cpuPercent: 0.1, privateMB: main, workingSetMB: 120 },
];

test("writes one CSV row per group and a total", () => {
  const time = new Date(2026, 10, 3, 17, 2, 11);
  assert.deepEqual(sampleCsvLines(1.04, time, groups(500, 400)), [
    "1,2026-11-03 17:02:11,account,Lavoro,1,0.5,500,100",
    "1,2026-11-03 17:02:11,account,'=Casa,1,0,400,50",
    "1,2026-11-03 17:02:11,main,,1,0.1,90,120",
    "1,2026-11-03 17:02:11,total,,3,0.6,990,270",
  ]);
  assert.equal(eventCsvLine(0.26, time, "WhatsApp page loaded: Lavoro"), "0.3,2026-11-03 17:02:11,event,WhatsApp page loaded: Lavoro");
});

test("the main process's row also has its JavaScript memory", () => {
  const time = new Date(2026, 10, 3, 17, 2, 11);
  const lines = sampleCsvLines(12, time, groups(500, 400), { jsHeapUsedMB: 21.04, jsHeapTotalMB: 30.96, jsExternalMB: 4.25 });
  assert.equal(lines[2], "12,2026-11-03 17:02:11,main,,1,0.1,90,120,21,31,4.3");
  // The other rows keep the same columns as before.
  assert.equal(lines[0], "12,2026-11-03 17:02:11,account,Lavoro,1,0.5,500,100");
  assert.equal(lines[3], "12,2026-11-03 17:02:11,total,,3,0.6,990,270");
});

test("counts from when Windows created the process, if Electron's time is plausible", () => {
  const nodeStartedAt = 1_000_000;
  const times = (processCreatedAt) => ({ processCreatedAt, nodeStartedAt, mainScriptStartedAt: nodeStartedAt + 900 });
  assert.equal(testStartTime(times(nodeStartedAt - 1500)), nodeStartedAt - 1500);
  // Rounding can put it a little after Node.js's start.
  assert.equal(testStartTime(times(nodeStartedAt + 400)), nodeStartedAt);
  for (const implausible of [undefined, Number.NaN, nodeStartedAt + 5000, nodeStartedAt - 120_000]) {
    assert.equal(testStartTime(times(implausible)), nodeStartedAt, String(implausible));
  }
});

test("startup moments become events in seconds from the test's start", () => {
  const times = { processCreatedAt: 10_000, nodeStartedAt: 10_400, mainScriptStartedAt: 11_200, electronReadyAt: 12_000 };
  assert.deepEqual(startupEvents(times, 10_000), [
    { type: "startup", mark: "node", seconds: 0.4 },
    { type: "startup", mark: "script", seconds: 1.2 },
    { type: "startup", mark: "ready", seconds: 2 },
  ]);
  // Counting from Node.js's start: no event for it; no "ready" before it happened.
  assert.deepEqual(startupEvents({ ...times, electronReadyAt: undefined }, 10_400), [
    { type: "startup", mark: "script", seconds: 0.8 },
  ]);
});

test("the steps before the window come in order, with the main process's CPU since the previous one", () => {
  const times = {
    processCreatedAt: 10_000,
    nodeStartedAt: 10_400,
    mainScriptStartedAt: 11_200,
    electronReadyAt: 12_000,
    partitionsCheckedAt: 12_100,
    autostartCheckedAt: 17_800,
    windowCreatedAt: 18_000,
    cpuMs: { script: 150, ready: 400, partitions: 420, autostart: 440, window: 600 },
  };
  assert.deepEqual(startupEvents(times, 10_000), [
    // No CPU time when Node.js started, so none for the step after it either.
    { type: "startup", mark: "node", seconds: 0.4 },
    { type: "startup", mark: "script", seconds: 1.2 },
    { type: "startup", mark: "ready", seconds: 2, cpuSeconds: 0.25 },
    { type: "startup", mark: "partitions", seconds: 2.1, cpuSeconds: 0.02 },
    { type: "startup", mark: "autostart", seconds: 7.8, cpuSeconds: 0.02 },
    { type: "startup", mark: "window", seconds: 8, cpuSeconds: 0.16 },
  ]);
  // A moment without its CPU time leaves both steps around it without one.
  const { partitions, ...cpuMs } = times.cpuMs;
  assert.equal(partitions, 420);
  const events = startupEvents({ ...times, cpuMs }, 10_000);
  assert.deepEqual(events.map((event) => event.cpuSeconds), [undefined, undefined, 0.25, undefined, undefined, 0.16]);

  assert.equal(startupEventText(events[2]), "Electron ready (main process CPU since the previous step: 0.25 s)");
  assert.equal(startupEventText(events[4]), "autostart checked");
  assert.equal(startupEventText({ type: "startup", mark: "window", seconds: 8, cpuSeconds: 0.004 }),
    "window created (main process CPU since the previous step: 0.00 s)");
});

const STARTUP_EVENTS = [
  { type: "startup", mark: "node", seconds: 0.4 },
  { type: "startup", mark: "script", seconds: 0.5 },
  { type: "startup", mark: "ready", seconds: 0.7, cpuSeconds: 0.2 },
  { type: "startup", mark: "partitions", seconds: 0.8, cpuSeconds: 0.02 },
  { type: "startup", mark: "autostart", seconds: 2.3, cpuSeconds: 0.01 },
  { type: "startup", mark: "window", seconds: 2.4, cpuSeconds: 0.05 },
];

/**
 * A test of `minutes`: Lavoro grows by `growth` MB per hour, the main process
 * by `mainGrowth`, its JavaScript memory by `jsGrowth` plus garbage that piles
 * up for 2 minutes and is then collected.
 */
function run({ minutes, calmFrom = 20, growth = 0, mainGrowth = 0, jsGrowth = 0, startup = STARTUP_EVENTS }) {
  const samples = [];
  for (let seconds = 1; seconds <= minutes * 60; seconds += seconds < 300 ? 1 : 10) {
    const cpu = seconds < calmFrom ? 30 : 0.5;
    const lavoro = 300 + Math.min(seconds, 10) * 20 + (growth * seconds) / 3600;
    const main = 90 + (mainGrowth * seconds) / 3600;
    const js = 20 + (jsGrowth * seconds) / 3600 + ((seconds % 120) / 120) * 8;
    samples.push(toTestSample(seconds, groups(lavoro, seconds >= 3 ? 400 : 0, cpu, main), {
      jsHeapUsedMB: js, jsHeapTotalMB: js + 10, jsExternalMB: 3,
    }));
  }
  const events = [
    ...startup,
    { type: "window-shown", seconds: 2.6 },
    { type: "account-loaded", seconds: 3, tabId: "work", name: "Lavoro" },
    { type: "account-loaded", seconds: 4, tabId: "home", name: "=Casa" },
  ];
  return summarizeResourceTest(samples, events, minutes * 60);
}

test("summarizes startup: times, window, pages, peaks and when the CPU calms down", () => {
  const summary = run({ minutes: 10 });
  assert.deepEqual(summary.startup, { node: 0.4, script: 0.5, ready: 0.7, partitions: 0.8, autostart: 2.3, window: 2.4 });
  const { seconds, ...step } = summary.longestStartupStep;
  assert.deepEqual(step, { from: "partitions", to: "autostart", cpuSeconds: 0.01 });
  assert.ok(Math.abs(seconds - 1.5) < 1e-9, String(seconds));
  assert.equal(summary.windowShownSeconds, 2.6);
  assert.deepEqual(summary.accountsLoaded, [{ name: "Lavoro", seconds: 3 }, { name: "=Casa", seconds: 4 }]);
  // Lavoro busy at 30 % plus the main process, from the first sample.
  assert.deepEqual(summary.peakCpu, { value: 30.1, seconds: 1 });
  assert.equal(summary.peakMemory.value, 990);
  assert.equal(summary.calmSeconds, 20);
  assert.deepEqual(summary.end, { cpuPercent: 0.6, privateMB: 990 });
});

test("the longest startup step may start where the test counts from, without CPU time", () => {
  const step = (startup) => run({ minutes: 3, startup }).longestStartupStep;
  assert.deepEqual(step([{ type: "startup", mark: "node", seconds: 2 }, { type: "startup", mark: "script", seconds: 2.2 }]),
    { from: "start", to: "node", seconds: 2 });
  assert.deepEqual(step([]), undefined);
});

test("never calm, or calm only before the pages loaded, gives no calm time", () => {
  assert.equal(run({ minutes: 3, calmFrom: 10_000 }).calmSeconds, undefined);
  // Calm for the last 20 s of the test: found.
  assert.equal(run({ minutes: 3, calmFrom: 160 }).calmSeconds, 160);
  // Calm starting less than 15 s before the end is not calm yet.
  assert.equal(run({ minutes: 3, calmFrom: 170 }).calmSeconds, undefined);
});

test("memory per account: after startup, at the end, highest, growth per hour", () => {
  const short = run({ minutes: 10 });
  assert.deepEqual(short.accounts, [
    { name: "Lavoro", startMB: 500, endMB: 500, maxMB: 500, growthMBPerHour: undefined },
    { name: "=Casa", startMB: 400, endMB: 400, maxMB: 400, growthMBPerHour: undefined },
  ]);
  const long = run({ minutes: 120, growth: 60 });
  assert.equal(long.accounts[0].growthMBPerHour, 60);
  assert.equal(long.accounts[1].growthMBPerHour, 0);
});

test("main process: memory after startup, at the end, growth; JavaScript only in long tests", () => {
  const short = run({ minutes: 10, mainGrowth: 6 });
  assert.deepEqual(short.main, { startMB: 90.03333333333333, endMB: 91, maxMB: 91, growthMBPerHour: undefined });

  const long = run({ minutes: 120, mainGrowth: 6 });
  assert.equal(long.main.growthMBPerHour, 6);
  // Garbage piling up and being collected is not growth: the lowest values
  // over the first and the last 10 minutes are compared.
  assert.deepEqual(long.main.js, { startMB: 20, endMB: 20, growthMBPerHour: 0 });

  const growing = run({ minutes: 120, jsGrowth: 36 }).main.js;
  assert.ok(growing.endMB > growing.startMB + 60, JSON.stringify(growing));
  assert.ok(Math.abs(growing.growthMBPerHour - 36) < 2, JSON.stringify(growing));
});

test("formats durations", () => {
  assert.equal(formatDuration(42.4), "42 s");
  assert.equal(formatDuration(125), "2 min 5 s");
  assert.equal(formatDuration(2 * 3600 + 14 * 60 + 9), "2 h 14 min");
});

test("writes the summary in the app's language, with every template filled", () => {
  for (const language of ["en", "it"]) {
    const strings = translation(language);
    const format = (summary) => formatSummary(
      summary,
      { title: "Altus + 5.8.1-plus.15", started: "2026-11-03 17:02:11", computer: "10 CPU", samplesFile: "resource-test-x.csv", capped: true },
      (key) => strings[key] ?? key,
      language
    );
    const text = format(run({ minutes: 45, growth: 12, mainGrowth: 3, jsGrowth: 1 }));
    assert.doesNotMatch(text, /\{\w+\}|resourceTestSummary|resourceTestStartup/, language);
    assert.match(text, /Altus \+ 5\.8\.1-plus\.15/);
    assert.match(text, /Node\.js 0[.,]4 s, .+ 0[.,]5 s, .+ 0[.,]7 s, .+ 0[.,]8 s, .+ 2[.,]3 s, .+ 2[.,]4 s/);
    assert.ok(text.includes(`: ${strings.resourceTestStartupPartitions} → ${strings.resourceTestStartupAutostart}, ${language === "it" ? "1,5" : "1.5"} s, `), language);
    assert.match(text, / 0[.,]01 s\r\n/);
    assert.match(text, /Lavoro 3[.,]0 s, =Casa 4[.,]0 s/);
    assert.match(text, /\+12[.,]0/);
    assert.match(text, new RegExp(strings.resourceTestSummaryMainTitle.replace(/[()]/g, "\\$&")));
    assert.match(text, /\+3[.,]0/);
    assert.match(text, /JavaScript: 20[.,]\d MB/);
    assert.match(text, /resource-test-x\.csv/);
    assert.ok(text.endsWith("\r\n"));

    // Counted from Node.js's start, a short test: no Node.js time, no JavaScript line.
    const short = format(run({ minutes: 10, startup: STARTUP_EVENTS.filter((event) => event.mark !== "node") }));
    assert.doesNotMatch(short, /\{\w+\}|resourceTestSummary|resourceTestStartup|Node\.js \d|JavaScript/, language);
    assert.match(short, /0[.,]5 s, .+ 0[.,]7 s, .+ 0[.,]8 s, .+ 2[.,]3 s, .+ 2[.,]4 s/);

    // The first step starts at the process's creation, or at Node.js's start.
    const first = (startup) => format(run({ minutes: 3, startup })).split("\r\n").find((line) => line.includes(" → "));
    assert.equal(first([{ type: "startup", mark: "node", seconds: 2 }, { type: "startup", mark: "script", seconds: 2.2 }]),
      `- ${strings.resourceTestSummaryLongestStep.replace("{from}", strings.resourceTestStartupCreated)
        .replace("{to}", strings.resourceTestStartupNode).replace("{seconds}", language === "it" ? "2,0" : "2.0")}`);
    assert.equal(first([{ type: "startup", mark: "script", seconds: 1.5 }]),
      `- ${strings.resourceTestSummaryLongestStep.replace("{from}", strings.resourceTestStartupNode)
        .replace("{to}", strings.resourceTestStartupScript).replace("{seconds}", language === "it" ? "1,5" : "1.5")}`);
  }
});
