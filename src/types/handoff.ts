// The HANDOFF block contract from library/HANDOFF.md.

import type { Severity } from "./common.js";

export type HandoffStatus = "complete" | "blocked" | "needs-decision" | "failed";

export type ArtifactKind = "created" | "updated" | "read-only";

export interface Artifact {
  readonly path: string;
  readonly kind: ArtifactKind;
}

export interface Finding {
  readonly id: string;
  readonly severity: Severity;
  readonly summary: string;
  readonly evidence: string;
}

export interface Handoff {
  readonly agent: string;
  readonly job: string;
  readonly status: HandoffStatus;
  readonly artifacts: readonly Artifact[];
  readonly findings: readonly Finding[];
  readonly decisions_owed: readonly string[];
  readonly next: string;
}
