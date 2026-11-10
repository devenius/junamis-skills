// The design registry contract from docs/design/_schema.md.

import type { LifecycleStatus } from "./common.js";

export type DesignKind = "web" | "api" | "data" | "infra" | "cli" | "other";

/** Same vocabulary as `LifecycleStatus`, kept as its own named contract. */
export type DesignStatus = Extract<LifecycleStatus, "draft" | "active" | "deprecated" | "needs_review">;

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

/** One loaded surface file. `frontmatter` is null when the file did not parse. */
export interface DesignSurface {
  readonly file: string;
  readonly relative: string;
  readonly surface_id: string;
  readonly frontmatter: DesignFrontmatter | null;
  readonly body: string | null;
  readonly checksum: string | null;
}

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
