// Derived run state: fold journal events into state.json, plan.json, and task
// records, then write the snapshots atomically.
//
// Replay is the source of truth. A snapshot is only a cache.

import { join } from "node:path";
import { ensureTaskTree, atomicWriteFile } from "./fsx.js";
import { orderTasks } from "./plan.js";
import { planChecksum } from "./hash.js";
import { isStringArray } from "../types/guards.js";
import type {
  JournalEvent,
  PlanSnapshot,
  PlanTask,
  RunState,
  RunStatus,
  StateCursor,
  StatePaths,
  TaskRecord,
  TaskState,
  TaskStatus,
  TaskSummary,
} from "../types/orchestrator.js";

export const SCHEMA_VERSION = 1;
export const HANDOFF_SCHEMA_VERSION = 1;
export const TASK_STATUSES: readonly TaskStatus[] = ["pending", "in_progress", "done", "failed", "needs_review"];

const RUNTIME_FIELDS = [
  "status",
  "current_step",
  "outputs",
  "attempt",
  "questions",
  "resolution",
  "last_error",
  "next",
  "handoff",
  "updated_at",
] as const;

/** The working state the reducer folds events into. */
export interface ReplayContext {
  run: RunState | null;
  plan: PlanSnapshot | null;
  tasks: Map<string, TaskRecord>;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function copyField<K extends keyof TaskRecord>(target: TaskRecord, source: TaskRecord, key: K): void {
  const value = source[key];
  if (value !== undefined) target[key] = clone(value);
}

export function emptyPlan({
  runId,
  createdAt,
  envFingerprint = null,
}: {
  readonly runId: string;
  readonly createdAt: string;
  readonly envFingerprint?: PlanSnapshot["env_fingerprint"];
}): PlanSnapshot {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    created_at: createdAt,
    env_fingerprint: envFingerprint,
    capabilities: [],
    tasks: [],
    checksum: planChecksum([]),
  };
}

export function buildTaskRecord(planTask: PlanTask, timestamp: string): TaskState {
  return {
    schema_version: SCHEMA_VERSION,
    task_id: planTask.task_id,
    capability: planTask.capability,
    status: "pending",
    resolved_skill: planTask.resolved_skill,
    resolution_source: planTask.resolution_source,
    owner: planTask.owner ?? "orchestrator",
    adapter: planTask.adapter ?? null,
    current_step: null,
    inputs_hash: planTask.inputs_hash,
    outputs: [],
    attempt: 0,
    updated_at: timestamp,
  };
}

function taskFromPlan(planTask: PlanTask, previous: TaskState | undefined, timestamp: string): TaskState {
  const record = buildTaskRecord(planTask, timestamp);
  if (!previous) return record;
  for (const field of RUNTIME_FIELDS) copyField(record, previous, field);
  return record;
}

function taskMap(tasks: Map<string, TaskState> | readonly TaskRecord[] | null | undefined): Map<string, TaskState> {
  if (tasks instanceof Map) return tasks;
  if (Array.isArray(tasks)) return new Map(tasks.map((task) => [task.task_id, task]));
  return new Map(Object.entries(tasks ?? {}));
}

/** The task an event names, if the fold already knows it. */
function eventTask(ctx: ReplayContext, event: JournalEvent): TaskState | undefined {
  const taskId = event.task_id;
  return typeof taskId === "string" ? ctx.tasks.get(taskId) : undefined;
}

export function applyEvent(ctx: ReplayContext, event: JournalEvent): ReplayContext {
  if (!event || typeof event !== "object") return ctx;

  if (event.type === "run_start") {
    const fingerprint = clone(event.env_fingerprint ?? null);
    ctx.run = {
      schema_version: SCHEMA_VERSION,
      run_id: event.run_id ?? "",
      created_at: event.created_at ?? event.ts,
      updated_at: event.ts,
      run_status: "NEW_RUN",
      cursor: null,
      plan: { path: "plan.json", checksum: null },
      env_fingerprint: fingerprint,
      tasks_summary: taskSummary([]),
      journal_head: { seq: event.seq, event_hash: event.hash },
      last_checkpoint: null,
      reconcile: null,
    };
    ctx.plan = null;
    ctx.tasks = new Map();
    return ctx;
  }

  const run = ctx.run;
  if (!run) return ctx;

  switch (event.type) {
    case "run_resume":
    case "lease_acquired":
    case "lease_reacquired":
    case "lease_taken_over":
    case "lease_released":
    case "lease_lost":
    case "journal_truncated":
      run.updated_at = event.ts;
      if (event.type === "journal_truncated") run.last_truncation = clone(event);
      break;

    case "plan_created":
    case "plan_updated": {
      if (!event.plan || typeof event.plan !== "object") break;
      const plan = clone(event.plan);
      const previous = taskMap(ctx.tasks);
      const next = new Map<string, TaskState>();
      for (const planTask of plan.tasks ?? []) {
        next.set(planTask.task_id, taskFromPlan(planTask, previous.get(planTask.task_id), event.ts));
      }
      ctx.plan = plan;
      ctx.tasks = next;
      run.plan = { path: "plan.json", checksum: plan.checksum };
      if (plan.env_fingerprint) run.env_fingerprint = clone(plan.env_fingerprint);
      delete run.completed_at;
      run.updated_at = event.ts;
      break;
    }

    case "step_start": {
      const task = eventTask(ctx, event);
      if (!task) break;
      task.status = "in_progress";
      task.attempt = event.attempt ?? 0;
      task.current_step = {
        step_id: event.step_id ?? "",
        skill: event.skill ?? task.resolved_skill,
        attempt: event.attempt ?? 0,
        idempotent: event.idempotent ?? false,
        started_at: event.started_at ?? event.ts,
        session_id: event.session_id ?? "",
      };
      task.updated_at = event.ts;
      run.updated_at = event.ts;
      break;
    }

    case "step_end": {
      const task = eventTask(ctx, event);
      if (!task) break;
      task.status = event.task_status ?? event.status ?? task.status;
      task.current_step = null;
      task.outputs = clone(event.outputs ?? task.outputs ?? []);
      task.handoff = event.handoff ?? null;
      task.next = event.next ?? null;
      if (event.reason) task.last_error = event.reason;
      task.updated_at = event.ts;
      run.updated_at = event.ts;
      break;
    }

    case "task_status": {
      const task = eventTask(ctx, event);
      if (!task) break;
      task.status = event.task_status ?? event.status ?? task.status;
      if (event.reason) task.last_error = event.reason;
      if (task.status !== "in_progress") task.current_step = null;
      task.updated_at = event.ts;
      run.updated_at = event.ts;
      break;
    }

    case "escalation": {
      const task = eventTask(ctx, event);
      if (task) {
        task.status = "needs_review";
        if (isStringArray(event.questions)) task.questions = [...event.questions];
        if (event.reason) task.last_error = event.reason;
        task.updated_at = event.ts;
      }
      if (event.reconcile !== true) run.updated_at = event.ts;
      break;
    }

    case "resolution": {
      const task = eventTask(ctx, event);
      if (task) {
        task.status = "pending";
        task.current_step = null;
        task.questions = [];
        task.resolution = { decision: event.decision ?? "", at: event.ts };
        task.updated_at = event.ts;
      }
      run.updated_at = event.ts;
      break;
    }

    case "drift_detected": {
      run.run_status = "BLOCKED_DRIFT";
      run.drift = clone(event.diff ?? null);
      run.updated_at = event.ts;
      break;
    }

    case "drift_cleared":
      run.run_status = null;
      run.drift = null;
      run.updated_at = event.ts;
      break;

    case "reconcile_pass":
      // Reconcile is a derived read. It updates the state field but is not a
      // reason to change updated_at, so two passes on one snapshot stay
      // byte-identical.
      run.reconcile = event.queue_status === "ready"
        ? "ready"
        : event.queue_status === "no_work"
          ? "no_work"
          : "blocked_drift";
      run.stalled = event.stalled === true;
      break;

    case "priority_override":
    case "priority_override_rejected":
    case "queue_blocked":
    case "queue_stale":
    case "unknown_reason":
    case "run_stalled":
      // Audit-only reconcile events. They do not change the run cursor or the
      // updated_at timestamp used for a deterministic queue.
      break;

    case "run_complete":
      run.run_status = "COMPLETE";
      run.completed_at = event.ts;
      run.updated_at = event.ts;
      break;

    case "checkpoint_written":
      run.last_checkpoint = event.path ?? null;
      run.updated_at = event.ts;
      break;

    default:
      run.updated_at = event.ts;
      break;
  }
  return ctx;
}

export function taskSummary(tasks: readonly TaskRecord[] | null | undefined): TaskSummary {
  const summary: Partial<Record<TaskStatus, number>> = {};
  for (const status of TASK_STATUSES) summary[status] = 0;
  for (const task of tasks ?? []) {
    const status = task.status ?? "pending";
    summary[status] = (summary[status] ?? 0) + 1;
  }
  return summary;
}

export function dependenciesDone(planTask: PlanTask, byId: Map<string, TaskState>): boolean {
  return (planTask.depends_on ?? []).every((dep) => byId.get(dep)?.status === "done");
}

export function selectCursor(
  plan: PlanSnapshot | null,
  tasks: Map<string, TaskState> | readonly TaskRecord[] | null,
): StateCursor | null {
  if (!plan || plan.tasks.length === 0) return null;
  const byId = taskMap(tasks);
  let ordered: readonly PlanTask[];
  try {
    ordered = orderTasks(plan.tasks);
  } catch {
    ordered = plan.tasks;
  }
  for (const planTask of ordered) {
    const task = byId.get(planTask.task_id);
    if (!task) continue;
    if (task.status !== "pending" && task.status !== "in_progress") continue;
    if (!dependenciesDone(planTask, byId)) continue;
    return {
      task_id: task.task_id,
      capability: task.capability,
      step_id: task.current_step?.step_id ?? null,
      attempt: task.attempt ?? 0,
      status: task.status,
    };
  }
  return null;
}

export function allTasksDone(
  plan: PlanSnapshot | null,
  tasks: Map<string, TaskState> | readonly TaskRecord[] | null,
): boolean {
  if (!plan) return false;
  if (plan.tasks.length === 0) return true;
  const byId = taskMap(tasks);
  return plan.tasks.every((planTask) => byId.get(planTask.task_id)?.status === "done");
}

export interface FinalizeOptions {
  readonly status?: RunStatus | null | undefined;
  readonly now?: string | null | undefined;
}

export interface FinalizeResult {
  readonly run: RunState | null;
  readonly plan: PlanSnapshot | null;
  readonly tasks: readonly TaskRecord[];
}

export function finalizeRun(
  run: RunState | null,
  plan: PlanSnapshot | null,
  tasks: Map<string, TaskState> | readonly TaskRecord[] | null,
  { status = null, now = null }: FinalizeOptions = {},
): FinalizeResult {
  if (!run) return { run: null, plan: plan ?? null, tasks: [] };
  const map = taskMap(tasks);
  let ordered: TaskRecord[];
  if (plan) {
    try {
      ordered = orderTasks(plan.tasks)
        .map((planTask) => map.get(planTask.task_id))
        .filter((task): task is TaskRecord => Boolean(task));
    } catch {
      ordered = [...map.values()];
    }
  } else {
    ordered = [...map.values()];
  }

  let nextStatus: RunStatus;
  if (status) nextStatus = status;
  else if (run.run_status === "HALT_CORRUPT") nextStatus = "HALT_CORRUPT";
  else if (run.run_status === "BLOCKED_DRIFT") nextStatus = "BLOCKED_DRIFT";
  else if (run.completed_at) nextStatus = "COMPLETE";
  else if (!plan || plan.tasks.length === 0) nextStatus = "NEW_RUN";
  else if (ordered.length > 0 && ordered.every((task) => task.status === "done")) nextStatus = "COMPLETE";
  else nextStatus = "RESUMING";

  run.run_status = nextStatus;
  run.tasks_summary = taskSummary(ordered);
  run.cursor = nextStatus === "COMPLETE" ? null : selectCursor(plan, ordered);
  if (plan) run.plan = { path: "plan.json", checksum: plan.checksum };
  if (!run.updated_at && now) run.updated_at = now;
  return { run, plan, tasks: ordered };
}

export async function writePlan(root: string, plan: PlanSnapshot): Promise<void> {
  await atomicWriteFile(join(root, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
}

export async function writeState(root: string, run: RunState): Promise<void> {
  await atomicWriteFile(join(root, "state.json"), `${JSON.stringify(run, null, 2)}\n`);
}

export async function writeTask(root: string, task: TaskRecord): Promise<void> {
  await ensureTaskTree(root, task.task_id);
  await atomicWriteFile(join(root, "tasks", task.task_id, "task.json"), `${JSON.stringify(task, null, 2)}\n`);
}

export async function writeTasks(root: string, tasks: readonly TaskRecord[] | null | undefined): Promise<void> {
  for (const task of tasks ?? []) await writeTask(root, task);
}

export interface SnapshotInput {
  readonly paths: StatePaths;
  readonly run: RunState;
  readonly plan: PlanSnapshot | null;
  readonly tasks: readonly TaskRecord[];
}

export async function writeSnapshots({ paths, run, plan, tasks }: SnapshotInput): Promise<void> {
  run.journal_head = run.journal_head ?? { seq: 0, event_hash: null };
  if (plan) await writePlan(paths.root, plan);
  await writeTasks(paths.root, tasks);
  await writeState(paths.root, run);
}
