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
import { isRecord } from "../types/guards.js";
import type {
  Checkpoint,
  JournalEvent,
  JournalHead,
  JournalSink,
  PlanSnapshot,
  RunState,
  TaskRecord,
} from "../types/orchestrator.js";

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function checkpointName(seq: number): string {
  return `${String(seq).padStart(6, "0")}.snapshot`;
}

export function checkpointPath(root: string, seq: number): string {
  return join(root, "checkpoints", checkpointName(seq));
}

/**
 * A checkpoint is written only by this engine and is checksummed. The shape is
 * re-proven below: schema, checksum, and sequence must all agree.
 */
function asCheckpoint(value: unknown, name: string, path: string): Checkpoint {
  const record = isRecord(value) ? value : {};
  if (record["schema_version"] !== 1) {
    throw new CorruptStateError(`checkpoint ${name} has unsupported schema_version ${String(record["schema_version"])}`);
  }
  if (record["checksum"] !== checkpointChecksum(record)) {
    throw new CorruptStateError(`checkpoint ${name} checksum does not match`, { detail: { path } });
  }
  return record as unknown as Checkpoint;
}

export async function readLatestCheckpoint(root: string): Promise<Checkpoint | null> {
  const dir = join(root, "checkpoints");
  const entries = await listDir(dir);
  const snapshots = entries
    .filter((entry) => entry.isFile() && /^\d+\.snapshot$/.test(entry.name))
    .map((entry) => ({ name: entry.name, seq: Number.parseInt(entry.name, 10) }))
    .sort((a, b) => b.seq - a.seq);
  if (snapshots.length === 0) return null;

  const chosen = snapshots[0] as { name: string; seq: number };
  const path = join(dir, chosen.name);
  const parsed = await readJsonFile(path);
  if (!parsed.exists || parsed.error || !parsed.value) {
    throw new CorruptStateError(`checkpoint ${chosen.name} is not valid JSON`, {
      detail: { path, error: parsed.error?.message ?? null },
    });
  }
  const checkpoint = asCheckpoint(parsed.value, chosen.name, path);
  if (checkpoint.seq !== chosen.seq) {
    throw new CorruptStateError(`checkpoint ${chosen.name} seq does not match its filename`);
  }
  return checkpoint;
}

export interface WriteCheckpointInput {
  readonly root: string;
  readonly run: RunState;
  readonly plan: PlanSnapshot | null;
  readonly tasks: readonly TaskRecord[];
  readonly seq: number;
  readonly journalHead: JournalHead;
}

export interface WriteCheckpointResult {
  readonly checkpoint: Checkpoint;
  readonly path: string;
  readonly relativePath: string;
}

export async function writeCheckpoint({
  root,
  run,
  plan,
  tasks,
  seq,
  journalHead,
}: WriteCheckpointInput): Promise<WriteCheckpointResult> {
  const name = checkpointName(seq);
  const relativePath = `checkpoints/${name}`;
  const path = join(root, "checkpoints", name);
  const state = clone(run);
  state.journal_head = clone(journalHead);
  state.last_checkpoint = relativePath;
  const body = {
    schema_version: 1,
    run_id: run.run_id,
    seq,
    journal_head: clone(journalHead),
    state,
    plan: plan ? clone(plan) : null,
    tasks: (tasks ?? []).map((task) => clone(task)),
  };
  const checkpoint: Checkpoint = { ...body, checksum: checkpointChecksum(body) };
  await atomicWriteFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`);
  crashPoint("after_checkpoint_snapshot");
  return { checkpoint, path, relativePath };
}

export async function truncateJournalAfter(
  journalPath: string,
  seq: number,
  journal: JournalSink,
): Promise<JournalEvent[]> {
  crashPoint("before_journal_truncation");
  const retained = journal.events.filter((event) => event.seq > seq);
  const text = retained.map((event) => JSON.stringify(event)).join("\n");
  await atomicWriteFile(journalPath, text.length > 0 ? `${text}\n` : "");
  journal.retainAfter(seq);
  return [...retained];
}

export function eventsSinceCheckpoint(checkpoint: Checkpoint | null, events: readonly JournalEvent[]): number {
  if (!checkpoint) return events.length;
  return events.filter((event) => event.seq > checkpoint.seq).length;
}
