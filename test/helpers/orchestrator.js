// Shared harness for the T1 to T7 integration tests.
//
// Every run copies the fixture project into a temporary directory and writes
// its state under a temporary root. Nothing here touches the repository.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readJournal, verifyChain } from "../../src/orchestrator/journal.js";
import { readLatestCheckpoint } from "../../src/orchestrator/compaction.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLI = join(ROOT, "scripts", "orchestrator-state.mjs");
export const FIXTURE = join(ROOT, "test", "fixtures", "orchestrator", "project");

export const TASKS = [
  { task_id: "T-001", capability: "route", skill: "route", idempotent: true },
  { task_id: "T-002", capability: "develop", skill: "develop", idempotent: true },
  { task_id: "T-003", capability: "release-prep", skill: "release-prep", idempotent: false },
];

export function makeRun({ session = "s-fixture" } = {}) {
  const base = mkdtempSync(join(tmpdir(), "orch-integration-"));
  const project = join(base, "project");
  cpSync(FIXTURE, project, { recursive: true });
  return {
    base,
    project,
    stateRoot: join(base, "state"),
    session,
  };
}

export function run(context, args, {
  crashAt = null,
  env = {},
  session = context.session,
  stateRoot = context.stateRoot,
  project = context.project,
  cwd = context.project,
} = {}) {
  const childEnv = {
    ...process.env,
    ORCH_PROJECT_ROOT: project,
    ORCH_STATE_ROOT: stateRoot,
    ORCH_SESSION_ID: session,
    ORCH_LIBRARY_ROOT: join(project, "library"),
    ORCH_MANIFEST: join(project, "skills-lock.json"),
    ORCH_TEST_ALLOW_TMP: "1",
    ...env,
  };
  if (crashAt) {
    childEnv.ORCH_TEST_MODE = "1";
    childEnv.ORCH_TEST_CRASH_AT = crashAt;
  } else {
    delete childEnv.ORCH_TEST_MODE;
    delete childEnv.ORCH_TEST_CRASH_AT;
  }
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: childEnv,
    encoding: "utf8",
  });
}

export const boot = (context, options = {}) => run(context, ["boot"], options);
export const planSet = (context, options = {}) => run(context, ["plan", "set", "--file", "plan.json"], options);
export const start = (context, taskId, options = {}) => run(context, ["start", "--task", taskId], options);
export const end = (context, taskId, stepId, handoff, options = {}) =>
  run(context, ["end", "--task", taskId, "--step", stepId, "--handoff", handoff], options);
export const checkpoint = (context, options = {}) => run(context, ["checkpoint"], options);
export const finish = (context, options = {}) => run(context, ["finish"], options);
export const status = (context, options = {}) => run(context, ["status"], options);

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function readState(context) {
  return readJson(join(context.stateRoot, "state.json"));
}

export function readPlan(context) {
  return readJson(join(context.stateRoot, "plan.json"));
}

export function readTask(context, taskId) {
  return readJson(join(context.stateRoot, "tasks", taskId, "task.json"));
}

export function readReport(context) {
  return readText(join(context.stateRoot, "resume-report.md"));
}

export function readJournalText(context) {
  return readText(join(context.stateRoot, "journal.ndjson"));
}

export function journalEvents(context) {
  return readJournalText(context)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

export function countEvents(context, type) {
  return journalEvents(context).filter((event) => event.type === type).length;
}

export function writeFixtureHandoff(context, taskId, skill, attempt) {
  const content = readText(join(FIXTURE, "handoffs", `${taskId}.yaml`));
  const relativePath = `tasks/${taskId}/handoffs/${skill}-${attempt}.yaml`;
  const path = join(context.stateRoot, "tasks", taskId, "handoffs", `${skill}-${attempt}.yaml`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return relativePath;
}

export function completeTask(context, task) {
  const started = start(context, task.task_id);
  if (started.status !== 0) return { started };
  const taskState = readTask(context, task.task_id);
  const attempt = taskState.attempt;
  const handoff = writeFixtureHandoff(context, task.task_id, task.skill, attempt);
  const ended = end(context, task.task_id, taskState.current_step.step_id, handoff);
  return { started, ended, attempt, handoff };
}

function crashOptions(point, match) {
  return point === match ? { crashAt: point } : {};
}

export function runReference({
  crashPoint = null,
  wantCheckpoint = true,
  wantFinish = true,
  session = "s-fixture",
} = {}) {
  const context = makeRun({ session });
  const results = {};

  results.boot = boot(context, crashOptions(crashPoint, "after_lease"));
  if (results.boot.signal) return { run: context, results, crashed: results.boot };

  results.plan = planSet(context, crashOptions(crashPoint, "after_plan_journal"));
  if (results.plan.signal) return { run: context, results, crashed: results.plan };

  for (const task of TASKS) {
    const startPoint = task.task_id === "T-001"
      && (crashPoint === "after_step_start_journal" || crashPoint === "after_task_snapshot");
    results[`start_${task.task_id}`] = start(
      context,
      task.task_id,
      startPoint ? { crashAt: crashPoint } : {},
    );
    if (results[`start_${task.task_id}`].signal) {
      return { run: context, results, crashed: results[`start_${task.task_id}`] };
    }

    const taskState = readTask(context, task.task_id);
    const handoff = writeFixtureHandoff(context, task.task_id, task.skill, taskState.attempt);
    const endPoint = task.task_id === "T-001" && [
      "before_step_end_journal",
      "after_step_end_journal",
      "after_task_snapshot_on_end",
    ].includes(crashPoint);
    results[`end_${task.task_id}`] = end(
      context,
      task.task_id,
      taskState.current_step.step_id,
      handoff,
      endPoint ? { crashAt: crashPoint } : {},
    );
    if (results[`end_${task.task_id}`].signal) {
      return { run: context, results, crashed: results[`end_${task.task_id}`] };
    }
  }

  results.status = status(context);

  if (wantCheckpoint || crashPoint === "after_checkpoint_snapshot" || crashPoint === "before_journal_truncation") {
    const checkpointPoint = crashPoint === "after_checkpoint_snapshot" || crashPoint === "before_journal_truncation";
    results.checkpoint = checkpoint(context, checkpointPoint ? { crashAt: crashPoint } : {});
    if (results.checkpoint.signal) return { run: context, results, crashed: results.checkpoint };
  }

  if (wantFinish) {
    results.finish = finish(context);
    if (results.finish.signal) return { run: context, results, crashed: results.finish };
  }

  return { run: context, results, crashed: null };
}

export function prepareRun({ session = "s-fixture" } = {}) {
  const context = makeRun({ session });
  const bootResult = boot(context);
  const planResult = planSet(context);
  return { run: context, boot: bootResult, plan: planResult };
}

function skillName(resolvedSkill) {
  return resolvedSkill.split("/").pop();
}

export function recoverAndFinish(context) {
  const results = {};
  results.boot = boot(context);
  if (results.boot.status !== 0) return { results, ok: false };

  let plan = readPlan(context);
  if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    results.plan = planSet(context);
    if (results.plan.status !== 0) return { results, ok: false };
    plan = readPlan(context);
  }

  for (const planTask of plan.tasks) {
    const task = readTask(context, planTask.task_id);
    if (!task) return { results, ok: false, missingTask: planTask.task_id };
    if (task.status === "done") continue;
    if (task.status === "needs_review") return { results, ok: false, needsReview: planTask.task_id };
    if (task.status === "in_progress") {
      const handoff = writeFixtureHandoff(
        context,
        task.task_id,
        skillName(planTask.resolved_skill),
        task.current_step?.attempt ?? task.attempt ?? 1,
      );
      results[`end_${task.task_id}`] = end(context, task.task_id, task.current_step.step_id, handoff);
      if (readTask(context, task.task_id).status !== "done") {
        return { results, ok: false, stuck: planTask.task_id };
      }
      continue;
    }
    const completed = completeTask(context, {
      task_id: planTask.task_id,
      capability: planTask.capability,
      skill: skillName(planTask.resolved_skill),
    });
    results[`complete_${planTask.task_id}`] = completed;
    if (completed.started?.status !== 0 || completed.ended?.status !== 0) {
      return { results, ok: false, failed: planTask.task_id };
    }
  }

  results.checkpoint = checkpoint(context);
  results.finish = finish(context);
  return {
    results,
    ok: results.checkpoint.status === 0 && results.finish.status === 0,
  };
}

export function artifactContents(context) {
  const dir = join(context.project, "artifacts");
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    out[name] = readText(join(dir, name));
  }
  return out;
}

export function taskView(context) {
  const plan = readPlan(context);
  const tasks = {};
  for (const planTask of plan.tasks) {
    const task = readTask(context, planTask.task_id);
    tasks[planTask.task_id] = {
      status: task.status,
      outputs: [...task.outputs].sort(),
    };
  }
  return tasks;
}

function reportSection(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start === -1) return "";
  let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n").trim();
}

export function t1ReportView(context) {
  const text = readReport(context);
  const status = /^- Status: (.+)$/m.exec(text)?.[1]?.trim() ?? null;
  let cursor = reportSection(text, "Cursor").replace(/attempt \d+/g, "attempt N");
  let tasks = reportSection(text, "Tasks")
    .split("\n")
    .map((line) => {
      if (!line.startsWith("| ")) return line;
      const cells = line.split("|");
      if (cells.length >= 9 && cells[1].trim() !== "id" && !/^-+$/.test(cells[1].trim())) {
        cells[4] = " N ";
      }
      return cells.join("|");
    })
    .join("\n");
  const environment = reportSection(text, "Environment fingerprint")
    .replace(/sha256:[0-9a-f]{64}/g, "sha256:HASH");
  return { status, cursor, tasks, environment };
}

export function t1Target(context) {
  const state = readState(context);
  const plan = readPlan(context);
  return {
    status: state.run_status,
    cursor: state.cursor
      ? { task_id: state.cursor.task_id, capability: state.cursor.capability, status: state.cursor.status }
      : null,
    planChecksum: plan.checksum,
    tasks: taskView(context),
    artifacts: artifactContents(context),
    report: t1ReportView(context),
  };
}

const TIME_KEYS = new Set(["created_at", "updated_at", "completed_at", "started_at", "generated_at", "at"]);
const ID_KEYS = new Map([["run_id", "RUN"], ["session_id", "SESSION"]]);

export function normalize(value) {
  if (Array.isArray(value)) return value.map((entry) => normalize(entry));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "journal_head") {
        out[key] = { seq: "SEQ", event_hash: "HASH" };
      } else if (TIME_KEYS.has(key)) {
        out[key] = "TS";
      } else if (ID_KEYS.has(key)) {
        out[key] = ID_KEYS.get(key);
      } else if (key === "event_hash") {
        out[key] = "HASH";
      } else if (key === "library_root") {
        out[key] = "LIBRARY_ROOT";
      } else if (key === "manifest_path") {
        out[key] = "MANIFEST_PATH";
      } else {
        out[key] = normalize(entry);
      }
    }
    return out;
  }
  return value;
}

export function normalizedRunFiles(context) {
  const plan = readPlan(context);
  const tasks = {};
  for (const planTask of plan.tasks) {
    tasks[planTask.task_id] = normalize(readTask(context, planTask.task_id));
  }
  return {
    plan: normalize(plan),
    state: normalize(readState(context)),
    tasks,
  };
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function snapshotFiles(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out[relative(dir, path)] = sha256Hex(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

export function ageLease(context, session) {
  const path = join(context.stateRoot, "locks", `session-${session}.json`);
  const lease = readJson(path);
  const old = new Date(Date.now() - 120_000).toISOString().slice(0, 19) + "Z";
  lease.started_at = old;
  lease.heartbeat_at = old;
  lease.ttl_seconds = 60;
  writeFileSync(path, `${JSON.stringify(lease, null, 2)}\n`);
  return lease;
}

export function corruptTornWrite(context) {
  const statePath = join(context.stateRoot, "state.json");
  const text = readText(statePath);
  writeFileSync(statePath, text.slice(0, Math.floor(text.length / 2)));
  appendFileSync(join(context.stateRoot, "journal.ndjson"), '{"seq":9999,"type":"step_start"');
}

export async function journalChain(context) {
  const info = await readJournal(join(context.stateRoot, "journal.ndjson"));
  const checkpoint = await readLatestCheckpoint(context.stateRoot);
  const retained = checkpoint ? info.events.filter((event) => event.seq > checkpoint.seq) : info.events;
  return verifyChain(retained, {
    prevHash: checkpoint?.journal_head?.event_hash ?? null,
    startSeq: checkpoint ? checkpoint.seq + 1 : 1,
  });
}

export function copyJournalAndCheckpoints(source, target, { checkpoints = true } = {}) {
  const targetState = join(target.stateRoot);
  mkdirSync(targetState, { recursive: true });
  writeFileSync(join(targetState, "journal.ndjson"), readText(join(source.stateRoot, "journal.ndjson")));
  if (checkpoints && existsSync(join(source.stateRoot, "checkpoints"))) {
    cpSync(join(source.stateRoot, "checkpoints"), join(targetState, "checkpoints"), { recursive: true });
  }
}
