import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TASKS,
  boot,
  corruptTornWrite,
  readJournalText,
  readState,
  readTask,
  runReference,
} from "./helpers/orchestrator.js";

function assertRecovered(run) {
  const booted = boot(run);
  assert.equal(booted.status, 0, booted.stderr);
  assert.match(booted.stdout, /status: COMPLETE/);

  const journal = readJournalText(run);
  assert.match(journal, /journal_truncated/);
  assert.doesNotMatch(journal, /"seq":9999/);
  assert.ok(journal.endsWith("\n"), "the journal must end at a complete line");

  const state = readState(run);
  assert.equal(state.schema_version, 1);
  for (const task of TASKS) {
    assert.equal(readTask(run, task.task_id).status, "done", `${task.task_id} must stay done`);
  }
}

test("T7 a torn state.json and partial journal tail recover from the checkpoint", () => {
  const reference = runReference({ wantFinish: false });
  assert.equal(reference.crashed, null);
  corruptTornWrite(reference.run);
  assertRecovered(reference.run);
});

test("T7 a torn state.json and partial journal tail recover with no checkpoint", () => {
  const reference = runReference({ wantCheckpoint: false, wantFinish: false });
  assert.equal(reference.crashed, null);
  corruptTornWrite(reference.run);
  assertRecovered(reference.run);
});
