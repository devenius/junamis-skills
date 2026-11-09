import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ageLease,
  boot,
  makeRun,
  readJournalText,
  snapshotFiles,
} from "./helpers/orchestrator.js";

test("T5 a live lease halts a second session without writes and a stale lease is taken over", () => {
  const sessionA = makeRun({ session: "s-lease-a" });
  assert.equal(boot(sessionA).status, 0);
  const before = snapshotFiles(sessionA.stateRoot);

  const sessionB = { ...sessionA, session: "s-lease-b" };
  const blocked = boot(sessionB);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /halt: lease_held/);
  assert.deepEqual(snapshotFiles(sessionA.stateRoot), before, "session B must write no file");
  assert.equal(existsSync(join(sessionA.stateRoot, "locks", "session-s-lease-a.json")), true);

  ageLease(sessionA, "s-lease-a");
  const takenOver = boot(sessionB);
  assert.equal(takenOver.status, 0, takenOver.stderr);
  assert.match(readJournalText(sessionA), /lease_taken_over/);
  assert.equal(existsSync(join(sessionA.stateRoot, "locks", "session-s-lease-b.json")), true);
  assert.equal(existsSync(join(sessionA.stateRoot, "locks", "session-s-lease-a.json")), false);
});
