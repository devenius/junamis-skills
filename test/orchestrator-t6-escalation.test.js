import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TASKS,
  boot,
  completeTask,
  countEvents,
  end,
  makeRun,
  planSet,
  readJournalText,
  readTask,
  start,
  writeFixtureHandoff,
} from "./helpers/orchestrator.js";

test("T6 a non-idempotent interrupted task escalates to needs_review without retry", () => {
  const run = makeRun();
  assert.equal(boot(run).status, 0);
  assert.equal(planSet(run).status, 0);
  for (const task of TASKS.slice(0, 2)) {
    assert.equal(completeTask(run, task).ended.status, 0);
  }

  assert.equal(start(run, "T-003").status, 0);
  const task = readTask(run, "T-003");
  const handoff = writeFixtureHandoff(run, "T-003", "release-prep", task.attempt);
  const crashed = end(run, "T-003", task.current_step.step_id, handoff, {
    crashAt: "before_step_end_journal",
  });
  assert.equal(crashed.signal, "SIGKILL");

  const booted = boot(run);
  assert.equal(booted.status, 0, booted.stderr);
  const after = readTask(run, "T-003");
  assert.equal(after.status, "needs_review");
  assert.equal(after.attempt, 1);
  assert.match(readJournalText(run), /interrupted_non_idempotent/);
  assert.equal(countEvents(run, "step_start"), 3);
  assert.equal(start(run, "T-003").status, 5, "the task must not retry");
});

test("T6 the same crash on an idempotent task resets it and a retry completes", () => {
  const run = makeRun();
  assert.equal(boot(run).status, 0);
  assert.equal(planSet(run).status, 0);
  assert.equal(completeTask(run, TASKS[0]).ended.status, 0);

  assert.equal(start(run, "T-002").status, 0);
  const task = readTask(run, "T-002");
  const handoff = writeFixtureHandoff(run, "T-002", "develop", task.attempt);
  const crashed = end(run, "T-002", task.current_step.step_id, handoff, {
    crashAt: "before_step_end_journal",
  });
  assert.equal(crashed.signal, "SIGKILL");

  const booted = boot(run);
  assert.equal(booted.status, 0, booted.stderr);
  const reset = readTask(run, "T-002");
  assert.equal(reset.status, "pending");
  assert.equal(reset.attempt, 1);

  const retry = completeTask(run, TASKS[1]);
  assert.equal(retry.started.status, 0, retry.started.stderr);
  assert.equal(retry.ended.status, 0, retry.ended.stderr);
  const done = readTask(run, "T-002");
  assert.equal(done.status, "done");
  assert.equal(done.attempt, 2);
});
