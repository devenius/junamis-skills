import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runReconcile } from "../dist/reconcile/queue.js";
import { reasonWeight, score } from "../dist/reconcile/score.js";
import { boot, makeRun, planSet, readJson } from "./helpers/orchestrator.js";

function reconcileOptions(run) {
  return {
    stateRoot: run.stateRoot,
    projectRoot: run.project,
    designRoot: join(run.project, "docs", "design"),
    libraryRoot: join(run.project, "library"),
    manifestPath: join(run.project, "skills-lock.json"),
    trigger: "test",
  };
}

test("R-T1 two passes on the same input produce a byte-equal work queue", async () => {
  const run = makeRun();
  const booted = boot(run);
  assert.equal(booted.status, 0, booted.stderr);
  const planned = planSet(run);
  assert.equal(planned.status, 0, planned.stderr);

  const first = await runReconcile(reconcileOptions(run));
  const firstBytes = readFileSync(join(run.stateRoot, "work-queue.json"), "utf8");
  const firstReport = readFileSync(join(run.stateRoot, "reconcile-report.md"), "utf8");
  assert.equal(existsSync(join(run.stateRoot, "reconcile", "detectors.yaml")), true);

  const second = await runReconcile(reconcileOptions(run));
  const secondBytes = readFileSync(join(run.stateRoot, "work-queue.json"), "utf8");
  const secondReport = readFileSync(join(run.stateRoot, "reconcile-report.md"), "utf8");

  assert.equal(first.passId, second.passId);
  assert.equal(firstBytes, secondBytes);
  assert.equal(firstReport, secondReport);
  const queue = JSON.parse(secondBytes);
  assert.equal(queue.schema_version, 1);
  assert.equal(queue.status, "ready");
  assert.ok(queue.queue.length > 0);
});

test("R-T1 plan_pending order follows the plan, not a fractional score", async () => {
  const run = makeRun();
  assert.equal(boot(run).status, 0);
  assert.equal(planSet(run).status, 0);
  await runReconcile(reconcileOptions(run));
  const queue = readJson(join(run.stateRoot, "work-queue.json"));
  const pending = queue.queue.filter((candidate) => candidate.reason === "plan_pending");
  assert.deepEqual(pending.map((candidate) => candidate.target.id), ["T-001", "T-002", "T-003"]);
  assert.deepEqual(pending.map((candidate) => candidate.plan_position), [0, 1, 2]);
});

test("R-T3 scoring uses the fixed severity base, reason weight, and buckets", () => {
  assert.equal(reasonWeight("failed_step"), 2);
  assert.equal(reasonWeight("code_drift"), 3);
  assert.equal(reasonWeight("plan_pending"), 6);
  assert.equal(reasonWeight("unknown_reason"), 100);

  const cases = [
    [{ reason: "failed_step", severity: "critical" }, "p0"],
    [{ reason: "code_drift", severity: "critical" }, "p0"],
    [{ reason: "failed_step", severity: "high" }, "p1"],
    [{ reason: "code_drift", severity: "high" }, "p1"],
    [{ reason: "plan_pending", severity: "high" }, "p1"],
    [{ reason: "failed_step", severity: "medium" }, "p2"],
    [{ reason: "code_drift", severity: "medium" }, "p2"],
    [{ reason: "plan_pending", severity: "medium" }, "p2"],
    [{ reason: "failed_step", severity: "low" }, "p3"],
    [{ reason: "plan_pending", severity: "low" }, "p3"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(score(input).priority, expected, JSON.stringify(input));
  }

  assert.equal(score({ reason: "unknown_reason", severity: "critical" }).score, 100);
  assert.equal(score({ reason: "plan_pending", severity: "medium" }).score, 206);
  assert.equal(score({ reason: "plan_pending", severity: "medium", planPosition: 5 }).score, 206.0005);
});
