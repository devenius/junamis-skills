// Crash injection. Inert unless ORCH_TEST_MODE=1.
//
// Reaching a point is a no-op in a normal command path, so these calls are safe
// to leave in production code.

export const CRASH_POINTS = Object.freeze([
  "after_lease",
  "after_plan_journal",
  "after_step_start_journal",
  "after_task_snapshot",
  "before_step_end_journal",
  "after_step_end_journal",
  "after_task_snapshot_on_end",
  "after_checkpoint_snapshot",
  "before_journal_truncation",
]);

export function testMode() {
  return process.env.ORCH_TEST_MODE === "1";
}

export function allowTmpRoot() {
  return process.env.ORCH_TEST_ALLOW_TMP === "1";
}

export function crashPoint(name) {
  if (!testMode()) return;
  if (process.env.ORCH_TEST_CRASH_AT !== name) return;
  if (!CRASH_POINTS.includes(name)) return;
  process.kill(process.pid, "SIGKILL");
}
