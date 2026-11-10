// Plan validation, dependency order, idempotency checks, and replace rules.
//
// The engine computes every checksum and every inputs hash. A checksum supplied
// in the input file is ignored.

import { join } from "node:path";
import { exists } from "./fsx.js";
import { inputsHash, planChecksum } from "./hash.js";
import { readFrontmatterFile } from "./frontmatter.js";
import { IdentityChangeError, TransitionError, UsageError } from "./errors.js";
import { isRecord } from "../types/guards.js";
import type { JsonObject } from "../types/common.js";
import type { EnvFingerprint, PlanSnapshot, PlanTask } from "../types/orchestrator.js";

const TASK_ID_RE = /^[A-Za-z0-9._-]+$/;
const MAX_TASKS = 10000;

/** The fields the identity checks compare when a plan is replaced. */
const IDENTITY_FIELDS = ["resolved_skill", "resolution_source", "owner", "idempotent"] as const;

/** Anything that has a task id and dependencies can be ordered. */
export interface Orderable {
  readonly task_id: string;
  readonly depends_on?: readonly string[];
}

/** One task after shape validation, before its idempotency is resolved. */
interface NormalizedTask {
  readonly task_id: string;
  readonly capability: string;
  readonly depends_on: string[];
  readonly resolved_skill: string;
  readonly resolution_source: string;
  readonly owner: string;
  readonly adapter: string | JsonObject | null;
  readonly idempotent: unknown;
}

export function isValidTaskId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    TASK_ID_RE.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export function skillNameFromResolved(resolvedSkill: unknown): string | null {
  if (typeof resolvedSkill !== "string" || resolvedSkill.length === 0) return null;
  const parts = resolvedSkill.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let name = parts[parts.length - 1] ?? "";
  if (name === "SKILL.md" && parts.length > 1) name = parts[parts.length - 2] ?? "";
  if (name.endsWith(".md") && parts.length > 1) name = parts[parts.length - 2] ?? "";
  return name;
}

function invalid(message: string, detail: unknown = null): UsageError {
  return new UsageError(message, { code: "invalid_plan", detail });
}

function normalizeDependsOn(value: unknown, taskId: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(`task ${taskId} depends_on must be an array`);
  const out: string[] = [];
  for (const dep of value) {
    if (!isValidTaskId(dep)) throw invalid(`task ${taskId} has an invalid dependency ${JSON.stringify(dep)}`);
    if (dep === taskId) throw invalid(`task ${taskId} cannot depend on itself`);
    if (!out.includes(dep)) out.push(dep);
  }
  return out;
}

export function orderTasks<T extends Orderable>(tasks: readonly T[]): T[] {
  const byId = new Map<string, T>(tasks.map((task) => [task.task_id, task]));
  const indegree = new Map<string, number>(tasks.map((task) => [task.task_id, 0]));
  const dependants = new Map<string, string[]>(tasks.map((task) => [task.task_id, []]));
  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      if (!byId.has(dep)) continue;
      indegree.set(task.task_id, (indegree.get(task.task_id) ?? 0) + 1);
      dependants.get(dep)?.push(task.task_id);
    }
  }
  const queue = tasks.filter((task) => indegree.get(task.task_id) === 0).map((task) => task.task_id);
  const ordered: T[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const task = byId.get(id) as T;
    ordered.push(task);
    for (const next of dependants.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  if (ordered.length !== tasks.length) {
    throw invalid("plan contains a dependency cycle");
  }
  return ordered;
}

async function internalSkillPath(libraryRoot: string | null, task: { resolved_skill: string }): Promise<string | null> {
  if (!libraryRoot) return null;
  const name = skillNameFromResolved(task.resolved_skill);
  if (!name) return null;
  const path = join(libraryRoot, "skills", name, "SKILL.md");
  return (await exists(path)) ? path : null;
}

function isInternalTask(task: { resolution_source: string }): boolean {
  if (task.resolution_source === "internal_override") return true;
  if (task.resolution_source === "manifest") return false;
  return typeof task.resolution_source === "string" && task.resolution_source.startsWith("internal");
}

async function resolveIdempotent(
  task: NormalizedTask,
  { libraryRoot }: { readonly libraryRoot: string | null },
): Promise<boolean> {
  const internal = isInternalTask(task);
  const explicit = task.idempotent;
  if (explicit !== undefined && typeof explicit !== "boolean") {
    throw invalid(`task ${task.task_id} idempotent must be true or false`);
  }
  if (!internal) return explicit ?? false;

  const path = await internalSkillPath(libraryRoot, task);
  if (!path) {
    throw invalid(
      `task ${task.task_id} names internal skill ${task.resolved_skill}, but no SKILL.md was found under ${libraryRoot ?? "(missing library root)"}`,
      { task_id: task.task_id, resolved_skill: task.resolved_skill },
    );
  }
  const frontmatter = await readFrontmatterFile(path);
  const declared = frontmatter?.["idempotent"];
  if (typeof declared !== "boolean") {
    throw new TransitionError(
      `internal skill ${task.resolved_skill} does not declare idempotent: true or false in ${path}`,
      { code: "idempotency_missing", detail: { task_id: task.task_id, path } },
    );
  }
  if (explicit !== undefined && explicit !== declared) {
    throw new TransitionError(
      `task ${task.task_id} idempotent ${String(explicit)} does not match ${task.resolved_skill} frontmatter ${String(declared)}`,
      {
        code: "idempotency_mismatch",
        detail: { task_id: task.task_id, path, recorded: explicit, declared },
      },
    );
  }
  return declared;
}

function normalizeCapabilities(input: Record<string, unknown>, tasks: readonly NormalizedTask[]): string[] {
  const capabilities = input["capabilities"];
  if (capabilities === undefined || capabilities === null) {
    return [...new Set(tasks.map((task) => task.capability))];
  }
  if (!Array.isArray(capabilities) || capabilities.some((c) => typeof c !== "string" || c.length === 0)) {
    throw invalid("capabilities must be an array of non-empty strings");
  }
  return [...new Set(capabilities as string[])];
}

export interface PlanInputOptions {
  readonly libraryRoot: string | null;
  readonly runId: string;
  readonly createdAt: string;
  readonly envFingerprint?: EnvFingerprint | null;
}

export async function validatePlanInput(input: unknown, {
  libraryRoot,
  runId,
  createdAt,
  envFingerprint,
}: PlanInputOptions): Promise<PlanSnapshot> {
  if (!isRecord(input)) {
    throw invalid("plan must be a JSON object");
  }
  const rawTasks = input["tasks"];
  if (!Array.isArray(rawTasks)) throw invalid("plan.tasks must be an array");
  if (rawTasks.length > MAX_TASKS) throw invalid(`plan has more than ${MAX_TASKS} tasks`);

  const ids = new Set<string>();
  const normalized: NormalizedTask[] = [];
  for (const raw of rawTasks) {
    if (!isRecord(raw)) {
      throw invalid("every task must be a JSON object");
    }
    const taskId = raw["task_id"];
    if (!isValidTaskId(taskId)) {
      throw invalid(`invalid task_id ${JSON.stringify(taskId)}`);
    }
    if (ids.has(taskId)) throw invalid(`duplicate task_id ${taskId}`);
    ids.add(taskId);
    const rawCapability = raw["capability"];
    if (typeof rawCapability !== "string" || rawCapability.length === 0) {
      throw invalid(`task ${taskId} needs a non-empty capability`);
    }
    const rawResolved = raw["resolved_skill"];
    if (typeof rawResolved !== "string" || rawResolved.length === 0) {
      throw invalid(`task ${taskId} needs a non-empty resolved_skill`);
    }
    const rawSource = raw["resolution_source"];
    if (typeof rawSource !== "string" || rawSource.length === 0) {
      throw invalid(`task ${taskId} needs a non-empty resolution_source`);
    }
    const rawOwner = raw["owner"] === undefined ? "orchestrator" : raw["owner"];
    if (typeof rawOwner !== "string" || rawOwner.length === 0) {
      throw invalid(`task ${taskId} owner must be a non-empty string`);
    }
    const adapter = raw["adapter"] === undefined ? null : raw["adapter"];
    if (adapter !== null && typeof adapter !== "string" && (typeof adapter !== "object" || Array.isArray(adapter))) {
      throw invalid(`task ${taskId} adapter must be null, a string, or an object`);
    }
    const explicit = raw["idempotent"];
    normalized.push({
      task_id: taskId,
      capability: rawCapability,
      depends_on: normalizeDependsOn(raw["depends_on"], taskId),
      resolved_skill: rawResolved,
      resolution_source: rawSource,
      owner: rawOwner,
      adapter: adapter as string | JsonObject | null,
      idempotent: explicit,
    });
  }

  // Every dependency must name a task in this plan.
  for (const task of normalized) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) throw invalid(`task ${task.task_id} depends on unknown task ${dep}`);
    }
  }
  orderTasks(normalized);

  const tasks: PlanTask[] = [];
  for (const task of normalized) {
    const idempotent = await resolveIdempotent(task, { libraryRoot });
    const resolved = { ...task, idempotent };
    tasks.push({ ...resolved, inputs_hash: inputsHash(resolved) });
  }

  return {
    schema_version: 1,
    run_id: runId,
    created_at: createdAt,
    env_fingerprint: envFingerprint ?? null,
    capabilities: normalizeCapabilities(input, normalized),
    tasks,
    checksum: planChecksum(tasks),
  };
}

export interface ReplaceInput {
  readonly currentPlan: PlanSnapshot | null;
  readonly currentTasks?: readonly { readonly task_id: string; readonly status: string }[];
  readonly newPlan: PlanSnapshot;
  readonly replace: boolean;
}

// Enforce the replace contract. A done task's identity cannot change, and an
// initial set is allowed only while the current plan has zero tasks.
export function assertReplaceAllowed({ currentPlan, currentTasks = [], newPlan, replace }: ReplaceInput): void {
  const currentCount = currentPlan?.tasks?.length ?? 0;
  if (currentCount > 0 && !replace) {
    throw new TransitionError("plan already has tasks; pass --replace to change it");
  }
  if (!replace || currentCount === 0) return;

  const oldById = new Map((currentPlan?.tasks ?? []).map((task) => [task.task_id, task]));
  const newById = new Map(newPlan.tasks.map((task) => [task.task_id, task]));
  const runtimeById = new Map(currentTasks.map((task) => [task.task_id, task]));
  for (const [taskId, oldTask] of oldById) {
    const runtime = runtimeById.get(taskId);
    if (runtime?.status !== "done") continue;
    const replacement = newById.get(taskId);
    if (!replacement) {
      throw new IdentityChangeError(`replacement removes done task ${taskId}`);
    }
    for (const key of IDENTITY_FIELDS) {
      if (replacement[key] !== oldTask[key]) {
        throw new IdentityChangeError(
          `replacement changes ${key} for done task ${taskId} (${JSON.stringify(oldTask[key])} -> ${JSON.stringify(replacement[key])})`,
          { detail: { task_id: taskId, field: key, old: oldTask[key], new: replacement[key] } },
        );
      }
    }
  }
}
