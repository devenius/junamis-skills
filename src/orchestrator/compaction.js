// Checkpoints and journal truncation.
//
// A checkpoint is a verified snapshot of the derived state at one sequence
// number. Truncation replaces the journal with only events after that sequence;
// the first retained event still points at the checkpoint head, so the chain
// remains verifiable.

import { join } from "node:path";
import { atomicWriteFile, listDir, readJsonFile } from "./fsx.js";
import { checkpointChecksum } from "./hash.js";
import { CorruptStateError } from "./errors.js";
import { crashPoint } from "./test-hooks.js";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function checkpointName(seq) {
  return `${String(seq).padStart(6, "0")}.snapshot`;
}

export function checkpointPath(root, seq) {
  return join(root, "checkpoints", checkpointName(seq));
}

export async function readLatestCheckpoint(root) {
  const dir = join(root, "checkpoints");
  const entries = await listDir(dir);
  const snapshots = entries
    .filter((entry) => entry.isFile() && /^\d+\.snapshot$/.test(entry.name))
    .map((entry) => ({ name: entry.name, seq: Number.parseInt(entry.name, 10) }))
    .sort((a, b) => b.seq - a.seq);
  if (snapshots.length === 0) return null;

  const chosen = snapshots[0];
  const path = join(dir, chosen.name);
  const parsed = await readJsonFile(path);
  if (!parsed.exists || parsed.error || !parsed.value) {
    throw new CorruptStateError(`checkpoint ${chosen.name} is not valid JSON`, {
      detail: { path, error: parsed.error?.message ?? null },
    });
  }
  const checkpoint = parsed.value;
  if (checkpoint.schema_version !== 1) {
    throw new CorruptStateError(`checkpoint ${chosen.name} has unsupported schema_version ${checkpoint.schema_version}`);
  }
  if (checkpoint.checksum !== checkpointChecksum(checkpoint)) {
    throw new CorruptStateError(`checkpoint ${chosen.name} checksum does not match`, { detail: { path } });
  }
  if (checkpoint.seq !== chosen.seq) {
    throw new CorruptStateError(`checkpoint ${chosen.name} seq does not match its filename`);
  }
  return checkpoint;
}

export async function writeCheckpoint({ root, run, plan, tasks, seq, journalHead }) {
  const name = checkpointName(seq);
  const relativePath = `checkpoints/${name}`;
  const path = join(root, "checkpoints", name);
  const state = clone(run);
  state.journal_head = clone(journalHead);
  state.last_checkpoint = relativePath;
  const checkpoint = {
    schema_version: 1,
    run_id: run.run_id,
    seq,
    journal_head: clone(journalHead),
    state,
    plan: plan ? clone(plan) : null,
    tasks: (tasks ?? []).map((task) => clone(task)),
  };
  checkpoint.checksum = checkpointChecksum(checkpoint);
  await atomicWriteFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`);
  crashPoint("after_checkpoint_snapshot");
  return { checkpoint, path, relativePath };
}

export async function truncateJournalAfter(journalPath, seq, journal) {
  crashPoint("before_journal_truncation");
  const retained = journal.events.filter((event) => event.seq > seq);
  const text = retained.map((event) => JSON.stringify(event)).join("\n");
  await atomicWriteFile(journalPath, text.length > 0 ? `${text}\n` : "");
  journal.retainAfter(seq);
  return retained;
}

export function eventsSinceCheckpoint(checkpoint, events) {
  if (!checkpoint) return events.length;
  return events.filter((event) => event.seq > checkpoint.seq).length;
}
