import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  boot,
  countEvents,
  prepareRun,
  readReport,
} from "./helpers/orchestrator.js";

test("T3 adding a manifest skill blocks with exit 3 and no new step_start", () => {
  const { run } = prepareRun();
  const before = countEvents(run, "step_start");
  const manifestPath = join(run.project, "skills-lock.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.skills["fixture-extra"] = {
    source: "fixture/source",
    sourceType: "github",
    skillPath: "skills/fixture-extra/SKILL.md",
    ref: "2222222222222222222222222222222222222222",
    treeSha: "3333333333333333333333333333333333333333",
    license: "MIT",
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const booted = boot(run);
  assert.equal(booted.status, 3, booted.stderr);
  assert.match(booted.stdout, /status: BLOCKED_DRIFT/);

  const report = readReport(run);
  assert.match(report, /## Drift/);
  assert.match(report, /skills_lock_sha256: sha256:[0-9a-f]{64} -> sha256:[0-9a-f]{64}/);
  assert.equal(countEvents(run, "step_start"), before, "drift must not start a step");
});
