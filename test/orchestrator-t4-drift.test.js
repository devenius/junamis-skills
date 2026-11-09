import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  boot,
  countEvents,
  prepareRun,
  readReport,
} from "./helpers/orchestrator.js";

test("T4 changing a library override blocks with exit 3 and names the path", () => {
  const { run } = prepareRun();
  const before = countEvents(run, "step_start");
  appendFileSync(
    join(run.project, "library", "agents", "orchestrator.md"),
    "\nchanged by the fixture\n",
  );

  const booted = boot(run);
  assert.equal(booted.status, 3, booted.stderr);
  assert.match(booted.stdout, /status: BLOCKED_DRIFT/);

  const report = readReport(run);
  assert.match(report, /## Drift/);
  assert.match(report, /library_overrides_sha256: sha256:[0-9a-f]{64} -> sha256:[0-9a-f]{64}/);
  assert.match(report, /agents\/orchestrator\.md/);
  assert.equal(countEvents(run, "step_start"), before, "drift must not start a step");
});
