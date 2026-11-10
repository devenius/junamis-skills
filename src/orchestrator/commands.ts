// Command implementations against the engine modules.
//
// Commands never print. They return a result object and throw typed errors; the
// CLI owns stdout, stderr, and the exit code.

import { join, resolve } from "node:path";
import {
  exists,
  ensureTree,
  readJsonFile,
  readText,
  removeFile,
  relativePosix,
  assertStateRootSafe,
  assertPathInside,
} from "./fsx.js";
import {
  CorruptStateError,
  HandoffError,
  LeaseLostError,
  TransitionError,
  UsageError,
} from "./errors.js";
import {
  acquireLease,
  heartbeatLease,
  leasePath,
  readLeases,
  readOwnLease,
  releaseLease,
  summarizeLeases,
} from "./lease.js";
import { computeFingerprint, compareFingerprints } from "./drift.js";
import { readFrontmatterFile } from "./frontmatter.js";
import { checkHandoffArtifacts, parseHandoff } from "./handoff.js";
import { skillNameFromResolved, isValidTaskId } from "./plan.js";
import { assertReplaceAllowed, validatePlanInput } from "./plan.js";
import {
  checkpointRun,
  createRun,
  loadRun,
  maybeAutoCheckpoint,
  refreshLoaded,
  saveLoaded,
  statePaths,
} from "./store.js";
import { allTasksDone } from "./state.js";
import { checkpointName } from "./compaction.js";
import { renderStateMd, writeRunReports, writeStateMd } from "./report.js";
import { crashPoint } from "./test-hooks.js";
import { nowIso } from "./time.js";
import { randomBytes } from "node:crypto";
import { runReconcile } from "../reconcile/queue.js";
import { errorMessage, isRecord } from "../types/guards.js";
import type {
  CommandResult,
  DriftDiff,
  EnvFingerprint,
  Lease,
  LoadedRun,
  OrchestratorContext,
  PlanSnapshot,
  PlanTask,
  ReconciliationSummary,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from "../types/orchestrator.js";
import type { Handoff, HandoffStatus } from "../types/handoff.js";
import type { ReconcileResult } from "../types/reconcile.js";

interface MutableReconciliation {
  interrupted: string[];
  retried: string[];
  escalated: string[];
  malformedHandoffs: string[];
}

function emptyReconciliation(): MutableReconciliation {
  return { interrupted: [], retried: [], escalated: [], malformedHandoffs: [] };
}

function makeRunId(iso: string): string {
  const date = iso.slice(0, 10).replaceAll("-", "");
  return `run-${date}-${randomBytes(3).toString("hex")}`;
}

function runStatus(loaded: LoadedRun): RunStatus {
  if (loaded.run?.completed_at) return "COMPLETE";
  if (!loaded.plan || loaded.plan.tasks.length === 0) return "NEW_RUN";
  return allTasksDone(loaded.plan, loaded.tasks) ? "COMPLETE" : "RESUMING";
}

function requireRun(loaded: LoadedRun): NonNullable<LoadedRun["run"]> {
  if (!loaded.run) throw new CorruptStateError("no run exists in the state root; run boot first");
  return loaded.run;
}

async function ensureWriteLease(ctx: OrchestratorContext, loaded: LoadedRun): Promise<Lease> {
  const lease = await readOwnLease(ctx.stateRoot, ctx.sessionId);
  if (!lease) {
    try {
      await loaded.journal.append({
        type: "lease_lost",
        run_id: requireRun(loaded).run_id,
        session_id: ctx.sessionId,
      });
    } catch {
      // The journal may be unwritable; the exit code still reports the loss.
    }
    throw new LeaseLostError(ctx.sessionId);
  }
  return lease;
}

async function beginWrite(ctx: OrchestratorContext): Promise<LoadedRun> {
  const loaded = await loadRun(ctx.stateRoot);
  requireRun(loaded);
  await ensureWriteLease(ctx, loaded);
  return loaded;
}

async function currentFingerprint(ctx: OrchestratorContext): Promise<EnvFingerprint> {
  return computeFingerprint({
    libraryRoot: ctx.libraryRoot,
    manifestPath: ctx.manifestPath,
    designRoot: ctx.designRoot,
    version: ctx.packageVersion,
  });
}

async function renew(ctx: OrchestratorContext, ttlSeconds: number | null): Promise<Lease> {
  return heartbeatLease({ root: ctx.stateRoot, sessionId: ctx.sessionId, ttlSeconds });
}

interface ReconcileNowInput {
  readonly trigger: string;
  readonly status?: string | null;
  readonly drift?: Partial<DriftDiff> | null;
  readonly loaded?: LoadedRun | null;
}

async function reconcileNow(ctx: OrchestratorContext, {
  trigger,
  status = null,
  drift = null,
  loaded = null,
}: ReconcileNowInput): Promise<ReconcileResult> {
  return runReconcile({
    stateRoot: ctx.stateRoot,
    projectRoot: ctx.projectRoot,
    designRoot: ctx.designRoot,
    libraryRoot: ctx.libraryRoot,
    manifestPath: ctx.manifestPath,
    packageVersion: ctx.packageVersion,
    trigger,
    status,
    drift,
    loaded,
    sessionId: ctx.sessionId,
  });
}

function queueExtra(reconcile: ReconcileResult | null): Record<string, unknown> {
  return {
    workQueue: reconcile?.queue ?? null,
    workQueuePath: reconcile?.queuePath ?? null,
    reconcileReportPath: reconcile?.reportPath ?? null,
    reconcileStatus: reconcile?.status ?? null,
    queueHead: reconcile?.head ?? null,
  };
}

interface ResultOptions {
  readonly status: string;
  readonly exitCode?: number;
  readonly reportPath?: string | null;
  readonly drift?: Partial<DriftDiff> | null;
  readonly halt?: string | null;
  readonly reconciliation?: Partial<ReconciliationSummary> | null;
  readonly extra?: Record<string, unknown>;
}

function result(loaded: LoadedRun, {
  status,
  exitCode = 0,
  reportPath = null,
  drift = null,
  halt = null,
  reconciliation = null,
  extra = {},
}: ResultOptions): CommandResult {
  return {
    status,
    exitCode,
    halt,
    reportPath,
    run: loaded.run ?? null,
    plan: loaded.plan ?? null,
    tasks: loaded.tasks ?? [],
    runId: loaded.run?.run_id ?? null,
    cursor: loaded.run?.cursor ?? null,
    tasksSummary: loaded.run?.tasks_summary ?? null,
    drift,
    reconciliation,
    ...extra,
  };
}

async function clearDriftIfNeeded(ctx: OrchestratorContext, loaded: LoadedRun): Promise<void> {
  const run = requireRun(loaded);
  if (run.run_status === "BLOCKED_DRIFT" || run.drift) {
    await loaded.journal.append({
      type: "drift_cleared",
      run_id: run.run_id,
      session_id: ctx.sessionId,
    });
    refreshLoaded(loaded);
  }
}

interface BlockForDriftInput {
  readonly diff: Partial<DriftDiff>;
  readonly current: EnvFingerprint;
}

async function blockForDrift(
  ctx: OrchestratorContext,
  loaded: LoadedRun,
  { diff, current }: BlockForDriftInput,
): Promise<CommandResult> {
  const runId = requireRun(loaded).run_id;
  await loaded.journal.append({
    type: "drift_detected",
    run_id: runId,
    session_id: ctx.sessionId,
    diff,
  });
  await loaded.journal.append({
    type: "lease_released",
    run_id: runId,
    session_id: ctx.sessionId,
  });
  refreshLoaded(loaded);
  try {
    await removeFile(leasePath(ctx.stateRoot, ctx.sessionId));
  } catch {
    // best effort
  }
  await saveLoaded(loaded, { status: "BLOCKED_DRIFT" });
  const reportPath = await writeRunReports({
    root: ctx.stateRoot,
    run: loaded.run,
    plan: loaded.plan,
    tasks: loaded.tasks,
    events: loaded.journal.events,
    status: "BLOCKED_DRIFT",
    drift: diff,
    reconciliation: emptyReconciliation(),
    currentFingerprint: current,
    sessionId: ctx.sessionId,
  });
  const reconcile = await reconcileNow(ctx, {
    trigger: "drift_detected",
    status: "BLOCKED_DRIFT",
    drift: diff,
    loaded,
  });
  return result(loaded, {
    status: "BLOCKED_DRIFT",
    exitCode: 3,
    halt: "drift",
    reportPath,
    drift: diff,
    reconciliation: emptyReconciliation(),
    extra: queueExtra(reconcile),
  });
}

function findPlanTask(loaded: LoadedRun, taskId: string): PlanTask {
  const planTask = loaded.plan?.tasks?.find((task) => task.task_id === taskId);
  if (!planTask) throw new TransitionError(`unknown task ${taskId}`);
  return planTask;
}

function findTask(loaded: LoadedRun, taskId: string): TaskRecord {
  const task = loaded.tasks?.find((entry) => entry.task_id === taskId);
  if (!task) throw new TransitionError(`unknown task ${taskId}`);
  return task;
}

function dependenciesDone(loaded: LoadedRun, planTask: PlanTask): boolean {
  const byId = new Map(loaded.tasks.map((task) => [task.task_id, task]));
  return (planTask.depends_on ?? []).every((dep) => byId.get(dep)?.status === "done");
}

function nextTarget(loaded: LoadedRun): string {
  const status = runStatus(loaded);
  if (status === "COMPLETE") return "none";
  const cursor = loaded.run?.cursor;
  if (!cursor) return "none";
  const task = loaded.tasks.find((entry) => entry.task_id === cursor.task_id);
  if (task?.status === "needs_review") return "user";
  return cursor.task_id;
}

interface IdempotencyCheck {
  readonly ok: boolean;
  readonly path?: string | null;
  readonly actual?: unknown;
  readonly expected?: boolean;
  readonly name?: string | null;
}

async function recheckInternalIdempotent(ctx: OrchestratorContext, planTask: PlanTask): Promise<IdempotencyCheck> {
  const source = planTask.resolution_source ?? "";
  const internal = source === "internal_override" || source.startsWith("internal");
  if (!internal) return { ok: true };
  const name = skillNameFromResolved(planTask.resolved_skill);
  const path = name && ctx.libraryRoot ? join(ctx.libraryRoot, "skills", name, "SKILL.md") : null;
  const frontmatter = path ? await readFrontmatterFile(path) : null;
  const actual = frontmatter?.["idempotent"];
  if (typeof actual !== "boolean" || actual !== planTask.idempotent) {
    return { ok: false, path, actual, expected: planTask.idempotent, name };
  }
  return { ok: true };
}

function idempotencyDiff({
  run,
  current,
  check,
  taskId,
}: {
  readonly run: NonNullable<LoadedRun["run"]>;
  readonly current: EnvFingerprint;
  readonly check: IdempotencyCheck;
  readonly taskId: string;
}): Partial<DriftDiff> {
  const relative = check.name ? `skills/${check.name}/SKILL.md` : "(internal skill)";
  return {
    match: false,
    manifest: {
      old: run.env_fingerprint?.skills_lock_sha256 ?? null,
      new: current.skills_lock_sha256 ?? null,
      changed: false,
    },
    overrides: {
      old: run.env_fingerprint?.library_overrides_sha256 ?? null,
      new: current.library_overrides_sha256 ?? null,
      changed: false,
      paths: [
        {
          path: relative,
          old: `idempotent:${String(check.expected)}`,
          new: check.actual === undefined ? "idempotent:missing" : `idempotent:${String(check.actual)}`,
          change: "changed",
        },
      ],
    },
    versionChanged: false,
    detail: `task ${taskId} idempotency does not match the internal skill frontmatter`,
    current,
  };
}

function mapHandoffStatus(status: HandoffStatus): TaskStatus {
  if (status === "complete") return "done";
  if (status === "needs-decision") return "needs_review";
  return "failed";
}

interface HandoffFailureInput {
  readonly stepId: string;
  readonly handoffPath: string | null;
  readonly message: string;
}

async function recordHandoffFailure(
  ctx: OrchestratorContext,
  loaded: LoadedRun,
  task: TaskRecord,
  { stepId, handoffPath, message }: HandoffFailureInput,
): Promise<never> {
  await loaded.journal.append({
    type: "step_end",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
    task_id: task.task_id,
    step_id: stepId,
    task_status: "needs_review",
    handoff: handoffPath ?? null,
    outputs: [],
    reason: message,
  });
  await loaded.journal.append({
    type: "escalation",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
    task_id: task.task_id,
    reason: "invalid_handoff",
    message,
  });
  refreshLoaded(loaded);
  try {
    await renew(ctx, ctx.baseTtl);
  } catch {
    // The handoff verdict still stands even if the lease was lost.
  }
  await saveLoaded(loaded, { status: runStatus(loaded) });
  throw new HandoffError(message, { detail: { task_id: task.task_id } });
}

export interface PlanSetInput {
  readonly file: string | null | undefined;
  readonly replace?: boolean;
}

export async function planSet(ctx: OrchestratorContext, { file, replace = false }: PlanSetInput): Promise<CommandResult> {
  if (!file) throw new UsageError("plan set needs --file <plan.json>");
  const loaded = await beginWrite(ctx);
  const current = await currentFingerprint(ctx);
  const diff = compareFingerprints(loaded.run?.env_fingerprint ?? null, current);
  if (!diff.match) return blockForDrift(ctx, loaded, { diff, current });
  await clearDriftIfNeeded(ctx, loaded);

  const planPath = resolve(ctx.projectRoot, file);
  const parsed = await readJsonFile(planPath);
  if (!parsed.exists) throw new UsageError(`plan file not found: ${planPath}`);
  if (parsed.error) throw new UsageError(`plan file is not valid JSON: ${parsed.error.message}`);

  const createdAt = loaded.plan?.created_at ?? nowIso();
  const plan = await validatePlanInput(parsed.value, {
    libraryRoot: ctx.libraryRoot,
    runId: requireRun(loaded).run_id,
    createdAt,
    envFingerprint: current,
  });
  assertReplaceAllowed({
    currentPlan: loaded.plan,
    currentTasks: loaded.tasks,
    newPlan: plan,
    replace,
  });

  const hasPlanEvent = loaded.journal.events.some(
    (event) => event.type === "plan_created" || event.type === "plan_updated",
  );
  await renew(ctx, ctx.baseTtl);
  await loaded.journal.append({
    type: hasPlanEvent ? "plan_updated" : "plan_created",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
    plan,
  });
  crashPoint("after_plan_journal");
  refreshLoaded(loaded);
  await saveLoaded(loaded, { status: runStatus(loaded) });
  await maybeAutoCheckpoint(loaded, { sessionId: ctx.sessionId });
  return result(loaded, {
    status: runStatus(loaded),
    drift: diff,
    extra: { checksum: plan.checksum, plan },
  });
}

export async function planShow(ctx: OrchestratorContext): Promise<CommandResult> {
  const loaded = await loadRun(ctx.stateRoot);
  let plan: PlanSnapshot | null | undefined = loaded.plan;
  if (!plan) {
    const parsed = await readJsonFile(join(ctx.stateRoot, "plan.json"));
    if (parsed.exists && parsed.error) {
      throw new CorruptStateError(`plan.json is not valid JSON: ${parsed.error.message}`);
    }
    // The journal owns the plan. This fallback only surfaces a plan.json that
    // has no journal event, and it is printed as parsed.
    plan = isRecord(parsed.value) ? (parsed.value as unknown as PlanSnapshot) : null;
  }
  return result(loaded, {
    status: loaded.run?.run_status ?? "NEW_RUN",
    extra: { plan, checksum: plan?.checksum ?? null },
  });
}

export interface StartInput {
  readonly taskId: string | null | undefined;
}

export async function start(ctx: OrchestratorContext, { taskId }: StartInput): Promise<CommandResult> {
  if (!taskId) throw new UsageError("start needs --task <task_id>");
  if (!isValidTaskId(taskId)) throw new UsageError(`invalid task id ${JSON.stringify(taskId)}`);
  const loaded = await beginWrite(ctx);
  const current = await currentFingerprint(ctx);
  const diff = compareFingerprints(loaded.run?.env_fingerprint ?? null, current);
  if (!diff.match) return blockForDrift(ctx, loaded, { diff, current });
  await clearDriftIfNeeded(ctx, loaded);

  const planTask = findPlanTask(loaded, taskId);
  const task = findTask(loaded, taskId);
  if (task.status === "in_progress") throw new TransitionError(`task ${taskId} is already in progress`);
  if (task.status === "done") throw new TransitionError(`task ${taskId} is already done`);
  if (task.status === "needs_review") throw new TransitionError(`task ${taskId} needs review; call resolve first`);
  if (task.status !== "pending" && task.status !== "failed") {
    throw new TransitionError(`task ${taskId} cannot start from status ${task.status}`);
  }
  if (!dependenciesDone(loaded, planTask)) {
    throw new TransitionError(`task ${taskId} has unmet dependencies`);
  }

  const check = await recheckInternalIdempotent(ctx, planTask);
  if (!check.ok) {
    const idemDiff = idempotencyDiff({ run: requireRun(loaded), current, check, taskId });
    return blockForDrift(ctx, loaded, { diff: idemDiff, current });
  }

  const attempt = (task.attempt ?? 0) + 1;
  const stepId = `${planTask.task_id}/${planTask.capability}/attempt-${attempt}`;
  await renew(ctx, ctx.stepTtl);
  await loaded.journal.append({
    type: "step_start",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
    task_id: planTask.task_id,
    capability: planTask.capability,
    step_id: stepId,
    attempt,
    idempotent: planTask.idempotent,
    skill: planTask.resolved_skill,
    started_at: nowIso(),
  });
  crashPoint("after_step_start_journal");
  refreshLoaded(loaded);
  await saveLoaded(loaded, { status: runStatus(loaded) });
  crashPoint("after_task_snapshot");
  await maybeAutoCheckpoint(loaded, { sessionId: ctx.sessionId });
  return result(loaded, {
    status: "started",
    drift: diff,
    extra: { task: planTask.task_id, step: stepId, attempt, idempotent: planTask.idempotent },
  });
}

export interface EndInput {
  readonly taskId: string | null | undefined;
  readonly stepId: string | null | undefined;
  readonly handoff?: string | null;
  readonly status?: string | null;
  readonly reason?: string | null;
}

export async function end(ctx: OrchestratorContext, {
  taskId,
  stepId,
  handoff = null,
  status = null,
  reason = null,
}: EndInput): Promise<CommandResult> {
  if (!taskId) throw new UsageError("end needs --task <task_id>");
  if (!stepId) throw new UsageError("end needs --step <step_id>");
  if (!handoff && status !== "failed") {
    throw new UsageError("end needs --handoff <path>, or --status failed --reason <text>");
  }
  if (handoff && status) throw new UsageError("end accepts --handoff or --status failed, not both");
  if (!handoff && !reason) throw new UsageError("end --status failed needs --reason <text>");

  const loaded = await beginWrite(ctx);
  const current = await currentFingerprint(ctx);
  const diff = compareFingerprints(loaded.run?.env_fingerprint ?? null, current);
  if (!diff.match) return blockForDrift(ctx, loaded, { diff, current });
  await clearDriftIfNeeded(ctx, loaded);

  const task = findTask(loaded, taskId);
  if (task.status !== "in_progress") {
    throw new TransitionError(`task ${taskId} is ${task.status}, not in_progress`);
  }
  if (task.current_step?.step_id !== stepId) {
    throw new TransitionError(`step ${stepId} is not the current step for ${taskId}`);
  }

  if (!handoff) {
    await loaded.journal.append({
      type: "step_end",
      run_id: requireRun(loaded).run_id,
      session_id: ctx.sessionId,
      task_id: taskId,
      step_id: stepId,
      task_status: "failed",
      handoff: null,
      outputs: [],
      reason,
    });
    crashPoint("after_step_end_journal");
    refreshLoaded(loaded);
    await renew(ctx, ctx.baseTtl);
    await saveLoaded(loaded, { status: runStatus(loaded) });
    crashPoint("after_task_snapshot_on_end");
    await maybeAutoCheckpoint(loaded, { sessionId: ctx.sessionId });
    const reconcile = await reconcileNow(ctx, { trigger: "step_end" });
    return result(loaded, {
      status: "failed",
      drift: diff,
      extra: {
        task: taskId,
        step: stepId,
        handoff: null,
        next: "none",
        ...queueExtra(reconcile),
      },
    });
  }

  const absolute = resolve(ctx.stateRoot, handoff);
  let handoffRelative: string;
  try {
    await assertPathInside(ctx.stateRoot, absolute, { label: "handoff" });
    handoffRelative = relativePosix(ctx.stateRoot, absolute);
  } catch {
    return recordHandoffFailure(ctx, loaded, task, {
      stepId,
      handoffPath: handoff,
      message: `handoff path escapes the state root: ${handoff}`,
    });
  }

  const text = await readText(absolute);
  if (text === null) {
    return recordHandoffFailure(ctx, loaded, task, {
      stepId,
      handoffPath: handoffRelative,
      message: `handoff file not found: ${handoffRelative}`,
    });
  }
  let parsedHandoff: Handoff;
  try {
    parsedHandoff = parseHandoff(text);
  } catch (error) {
    return recordHandoffFailure(ctx, loaded, task, {
      stepId,
      handoffPath: handoffRelative,
      message: `handoff is invalid: ${errorMessage(error)}`,
    });
  }
  const artifacts = await checkHandoffArtifacts(parsedHandoff, { projectRoot: ctx.projectRoot });
  if (!artifacts.ok) {
    const parts: string[] = [];
    if (artifacts.missing.length > 0) parts.push(`missing ${artifacts.missing.join(", ")}`);
    if (artifacts.outside.length > 0) parts.push(`outside the project ${artifacts.outside.join(", ")}`);
    return recordHandoffFailure(ctx, loaded, task, {
      stepId,
      handoffPath: handoffRelative,
      message: `handoff artifacts are invalid: ${parts.join("; ")}`,
    });
  }

  const taskStatus = mapHandoffStatus(parsedHandoff.status);
  const outputs = parsedHandoff.artifacts.map((artifact) => artifact.path);
  crashPoint("before_step_end_journal");
  await loaded.journal.append({
    type: "step_end",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
    task_id: taskId,
    step_id: stepId,
    task_status: taskStatus,
    handoff: handoffRelative,
    outputs,
    handoff_status: parsedHandoff.status,
    next_target: parsedHandoff.next,
  });
  crashPoint("after_step_end_journal");
  if (parsedHandoff.status === "needs-decision") {
    await loaded.journal.append({
      type: "escalation",
      run_id: requireRun(loaded).run_id,
      session_id: ctx.sessionId,
      task_id: taskId,
      reason: "user_decision",
      questions: parsedHandoff.decisions_owed,
    });
  }
  refreshLoaded(loaded);
  await renew(ctx, ctx.baseTtl);
  await saveLoaded(loaded, { status: runStatus(loaded) });
  crashPoint("after_task_snapshot_on_end");
  await maybeAutoCheckpoint(loaded, { sessionId: ctx.sessionId });
  const reconcile = await reconcileNow(ctx, { trigger: "step_end" });
  return result(loaded, {
    status: taskStatus,
    drift: diff,
    extra: {
      task: taskId,
      step: stepId,
      handoff: handoffRelative,
      next: nextTarget(loaded),
      handoffStatus: parsedHandoff.status,
      ...queueExtra(reconcile),
    },
  });
}

export interface ResolveInput {
  readonly taskId: string | null | undefined;
  readonly decision: string | null | undefined;
}

export async function resolveTask(ctx: OrchestratorContext, { taskId, decision }: ResolveInput): Promise<CommandResult> {
  if (!taskId) throw new UsageError("resolve needs --task <task_id>");
  if (!decision || decision.trim().length === 0) throw new UsageError("resolve needs --decision <text>");
  const loaded = await beginWrite(ctx);
  const task = findTask(loaded, taskId);
  if (task.status !== "needs_review") {
    throw new TransitionError(`task ${taskId} is ${task.status}, not needs_review`);
  }
  await renew(ctx, ctx.baseTtl);
  await loaded.journal.append({
    type: "resolution",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
    task_id: taskId,
    decision,
  });
  refreshLoaded(loaded);
  await saveLoaded(loaded, { status: runStatus(loaded) });
  await maybeAutoCheckpoint(loaded, { sessionId: ctx.sessionId });
  return result(loaded, {
    status: "pending",
    extra: { task: taskId, decision },
  });
}

export async function status(ctx: OrchestratorContext): Promise<CommandResult> {
  const loaded = await loadRun(ctx.stateRoot);
  const current = await currentFingerprint(ctx);
  const drift = loaded.run ? compareFingerprints(loaded.run.env_fingerprint, current) : null;
  const leases = summarizeLeases(await readLeases(ctx.stateRoot));
  const checkpoint = loaded.checkpoint
    ? `checkpoints/${checkpointName(loaded.checkpoint.seq)}`
    : loaded.run?.last_checkpoint ?? null;
  return result(loaded, {
    status: loaded.run?.run_status ?? "NEW_RUN",
    drift,
    extra: {
      leases,
      checkpoint,
      journalHead: loaded.journal.head,
      reportPath: loaded.paths.report,
      currentFingerprint: current,
      designRegistry: current.design_registry,
    },
  });
}

export async function checkpoint(ctx: OrchestratorContext): Promise<CommandResult> {
  const loaded = await beginWrite(ctx);
  await renew(ctx, null);
  const written = await checkpointRun(loaded, { sessionId: ctx.sessionId });
  const generatedAt = nowIso();
  const stateMd = renderStateMd({
    run: loaded.run,
    tasks: loaded.tasks,
    events: loaded.journal.events,
    drift: loaded.run?.drift ?? null,
    generatedAt,
  });
  await writeStateMd(loaded.paths.root, stateMd);
  return result(loaded, {
    status: "checkpointed",
    extra: { ...written },
  });
}

function leaseEventName(action: string): string {
  if (action === "taken_over") return "lease_taken_over";
  if (action === "reacquired") return "lease_reacquired";
  return "lease_acquired";
}

export async function leaseAcquire(ctx: OrchestratorContext): Promise<CommandResult> {
  await assertStateRootSafe(ctx.stateRoot, { allowTmp: ctx.allowTmp });
  const paths = statePaths(ctx.stateRoot);
  const journalExisted = await exists(paths.journal);
  await ensureTree(ctx.stateRoot);
  const acquired = await acquireLease({
    root: ctx.stateRoot,
    sessionId: ctx.sessionId,
    pid: ctx.pid,
    host: ctx.host,
    ttlSeconds: ctx.baseTtl,
  });
  crashPoint("after_lease");

  let loaded: LoadedRun;
  if (!journalExisted) {
    const createdAt = nowIso();
    const current = await currentFingerprint(ctx);
    loaded = await createRun({
      paths,
      runId: makeRunId(createdAt),
      createdAt,
      envFingerprint: current,
      sessionId: ctx.sessionId,
      leaseEvent: { type: leaseEventName(acquired.action), lease: acquired.lease },
    });
  } else {
    loaded = await loadRun(ctx.stateRoot);
    requireRun(loaded);
    await loaded.journal.append({
      type: leaseEventName(acquired.action),
      run_id: requireRun(loaded).run_id,
      session_id: ctx.sessionId,
      lease: acquired.lease,
    });
    refreshLoaded(loaded);
    await saveLoaded(loaded, { status: requireRun(loaded).run_status });
  }
  return result(loaded, {
    status: acquired.action,
    extra: { action: acquired.action, lease: acquired.lease, previous: acquired.previous ?? null },
  });
}

export interface LeaseHeartbeatResult {
  readonly status: string;
  readonly lease: Lease;
}

export async function leaseHeartbeat(ctx: OrchestratorContext): Promise<LeaseHeartbeatResult> {
  const lease = await heartbeatLease({ root: ctx.stateRoot, sessionId: ctx.sessionId, ttlSeconds: null });
  return { status: "renewed", lease };
}

export interface LeaseReleaseResult {
  readonly status: string;
  readonly lease: Lease;
  readonly loaded: LoadedRun | null;
}

export async function leaseRelease(ctx: OrchestratorContext): Promise<LeaseReleaseResult> {
  const lease = await readOwnLease(ctx.stateRoot, ctx.sessionId);
  if (!lease) throw new LeaseLostError(ctx.sessionId);
  let loaded: LoadedRun | null = null;
  try {
    loaded = await loadRun(ctx.stateRoot);
  } catch {
    // The journal may be unreadable; releasing the file still matters.
  }
  if (loaded?.run) {
    try {
      await loaded.journal.append({
        type: "lease_released",
        run_id: requireRun(loaded).run_id,
        session_id: ctx.sessionId,
      });
      refreshLoaded(loaded);
    } catch {
      // Releasing the file still matters more than the audit event.
    }
  }
  await releaseLease({ root: ctx.stateRoot, sessionId: ctx.sessionId });
  if (loaded?.run) {
    try {
      await saveLoaded(loaded, { status: requireRun(loaded).run_status });
    } catch {
      // best effort
    }
  }
  return { status: "released", lease, loaded };
}

export interface LeaseStatusResult {
  readonly status: string;
  readonly leases: ReturnType<typeof summarizeLeases>;
}

export async function leaseStatus(ctx: OrchestratorContext): Promise<LeaseStatusResult> {
  const leases = summarizeLeases(await readLeases(ctx.stateRoot));
  return { status: "ok", leases };
}

export async function finish(ctx: OrchestratorContext): Promise<CommandResult> {
  const loaded = await beginWrite(ctx);
  if (!allTasksDone(loaded.plan, loaded.tasks)) {
    throw new TransitionError("not every task is done; finish refused");
  }
  const current = await currentFingerprint(ctx);
  const diff = compareFingerprints(loaded.run?.env_fingerprint ?? null, current);
  await clearDriftIfNeeded(ctx, loaded);
  await loaded.journal.append({
    type: "run_complete",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
  });
  refreshLoaded(loaded);
  await loaded.journal.append({
    type: "lease_released",
    run_id: requireRun(loaded).run_id,
    session_id: ctx.sessionId,
  });
  refreshLoaded(loaded);
  try {
    await removeFile(leasePath(ctx.stateRoot, ctx.sessionId));
  } catch {
    // best effort
  }
  await saveLoaded(loaded, { status: "COMPLETE" });
  const reportPath = await writeRunReports({
    root: ctx.stateRoot,
    run: loaded.run,
    plan: loaded.plan,
    tasks: loaded.tasks,
    events: loaded.journal.events,
    status: "COMPLETE",
    drift: diff,
    reconciliation: emptyReconciliation(),
    currentFingerprint: current,
    sessionId: ctx.sessionId,
  });
  return result(loaded, {
    status: "COMPLETE",
    reportPath,
    drift: diff,
    reconciliation: emptyReconciliation(),
  });
}
