// Fixed priority scoring for the pass A detectors.
//
// No model input. No plan_position_frac: plan_pending is ordered by its plan
// index later. Unknown reasons get weight 100 so they sort last.

import type { Priority, Severity } from "../types/common.js";
import type { Candidate } from "../types/reconcile.js";

export const SEVERITY_BASE: Readonly<Record<string, number>> = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
});

export const REASON_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  shadow_conflict: 0,
  needs_review: 1,
  invalid_handoff: 1,
  failed_step: 2,
  code_drift: 3,
  coverage_gap: 4,
  dependency_drift: 5,
  plan_pending: 6,
  stale_surface: 7,
});

export const PRIORITY_RANK: Readonly<Record<Priority, number>> = Object.freeze({ p0: 0, p1: 1, p2: 2, p3: 3 });

export function isKnownReason(reason: unknown): boolean {
  return typeof reason === "string" && Object.prototype.hasOwnProperty.call(REASON_WEIGHT, reason);
}

export function reasonWeight(reason: unknown): number {
  if (typeof reason !== "string") return 100;
  return Object.prototype.hasOwnProperty.call(REASON_WEIGHT, reason) ? (REASON_WEIGHT[reason] ?? 100) : 100;
}

export interface ScoreInput {
  readonly reason: string;
  readonly severity: Severity | string;
  readonly planPosition?: number | null;
}

export interface ScoreResult {
  readonly score: number;
  readonly priority: Priority;
}

export function score({ reason, severity, planPosition = null }: ScoreInput): ScoreResult {
  const base = Object.prototype.hasOwnProperty.call(SEVERITY_BASE, severity) ? (SEVERITY_BASE[severity] ?? 3) : 3;
  const fraction = reason === "plan_pending" && Number.isInteger(planPosition) ? (planPosition ?? 0) / 10000 : 0;
  const value = base * 100 + reasonWeight(reason) + fraction;
  let priority: Priority;
  if (value < 100) priority = "p0";
  else if (value < 200) priority = "p1";
  else if (value < 300) priority = "p2";
  else priority = "p3";
  return { score: value, priority };
}

export function compareCandidates(a: Candidate, b: Candidate): number {
  const priority = (PRIORITY_RANK[a.priority] ?? 0) - (PRIORITY_RANK[b.priority] ?? 0);
  if (priority !== 0) return priority;
  if (a.ready !== b.ready) return a.ready ? -1 : 1;
  const aPosition = Number.isInteger(a.plan_position) ? (a.plan_position ?? 0) : Number.POSITIVE_INFINITY;
  const bPosition = Number.isInteger(b.plan_position) ? (b.plan_position ?? 0) : Number.POSITIVE_INFINITY;
  if (aPosition !== bPosition) return aPosition - bPosition;
  return Buffer.compare(Buffer.from(a.candidate_id, "utf8"), Buffer.from(b.candidate_id, "utf8"));
}
