// RECONCILE detectors.
//
// MVP: plan_pending, code_drift, failed_step.
// Extended: coverage_gap, dependency_drift, needs_review, stale_surface, and
// shadow_conflict. Every detector is a read-only function over one snapshot.

import { join } from "node:path";
import { exists, readJsonFile } from "../orchestrator/fsx.js";
import { detectCodeDrift, detectCoverage, detectDependencyDrift } from "../design/drift.js";
import { orderTasks } from "../orchestrator/plan.js";
import { isRecord } from "../types/guards.js";
import type { Severity } from "../types/common.js";
import type { DesignSurface } from "../types/design.js";
import type { JournalEvent, PlanSnapshot, PlanTask, TaskRecord } from "../types/orchestrator.js";
import type { CandidateTarget, ProvenanceEntry, RawCandidate, ResolutionSource } from "../types/reconcile.js";

/** One detector run's read-only snapshot. Every runner takes this shape. */
export interface DetectorContext {
  readonly plan: PlanSnapshot | null;
  readonly tasks: readonly TaskRecord[];
  readonly events: readonly JournalEvent[];
  readonly surfaces?: readonly DesignSurface[];
  readonly designRoot?: string | null;
  readonly projectRoot?: string;
  readonly libraryRoot?: string | null;
  readonly manifestPath?: string | null;
  readonly overridesStale?: boolean;
  readonly lastSeq?: number;
  readonly lastTs?: string;
  readonly params?: Record<string, unknown> | undefined;
}

export type DetectorRunner = (ctx: DetectorContext) => RawCandidate[] | Promise<RawCandidate[]>;

function orderedPlanTasks(plan: PlanSnapshot | null): readonly PlanTask[] {
  if (!plan || !Array.isArray(plan.tasks)) return [];
  try {
    return orderTasks(plan.tasks);
  } catch {
    return plan.tasks;
  }
}

function lastEvent(events: readonly JournalEvent[], types: readonly string[]): JournalEvent | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event && types.includes(event.type)) return event;
  }
  return null;
}

function latestStepEndByTask(events: readonly JournalEvent[]): Map<string, JournalEvent> {
  const map = new Map<string, JournalEvent>();
  for (const event of events) {
    if (event?.type === "step_end" && typeof event.task_id === "string") {
      map.set(event.task_id, event);
    }
  }
  return map;
}

interface CandidateInput {
  readonly capability: string;
  readonly target: CandidateTarget;
  readonly reason: string;
  readonly severity: Severity;
  readonly planPosition?: number | null;
  readonly rationale: string;
  readonly detector: string;
  readonly atSeq?: number | null | undefined;
  readonly atTs?: string | null | undefined;
  readonly nonDispatchable?: boolean;
  readonly resolvedSkill?: string | null;
  readonly resolutionSource?: ResolutionSource | null;
}

function candidate({
  capability,
  target,
  reason,
  severity,
  planPosition = null,
  rationale,
  detector,
  atSeq,
  atTs,
  nonDispatchable = false,
  resolvedSkill = null,
  resolutionSource = null,
}: CandidateInput): RawCandidate {
  const provenance: ProvenanceEntry[] = [
    {
      detector,
      at_seq: atSeq ?? 0,
      at_ts: atTs ?? null,
    },
  ];
  return {
    capability,
    target,
    reason,
    severity,
    plan_position: planPosition,
    rationale,
    provenance,
    ...(nonDispatchable ? { non_dispatchable: true } : {}),
    ...(resolvedSkill ? { resolved_skill: resolvedSkill } : {}),
    ...(resolutionSource ? { resolution_source: resolutionSource } : {}),
  };
}

export function runPlanPending({ plan, tasks, events }: DetectorContext): RawCandidate[] {
  const ordered = orderedPlanTasks(plan);
  const byId = new Map((tasks ?? []).map((task) => [task.task_id, task]));
  const planEvent = lastEvent(events, ["plan_created", "plan_updated"]);
  const candidates: RawCandidate[] = [];
  ordered.forEach((planTask, index) => {
    const task = byId.get(planTask.task_id);
    const status = task?.status ?? "pending";
    if (status !== "pending") return;
    candidates.push(candidate({
      capability: planTask.capability,
      target: { kind: "task", id: planTask.task_id },
      reason: "plan_pending",
      severity: "medium",
      planPosition: index,
      rationale: `plan task ${planTask.task_id} is pending`,
      detector: "plan_pending",
      atSeq: planEvent?.seq,
      atTs: planEvent?.ts,
    }));
  });
  return candidates;
}

export async function runCodeDrift({
  designRoot,
  projectRoot,
  events,
  lastSeq,
  lastTs,
  params = {},
}: DetectorContext): Promise<RawCandidate[]> {
  if (!designRoot) return [];
  const useGit = params["use_git"] !== false;
  const flags = await detectCodeDrift({ designRoot, projectRoot: projectRoot ?? "", git: useGit });
  const last = events.length > 0 ? events[events.length - 1] : null;
  return flags.map((flag) => candidate({
    capability: "document",
    target: { kind: "surface", id: flag.surface_id },
    reason: "code_drift",
    severity: "high",
    rationale: `code changed under active surface ${flag.surface_id}: ${flag.files.join(", ")}`,
    detector: "code_drift",
    atSeq: lastSeq ?? last?.seq,
    atTs: lastTs ?? last?.ts,
  }));
}

export function runFailedStep({ plan, tasks, events, lastSeq, lastTs }: DetectorContext): RawCandidate[] {
  const ordered = orderedPlanTasks(plan);
  const taskById = new Map((tasks ?? []).map((task) => [task.task_id, task]));
  const planById = new Map((plan?.tasks ?? []).map((task) => [task.task_id, task]));
  const latestStepEnd = latestStepEndByTask(events);
  const candidates: RawCandidate[] = [];
  for (const task of ordered) {
    const record = taskById.get(task.task_id);
    const stepEnd = latestStepEnd.get(task.task_id);
    const failed = record?.status === "failed" || stepEnd?.task_status === "failed" || stepEnd?.status === "failed";
    if (!failed) continue;
    const capability = planById.get(task.task_id)?.capability ?? record?.capability ?? task.capability;
    candidates.push(candidate({
      capability,
      target: { kind: "task", id: task.task_id },
      reason: "failed_step",
      severity: "high",
      rationale: `task ${task.task_id} last step failed`,
      detector: "failed_step",
      atSeq: stepEnd?.seq ?? lastSeq,
      atTs: stepEnd?.ts ?? lastTs,
    }));
  }
  return candidates;
}

export async function runCoverageGap({
  designRoot,
  projectRoot,
  lastSeq,
  lastTs,
}: DetectorContext): Promise<RawCandidate[]> {
  if (!designRoot) return [];
  const coverage = await detectCoverage({ designRoot, projectRoot: projectRoot ?? "" });
  const candidates: RawCandidate[] = [];
  for (const overlap of coverage.overlaps) {
    candidates.push(candidate({
      capability: "document",
      target: { kind: "surface", id: overlap.surfaces[0] ?? "" },
      reason: "coverage_gap",
      severity: "medium",
      rationale: `overlapping code path ${overlap.path} claimed by ${overlap.surfaces.join(", ")}`,
      detector: "coverage_gap",
      atSeq: lastSeq,
      atTs: lastTs,
    }));
  }
  for (const path of coverage.unclaimed) {
    candidates.push(candidate({
      capability: "document",
      target: { kind: "repo", id: path },
      reason: "coverage_gap",
      severity: "medium",
      rationale: `unclaimed code path ${path}`,
      detector: "coverage_gap",
      atSeq: lastSeq,
      atTs: lastTs,
    }));
  }
  return candidates;
}

export async function runDependencyDrift({ designRoot, lastSeq, lastTs }: DetectorContext): Promise<RawCandidate[]> {
  if (!designRoot) return [];
  const flags = await detectDependencyDrift({ designRoot });
  return flags.map((flag) => candidate({
    capability: "develop",
    target: { kind: "surface", id: flag.surface_id },
    reason: "dependency_drift",
    severity: "medium",
    rationale: `depends_on ${flag.depends_on} moved from v${flag.recorded_version} to v${String(flag.current_version)}`,
    detector: "dependency_drift",
    atSeq: lastSeq,
    atTs: lastTs,
  }));
}

export function runNeedsReview({ plan, tasks, surfaces = [], lastSeq, lastTs }: DetectorContext): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  for (const surface of surfaces) {
    if (surface.frontmatter?.status !== "needs_review") continue;
    candidates.push(candidate({
      capability: "needs_review",
      target: { kind: "surface", id: surface.surface_id },
      reason: "needs_review",
      severity: "critical",
      rationale: `surface ${surface.surface_id} needs operator review`,
      detector: "needs_review",
      atSeq: lastSeq,
      atTs: lastTs,
      nonDispatchable: true,
      resolvedSkill: "needs_review",
      resolutionSource: "needs_review",
    }));
  }
  const planIds = new Set((plan?.tasks ?? []).map((task) => task.task_id));
  for (const task of tasks ?? []) {
    if (task.status !== "needs_review") continue;
    if (planIds.size > 0 && !planIds.has(task.task_id)) continue;
    candidates.push(candidate({
      capability: "needs_review",
      target: { kind: "task", id: task.task_id },
      reason: "needs_review",
      severity: "critical",
      rationale: `task ${task.task_id} needs operator review`,
      detector: "needs_review",
      atSeq: lastSeq,
      atTs: lastTs,
      nonDispatchable: true,
      resolvedSkill: "needs_review",
      resolutionSource: "needs_review",
    }));
  }
  return candidates;
}

export function runStaleSurface({ surfaces = [], lastSeq, lastTs, params = {} }: DetectorContext): RawCandidate[] {
  const maxAgeDays = Number.parseInt(String(params["max_age_days"] ?? "30"), 10);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0 || !lastTs) return [];
  const now = Date.parse(`${String(lastTs).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(now)) return [];
  const candidates: RawCandidate[] = [];
  for (const surface of surfaces) {
    if (surface.frontmatter?.status !== "active") continue;
    const reviewedAt = surface.frontmatter.last_reviewed;
    if (typeof reviewedAt !== "string") continue;
    const reviewed = Date.parse(`${reviewedAt}T00:00:00Z`);
    if (Number.isNaN(reviewed)) continue;
    const days = Math.floor((now - reviewed) / 86_400_000);
    if (days <= maxAgeDays) continue;
    candidates.push(candidate({
      capability: "check",
      target: { kind: "surface", id: surface.surface_id },
      reason: "stale_surface",
      severity: "low",
      rationale: `active surface ${surface.surface_id} last reviewed ${reviewedAt} (${days} days)`,
      detector: "stale_surface",
      atSeq: lastSeq,
      atTs: lastTs,
    }));
  }
  return candidates;
}

export async function runShadowConflict({
  plan,
  libraryRoot,
  manifestPath,
  overridesStale,
  lastSeq,
  lastTs,
}: DetectorContext): Promise<RawCandidate[]> {
  let manifestSkills: Record<string, unknown> = {};
  if (manifestPath) {
    const parsed = await readJsonFile(manifestPath);
    if (parsed.exists && !parsed.error && isRecord(parsed.value) && isRecord(parsed.value["skills"])) {
      manifestSkills = parsed.value["skills"];
    }
  }
  const seen = new Set<string>();
  const candidates: RawCandidate[] = [];
  for (const planTask of orderedPlanTasks(plan)) {
    const capability = planTask.capability;
    if (!capability || seen.has(capability) || capability === "needs_review" || capability === "audit") continue;
    seen.add(capability);
    const internal = Boolean(libraryRoot && (await exists(join(libraryRoot, "skills", capability, "SKILL.md"))));
    const manifestHas = Boolean(manifestSkills[capability]);
    const conflict = (internal && overridesStale) || (!internal && !manifestHas);
    if (!conflict) continue;
    candidates.push(candidate({
      capability: "needs_review",
      target: { kind: "task", id: planTask.task_id },
      reason: "shadow_conflict",
      severity: "critical",
      rationale: internal
        ? `internal override ${capability} is shadowed by a stale override fingerprint`
        : `capability ${capability} has no internal override and no manifest entry`,
      detector: "shadow_conflict",
      atSeq: lastSeq,
      atTs: lastTs,
      nonDispatchable: true,
      resolvedSkill: "needs_review",
      resolutionSource: "needs_review",
    }));
  }
  return candidates;
}

export const DETECTOR_RUNNERS: Readonly<Record<string, DetectorRunner>> = Object.freeze({
  plan_pending: runPlanPending,
  code_drift: runCodeDrift,
  failed_step: runFailedStep,
  coverage_gap: runCoverageGap,
  dependency_drift: runDependencyDrift,
  needs_review: runNeedsReview,
  stale_surface: runStaleSurface,
  shadow_conflict: runShadowConflict,
});
