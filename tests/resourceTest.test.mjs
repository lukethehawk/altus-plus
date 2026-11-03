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
  summarizeResourceTest,
  testBaseName,
  testFilesToRemove,
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

const groups = (lavoro, casa, cpu = 0.5) => [
  { kind: "account", tabId: "work", name: "Lavoro", processes: 1, cpuPercent: cpu, privateMB: lavoro, workingSetMB: 100 },
  { kind: "account", tabId: "home", name: "=Casa", processes: casa ? 1 : 0, cpuPercent: 0, privateMB: casa, workingSetMB: 50 },
  { kind: "main", processes: 1, cpuPercent: 0.1, privateMB: 90, workingSetMB: 120 },
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

function run({ minutes, calmFrom = 20, growth = 0 }) {
  const samples = [];
  for (let seconds = 1; seconds <= minutes * 60; seconds += seconds < 300 ? 1 : 10) {
    const cpu = seconds < calmFrom ? 30 : 0.5;
    const lavoro = 300 + Math.min(seconds, 10) * 20 + (growth * seconds) / 3600;
    samples.push(toTestSample(seconds, groups(lavoro, seconds >= 3 ? 400 : 0, cpu)));
  }
  const events = [
    { type: "window-shown", seconds: 0.8 },
    { type: "account-loaded", seconds: 2.5, tabId: "work", name: "Lavoro" },
    { type: "account-loaded", seconds: 4, tabId: "home", name: "=Casa" },
  ];
  return summarizeResourceTest(samples, events, minutes * 60);
}

test("summarizes startup: window, pages, peaks and when the CPU calms down", () => {
  const summary = run({ minutes: 10 });
  assert.equal(summary.windowShownSeconds, 0.8);
  assert.deepEqual(summary.accountsLoaded, [{ name: "Lavoro", seconds: 2.5 }, { name: "=Casa", seconds: 4 }]);
  // Lavoro busy at 30 % plus the main process, from the first sample.
  assert.deepEqual(summary.peakCpu, { value: 30.1, seconds: 1 });
  assert.equal(summary.peakMemory.value, 990);
  assert.equal(summary.calmSeconds, 20);
  assert.deepEqual(summary.end, { cpuPercent: 0.6, privateMB: 990 });
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

test("formats durations", () => {
  assert.equal(formatDuration(42.4), "42 s");
  assert.equal(formatDuration(125), "2 min 5 s");
  assert.equal(formatDuration(2 * 3600 + 14 * 60 + 9), "2 h 14 min");
});

test("writes the summary in the app's language, with every template filled", () => {
  for (const language of ["en", "it"]) {
    const strings = translation(language);
    const text = formatSummary(
      run({ minutes: 45, growth: 12 }),
      { title: "Altus + 5.8.1-plus.15", started: "2026-11-03 17:02:11", computer: "10 CPU", samplesFile: "resource-test-x.csv", capped: true },
      (key) => strings[key] ?? key,
      language
    );
    assert.doesNotMatch(text, /\{\w+\}|resourceTestSummary/, language);
    assert.match(text, /Altus \+ 5\.8\.1-plus\.15/);
    assert.match(text, /Lavoro 2[.,]5 s, =Casa 4[.,]0 s/);
    assert.match(text, /\+12[.,]0/);
    assert.match(text, /resource-test-x\.csv/);
    assert.ok(text.endsWith("\r\n"));
  }
});
