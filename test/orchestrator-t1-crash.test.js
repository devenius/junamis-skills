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
  recoverAndFinish,
  runReference,
  start,
  t1Target,
  writeFixtureHandoff,
} from "./helpers/orchestrator.js";

const reference = runReference();
const expected = t1Target(reference.run);

const CRASH_POINTS = [
  { point: "after_lease", step: "boot" },
  { point: "after_plan_journal", step: "plan set" },
  { point: "after_step_start_journal", step: "start T-001" },
  { point: "after_task_snapshot", step: "start T-001 snapshot" },
  { point: "before_step_end_journal", step: "end T-001" },
  { point: "after_step_end_journal", step: "end T-001 journal" },
  { point: "after_task_snapshot_on_end", step: "end T-001 snapshot" },
  { point: "after_checkpoint_snapshot", step: "checkpoint snapshot" },
  { point: "before_journal_truncation", step: "checkpoint truncation" },
];

for (const { point, step } of CRASH_POINTS) {
  test(`T1 crash at ${point} (${step})`, () => {
    const scenario = runReference({ crashPoint: point });
    assert.ok(scenario.crashed, `${point}: expected the child to die`);
    assert.equal(
      scenario.crashed.signal,
      "SIGKILL",
      `${point}: expected SIGKILL, got signal ${scenario.crashed.signal} and status ${scenario.crashed.status}\n${scenario.crashed.stderr}`,
    );

    const recovery = recoverAndFinish(scenario.run);
    assert.equal(recovery.ok, true, `${point}: recovery failed\n${JSON.stringify(recovery.results, null, 2)}`);
    assert.deepEqual(t1Target(scenario.run), expected, `${point}: recovered run differs from the reference`);
  });
}

test("T1 a non-idempotent task killed after its artifact before step_end becomes needs_review", () => {
  const run = makeRun();
  assert.equal(boot(run).status, 0);
  assert.equal(planSet(run).status, 0);
  for (const task of TASKS.slice(0, 2)) {
    const completed = completeTask(run, task);
    assert.equal(completed.started.status, 0, completed.started.stderr);
    assert.equal(completed.ended.status, 0, completed.ended.stderr);
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
  assert.equal(after.attempt, 1, "a non-idempotent task must not be retried");
  assert.match(readJournalText(run), /interrupted_non_idempotent/);
  assert.equal(countEvents(run, "step_start"), 3, "no retry step_start may be journaled");
  assert.equal(start(run, "T-003").status, 5, "a needs_review task must not start");
});
