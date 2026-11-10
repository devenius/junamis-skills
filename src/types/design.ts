// The design registry contract from docs/design/_schema.md.

import type { LifecycleStatus } from "./common.js";

export type DesignKind = "web" | "api" | "data" | "infra" | "cli" | "other";

/** Same vocabulary as `LifecycleStatus`, kept as its own named contract. */
export type DesignStatus = Extract<LifecycleStatus, "draft" | "active" | "deprecated" | "needs_review">;

/** The validated frontmatter `validateFrontmatter` proves. */
export interface DesignFrontmatter {
  readonly surface_id: string;
  readonly app?: string;
  readonly kind: DesignKind;
  readonly status: DesignStatus;
  readonly version: string;
  readonly owner: string;
  readonly code_paths: readonly string[];
  readonly depends_on: readonly string[];
  readonly related_tasks: readonly string[];
  readonly last_reviewed: string;
  readonly design_checksum: string;
  readonly last_reviewed_commit?: string;
}

/**
 * The frontmatter mapping as parsed from YAML, before validation. A registry
 * load that does not validate still returns surfaces, so every field stays
 * optional here; `DesignFrontmatter` is the proven shape.
 */
export interface ParsedFrontmatter {
  readonly surface_id?: string;
  readonly app?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly version?: string;
  readonly owner?: string;
  readonly code_paths?: readonly string[];
  readonly depends_on?: readonly string[];
  readonly related_tasks?: readonly string[];
  readonly last_reviewed?: string;
  readonly design_checksum?: string;
  readonly last_reviewed_commit?: string;
  readonly [key: string]: unknown;
}

/** One loaded surface file. `frontmatter` is null when the file did not parse. */
export interface DesignSurface {
  readonly file: string;
  readonly relative: string;
  readonly surface_id: string;
  readonly frontmatter: DesignFrontmatter | ParsedFrontmatter | null;
  readonly body: string | null;
  readonly checksum: string | null;
}

/**
 * The result of validating one design document. Only `ok: true` carries the
 * proven frontmatter and the computed checksum.
 */
export type DesignValidation =
  | {
      readonly ok: true;
      readonly errors: string[];
      readonly file: string | null;
      readonly frontmatter: DesignFrontmatter;
      readonly body: string;
      readonly checksum: string;
      readonly surfaceId: string;
      readonly kind: DesignKind;
    }
  | {
      readonly ok: false;
      readonly errors: string[];
      readonly file: string | null;
      readonly frontmatter: ParsedFrontmatter | null;
      readonly body: string | null;
      readonly checksum: string | null;
      readonly surfaceId: string | null;
      readonly kind: DesignKind | null;
    };

export type DeltaOperation = "create" | "update" | "deprecate" | "none";

export type DeltaAction = "replace" | "append" | "prepend" | "remove_line";

export type DeltaBump = "minor" | "major";

export interface DeltaSection {
  readonly section: string;
  readonly action: DeltaAction;
  /** Required for replace, append, and prepend. */
  readonly content?: string;
  /** Required for remove_line. */
  readonly match?: string;
}

export interface DesignDelta {
  readonly surface_id: string;
  readonly operation: DeltaOperation;
  readonly base_checksum: string | null;
  readonly sections: readonly DeltaSection[];
  readonly code_paths_touched: readonly string[];
  readonly rationale: string | null;
  readonly task_id: string | null;
  readonly skill: string | null;
  readonly idempotent: boolean;
  readonly bump: DeltaBump;
}

/** The B4 fingerprint stored in `state.env_fingerprint.design_registry`. */
export interface DesignFingerprint {
  readonly index_sha256: string;
  readonly surface_count: number;
  readonly status_counts: Readonly<Record<DesignStatus, number>>;
}

/** One bootstrap target: a workspace, or the project root for a single app. */
export interface BootstrapTarget {
  readonly dir: string;
  readonly app: string | null;
  readonly kind: DesignKind;
  readonly surface_id: string;
  readonly code_paths: readonly string[];
}

/** The generated INDEX.md and the counts it was built from. */
export interface IndexResult {
  readonly content: string;
  readonly generatedAt: string;
  readonly surfaceCount: number;
  readonly statusCounts: Record<string, number>;
  readonly surfaces: readonly DesignSurface[];
}

/** The result of `bootstrapRegistry`. */export interface BootstrapResult {
  readonly created: string[];
  readonly skipped: string[];
  readonly schemaCopied: boolean;
  readonly registryCreated: boolean;
  readonly targets: BootstrapTarget[];
  readonly index: { readonly path: string | null; readonly generatedAt: string };
  readonly date: string;
  readonly commit: string | null;
}

/**
 * The result of applying one delta. `rejected` means nothing was written; a
 * rejection is journaled and reported by the CLI.
 */
export interface DeltaOutcome {
  readonly ok: boolean;
  readonly rejected?: boolean;
  readonly unchanged?: boolean;
  readonly surface_id: string;
  readonly reason?: string;
  readonly code?: string;
  readonly operation?: DeltaOperation;
  readonly version?: string;
  readonly checksum?: string | null;
  readonly previous_checksum?: string | null;
  readonly file?: string;
  readonly journal?: unknown;
  readonly index?: unknown;
  readonly reconcile?: string | null;
}

/** One design drift flag. */
export interface CodeDriftFlag {
  readonly type: "CODE_DRIFT";
  readonly surface_id: string;
  readonly files: readonly string[];
  readonly last_reviewed: string;
  readonly last_reviewed_commit: string | null;
}

export interface DependencyDriftFlag {
  readonly type: "DEPENDENCY_DRIFT";
  readonly surface_id: string;
  readonly depends_on: string;
  readonly recorded_version: string;
  readonly current_version: string | null;
  readonly at: string;
}

/** Coverage report. `enforced` is the bootstrap flag, not a hard failure. */
export interface CoverageReport {
  readonly bootstrap_complete: boolean;
  readonly enforced: boolean;
  readonly overlaps: readonly { readonly path: string; readonly surfaces: readonly string[] }[];
  readonly unclaimed: readonly string[];
  readonly claimed_files: number;
  readonly code_files: number;
}

/** The result of `runDrift`. */
export interface DriftReport {
  readonly ok: boolean;
  readonly code: readonly CodeDriftFlag[];
  readonly dependency: readonly DependencyDriftFlag[];
  readonly coverage: CoverageReport;
}
