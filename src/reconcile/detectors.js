// Pass A detectors: plan_pending, code_drift, and failed_step.
//
// Each detector is a pure read over the supplied snapshot. It returns raw
// candidates; the queue builder dedupes, resolves, scores, and sorts them.

import { detectCodeDrift } from "../design/drift.js";
import { orderTasks } from "../orchestrator/plan.js";

function orderedPlanTasks(plan) {
  if (!plan || !Array.isArray(plan.tasks)) return [];
  try {
    return orderTasks(plan.tasks);
  } catch {
    return plan.tasks;
  }
}

function lastEvent(events, types) {
  for (let index = events.length - 1; index >= 0; index--) {
    if (types.includes(events[index]?.type)) return events[index];
  }
  return null;
}

function latestStepEndByTask(events) {
  const map = new Map();
  for (const event of events) {
    if (event?.type === "step_end" && typeof event.task_id === "string") {
      map.set(event.task_id, event);
    }
  }
  return map;
}

function candidate({ capability, target, reason, severity, planPosition = null, rationale, detector, atSeq, atTs }) {
  return {
    capability,
    target,
    reason,
    severity,
    plan_position: planPosition,
    rationale,
    provenance: [
      {
        detector,
        at_seq: atSeq ?? 0,
        at_ts: atTs ?? null,
      },
    ],
  };
}

export function runPlanPending({ plan, tasks, events }) {
  const ordered = orderedPlanTasks(plan);
  const byId = new Map((tasks ?? []).map((task) => [task.task_id, task]));
  const planEvent = lastEvent(events, ["plan_created", "plan_updated"]);
  const candidates = [];
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

export async function runCodeDrift({ designRoot, projectRoot, events, lastSeq, lastTs, params = {} }) {
  if (!designRoot) return [];
  const useGit = params.use_git !== false;
  const flags = await detectCodeDrift({ designRoot, projectRoot, git: useGit });
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

export function runFailedStep({ plan, tasks, events, lastSeq, lastTs }) {
  const ordered = orderedPlanTasks(plan);
  const taskById = new Map((tasks ?? []).map((task) => [task.task_id, task]));
  const planById = new Map((plan?.tasks ?? []).map((task) => [task.task_id, task]));
  const latestStepEnd = latestStepEndByTask(events);
  const candidates = [];
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

export const DETECTOR_RUNNERS = Object.freeze({
  plan_pending: runPlanPending,
  code_drift: runCodeDrift,
  failed_step: runFailedStep,
});
