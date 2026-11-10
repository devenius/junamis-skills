import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeSurface } from "./design-helpers.js";
import {
  boot,
  countEvents,
  makeRun,
  readReport,
} from "./helpers/orchestrator.js";

test("D-T8 mutating the design registry after boot produces BLOCKED_DRIFT with a design diff", () => {
  const run = makeRun();
  const designRoot = join(run.project, "docs", "design");
  mkdirSync(designRoot, { recursive: true });
  const surface = writeSurface({
    designRoot,
    surfaceId: "other/example",
    kind: "other",
    codePaths: ["src/example.js"],
  });
  writeFileSync(join(designRoot, "_registry.json"), `${JSON.stringify({ bootstrap_complete: false })}\n`);

  const first = boot(run);
  assert.equal(first.status, 0, first.stderr);
  const before = countEvents(run, "step_start");

  const original = readFileSync(surface.file, "utf8");
  writeFileSync(surface.file, original.replace("What is here now.", "Changed after boot."));

  const second = boot(run);
  assert.equal(second.status, 3, second.stderr);
  assert.match(second.stdout, /status: BLOCKED_DRIFT/);

  const report = readReport(run);
  assert.match(report, /## Drift/);
  assert.match(report, /design_registry\.index_sha256: sha256:[0-9a-f]{64} -> sha256:[0-9a-f]{64}/);
  assert.match(report, /other\/example\.md/);
  assert.equal(countEvents(run, "step_start"), before, "drift must not start a step");
});
