// Design registry events on the orchestrator journal.
//
// The journal is the source of truth and is hash-chained. The registry appends
// its events through the same JournalWriter so a later boot replay sees them.
// A design event does not rewrite state.json; the next load replays the journal.

import { join } from "node:path";
import { JournalWriter, readJournal } from "../orchestrator/journal.js";
import type { JournalEvent } from "../types/orchestrator.js";

const DESIGN_SESSION = "s-design-registry";

export interface DesignEventInput {
  readonly stateRoot: string;
  readonly type: string;
  readonly payload?: Record<string, unknown>;
  readonly taskId?: string | null;
}

export type DesignEventResult =
  | { readonly appended: false; readonly reason: string; readonly path: string }
  | { readonly appended: true; readonly event: JournalEvent; readonly path: string };

export async function appendDesignEvent({
  stateRoot,
  type,
  payload = {},
  taskId = null,
}: DesignEventInput): Promise<DesignEventResult> {
  const journalPath = join(stateRoot, "journal.ndjson");
  const info = await readJournal(journalPath);
  if (!info.exists) {
    return { appended: false, reason: "no_journal", path: journalPath };
  }
  if (info.errors.length > 0) {
    return { appended: false, reason: "journal_unreadable", path: journalPath };
  }
  const last = info.events.at(-1) ?? null;
  const writer = new JournalWriter({
    path: journalPath,
    events: info.events,
    prevHash: last?.hash ?? null,
    lastSeq: last?.seq ?? 0,
  });
  const event = await writer.append({
    type,
    run_id: last?.run_id ?? null,
    session_id: DESIGN_SESSION,
    ...payload,
  });

  if (taskId && type === "design_delta_rejected") {
    const reason = payload["reason"];
    await writer.append({
      type: "escalation",
      run_id: last?.run_id ?? null,
      session_id: DESIGN_SESSION,
      task_id: taskId,
      reason: "design_delta_rejected",
      message: typeof reason === "string" ? reason : "design delta rejected",
    });
  }
  return { appended: true, event, path: journalPath };
}
