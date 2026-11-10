// Fixed priority scoring for the pass A detectors.
//
// No model input. No plan_position_frac: plan_pending is ordered by its plan
// index later. Unknown reasons get weight 100 so they sort last.

export const SEVERITY_BASE = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
});

export const REASON_WEIGHT = Object.freeze({
  shadow_conflict: 0,
  needs_review: 1,
  failed_step: 2,
  code_drift: 3,
  coverage_gap: 4,
  dependency_drift: 5,
  plan_pending: 6,
  stale_surface: 7,
});

export const PRIORITY_RANK = Object.freeze({ p0: 0, p1: 1, p2: 2, p3: 3 });

export function reasonWeight(reason) {
  return Object.prototype.hasOwnProperty.call(REASON_WEIGHT, reason) ? REASON_WEIGHT[reason] : 100;
}

export function score({ reason, severity }) {
  const base = Object.prototype.hasOwnProperty.call(SEVERITY_BASE, severity) ? SEVERITY_BASE[severity] : 3;
  const value = base * 100 + reasonWeight(reason);
  let priority;
  if (value < 100) priority = "p0";
  else if (value < 200) priority = "p1";
  else if (value < 300) priority = "p2";
  else priority = "p3";
  return { score: value, priority };
}

export function compareCandidates(a, b) {
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;
  if (a.ready !== b.ready) return a.ready ? -1 : 1;
  const aPosition = Number.isInteger(a.plan_position) ? a.plan_position : Number.POSITIVE_INFINITY;
  const bPosition = Number.isInteger(b.plan_position) ? b.plan_position : Number.POSITIVE_INFINITY;
  if (aPosition !== bPosition) return aPosition - bPosition;
  return Buffer.compare(Buffer.from(a.candidate_id, "utf8"), Buffer.from(b.candidate_id, "utf8"));
}
