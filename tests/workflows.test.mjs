import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, ".github/workflows");
const workflows = fs
  .readdirSync(dir)
  .filter((file) => file.endsWith(".yml"))
  .map((file) => [file, fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n")]);

/** The jobs of a workflow: the two-space keys under `jobs:`, each with its lines. */
const jobsOf = (text) =>
  (text.split(/^jobs:\n/m)[1] ?? "")
    .split(/^(?=  [\w-]+:\s*$)/m)
    .filter((block) => /^  [\w-]+:/.test(block))
    .map((block) => ({ name: block.match(/^  ([\w-]+):/)[1], text: block }));

test("every workflow job has a timeout", () => {
  assert.ok(workflows.length >= 5, "workflows found");
  for (const [file, text] of workflows) {
    const jobs = jobsOf(text);
    assert.ok(jobs.length > 0, `${file} has jobs`);
    for (const job of jobs) {
      // Without one, a hung step holds the runner for GitHub's 6-hour default.
      const minutes = Number(job.text.match(/^    timeout-minutes: (\d+)$/m)?.[1]);
      assert.ok(minutes >= 5 && minutes <= 60, `${file}, job ${job.name}: timeout-minutes is ${minutes}`);
    }
  }
});

test("pushes start workflows only on master", () => {
  for (const [file, text] of workflows) {
    const push = text.match(/^  push:\n((?: {4}.*\n)*)/m)?.[1];
    if (push === undefined) continue;
    const inline = push.match(/branches: \[([^\]]*)\]/)?.[1];
    const branches = inline === undefined
      ? [...push.matchAll(/^ {6}- (.+)$/gm)].map((match) => match[1].trim())
      : inline.split(",").map((branch) => branch.trim());
    assert.deepEqual(branches, ["master"], file);
  }
});

test("the checks master requires still run on every pull request", () => {
  // The "Protect master" ruleset requires these two job names: renaming one
  // would leave every pull request waiting for a check that never comes.
  const text = new Map(workflows).get("stability-checks.yml");
  assert.match(text, /^on:\n {2}pull_request:\n/m);
  assert.deepEqual(jobsOf(text).map((job) => job.name), ["validate", "windows-package"]);
});

test("Corepack checks the Yarn it downloads", () => {
  // The hash is of Yarn's yarn.js, the same file on npm and repo.yarnpkg.com.
  const { packageManager } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(packageManager, /^yarn@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
});
