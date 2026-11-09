import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWriteFile,
  readJsonFile,
} from "../src/orchestrator/fsx.js";
import {
  JournalWriter,
  readJournal,
  replay,
  truncatePartialTail,
  verifyChain,
} from "../src/orchestrator/journal.js";
import { canonicalJson, inputsHash, planChecksum } from "../src/orchestrator/hash.js";
import { emptyPlan } from "../src/orchestrator/state.js";

function tempDir(name) {
  const dir = mkdtempSync(join(tmpdir(), `orch-core-${name}-`));
  mkdirSync(dir, { recursive: true });
  return dir;
}

const task = {
  task_id: "T-001",
  capability: "route",
  depends_on: [],
  resolved_skill: "library/route",
  resolution_source: "internal_override",
  owner: "orchestrator",
  adapter: null,
  idempotent: true,
};

function planFor(tasks) {
  return {
    schema_version: 1,
    run_id: "run-test-1",
    created_at: "2026-11-09T10:00:00Z",
    env_fingerprint: { skills_lock_sha256: null, library_overrides_sha256: null },
    capabilities: tasks.map((entry) => entry.capability),
    tasks: tasks.map((entry) => ({ ...entry, inputs_hash: inputsHash(entry) })),
    checksum: planChecksum(tasks.map((entry) => ({ ...entry, inputs_hash: inputsHash(entry) }))),
  };
}

test("atomic write replaces a file with no temporary leftovers and mode 0600", async () => {
  const dir = tempDir("atomic");
  const path = join(dir, "state.json");
  await atomicWriteFile(path, '{"a":1}\n');
  assert.equal(readFileSync(path, "utf8"), '{"a":1}\n');
  await atomicWriteFile(path, '{"a":2}\n');
  assert.equal(readFileSync(path, "utf8"), '{"a":2}\n');
  const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("readJsonFile distinguishes missing, valid, and torn files", async () => {
  const dir = tempDir("json");
  const path = join(dir, "state.json");
  assert.deepEqual(await readJsonFile(path), { exists: false, value: null, raw: null, error: null });
  await atomicWriteFile(path, '{"ok":true}\n');
  assert.equal((await readJsonFile(path)).value.ok, true);
  writeFileSync(path, '{"ok":');
  const torn = await readJsonFile(path);
  assert.equal(torn.exists, true);
  assert.equal(torn.value, null);
  assert.ok(torn.error);
});

test("journal hash chain verifies, detects tampering and sequence gaps", async () => {
  const dir = tempDir("chain");
  const path = join(dir, "journal.ndjson");
  const writer = new JournalWriter({ path, events: [], prevHash: null, lastSeq: 0 });
  await writer.append({ type: "run_start", run_id: "run-test-1", session_id: "s-1", env_fingerprint: {} });
  await writer.append({ type: "run_resume", run_id: "run-test-1", session_id: "s-1" });

  const read = await readJournal(path);
  assert.equal(read.errors.length, 0);
  const verified = verifyChain(read.events);
  assert.equal(verified.ok, true);
  assert.equal(verified.head.seq, 2);

  const tampered = read.events.map((event) => ({ ...event }));
  tampered[1].prev_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  const bad = verifyChain(tampered);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /hash mismatch|prev_hash/);

  const gapped = read.events.map((event) => ({ ...event }));
  gapped[1].seq = 3;
  const gap = verifyChain(gapped);
  assert.equal(gap.ok, false);
  assert.match(gap.reason, /sequence gap/);
});

test("journal partial tail is reported and truncated to the last valid newline", async () => {
  const dir = tempDir("truncate");
  const path = join(dir, "journal.ndjson");
  const writer = new JournalWriter({ path, events: [], prevHash: null, lastSeq: 0 });
  await writer.append({ type: "run_start", run_id: "run-test-1", session_id: "s-1" });
  writeFileSync(path, '{"seq":2,"type":"step_start"', { flag: "a" });

  const before = await readJournal(path);
  assert.equal(before.truncated, true);
  assert.equal(before.events.length, 1);
  assert.ok(before.removedBytes > 0);

  await truncatePartialTail(path, before);
  const after = await readJournal(path);
  assert.equal(after.truncated, false);
  assert.equal(after.events.length, 1);
  assert.equal(verifyChain(after.events).ok, true);
});

test("replay reconstructs plan, state, and task records from events", async () => {
  const dir = tempDir("replay");
  const path = join(dir, "journal.ndjson");
  const writer = new JournalWriter({ path, events: [], prevHash: null, lastSeq: 0 });
  const plan = planFor([task]);
  await writer.append({
    type: "run_start",
    run_id: "run-test-1",
    session_id: "s-1",
    created_at: "2026-11-09T10:00:00Z",
    env_fingerprint: { skills_lock_sha256: "sha256:a", library_overrides_sha256: "sha256:b" },
  });
  await writer.append({
    type: "plan_created",
    run_id: "run-test-1",
    session_id: "s-1",
    plan,
  });
  await writer.append({
    type: "step_start",
    run_id: "run-test-1",
    session_id: "s-1",
    task_id: "T-001",
    capability: "route",
    step_id: "T-001/route/attempt-1",
    attempt: 1,
    idempotent: true,
    skill: "library/route",
  });
  await writer.append({
    type: "step_end",
    run_id: "run-test-1",
    session_id: "s-1",
    task_id: "T-001",
    step_id: "T-001/route/attempt-1",
    task_status: "done",
    outputs: ["artifacts/T-001.md"],
  });

  const derived = replay(writer.events);
  assert.equal(derived.run.run_id, "run-test-1");
  assert.equal(derived.plan.checksum, plan.checksum);
  assert.equal(derived.tasks.length, 1);
  assert.equal(derived.tasks[0].status, "done");
  assert.equal(derived.tasks[0].attempt, 1);
  assert.deepEqual(derived.tasks[0].outputs, ["artifacts/T-001.md"]);
  assert.equal(derived.run.run_status, "COMPLETE");
});

test("canonical JSON and checksums are stable across key order", () => {
  const a = { b: 2, a: 1, nested: { y: true, x: ["z"] } };
  const b = { nested: { x: ["z"], y: true }, a: 1, b: 2 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(inputsHash(task), inputsHash({ ...task }));
  assert.equal(planChecksum([task]), planChecksum([{ ...task }]));
  assert.equal(emptyPlan({ runId: "run-1", createdAt: "2026-11-09T10:00:00Z" }).tasks.length, 0);
});
