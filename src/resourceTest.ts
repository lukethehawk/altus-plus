import fs from "fs";
import path from "path";
import { type ResourceGroup } from "./utils/resources";
import {
  CSV_HEADER,
  type TestEvent,
  type TestSample,
  type TestSummary,
  eventCsvLine,
  nextSampleDelay,
  sampleCsvLines,
  summarizeResourceTest,
  testBaseName,
  testFilesToRemove,
  toTestSample,
} from "./utils/resourceTest";

const FLUSH_MS = 5000;

export type ResourceTestFiles = { samples: string; summary: string };

/**
 * Records CPU and memory from the start of the process until finish(),
 * appending to a CSV file every few seconds. A failure is logged and never
 * stops the app.
 */
export class ResourceTestRecorder {
  readonly files: ResourceTestFiles;
  private readonly samples: TestSample[] = [];
  private readonly events: TestEvent[] = [];
  private readonly loadedTabs = new Set<string>();
  private pending: string[] = [];
  private sampleTimer?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setInterval>;
  private capped = false;
  private finished = false;

  constructor(
    private readonly options: {
      directory: string;
      /** When the process started (ms since the epoch). */
      startedAt: number;
      sample: () => ResourceGroup[];
      /** First event: app version, computer. */
      description: string;
      summarize: (summary: TestSummary, info: { capped: boolean; samplesFile: string }) => string;
    }
  ) {
    const base = path.join(options.directory, testBaseName(new Date(options.startedAt)));
    this.files = { samples: `${base}.csv`, summary: `${base}.txt` };
  }

  start() {
    const { directory } = this.options;
    fs.mkdirSync(directory, { recursive: true });
    for (const name of testFilesToRemove(fs.readdirSync(directory))) {
      try {
        fs.rmSync(path.join(directory, name), { force: true });
      } catch (error) {
        console.warn("Could not remove an old resource test", error);
      }
    }
    fs.writeFileSync(this.files.samples, `${CSV_HEADER}\r\n`);
    this.note(this.options.description, 0);
    this.note("app ready");
    this.takeSample();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
  }

  windowShown() {
    if (this.events.some((event) => event.type === "window-shown")) return;
    this.record({ type: "window-shown", seconds: this.seconds() }, "window shown");
  }

  /** The first unread count from a tab: its WhatsApp page has loaded. */
  accountLoaded(tabId: string, name: string) {
    if (this.loadedTabs.has(tabId)) return;
    this.loadedTabs.add(tabId);
    this.record({ type: "account-loaded", seconds: this.seconds(), tabId, name }, `WhatsApp page loaded: ${name}`);
  }

  /** Stops sampling and writes the summary; later calls return the same files. */
  finish(): ResourceTestFiles {
    if (this.finished) return this.files;
    this.finished = true;
    clearTimeout(this.sampleTimer);
    clearInterval(this.flushTimer);
    if (!this.capped) this.takeSample();
    const durationSeconds = this.seconds();
    this.note("test ended");
    this.flush();
    try {
      const summary = summarizeResourceTest(this.samples, this.events, durationSeconds);
      fs.writeFileSync(
        this.files.summary,
        this.options.summarize(summary, { capped: this.capped, samplesFile: path.basename(this.files.samples) })
      );
    } catch (error) {
      console.warn("Could not write the resource test summary", error);
    }
    return this.files;
  }

  private seconds() {
    return (Date.now() - this.options.startedAt) / 1000;
  }

  private takeSample = () => {
    if (this.finished) return;
    try {
      const seconds = this.seconds();
      const groups = this.options.sample();
      this.samples.push(toTestSample(seconds, groups));
      this.pending.push(...sampleCsvLines(seconds, new Date(), groups));
    } catch (error) {
      console.warn("Could not sample resource usage", error);
    }
    const delay = nextSampleDelay(Date.now() - this.options.startedAt);
    if (delay === null) {
      this.capped = true;
      this.note("sampling stopped after 24 hours");
      return;
    }
    this.sampleTimer = setTimeout(this.takeSample, delay);
  };

  private record(event: TestEvent, description: string) {
    if (this.finished) return;
    this.events.push(event);
    this.note(description, event.seconds);
  }

  private note(description: string, seconds = this.seconds()) {
    this.pending.push(eventCsvLine(seconds, new Date(this.options.startedAt + seconds * 1000), description));
  }

  // Small synchronous appends keep the rows in order.
  private flush() {
    if (!this.pending.length) return;
    const lines = this.pending;
    this.pending = [];
    try {
      fs.appendFileSync(this.files.samples, `${lines.join("\r\n")}\r\n`);
    } catch (error) {
      console.warn("Could not write resource test samples", error);
    }
  }
}
