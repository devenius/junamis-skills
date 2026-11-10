// Append-only journal: append, read, hash chain verification, partial tail
// truncation, and replay.

import { appendLine, atomicWriteFile, readBuffer } from "./fsx.js";
import { eventHash } from "./hash.js";
import { applyEvent, finalizeRun } from "./state.js";
import { nowIso } from "./time.js";
import type {
  ChainCheck,
  Checkpoint,
  JournalEvent,
  JournalEventInput,
  JournalHead,
  JournalInfo,
  JournalLineError,
  JournalSink,
  PlanSnapshot,
  RunState,
  TaskState,
} from "../types/orchestrator.js";
import { isRecord } from "../types/guards.js";

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * The journal is hash-chained and `verifyChain` proves every line before it is
 * replayed. Parsing stops at "valid JSON" on purpose: a line of the wrong shape
 * is reported by the chain check with its sequence number, not dropped here.
 */
function parseJournalLine(line: string): JournalEvent {
  return JSON.parse(line) as JournalEvent;
}

export async function readJournal(path: string): Promise<JournalInfo> {
  const buffer = await readBuffer(path);
  if (buffer === null) {
    return {
      events: [],
      errors: [],
      truncated: false,
      partial: "",
      removedBytes: 0,
      completeText: "",
      exists: false,
      size: 0,
    };
  }
  const text = buffer.toString("utf8");
  let completeText = text;
  let partial = "";
  let truncated = false;
  if (text.length > 0 && !text.endsWith("\n")) {
    const index = text.lastIndexOf("\n");
    partial = index === -1 ? text : text.slice(index + 1);
    completeText = index === -1 ? "" : text.slice(0, index + 1);
    truncated = true;
  }
  const events: JournalEvent[] = [];
  const errors: JournalLineError[] = [];
  for (const line of completeText.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(parseJournalLine(line));
    } catch (error) {
      errors.push({ line, error });
    }
  }
  return {
    events,
    errors,
    truncated,
    partial,
    removedBytes: truncated ? Buffer.byteLength(partial, "utf8") : 0,
    completeText,
    exists: true,
    size: buffer.length,
  };
}

// Rewrite the journal with only complete lines. Used when boot finds a partial
// trailing line; the replacement uses the same atomic write protocol.
export async function truncatePartialTail(path: string, info: JournalInfo | null = null): Promise<number> {
  const current = info ?? (await readJournal(path));
  if (!current.truncated) return 0;
  await atomicWriteFile(path, current.completeText);
  return current.removedBytes;
}

export interface VerifyChainOptions {
  readonly prevHash?: string | null;
  readonly startSeq?: number;
}

export function verifyChain(
  events: readonly unknown[],
  { prevHash = null, startSeq = 1 }: VerifyChainOptions = {},
): ChainCheck {
  let expectedPrev = prevHash;
  let expectedSeq = startSeq;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!isRecord(event)) {
      return { ok: false, index, reason: "event is not an object" };
    }
    const seq = event["seq"];
    if (seq !== expectedSeq) {
      return { ok: false, index, reason: `sequence gap: expected ${expectedSeq}, got ${String(seq)}` };
    }
    const hash = event["hash"];
    if (typeof hash !== "string") {
      return { ok: false, index, reason: `event ${String(seq)} has no hash` };
    }
    if (eventHash(event) !== hash) {
      return { ok: false, index, reason: `hash mismatch at seq ${String(seq)}` };
    }
    if ((event["prev_hash"] ?? null) !== expectedPrev) {
      return { ok: false, index, reason: `prev_hash mismatch at seq ${String(seq)}` };
    }
    expectedPrev = hash;
    expectedSeq += 1;
  }
  return { ok: true, head: { seq: expectedSeq - 1, event_hash: expectedPrev } };
}

export interface JournalWriterOptions {
  readonly path: string;
  readonly events?: readonly JournalEvent[];
  readonly prevHash?: string | null;
  readonly lastSeq?: number;
}

export class JournalWriter implements JournalSink {
  readonly path: string;
  events: JournalEvent[];
  prevHash: string | null;
  lastSeq: number;

  constructor({ path, events = [], prevHash = null, lastSeq = 0 }: JournalWriterOptions) {
    this.path = path;
    this.events = [...events];
    this.prevHash = prevHash;
    this.lastSeq = lastSeq;
  }

  get head(): JournalHead {
    return { seq: this.lastSeq, event_hash: this.prevHash };
  }

  async append(fields: JournalEventInput): Promise<JournalEvent> {
    const seq = this.lastSeq + 1;
    const {
      type,
      ts,
      run_id,
      session_id,
      prev_hash: _ignoredPrev,
      hash: _ignoredHash,
      seq: _ignoredSeq,
      ...rest
    } = fields;
    const body: Record<string, unknown> = {
      seq,
      ts: ts ?? nowIso(),
      type,
      run_id: run_id ?? null,
      session_id: session_id ?? null,
      ...rest,
      prev_hash: this.prevHash,
    };
    const full: JournalEvent = {
      seq,
      ts: body["ts"] as string,
      type,
      run_id: run_id ?? null,
      session_id: session_id ?? null,
      prev_hash: this.prevHash,
      ...rest,
      hash: eventHash(body),
    };
    await appendLine(this.path, JSON.stringify(full));
    this.events.push(full);
    this.lastSeq = seq;
    this.prevHash = full.hash;
    return full;
  }

  retainAfter(seq: number): JournalEvent[] {
    this.events = this.events.filter((event) => event.seq > seq);
    return this.events;
  }

  lastEvents(count: number): JournalEvent[] {
    return this.events.slice(-count);
  }
}

export interface ReplayOptions {
  readonly base?: Checkpoint | null;
}

export interface ReplayResult {
  readonly run: RunState | null;
  readonly plan: PlanSnapshot | null;
  readonly tasks: readonly TaskState[];
}

// Replay a retained journal onto an optional checkpoint base.
export function replay(events: readonly JournalEvent[], { base = null }: ReplayOptions = {}): ReplayResult {
  const ctx = {
    run: base?.state ? clone(base.state) : null,
    plan: base?.plan ? clone(base.plan) : null,
    tasks: base?.tasks ? new Map(base.tasks.map((task) => [task.task_id, clone(task)])) : new Map<string, TaskState>(),
  };
  for (const event of events) applyEvent(ctx, event);
  return finalizeRun(ctx.run, ctx.plan, ctx.tasks);
}
