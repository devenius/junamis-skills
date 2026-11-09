// Append-only journal: append, read, hash chain verification, partial tail
// truncation, and replay.

import { appendLine, atomicWriteFile, readBuffer } from "./fsx.js";
import { eventHash } from "./hash.js";
import { applyEvent, finalizeRun } from "./state.js";
import { nowIso } from "./time.js";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export async function readJournal(path) {
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
  const events = [];
  const errors = [];
  for (const line of completeText.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
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
export async function truncatePartialTail(path, info = null) {
  const current = info ?? (await readJournal(path));
  if (!current.truncated) return 0;
  await atomicWriteFile(path, current.completeText);
  return current.removedBytes;
}

export function verifyChain(events, { prevHash = null, startSeq = 1 } = {}) {
  let expectedPrev = prevHash;
  let expectedSeq = startSeq;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event || typeof event !== "object") {
      return { ok: false, index, reason: "event is not an object" };
    }
    if (event.seq !== expectedSeq) {
      return { ok: false, index, reason: `sequence gap: expected ${expectedSeq}, got ${event.seq}` };
    }
    if (typeof event.hash !== "string") {
      return { ok: false, index, reason: `event ${event.seq} has no hash` };
    }
    if (eventHash(event) !== event.hash) {
      return { ok: false, index, reason: `hash mismatch at seq ${event.seq}` };
    }
    if ((event.prev_hash ?? null) !== expectedPrev) {
      return { ok: false, index, reason: `prev_hash mismatch at seq ${event.seq}` };
    }
    expectedPrev = event.hash;
    expectedSeq += 1;
  }
  return { ok: true, head: { seq: expectedSeq - 1, event_hash: expectedPrev } };
}

export class JournalWriter {
  constructor({ path, events = [], prevHash = null, lastSeq = 0 }) {
    this.path = path;
    this.events = [...events];
    this.prevHash = prevHash;
    this.lastSeq = lastSeq;
  }

  get head() {
    return { seq: this.lastSeq, event_hash: this.prevHash };
  }

  async append(fields) {
    const seq = this.lastSeq + 1;
    const { type, ts, run_id, session_id, prev_hash: _ignoredPrev, hash: _ignoredHash, seq: _ignoredSeq, ...rest } = fields;
    const body = {
      seq,
      ts: ts ?? nowIso(),
      type,
      run_id,
      session_id,
      ...rest,
      prev_hash: this.prevHash,
    };
    const full = { ...body, hash: eventHash(body) };
    await appendLine(this.path, JSON.stringify(full));
    this.events.push(full);
    this.lastSeq = seq;
    this.prevHash = full.hash;
    return full;
  }

  retainAfter(seq) {
    this.events = this.events.filter((event) => event.seq > seq);
    return this.events;
  }

  lastEvents(count) {
    return this.events.slice(-count);
  }
}

// Replay a retained journal onto an optional checkpoint base.
export function replay(events, { base = null } = {}) {
  const ctx = {
    run: base?.state ? clone(base.state) : null,
    plan: base?.plan ? clone(base.plan) : null,
    tasks: base?.tasks ? new Map(base.tasks.map((task) => [task.task_id, clone(task)])) : new Map(),
  };
  for (const event of events) applyEvent(ctx, event);
  return finalizeRun(ctx.run, ctx.plan, ctx.tasks);
}
