import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  boot,
  copyJournalAndCheckpoints,
  journalChain,
  normalizedRunFiles,
  runReference,
} from "./helpers/orchestrator.js";

function replayContext(source, { checkpoints }) {
  const stateRoot = join(mkdtempSync(join(tmpdir(), "orch-replay-")), "state");
  const replay = { ...source, stateRoot, session: "s-replay" };
  copyJournalAndCheckpoints(source, replay, { checkpoints });
  return replay;
}

test("T2 replay from the checkpoint reconstructs plan, state, and tasks", async () => {
  const reference = runReference();
  assert.equal(reference.crashed, null);
  const replay = replayContext(reference.run, { checkpoints: true });

  const booted = boot(replay);
  assert.equal(booted.status, 0, booted.stderr);

  const chain = await journalChain(replay);
  assert.equal(chain.ok, true, `hash chain invalid: ${chain.reason}`);

  assert.deepEqual(normalizedRunFiles(replay), normalizedRunFiles(reference.run));
});

test("T2 replay with no checkpoint reconstructs from sequence 0", async () => {
  const reference = runReference({ wantCheckpoint: false, wantFinish: true });
  assert.equal(reference.crashed, null);
  const replay = replayContext(reference.run, { checkpoints: false });

  const booted = boot(replay);
  assert.equal(booted.status, 0, booted.stderr);

  const chain = await journalChain(replay);
  assert.equal(chain.ok, true, `hash chain invalid: ${chain.reason}`);

  assert.deepEqual(normalizedRunFiles(replay), normalizedRunFiles(reference.run));
});
