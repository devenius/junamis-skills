// The RECONCILE work-queue contract from docs/RECONCILE.md.

import type { Priority, Severity } from "./common.js";
import type { DriftDiff, LoadedRun } from "./orchestrator.js";

export type TargetKind = "surface" | "task" | "repo";

/** Where a capability's skill came from. RECONCILE §7. */
export type ResolutionSource = "internal_override" | "manifest" | "needs_review";

export interface CandidateTarget {
  readonly kind: TargetKind;
  readonly id: string;
}

/** Detector ids and the fixed reason weights in src/reconcile/score.ts. */
export type CandidateReason =
  | "shadow_conflict"
  | "needs_review"
  | "invalid_handoff"
  | "failed_step"
  | "code_drift"
  | "coverage_gap"
  | "dependency_drift"
  | "plan_pending"
  | "stale_surface";

export type Capability =
  | "scope"
  | "architect"
  | "develop"
  | "test"
  | "check"
  | "document"
  | "audit"
  | "sync"
  | "needs_review";

export type Effort = "unknown" | "small" | "medium" | "large";

export interface ProvenanceEntry {
  readonly detector: string;
  readonly at_seq: number;
  readonly at_ts: string | null;
}

export interface Candidate {
  readonly candidate_id: string;
  readonly capability: string;
  readonly target: CandidateTarget;
  /**
   * One of `CandidateReason` for every detector this package ships. A detector
   * may report an unknown reason; the pass keeps it, scores it last, and audits
   * it with a journal event, so the type stays open.
   */
  readonly reason: string;
  readonly priority: Priority;
  readonly severity: Severity;
  readonly effort: Effort;
  readonly ready: boolean;
  readonly blocked_by: readonly string[];
  readonly resolved_skill: string | null;
  readonly resolution_source: ResolutionSource;
  readonly provenance: readonly ProvenanceEntry[];
  readonly rationale: string;
  readonly plan_position: number | null;
  readonly non_dispatchable?: boolean;
  readonly shadow_conflict?: boolean;
  readonly drift?: Partial<DriftDiff> | null;
}

/**
 * A detector's pre-resolution output. The pass dedupes it, resolves a skill,
 * and scores it into a `Candidate`.
 */
export interface RawCandidate {
  readonly capability: string;
  readonly target: CandidateTarget;
  readonly reason: string;
  readonly severity: Severity;
  readonly plan_position: number | null;
  readonly rationale: string;
  readonly provenance: readonly ProvenanceEntry[];
  readonly non_dispatchable?: boolean;
  readonly resolved_skill?: string;
  readonly resolution_source?: ResolutionSource;
}

export interface QueueSummary {
  readonly total: number;
  readonly ready: number;
  readonly blocked: number;
  readonly needs_review: number;
  readonly by_priority: Readonly<Record<Priority, number>>;
  readonly stalled?: boolean;
  readonly blocking_set?: readonly string[];
}

export interface QueueInputFingerprint {
  readonly journal_head_seq: number;
  readonly plan_checksum: string | null;
  readonly design_index_sha256: string | null;
  readonly env_fingerprint: {
    readonly skills_lock_sha256: string | null;
    readonly library_overrides_sha256: string | null;
  };
}

export type WorkQueueStatus = "ready" | "no_work" | "blocked_drift";

/** `work-queue.json`. Derived on every pass; never committed. */
export interface WorkQueue {
  readonly schema_version: number;
  readonly pass_id: string;
  readonly generated_at: string;
  readonly input_fingerprint: QueueInputFingerprint;
  readonly status: WorkQueueStatus;
  readonly summary: QueueSummary;
  readonly queue: readonly Candidate[];
  readonly stalled?: boolean;
  readonly drift?: Partial<DriftDiff> | null;
}

export interface DetectorEntry {
  readonly id: string;
  readonly enabled: boolean;
  readonly order: number;
  /** The raw YAML params mapping. Detectors read the keys they need. */
  readonly params?: Record<string, unknown>;
  readonly supported?: boolean;
}

/**
 * The normalized result of loading `reconcile/detectors.yaml`. The file itself
 * uses `schema_version` and `tick_every`; the loader returns the camelCase
 * `tickEvery` plus its resolved path.
 */
export interface DetectorManifest {
  readonly path: string;
  readonly created: boolean;
  readonly detectors: readonly DetectorEntry[];
  readonly tickEvery: number;
}

/** One row of the detector status table in the reconcile report. */
export interface DetectorStatus {
  readonly id: string;
  readonly enabled: boolean;
  readonly fired: number;
  readonly candidates: number;
  readonly skipped?: string;
  readonly error?: string;
}

/** A `priority_override` journal event, with the rationale RECONCILE requires. */
export interface PriorityOverride {
  readonly candidate_id: string;
  readonly from: Priority;
  readonly to: Priority;
  readonly rationale: string;
  readonly by: string;
  readonly ts?: string;
}

/** The options one RECONCILE pass accepts. */
export interface ReconcileOptions {
  readonly stateRoot: string;
  readonly projectRoot: string;
  readonly designRoot?: string | null;
  readonly libraryRoot?: string | null;
  readonly manifestPath?: string | null;
  readonly packageVersion?: string;
  readonly trigger?: string;
  readonly status?: string | null;
  readonly drift?: Partial<DriftDiff> | null;
  readonly loaded?: LoadedRun | null;
  readonly sessionId?: string;
}

/** The result of one RECONCILE pass. */
export interface ReconcileResult {
  readonly ok: true;
  readonly status: WorkQueueStatus;
  readonly passId: string;
  readonly queue: WorkQueue;
  readonly queuePath: string;
  readonly reportPath: string;
  readonly head: Candidate | null;
  readonly detectorStatus: readonly DetectorStatus[];
  readonly event: unknown;
  readonly events: readonly unknown[];
  readonly tick: boolean;
  readonly stale: { readonly pass_id: string | null; readonly mismatched_field: string } | null;
  readonly overridesRejected: readonly unknown[];
}
