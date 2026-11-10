import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JournalWriter, readJournal } from "../dist/orchestrator/journal.js";
import { runReconcile } from "../dist/reconcile/queue.js";
import { writeSurface } from "./design-helpers.js";
import {
  TASKS,
  boot,
  completeTask,
  countEvents,
  journalEvents,
  makeRun,
  planSet,
  readJson,
  run,
} from "./helpers/orchestrator.js";

function options(context) {
  return {
    stateRoot: context.stateRoot,
    projectRoot: context.project,
    designRoot: join(context.project, "docs", "design"),
    libraryRoot: join(context.project, "library"),
    manifestPath: join(context.project, "skills-lock.json"),
    trigger: "test",
  };
}

const DETECTORS = [
  ["plan_pending", 10],
  ["code_drift", 20],
  ["failed_step", 30],
  ["coverage_gap", 40],
  ["dependency_drift", 50],
  ["needs_review", 60],
  ["stale_surface", 70],
  ["shadow_conflict", 5],
];

function writeManifest(context, enabled) {
  const dir = join(context.stateRoot, "reconcile");
  mkdirSync(dir, { recursive: true });
  const lines = ["schema_version: 1", "tick_every: 10", "detectors:"];
  for (const [id, order] of DETECTORS) {
    lines.push(`  - id: ${id}`);
    lines.push(`    enabled: ${enabled.includes(id) ? "true" : "false"}`);
    lines.push(`    order: ${order}`);
  }
  writeFileSync(join(dir, "detectors.yaml"), `${lines.join("\n")}\n`);
}

function writeOrphanPlan(context) {
  const plan = {
    tasks: [
      {
        task_id: "T-010",
        capability: "orphan",
        depends_on: [],
        resolved_skill: "external/orphan",
        resolution_source: "manifest",
        owner: "orchestrator",
        adapter: null,
        idempotent: false,
      },
    ],
  };
  writeFileSync(join(context.project, "orphan-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const result = run(context, ["plan", "set", "--file", "orphan-plan.json"]);
  assert.equal(result.status, 0, result.stderr);
  return plan;
}

async function appendJournal(context, payload) {
  const path = join(context.stateRoot, "journal.ndjson");
  const info = await readJournal(path);
  const last = info.events.at(-1) ?? null;
  const writer = new JournalWriter({
    path,
    events: info.events,
    prevHash: last?.hash ?? null,
    lastSeq: last?.seq ?? 0,
  });
  return writer.append({
    run_id: last?.run_id ?? "run-test",
    session_id: "s-test",
    ...payload,
  });
}

test("R-T2 adding an unrelated candidate does not change an existing candidate id", async () => {
  const context = makeRun();
  assert.equal(boot(context).status, 0);
  assert.equal(planSet(context).status, 0);
  await runReconcile(options(context));
  const first = readJson(join(context.stateRoot, "work-queue.json"));
  const firstId = first.queue.find((candidate) => candidate.target.id === "T-001").candidate_id;

  const designRoot = join(context.project, "docs", "design");
  mkdirSync(designRoot, { recursive: true });
  writeSurface({
    designRoot,
    surfaceId: "other/review",
    kind: "other",
    status: "needs_review",
    codePaths: [],
  });
  writeManifest(context, ["plan_pending", "needs_review"]);
  await runReconcile(options(context));

  const second = readJson(join(context.stateRoot, "work-queue.json"));
  const secondId = second.queue.find((candidate) => candidate.target.id === "T-001").candidate_id;
  assert.equal(secondId, firstId);
  assert.ok(second.queue.some((candidate) => candidate.target.id === "other/review"));
});

test("R-T4 BLOCKED_DRIFT produces blocked_drift with no dispatchable candidate", async () => {
  const context = makeRun();
  assert.equal(boot(context).status, 0);
  assert.equal(planSet(context).status, 0);
  const result = await runReconcile({
    ...options(context),
    status: "BLOCKED_DRIFT",
    drift: { match: false, detail: "test drift" },
  });
  assert.equal(result.status, "blocked_drift");
  assert.equal(result.queue.queue.length, 1);
  assert.equal(result.queue.queue.every((candidate) => candidate.ready === false), true);
  assert.equal(result.queue.queue[0].resolution_source, "needs_review");
});

test("R-T5 a candidate with no resolvable skill becomes a non-dispatchable shadow conflict", async () => {
  const context = makeRun();
  assert.equal(boot(context).status, 0);
  writeOrphanPlan(context);
  writeManifest(context, ["plan_pending", "shadow_conflict"]);

  const result = await runReconcile(options(context));
  const candidate = result.queue.queue.find((entry) => entry.target.id === "T-010");
  assert.ok(candidate);
  assert.equal(candidate.reason, "shadow_conflict");
  assert.equal(candidate.capability, "needs_review");
  assert.equal(candidate.ready, false);
  assert.equal(candidate.resolution_source, "needs_review");
  assert.equal(candidate.resolved_skill, "needs_review");
});

test("R-T6 an unmet plan dependency is ready false with the blocker", async () => {
  const context = makeRun();
  assert.equal(boot(context).status, 0);
  assert.equal(planSet(context).status, 0);
  const result = await runReconcile(options(context));
  const candidate = result.queue.queue.find((entry) => entry.target.id === "T-002");
  assert.ok(candidate);
  assert.equal(candidate.ready, false);
  assert.ok(candidate.blocked_by.includes("T-001"));
});

test("R-T7 two detectors on one target merge into one candidate with both provenance entries", async () => {
  const context = makeRun();
  assert.equal(boot(context).status, 0);
  writeOrphanPlan(context);
  await appendJournal(context, { type: "escalation", task_id: "T-010", reason: "test needs review" });
  writeManifest(context, ["plan_pending", "needs_review", "shadow_conflict"]);

  const result = await runReconcile(options(context));
  const matches = result.queue.queue.filter((entry) => entry.target.id === "T-010");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].reason, "shadow_conflict");
  const detectors = matches[0].provenance.map((entry) => entry.detector);
  assert.ok(detectors.includes("shadow_conflict"));
  assert.ok(detectors.includes("needs_review"));
});

test("R-T9 all tasks done produces no_work and journals run_complete", () => {
  const context = makeRun();
  assert.equal(boot(context).status, 0);
  assert.equal(planSet(context).status, 0);
  for (const task of TASKS) {
    const completed = completeTask(context, task);
    assert.equal(completed.ended.status, 0, completed.ended.stderr);
  }
  const queue = readJson(join(context.stateRoot, "work-queue.json"));
  assert.equal(queue.status, "no_work");
  assert.ok(countEvents(context, "run_complete") >= 1);
});

test("R-T10 plan work blocked by a needs_review surface is stalled with the blocking set", async () => {
  const context = makeRun();
  const designRoot = join(context.project, "docs", "design");
  mkdirSync(designRoot, { recursive: true });
  writeSurface({
    designRoot,
    surfaceId: "other/gate",
    kind: "other",
    status: "needs_review",
    codePaths: [],
  });
  writeFileSync(join(designRoot, "_registry.json"), `${JSON.stringify({ bootstrap_complete: false })}\n`);
  assert.equal(boot(context).status, 0);
  assert.equal(planSet(context).status, 0);

  const result = await runReconcile(options(context));
  assert.equal(result.status, "no_work");
  assert.equal(result.queue.stalled, true);
  assert.equal(result.queue.summary.stalled, true);
  assert.ok(result.queue.summary.blocking_set.includes("other/gate"));
  assert.ok(countEvents(context, "run_stalled") >= 1);
});

test("periodic tick fires after N step_end events", async () => {
  const context = makeRun();
  assert.equal(boot(context).status, 0);
  assert.equal(planSet(context).status, 0);
  writeManifest(context, ["plan_pending"]);
  for (let index = 0; index < 10; index++) {
    await appendJournal(context, {
      type: "step_end",
      task_id: `T-9${index}`,
      step_id: `T-9${index}/test/attempt-1`,
      task_status: "done",
      outputs: [],
    });
  }
  const result = await runReconcile(options(context));
  assert.equal(result.tick, true);
  assert.ok(journalEvents(context).some((event) => event.type === "reconcile_pass" && event.tick === true));
});

test("R-T12 a valid override applies and a missing rationale is rejected and journaled", async () => {  const context = makeRun();
  assert.equal(boot(context).status, 0);
  assert.equal(planSet(context).status, 0);
  await runReconcile(options(context));
  const queue = readJson(join(context.stateRoot, "work-queue.json"));
  const candidate = queue.queue.find((entry) => entry.target.id === "T-001");
  assert.ok(candidate);

  await appendJournal(context, {
    type: "priority_override",
    candidate_id: candidate.candidate_id,
    from: "p2",
    to: "p1",
    rationale: "blocks the release",
    by: "operator",
  });
  await runReconcile(options(context));
  const overridden = readJson(join(context.stateRoot, "work-queue.json"));
  assert.equal(overridden.queue.find((entry) => entry.candidate_id === candidate.candidate_id).priority, "p1");

  const invalid = await appendJournal(context, {
    type: "priority_override",
    candidate_id: candidate.candidate_id,
    from: "p2",
    to: "p0",
    by: "operator",
  });
  await runReconcile(options(context));
  const rejected = journalEvents(context).find(
    (event) => event.type === "priority_override_rejected" && event.override_seq === invalid.seq,
  );
  assert.ok(rejected);
  assert.equal(rejected.reason, "missing rationale");
});
