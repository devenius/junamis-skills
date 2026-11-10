import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyDelta } from "../dist/design/delta.js";
import { writeDelta, writeSurface } from "./design-helpers.js";
import {
  TASKS,
  boot,
  completeTask,
  countEvents,
  end,
  makeRun,
  planSet,
  prepareRun,
  readJson,
  readTask,
  start,
  writeFixtureHandoff,
} from "./helpers/orchestrator.js";

test("R-T8 a step_end triggers exactly one reconcile pass", () => {
  const { run } = prepareRun();
  const before = countEvents(run, "reconcile_pass");
  const completed = completeTask(run, TASKS[0]);
  assert.equal(completed.started.status, 0, completed.started.stderr);
  assert.equal(completed.ended.status, 0, completed.ended.stderr);
  assert.equal(countEvents(run, "reconcile_pass"), before + 1);
});

test("R-T8 a drift_detected trigger produces exactly one blocked pass", () => {
  const { run } = prepareRun();
  const before = countEvents(run, "reconcile_pass");
  appendFileSync(join(run.project, "library", "agents", "orchestrator.md"), "\nchanged for drift\n");

  const started = start(run, "T-001");
  assert.equal(started.status, 3, started.stderr);
  assert.equal(countEvents(run, "reconcile_pass"), before + 1);
  const queue = readJson(join(run.stateRoot, "work-queue.json"));
  assert.equal(queue.status, "blocked_drift");
  assert.equal(queue.queue.length, 1);
  assert.equal(queue.queue[0].ready, false);
});

test("R-T8 a design_delta_rejected triggers exactly one fresh pass", async () => {
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
  assert.equal(boot(run).status, 0);
  assert.equal(planSet(run).status, 0);

  const before = countEvents(run, "reconcile_pass");
  const delta = `surface_id: other/example
operation: update
base_checksum: sha256:${"1".repeat(64)}
sections:
  - section: "Current state"
    action: replace
    content: "Changed after rejection."
task_id: T-001
skill: library/develop
idempotent: false
`;
  const deltaPath = writeDelta(run.project, "stale.yaml", delta);
  const rejected = await applyDelta({
    projectRoot: run.project,
    designRoot,
    stateRoot: run.stateRoot,
    deltaPath,
    now: "2026-11-10",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.rejected, true);
  assert.equal(countEvents(run, "reconcile_pass"), before + 1);
});

test("R-T11 a crash after step_end before reconcile converges on the same head at boot", () => {
  const uninterrupted = prepareRun().run;
  const interrupted = prepareRun().run;

  for (const run of [uninterrupted, interrupted]) {
    const completed = completeTask(run, TASKS[0]);
    assert.equal(completed.ended.status, 0, completed.ended.stderr);
  }

  const startedA = start(uninterrupted, "T-002");
  assert.equal(startedA.status, 0, startedA.stderr);
  const taskA = readTask(uninterrupted, "T-002");
  const handoffA = writeFixtureHandoff(uninterrupted, "T-002", "develop", taskA.attempt);
  const endedA = end(uninterrupted, "T-002", taskA.current_step.step_id, handoffA);
  assert.equal(endedA.status, 0, endedA.stderr);
  const queueA = readJson(join(uninterrupted.stateRoot, "work-queue.json"));

  const startedB = start(interrupted, "T-002");
  assert.equal(startedB.status, 0, startedB.stderr);
  const taskB = readTask(interrupted, "T-002");
  const handoffB = writeFixtureHandoff(interrupted, "T-002", "develop", taskB.attempt);
  const crashed = end(interrupted, "T-002", taskB.current_step.step_id, handoffB, { crashAt: "after_step_end_journal" });
  assert.notEqual(crashed.status, 0, "the end command should have been killed before reconcile");

  const booted = boot(interrupted);
  assert.equal(booted.status, 0, booted.stderr);
  const queueB = readJson(join(interrupted.stateRoot, "work-queue.json"));

  assert.equal(queueB.queue[0]?.candidate_id, queueA.queue[0]?.candidate_id);
  assert.equal(queueB.queue[0]?.target.id, queueA.queue[0]?.target.id);
});
