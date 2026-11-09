// Shared load/save helpers over the state root.
//
// Journal first, snapshot second. Every caller appends an event, folds it into
// the in-memory state, then writes the derived snapshots.

import { join } from "node:path";
import { readJournal, replay, verifyChain, JournalWriter } from "./journal.js";
import { readLatestCheckpoint, writeCheckpoint, truncateJournalAfter } from "./compaction.js";
import { ensureTree, readJsonFile, statSafe, writeIfMissing } from "./fsx.js";
import { CorruptStateError } from "./errors.js";
import { SCHEMA_VERSION, emptyPlan, finalizeRun, writeSnapshots } from "./state.js";

export const AUTO_CHECKPOINT_EVENTS = 200;
export const AUTO_CHECKPOINT_BYTES = 5 * 1024 * 1024;

export function statePaths(root) {
  return {
    root,
    journal: join(root, "journal.ndjson"),
    state: join(root, "state.json"),
    plan: join(root, "plan.json"),
    report: join(root, "resume-report.md"),
    stateMd: join(root, "STATE.md"),
    checkpoints: join(root, "checkpoints"),
    tasks: join(root, "tasks"),
    locks: join(root, "locks"),
  };
}

export function toTaskMap(tasks) {
  if (tasks instanceof Map) return tasks;
  if (Array.isArray(tasks)) return new Map(tasks.map((task) => [task.task_id, task]));
  return new Map(Object.entries(tasks ?? {}));
}

export function refreshLoaded(loaded) {
  const derived = replay(loaded.journal.events, { base: loaded.checkpoint });
  loaded.run = derived.run;
  loaded.plan = derived.plan;
  loaded.tasks = derived.tasks;
  return loaded;
}

export async function loadFromPaths({ paths, journalInfo = null }) {
  const info = journalInfo ?? (await readJournal(paths.journal));
  if (info.errors.length > 0) {
    throw new CorruptStateError(`journal has ${info.errors.length} unparsable line(s)`, {
      detail: { first_error: info.errors[0].error.message, line: info.errors[0].line.slice(0, 120) },
    });
  }
  const checkpoint = await readLatestCheckpoint(paths.root);
  const retained = checkpoint ? info.events.filter((event) => event.seq > checkpoint.seq) : info.events;
  const chain = verifyChain(retained, {
    prevHash: checkpoint?.journal_head?.event_hash ?? null,
    startSeq: checkpoint ? checkpoint.seq + 1 : 1,
  });
  if (!chain.ok) {
    throw new CorruptStateError(`journal hash chain invalid: ${chain.reason}`, {
      detail: { index: chain.index, event: retained[chain.index] ?? null },
    });
  }
  const derived = replay(retained, { base: checkpoint });
  if (!derived.run && (retained.length > 0 || checkpoint)) {
    throw new CorruptStateError("journal has no run_start event");
  }
  const journal = new JournalWriter({
    path: paths.journal,
    events: retained,
    prevHash: chain.head.event_hash,
    lastSeq: chain.head.seq,
  });
  return {
    paths,
    journalInfo: info,
    checkpoint,
    journal,
    run: derived.run,
    plan: derived.plan,
    tasks: derived.tasks,
  };
}

export async function loadRun(root) {
  return loadFromPaths({ paths: statePaths(root) });
}

export async function createRun({ paths, runId, createdAt, envFingerprint, sessionId, leaseEvent = null }) {
  await ensureTree(paths.root);
  await writeIfMissing(join(paths.root, ".gitignore"), "*\n");
  const journal = new JournalWriter({ path: paths.journal, events: [], prevHash: null, lastSeq: 0 });
  await journal.append({
    type: "run_start",
    run_id: runId,
    session_id: sessionId,
    ts: createdAt,
    created_at: createdAt,
    schema_version: SCHEMA_VERSION,
    env_fingerprint: envFingerprint,
  });
  const plan = emptyPlan({ runId, createdAt, envFingerprint });
  await journal.append({
    type: "plan_created",
    run_id: runId,
    session_id: sessionId,
    ts: createdAt,
    plan,
  });
  if (leaseEvent) {
    await journal.append({
      ...leaseEvent,
      run_id: runId,
      session_id: sessionId,
      ts: createdAt,
    });
  }
  const loaded = { paths, journal, checkpoint: null, run: null, plan: null, tasks: [] };
  refreshLoaded(loaded);
  await saveLoaded(loaded, { now: createdAt });
  return loaded;
}

export async function saveLoaded(loaded, { status = null, now = null } = {}) {
  if (!loaded.run) return loaded;
  const derived = finalizeRun(loaded.run, loaded.plan, toTaskMap(loaded.tasks), { status, now });
  loaded.run = derived.run;
  loaded.plan = derived.plan;
  loaded.tasks = derived.tasks;
  loaded.run.journal_head = loaded.journal.head;
  await writeSnapshots({ paths: loaded.paths, run: loaded.run, plan: loaded.plan, tasks: loaded.tasks });
  return loaded;
}

export async function maybeAutoCheckpoint(loaded, { sessionId, maxEvents = AUTO_CHECKPOINT_EVENTS, maxBytes = AUTO_CHECKPOINT_BYTES } = {}) {
  if (!loaded.run) return null;
  const journalSize = (await statSafe(loaded.paths.journal))?.size ?? 0;
  const sinceCheckpoint = loaded.checkpoint
    ? loaded.journal.events.filter((event) => event.seq > loaded.checkpoint.seq).length
    : loaded.journal.events.length;
  if (sinceCheckpoint < maxEvents && journalSize < maxBytes) return null;
  return checkpointRun(loaded, { sessionId });
}

export async function checkpointRun(loaded, { sessionId }) {
  const seq = loaded.journal.head.seq;
  const head = loaded.journal.head;
  const { checkpoint, relativePath } = await writeCheckpoint({
    root: loaded.paths.root,
    run: loaded.run,
    plan: loaded.plan,
    tasks: loaded.tasks,
    seq,
    journalHead: head,
  });
  const event = await loaded.journal.append({
    type: "checkpoint_written",
    run_id: loaded.run.run_id,
    session_id: sessionId,
    checkpoint_seq: seq,
    path: relativePath,
    hash: checkpoint.checksum,
  });
  loaded.run.last_checkpoint = relativePath;
  loaded.run.updated_at = event.ts;
  await truncateJournalAfter(loaded.paths.journal, seq, loaded.journal);
  loaded.checkpoint = checkpoint;
  await saveLoaded(loaded, { status: loaded.run.run_status });
  return { path: relativePath, seq, checksum: checkpoint.checksum };
}

// Verify the plan.json/state.json snapshots against replayed truth. A torn
// snapshot is a cache miss; a checksum mismatch with no explaining event is
// corruption.
export async function validateSnapshots(loaded) {
  const stateFile = await readJsonFile(loaded.paths.state);
  if (stateFile.exists && stateFile.value && stateFile.value.schema_version !== SCHEMA_VERSION) {
    throw new CorruptStateError(`state.json has unsupported schema_version ${stateFile.value.schema_version}`);
  }
  const planFile = await readJsonFile(loaded.paths.plan);
  if (planFile.exists && planFile.value && planFile.value.schema_version !== SCHEMA_VERSION) {
    throw new CorruptStateError(`plan.json has unsupported schema_version ${planFile.value.schema_version}`);
  }
  const planEvents = loaded.journal.events.filter(
    (event) => event.type === "plan_created" || event.type === "plan_updated",
  );
  if (planFile.exists && planFile.value && !loaded.plan && planEvents.length === 0 && !loaded.checkpoint) {
    throw new CorruptStateError("plan.json exists but the journal has no plan event");
  }
  if (planFile.exists && planFile.value && loaded.plan && planFile.value.checksum !== loaded.plan.checksum) {
    if (planEvents.length === 0 && !loaded.checkpoint) {
      throw new CorruptStateError("plan.json checksum mismatch with no journal event to explain it");
    }
    // Replay wins; saveLoaded rewrites the snapshot.
  }
  if (stateFile.exists && !stateFile.value && stateFile.error && !loaded.checkpoint) {
    // A torn snapshot with no checkpoint can still be repaired by full replay.
    if (loaded.journal.events.length === 0) {
      throw new CorruptStateError("state.json is torn and the journal is empty");
    }
  }
  return true;
}
