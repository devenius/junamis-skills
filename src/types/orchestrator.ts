// Journal events, derived snapshots, and the context/result shapes the CLI and
// the boot sequence already produce.

import type { JsonObject } from "./common.js";
import type { DesignFingerprint } from "./design.js";
import type { Candidate, WorkQueue } from "./reconcile.js";

export type RunStatus = "NEW_RUN" | "RESUMING" | "COMPLETE" | "BLOCKED_DRIFT" | "HALT_CORRUPT";

export type TaskStatus = "pending" | "in_progress" | "done" | "failed" | "needs_review";

/** Mirrors the reconcile queue status. A queue status is not a run status. */
export type ReconcileQueueStatus = "ready" | "no_work" | "blocked_drift";

/** The documented capability resolution values. */
export interface PlanTask {
  readonly task_id: string;
  readonly capability: string;
  readonly depends_on: readonly string[];
  readonly resolved_skill: string;
  /** One of `ResolutionSource` in practice; a plan file may name any source. */
  readonly resolution_source: string;
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
  /** One of `ResolutionSource` in practice; carried over from the plan. */
  readonly resolution_source: string;
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
 * The payload fields the state engine reads from a journal event.
 *
 * The journal is append-only and hash-chained, and `verifyChain` proves every
 * payload byte after it was written, so these fields are engine-owned once the
 * chain verifies. Untrusted input (the raw line) is parsed and its envelope is
 * validated before it is folded.
 */
export interface JournalEventFields {
  readonly created_at?: string;
  readonly schema_version?: number;
  readonly task_id?: string;
  readonly step_id?: string;
  readonly capability?: string;
  readonly attempt?: number;
  readonly idempotent?: boolean;
  readonly started_at?: string;
  readonly skill?: string;
  readonly task_status?: TaskStatus;
  readonly status?: TaskStatus;
  readonly outputs?: readonly string[];
  readonly handoff?: string | null;
  readonly handoff_status?: string;
  readonly next?: string | null;
  readonly next_target?: string;
  readonly reason?: string;
  readonly questions?: readonly string[];
  readonly decision?: string;
  readonly diff?: Partial<DriftDiff> | null;
  readonly queue_status?: string;
  readonly stalled?: boolean;
  readonly path?: string;
  readonly plan?: PlanSnapshot;
  readonly env_fingerprint?: EnvFingerprint | null;
  readonly design_registry?: DesignFingerprint | null;
  readonly design_registry_files?: Readonly<Record<string, string>> | null;
  readonly lease?: Lease | null;
  readonly reconcile?: boolean;
  readonly bytes_removed?: number;
  readonly last_valid_seq?: number;
  readonly checkpoint_seq?: number;
  readonly hash?: string;
}

/** The fields a caller supplies when it appends one journal line. */
export interface JournalEventInput {
  readonly type: string;
  readonly ts?: string;
  readonly run_id?: string | null;
  readonly session_id?: string | null;
  readonly [key: string]: unknown;
}

/**
 * One journal line. Events are open: the named fields are always present and
 * every contract adds its own payload on top, so extra keys are allowed.
 */
export interface JournalEvent extends JournalEventFields {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly run_id: string | null;
  readonly session_id: string | null;
  readonly prev_hash: string | null;
  readonly hash: string;
  readonly [key: string]: unknown;
}

/** One parsed journal, with a partial trailing line held back. */
export interface JournalLineError {
  readonly line: string;
  readonly error: unknown;
}

export interface JournalInfo {
  readonly events: JournalEvent[];
  readonly errors: JournalLineError[];
  readonly truncated: boolean;
  readonly partial: string;
  readonly removedBytes: number;
  readonly completeText: string;
  readonly exists: boolean;
  readonly size: number;
}

export interface JournalHead {
  readonly seq: number;
  readonly event_hash: string | null;
}

/** The result of verifying one run of events against a hash chain. */
export type ChainCheck =
  | { readonly ok: true; readonly head: JournalHead }
  | { readonly ok: false; readonly index: number; readonly reason: string };

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
  readonly drift?: Partial<DriftDiff> | null;
  readonly completed_at?: string;
  readonly last_truncation?: JournalEvent;
}

export interface Lease {
  readonly session_id: string;
  readonly pid: number;
  readonly host: string;
  readonly started_at?: string;
  readonly acquired_at?: string;
  readonly heartbeat_at: string;
  readonly ttl_seconds: number;
}

/**
 * A contract shape with its top-level `readonly` modifiers removed. The engine
 * rebuilds derived values in memory before it writes a snapshot, so the working
 * copy is mutable while the snapshot itself stays a read-only contract.
 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type RunState = Mutable<StateSnapshot>;
export type TaskState = Mutable<TaskRecord>;

/** The paths one state root resolves to. */
export interface StatePaths {
  readonly root: string;
  readonly journal: string;
  readonly state: string;
  readonly plan: string;
  readonly report: string;
  readonly stateMd: string;
  readonly checkpoints: string;
  readonly tasks: string;
  readonly locks: string;
}

/**
 * The journal writer the store and the design registry append through. The
 * engine module implements this port; the contract only describes it.
 */
export interface JournalSink {
  readonly head: JournalHead;
  readonly events: readonly JournalEvent[];
  append(fields: JournalEventInput): Promise<JournalEvent>;
  retainAfter(seq: number): readonly JournalEvent[];
  lastEvents(count: number): readonly JournalEvent[];
}

/** A checkpoint snapshot with the engine's derived state at one sequence. */
export interface Checkpoint {
  readonly schema_version: number;
  readonly run_id: string;
  readonly seq: number;
  readonly journal_head: JournalHead;
  readonly state: StateSnapshot;
  readonly plan: PlanSnapshot | null;
  readonly tasks: readonly TaskRecord[];
  readonly checksum: string;
}

/** Everything one load of a state root produces. */
export interface LoadedRun {
  readonly paths: StatePaths;
  readonly journalInfo?: JournalInfo;
  checkpoint: Checkpoint | null;
  readonly journal: JournalSink;
  run: RunState | null;
  plan: PlanSnapshot | null;
  tasks: TaskState[];
}

/** A lease plus its computed liveness, as `status` reports it. */
export interface LeaseView extends Lease {
  readonly live: boolean;
  readonly stale: boolean;
  readonly age_seconds: number | null;
}

/** One lease file on disk. `invalid` marks a file that did not parse. */
export interface LeaseRecord {
  readonly path: string;
  readonly lease: Lease | null;
  readonly invalid?: true;
}

/** A lease file plus its liveness, as the `status` snapshot reports it. */
export interface LeaseSummary extends Partial<LeaseView> {
  readonly path: string;
  readonly invalid?: boolean;
}

/** The outcome of taking the single-writer lease. */
export interface LeaseAcquisition {
  readonly action: "acquired" | "taken_over" | "reacquired";
  readonly lease: Lease;
  readonly previous: Lease | null;
}

export interface ReconciliationSummary {
  readonly interrupted: readonly string[];
  readonly retried: readonly string[];
  readonly escalated: readonly string[];
  readonly malformedHandoffs: readonly string[];
}

/** One changed path inside the drift diff. */
export interface DriftPathChange {
  readonly path: string;
  readonly old: string | null;
  readonly new: string | null;
  readonly change: "added" | "removed" | "changed";
}

/** A manifest or library-override comparison. */
export interface DriftAspect {
  readonly old: string | null;
  readonly new: string | null;
  readonly changed: boolean;
  readonly path?: string | null;
  readonly paths?: DriftPathChange[];
}

/** The design-registry comparison inside a drift diff. */
export interface DriftDesignAspect {
  readonly old: DesignFingerprint | null;
  readonly new: DesignFingerprint | null;
  readonly changed: boolean;
  readonly baseline?: boolean;
  readonly paths: readonly DriftPathChange[];
}

/** The drift diff produced by `compareFingerprints`. */
export interface DriftDiff {
  readonly match: boolean;
  readonly recorded_missing: boolean;
  readonly manifest: DriftAspect;
  readonly overrides: DriftAspect;
  readonly design: DriftDesignAspect;
  readonly design_baseline: boolean;
  readonly versionChanged: boolean;
  readonly recorded_version?: string | null;
  readonly current_version?: string | null;
  readonly current: EnvFingerprint;
  readonly detail?: string;
  readonly paths?: readonly DriftPathChange[];
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
  readonly drift: Partial<DriftDiff> | null;
  readonly lease: Lease | null;
  readonly leaseAction?: string;
  readonly reconciliation: Partial<ReconciliationSummary> | null;
  readonly workQueue: WorkQueue | null;
  readonly workQueuePath: string | null;
  readonly reconcileReportPath: string | null;
  readonly reconcileStatus: ReconcileQueueStatus | null;
  readonly queueHead: Candidate | null;
  readonly error?: string;
  readonly [key: string]: unknown;
}

/**
 * The common shape every command result satisfies. Commands add their own
 * fields; the CLI reads these keys and ignores the rest.
 */
export interface CommandResult {
  readonly status: string;
  readonly exitCode: number;
  readonly halt?: string | null;
  readonly run?: StateSnapshot | null;
  readonly plan?: PlanSnapshot | null;
  readonly tasks?: readonly TaskRecord[];
  readonly runId?: string | null;
  readonly reportPath?: string | null;
  readonly cursor?: StateCursor | null;
  readonly tasksSummary?: TaskSummary | null;
  readonly drift?: Partial<DriftDiff> | null;
  readonly lease?: Lease | readonly LeaseSummary[] | null;
  readonly leases?: readonly LeaseSummary[];
  readonly reconciliation?: Partial<ReconciliationSummary> | null;
  readonly workQueue?: WorkQueue | null;
  readonly workQueuePath?: string | null;
  readonly reconcileReportPath?: string | null;
  readonly reconcileStatus?: ReconcileQueueStatus | null;
  readonly queueHead?: Candidate | null;
  readonly task?: string;
  readonly step?: string;
  readonly attempt?: number;
  readonly idempotent?: boolean;
  readonly handoff?: string | null;
  readonly handoffStatus?: string;
  readonly next?: string;
  readonly decision?: string;
  readonly checksum?: string | null;
  readonly checkpoint?: string | null;
  readonly journalHead?: JournalHead;
  readonly path?: string;
  readonly seq?: number;
  readonly action?: string;
  readonly previous?: Lease | null;
  readonly currentFingerprint?: EnvFingerprint;
  readonly designRegistry?: DesignFingerprint | null;
  readonly [key: string]: unknown;
}
