// Plan validation, dependency order, idempotency checks, and replace rules.
//
// The engine computes every checksum and every inputs hash. A checksum supplied
// in the input file is ignored.

import { join } from "node:path";
import { exists } from "./fsx.js";
import { inputsHash, planChecksum } from "./hash.js";
import { readFrontmatterFile } from "./frontmatter.js";
import { IdentityChangeError, TransitionError, UsageError } from "./errors.js";

const TASK_ID_RE = /^[A-Za-z0-9._-]+$/;
const MAX_TASKS = 10000;

export function isValidTaskId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    TASK_ID_RE.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export function skillNameFromResolved(resolvedSkill) {
  if (typeof resolvedSkill !== "string" || resolvedSkill.length === 0) return null;
  const parts = resolvedSkill.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let name = parts[parts.length - 1];
  if (name === "SKILL.md" && parts.length > 1) name = parts[parts.length - 2];
  if (name.endsWith(".md") && parts.length > 1) name = parts[parts.length - 2];
  return name;
}

function invalid(message, detail = null) {
  return new UsageError(message, { code: "invalid_plan", detail });
}

function normalizeDependsOn(value, taskId) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(`task ${taskId} depends_on must be an array`);
  const out = [];
  for (const dep of value) {
    if (!isValidTaskId(dep)) throw invalid(`task ${taskId} has an invalid dependency ${JSON.stringify(dep)}`);
    if (dep === taskId) throw invalid(`task ${taskId} cannot depend on itself`);
    if (!out.includes(dep)) out.push(dep);
  }
  return out;
}

export function orderTasks(tasks) {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const indegree = new Map(tasks.map((task) => [task.task_id, 0]));
  const dependants = new Map(tasks.map((task) => [task.task_id, []]));
  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      if (!byId.has(dep)) continue;
      indegree.set(task.task_id, indegree.get(task.task_id) + 1);
      dependants.get(dep).push(task.task_id);
    }
  }
  const queue = tasks.filter((task) => indegree.get(task.task_id) === 0).map((task) => task.task_id);
  const ordered = [];
  while (queue.length > 0) {
    const id = queue.shift();
    ordered.push(byId.get(id));
    for (const next of dependants.get(id)) {
      const left = indegree.get(next) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  if (ordered.length !== tasks.length) {
    throw invalid("plan contains a dependency cycle");
  }
  return ordered;
}

async function internalSkillPath(libraryRoot, task) {
  if (!libraryRoot) return null;
  const name = skillNameFromResolved(task.resolved_skill);
  if (!name) return null;
  const path = join(libraryRoot, "skills", name, "SKILL.md");
  return (await exists(path)) ? path : null;
}

function isInternalTask(task) {
  if (task.resolution_source === "internal_override") return true;
  if (task.resolution_source === "manifest") return false;
  return typeof task.resolution_source === "string" && task.resolution_source.startsWith("internal");
}

async function resolveIdempotent(task, { libraryRoot }) {
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
  const declared = frontmatter?.idempotent;
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

function normalizeCapabilities(input, tasks) {
  if (input.capabilities === undefined || input.capabilities === null) {
    return [...new Set(tasks.map((task) => task.capability))];
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.some((c) => typeof c !== "string" || c.length === 0)) {
    throw invalid("capabilities must be an array of non-empty strings");
  }
  return [...new Set(input.capabilities)];
}

export async function validatePlanInput(input, { libraryRoot, runId, createdAt, envFingerprint }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalid("plan must be a JSON object");
  }
  if (!Array.isArray(input.tasks)) throw invalid("plan.tasks must be an array");
  if (input.tasks.length > MAX_TASKS) throw invalid(`plan has more than ${MAX_TASKS} tasks`);

  const ids = new Set();
  const normalized = [];
  for (const raw of input.tasks) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw invalid("every task must be a JSON object");
    }
    if (!isValidTaskId(raw.task_id)) {
      throw invalid(`invalid task_id ${JSON.stringify(raw.task_id)}`);
    }
    if (ids.has(raw.task_id)) throw invalid(`duplicate task_id ${raw.task_id}`);
    ids.add(raw.task_id);
    if (typeof raw.capability !== "string" || raw.capability.length === 0) {
      throw invalid(`task ${raw.task_id} needs a non-empty capability`);
    }
    if (typeof raw.resolved_skill !== "string" || raw.resolved_skill.length === 0) {
      throw invalid(`task ${raw.task_id} needs a non-empty resolved_skill`);
    }
    if (typeof raw.resolution_source !== "string" || raw.resolution_source.length === 0) {
      throw invalid(`task ${raw.task_id} needs a non-empty resolution_source`);
    }
    const owner = raw.owner === undefined ? "orchestrator" : raw.owner;
    if (typeof owner !== "string" || owner.length === 0) {
      throw invalid(`task ${raw.task_id} owner must be a non-empty string`);
    }
    const adapter = raw.adapter === undefined ? null : raw.adapter;
    if (adapter !== null && typeof adapter !== "string" && (typeof adapter !== "object" || Array.isArray(adapter))) {
      throw invalid(`task ${raw.task_id} adapter must be null, a string, or an object`);
    }
    normalized.push({
      task_id: raw.task_id,
      capability: raw.capability,
      depends_on: normalizeDependsOn(raw.depends_on, raw.task_id),
      resolved_skill: raw.resolved_skill,
      resolution_source: raw.resolution_source,
      owner,
      adapter,
      idempotent: raw.idempotent,
    });
  }

  // Every dependency must name a task in this plan.
  for (const task of normalized) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) throw invalid(`task ${task.task_id} depends on unknown task ${dep}`);
    }
  }
  orderTasks(normalized);

  for (const task of normalized) {
    task.idempotent = await resolveIdempotent(task, { libraryRoot });
    task.inputs_hash = inputsHash(task);
  }

  return {
    schema_version: 1,
    run_id: runId,
    created_at: createdAt,
    env_fingerprint: envFingerprint ?? null,
    capabilities: normalizeCapabilities(input, normalized),
    tasks: normalized,
    checksum: planChecksum(normalized),
  };
}

// Enforce the replace contract. A done task's identity cannot change, and an
// initial set is allowed only while the current plan has zero tasks.
export function assertReplaceAllowed({ currentPlan, currentTasks = [], newPlan, replace }) {
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
    for (const key of ["resolved_skill", "resolution_source", "owner", "idempotent"]) {
      if (replacement[key] !== oldTask[key]) {
        throw new IdentityChangeError(
          `replacement changes ${key} for done task ${taskId} (${JSON.stringify(oldTask[key])} -> ${JSON.stringify(replacement[key])})`,
          { detail: { task_id: taskId, field: key, old: oldTask[key], new: replacement[key] } },
        );
      }
    }
  }
}
