// Journal events, derived snapshots, and the context/result shapes the CLI and
// the boot sequence already produce.

import type { JsonObject, Result } from "./common.js";
import type { DesignFingerprint } from "./design.js";
import type { Candidate, ResolutionSource, WorkQueue } from "./reconcile.js";

export type RunStatus = "NEW_RUN" | "RESUMING" | "COMPLETE" | "BLOCKED_DRIFT" | "HALT_CORRUPT";

export type TaskStatus = "pending" | "in_progress" | "done" | "failed" | "needs_review";

/** Mirrors src/reconcile/queue.js. A queue status is not a run status. */
export type ReconcileQueueStatus = "ready" | "no_work" | "blocked_drift";

/** The documented capability resolution values. */
export interface PlanTask {
  readonly task_id: string;
  readonly capability: string;
  readonly depends_on: readonly string[];
  readonly resolved_skill: string;
  readonly resolution_source: ResolutionSource;
  readonly owner: string;
  readonly adapter: string | JsonObject | null;
  readonly idempotent: boolean;
  readonly inputs_hash: string;
}

export interface PlanSnapshot {
  readonly schema_version: number;
  readonly run_id: string;
  readonly created_at: string;
  readonly env_fingerprint: EnvFingerprint | null;
  readonly capabilities: readonly string[];
  readonly tasks: readonly PlanTask[];
  readonly checksum: string;
}

export interface EnvFingerprint {
  readonly skills_lock_sha256: string | null;
  readonly library_overrides_sha256: string | null;
  readonly library_overrides_files: Readonly<Record<string, string>> | null;
  readonly design_registry: DesignFingerprint | null;
  readonly design_registry_files: Readonly<Record<string, string>> | null;
  readonly orchestrator_version: string;
  readonly handoff_schema_version: number;
  readonly library_root: string | null;
  readonly manifest_path: string | null;
}

/** One step in flight on a task record. */
export interface TaskStep {
  readonly step_id: string;
  readonly skill: string;
  readonly attempt: number;
  readonly idempotent: boolean;
  readonly started_at: string;
  readonly session_id: string;
}

export interface TaskResolution {
  readonly decision: string;
  readonly at: string;
}

export interface TaskRecord {
  readonly schema_version: number;
  readonly task_id: string;
  readonly capability: string;
  readonly status: TaskStatus;
  readonly resolved_skill: string;
  readonly resolution_source: ResolutionSource;
  readonly owner: string;
  readonly adapter: string | JsonObject | null;
  readonly current_step: TaskStep | null;
  readonly inputs_hash: string;
  readonly outputs: readonly string[];
  readonly attempt: number;
  readonly updated_at: string;
  readonly questions?: readonly string[];
  readonly resolution?: TaskResolution;
  readonly last_error?: string;
  readonly next?: string | null;
  readonly handoff?: unknown;
}

/**
 * One journal line. Events are open: the named fields are always present and
 * every contract adds its own payload on top, so extra keys are allowed.
 */
export interface JournalEvent {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly run_id: string | null;
  readonly session_id: string | null;
  readonly prev_hash: string | null;
  readonly hash: string;
  readonly [key: string]: unknown;
}

export interface JournalHead {
  readonly seq: number;
  readonly event_hash: string | null;
}

export interface PlanReference {
  readonly path: string;
  readonly checksum: string | null;
}

export interface StateCursor {
  readonly task_id: string;
  readonly capability: string;
  readonly step_id: string | null;
  readonly attempt: number;
  readonly status: TaskStatus;
}

export type TaskSummary = Readonly<Partial<Record<TaskStatus, number>>>;

/** `state.json`. Derived from the journal; never the source of truth. */
export interface StateSnapshot {
  readonly schema_version: number;
  readonly run_id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly run_status: RunStatus | null;
  readonly cursor: StateCursor | null;
  readonly plan: PlanReference;
  readonly env_fingerprint: EnvFingerprint | null;
  readonly tasks_summary: TaskSummary;
  readonly journal_head: JournalHead;
  readonly last_checkpoint: string | null;
  readonly reconcile: ReconcileQueueStatus | null;
  readonly stalled?: boolean;
  readonly drift?: JsonObject | null;
  readonly completed_at?: string;
  readonly last_truncation?: JsonObject;
}

export interface Lease {
  readonly session_id: string;
  readonly pid: number;
  readonly host: string;
  readonly acquired_at: string;
  readonly heartbeat_at: string;
  readonly ttl_seconds: number;
  readonly live?: boolean;
}

export interface ReconciliationSummary {
  readonly interrupted: readonly string[];
  readonly retried: readonly string[];
  readonly escalated: readonly string[];
  readonly malformedHandoffs: readonly string[];
}

/** The drift diff produced by `compareFingerprints`. */
export interface DriftDiff {
  readonly match: boolean;
  readonly recorded_missing: boolean;
  readonly manifest: JsonObject;
  readonly overrides: JsonObject;
  readonly design: JsonObject;
  readonly design_baseline: boolean;
  readonly versionChanged: boolean;
  readonly current: EnvFingerprint;
  readonly [key: string]: unknown;
}

/** Resolved paths and process settings for one orchestrator session. */
export interface OrchestratorContext {
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly sessionId: string;
  readonly libraryRoot: string | null;
  readonly manifestPath: string | null;
  readonly designRoot: string;
  readonly baseTtl: number;
  readonly stepTtl: number;
  readonly allowTmp: boolean;
  readonly packageVersion: string;
  readonly host: string;
  readonly pid: number;
  readonly json: boolean;
  readonly quiet: boolean;
}

/** The object `boot` returns to the CLI. */
export interface BootResult {
  readonly status: RunStatus;
  readonly exitCode: number;
  readonly halt: string | null;
  readonly reportPath: string | null;
  readonly run: StateSnapshot | null;
  readonly plan: PlanSnapshot | null;
  readonly tasks: readonly TaskRecord[];
  readonly runId: string | null;
  readonly cursor: StateCursor | null;
  readonly tasksSummary: TaskSummary | null;
  readonly drift: DriftDiff | null;
  readonly lease: Lease | null;
  readonly leaseAction?: string;
  readonly reconciliation: ReconciliationSummary | null;
  readonly workQueue: WorkQueue | null;
  readonly workQueuePath: string | null;
  readonly reconcileReportPath: string | null;
  readonly reconcileStatus: ReconcileQueueStatus | null;
  readonly queueHead: Candidate | null;
  readonly error?: string;
}

/**
 * The common shape every command result satisfies. Commands add their own
 * fields; the CLI reads these keys and ignores the rest.
 */
export interface CommandResult {
  readonly status: string;
  readonly exitCode: number;
  readonly runId?: string | null;
  readonly reportPath?: string | null;
  readonly cursor?: StateCursor | null;
  readonly tasksSummary?: TaskSummary | null;
  readonly drift?: DriftDiff | null;
  readonly lease?: Lease | readonly Lease[] | null;
  readonly workQueue?: WorkQueue | null;
  readonly workQueuePath?: string | null;
  readonly reconcileReportPath?: string | null;
  readonly reconcileStatus?: ReconcileQueueStatus | null;
  readonly queueHead?: Candidate | null;
}

/** A command result or the typed error the CLI reports in its place. */
export type CommandOutcome = Result<
  CommandResult,
  { readonly reason: string; readonly detail: unknown; readonly halt: string | null }
>;
