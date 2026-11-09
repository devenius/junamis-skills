import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  boot,
  checkpoint,
  completeTask,
  end,
  endFailed,
  finish,
  makeFixture,
  planSet,
  readJson,
  readText,
  runCli,
  start,
  status,
  writeArtifact,
  writeHandoff,
  handoffText,
} from "./orchestrator-helpers.js";

test("the reference lifecycle reaches COMPLETE and releases the lease", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);

  for (const [taskId, capability, next] of [
    ["T-001", "route", "develop"],
    ["T-002", "develop", "release-prep"],
    ["T-003", "release-prep", "none"],
  ]) {
    const done = completeTask(fixture, { taskId, capability, next });
    assert.equal(done.started.status, 0, done.started.stderr);
    assert.equal(done.ended.status, 0, done.ended.stderr);
  }

  const check = checkpoint(fixture);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /status: checkpointed/);

  const finished = finish(fixture);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /status: COMPLETE/);
  assert.equal(existsSync(join(fixture.state, "locks", "session-s-unittest.json")), false);

  const after = status(fixture);
  assert.equal(after.status, 0);
  assert.match(after.stdout, /status: COMPLETE/);
  assert.match(after.stdout, /tasks: pending=0 in_progress=0 done=3 failed=0 needs_review=0/);
  assert.match(readText(join(fixture.state, "resume-report.md")), /Status: COMPLETE/);
});

test("end with a missing artifact escalates to needs_review and exits 5", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  assert.equal(start(fixture, "T-001").status, 0);
  const handoff = writeHandoff(
    fixture,
    "T-001",
    "route-1.yaml",
    handoffText({
      agent: "route",
      artifacts: [{ path: "artifacts/missing.md", kind: "created" }],
      next: "develop",
    }),
  );

  const result = end(fixture, "T-001", "T-001/route/attempt-1", handoff);
  assert.equal(result.status, 5);
  assert.match(result.stderr, /invalid_handoff/);
  assert.equal(existsSync(join(fixture.state, handoff)), true);
  const task = readJson(join(fixture.state, "tasks", "T-001", "task.json"));
  assert.equal(task.status, "needs_review");
  assert.match(readText(join(fixture.state, "journal.ndjson")), /"reason":"invalid_handoff"/);
});

test("a needs-decision handoff becomes needs_review and resolve reopens the task", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  writeArtifact(fixture, "artifacts/T-001.md");
  assert.equal(start(fixture, "T-001").status, 0);
  const handoff = writeHandoff(
    fixture,
    "T-001",
    "route-1.yaml",
    handoffText({
      agent: "route",
      status: "needs-decision",
      artifacts: [{ path: "artifacts/T-001.md", kind: "created" }],
      decisions: ["Which path should the next step take?"],
      next: "user",
    }),
  );

  const decided = end(fixture, "T-001", "T-001/route/attempt-1", handoff);
  assert.equal(decided.status, 0, decided.stderr);
  assert.match(decided.stdout, /status: needs_review/);
  let task = readJson(join(fixture.state, "tasks", "T-001", "task.json"));
  assert.equal(task.status, "needs_review");
  assert.deepEqual(task.questions, ["Which path should the next step take?"]);

  const resolved = runCli(fixture, ["resolve", "--task", "T-001", "--decision", "take path A"]);
  assert.equal(resolved.status, 0, resolved.stderr);
  task = readJson(join(fixture.state, "tasks", "T-001", "task.json"));
  assert.equal(task.status, "pending");
  assert.equal(task.resolution.decision, "take path A");

  const retried = completeTask(fixture, { taskId: "T-001", capability: "route", attempt: 2, next: "develop" });
  assert.equal(retried.started.status, 0, retried.started.stderr);
  assert.equal(retried.ended.status, 0, retried.ended.stderr);
  task = readJson(join(fixture.state, "tasks", "T-001", "task.json"));
  assert.equal(task.status, "done");
  assert.equal(task.attempt, 2);
});

test("end without a handoff records a failed step", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  assert.equal(start(fixture, "T-001").status, 0);
  const failed = endFailed(fixture, "T-001", "T-001/route/attempt-1", "the tool crashed");
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stdout, /status: failed/);
  const task = readJson(join(fixture.state, "tasks", "T-001", "task.json"));
  assert.equal(task.status, "failed");
  assert.equal(task.last_error, "the tool crashed");
});

test("resolve rejects a task that is not in needs_review", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const result = runCli(fixture, ["resolve", "--task", "T-001", "--decision", "noop"]);
  assert.equal(result.status, 5);
  assert.match(result.stderr, /not needs_review/);
});

test("finish refuses a run with tasks that are not done, and allows an empty plan", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const refused = finish(fixture);
  assert.equal(refused.status, 5);
  assert.match(refused.stderr, /not every task is done/);

  const empty = makeFixture({ tasks: [] });
  assert.equal(boot(empty).status, 0);
  const finished = finish(empty);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /status: COMPLETE/);
  const booted = boot(empty);
  assert.equal(booted.status, 0, booted.stderr);
  assert.match(booted.stdout, /status: COMPLETE/);
});

test("a writing command without its lease exits 2 and journals lease_lost", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  unlinkSync(join(fixture.state, "locks", "session-s-unittest.json"));

  const result = planSet(fixture);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /halt: lease_lost/);
  assert.match(readText(join(fixture.state, "journal.ndjson")), /"type":"lease_lost"/);
});

test("plan set refuses on drift before writing a plan", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const planPath = join(fixture.state, "plan.json");
  const before = readJson(planPath).checksum;
  writeFileSync(fixture.manifest, `${JSON.stringify({ version: 1, skills: { extra: { source: "x" } } }, null, 2)}\n`);
  const drifted = planSet(fixture);
  assert.equal(drifted.status, 3);
  assert.match(drifted.stdout, /status: BLOCKED_DRIFT/);
  assert.equal(readJson(planPath).checksum, before);
  assert.match(readText(join(fixture.state, "resume-report.md")), /## Drift/);
});

test("checkpoint regenerates STATE.md and keeps the journal chain verifiable", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const result = checkpoint(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readText(join(fixture.state, "STATE.md")), /^# Orchestrator State/);
  assert.match(readText(join(fixture.state, "STATE.md")), /Status: RESUMING/);
  const journal = readText(join(fixture.state, "journal.ndjson")).trim().split("\n");
  assert.ok(journal.length >= 1);
  assert.match(journal[0], /checkpoint_written/);
});

test("--json emits exactly one object with the contract keys", () => {
  const fixture = makeFixture();
  const booted = runCli(fixture, ["boot", "--json"], { session: "s-json1" });
  assert.equal(booted.status, 0, booted.stderr);
  assert.equal(booted.stdout.trim().split("\n").length, 1);
  const object = JSON.parse(booted.stdout);
  for (const key of [
    "ok",
    "command",
    "status",
    "exitCode",
    "runId",
    "sessionId",
    "projectRoot",
    "stateRoot",
    "reportPath",
    "cursor",
    "tasksSummary",
    "drift",
    "lease",
    "error",
  ]) {
    assert.ok(key in object, `missing ${key}`);
  }
  assert.equal(object.ok, true);
  assert.equal(object.command, "boot");
  assert.equal(object.status, "NEW_RUN");
  assert.equal(object.exitCode, 0);

  const bad = runCli(fixture, ["start", "--json"], { session: "s-json2" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout.trim().split("\n").length, 1);
  const errorObject = JSON.parse(bad.stdout);
  assert.equal(errorObject.ok, false);
  assert.ok(errorObject.error);
});
