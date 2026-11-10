import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyDelta } from "../src/design/delta.js";
import { detectCodeDrift, runDrift } from "../src/design/drift.js";
import { generateIndex } from "../src/design/index-gen.js";
import { readSurface, validateRegistry } from "../src/design/schema.js";
import {
  commitAll,
  initGit,
  makeDesignFixture,
  REPO_DESIGN,
  writeDelta,
  writeSurface,
} from "./design-helpers.js";
import {
  boot,
  journalEvents,
  makeRun,
  planSet,
} from "./helpers/orchestrator.js";
import { loadRun } from "../src/orchestrator/store.js";

const STALE = `sha256:${"1".repeat(64)}`;

test("D-T1 every committed design surface validates against its kind schema", async () => {
  const result = await validateRegistry(REPO_DESIGN);
  const problems = result.errors.flatMap((entry) => entry.errors.map((error) => `${entry.file}: ${error}`));
  assert.equal(result.ok, true, problems.join("\n"));
  assert.ok(result.count >= 50, `expected the bootstrapped registry, found ${result.count} file(s)`);
});

test("D-T2 regenerating INDEX.md is byte-equal to the committed file", async () => {
  const generated = await generateIndex({ designRoot: REPO_DESIGN });
  const committed = readFileSync(join(REPO_DESIGN, "INDEX.md"), "utf8");
  assert.equal(generated.content, committed);
  const again = await generateIndex({ designRoot: REPO_DESIGN });
  assert.equal(again.content, generated.content);
});

test("D-T3 an idempotent delta applied twice leaves the file identical", async () => {
  const fixture = makeDesignFixture();
  writeSurface({
    designRoot: fixture.designRoot,
    surfaceId: "api/get-user",
    kind: "api",
    codePaths: [],
  });
  const before = await readSurface(fixture.designRoot, "api/get-user");
  const delta = `surface_id: api/get-user
operation: update
base_checksum: ${before.checksum}
sections:
  - section: "Response — 200"
    action: replace
    content: |
      | field | type | nullable | notes |
      |-------|------|----------|-------|
      | \`id\` | \`string(uuid)\` | no | |
      | \`updatedAt\` | \`string(iso8601)\` | no | added |
  - section: "Change log"
    action: append
    content: "2026-11-10 · v0.2.0 · Added updatedAt · task T-014 · library/develop"
task_id: T-014
skill: library/develop
idempotent: true
`;
  const deltaPath = writeDelta(fixture.project, "delta.yaml", delta);
  const first = await applyDelta({
    projectRoot: fixture.project,
    designRoot: fixture.designRoot,
    stateRoot: fixture.stateRoot,
    deltaPath,
    now: "2026-11-10",
  });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.unchanged, false);
  const afterFirst = readFileSync(join(fixture.designRoot, "api", "get-user.md"), "utf8");

  const second = await applyDelta({
    projectRoot: fixture.project,
    designRoot: fixture.designRoot,
    stateRoot: fixture.stateRoot,
    deltaPath,
    now: "2026-11-10",
  });
  assert.equal(second.ok, true, second.reason);
  assert.equal(second.unchanged, true);
  const afterSecond = readFileSync(join(fixture.designRoot, "api", "get-user.md"), "utf8");
  assert.equal(afterSecond, afterFirst);
});

test("D-T4 a stale base checksum is rejected, journaled, and marks the task needs_review", async () => {
  const run = makeRun();
  const designRoot = join(run.project, "docs", "design");
  mkdirSync(designRoot, { recursive: true });
  writeSurface({
    designRoot,
    surfaceId: "other/example",
    kind: "other",
    codePaths: ["src/example.js"],
  });
  writeFileSync(join(designRoot, "_registry.json"), `${JSON.stringify({ bootstrap_complete: false })}\n`);

  const booted = boot(run);
  assert.equal(booted.status, 0, booted.stderr);
  const planned = planSet(run);
  assert.equal(planned.status, 0, planned.stderr);

  const delta = `surface_id: other/example
operation: update
base_checksum: ${STALE}
sections:
  - section: "Current state"
    action: replace
    content: "Changed."
task_id: T-001
skill: library/develop
idempotent: false
`;
  const deltaPath = writeDelta(run.project, "stale.yaml", delta);
  const result = await applyDelta({
    projectRoot: run.project,
    designRoot,
    stateRoot: run.stateRoot,
    deltaPath,
    now: "2026-11-10",
  });
  assert.equal(result.ok, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "stale_base_checksum");

  const events = journalEvents(run);
  assert.ok(events.some((event) => event.type === "design_delta_rejected"), "missing design_delta_rejected event");
  const loaded = await loadRun(run.stateRoot);
  const task = loaded.tasks.find((entry) => entry.task_id === "T-001");
  assert.equal(task.status, "needs_review");
});

test("D-T5 code changed under an active surface without a design update is CODE_DRIFT", async () => {
  const fixture = makeDesignFixture();
  const codePath = "src/feature/file.js";
  mkdirSync(join(fixture.project, "src", "feature"), { recursive: true });
  writeFileSync(join(fixture.project, codePath), "export const value = 1;\n");
  initGit(fixture.project);
  const first = commitAll(fixture.project, "initial code", "2026-11-10T10:00:00Z");

  writeSurface({
    designRoot: fixture.designRoot,
    surfaceId: "other/feature",
    kind: "other",
    status: "active",
    codePaths: [codePath],
    lastReviewedCommit: first,
  });
  commitAll(fixture.project, "record surface", "2026-11-10T10:01:00Z");

  writeFileSync(join(fixture.project, codePath), "export const value = 2;\n");
  commitAll(fixture.project, "change code", "2026-11-10T10:02:00Z");

  const flags = await detectCodeDrift({
    designRoot: fixture.designRoot,
    projectRoot: fixture.project,
    git: true,
  });
  assert.equal(flags.length, 1, JSON.stringify(flags));
  assert.equal(flags[0].type, "CODE_DRIFT");
  assert.equal(flags[0].surface_id, "other/feature");
  assert.deepEqual(flags[0].files, [codePath]);
});

test("D-T6 coverage reports overlaps and unclaimed files, and the bootstrap flag gates the failure", async () => {
  const fixture = makeDesignFixture();
  mkdirSync(join(fixture.project, "src", "feature"), { recursive: true });
  writeFileSync(join(fixture.project, "src", "feature", "existing.js"), "export const existing = true;\n");
  writeFileSync(join(fixture.project, "src", "feature", "new.js"), "export const added = true;\n");
  writeSurface({
    designRoot: fixture.designRoot,
    surfaceId: "other/feature",
    kind: "other",
    codePaths: ["src/feature/existing.js"],
  });
  writeSurface({
    designRoot: fixture.designRoot,
    surfaceId: "other/overlap",
    kind: "other",
    codePaths: ["src/feature/existing.js"],
  });
  writeFileSync(join(fixture.designRoot, "_registry.json"), `${JSON.stringify({ bootstrap_complete: false })}\n`);

  const open = await runDrift({ designRoot: fixture.designRoot, projectRoot: fixture.project, git: false });
  assert.equal(open.ok, true);
  assert.equal(open.coverage.enforced, false);
  assert.ok(open.coverage.unclaimed.includes("src/feature/new.js"));
  assert.deepEqual(open.coverage.overlaps.map((entry) => entry.path), ["src/feature/existing.js"]);

  writeFileSync(join(fixture.designRoot, "_registry.json"), `${JSON.stringify({ bootstrap_complete: true })}\n`);
  const enforced = await runDrift({ designRoot: fixture.designRoot, projectRoot: fixture.project, git: false });
  assert.equal(enforced.ok, false);
  assert.equal(enforced.coverage.enforced, true);
  assert.ok(enforced.coverage.unclaimed.includes("src/feature/new.js"));
});

test("D-T7 a delta against a deprecated surface is rejected", async () => {
  const fixture = makeDesignFixture();
  writeSurface({
    designRoot: fixture.designRoot,
    surfaceId: "other/example",
    kind: "other",
    status: "deprecated",
    codePaths: [],
  });
  const before = await readSurface(fixture.designRoot, "other/example");
  const delta = `surface_id: other/example
operation: update
base_checksum: ${before.checksum}
sections:
  - section: "Current state"
    action: replace
    content: "Should not be written."
task_id: T-001
skill: library/develop
idempotent: false
`;
  const deltaPath = writeDelta(fixture.project, "deprecated.yaml", delta);
  const result = await applyDelta({
    projectRoot: fixture.project,
    designRoot: fixture.designRoot,
    stateRoot: fixture.stateRoot,
    deltaPath,
    now: "2026-11-10",
  });
  assert.equal(result.ok, false);
  assert.equal(result.rejected, true);
  assert.equal(result.code, "status_guard");
  const after = readFileSync(before.file, "utf8");
  assert.ok(after.includes("What is here now."));
  assert.ok(!after.includes("Should not be written."));
});
