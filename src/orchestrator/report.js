// Human-facing reports.
//
// resume-report.md is sufficient on its own for a fresh reader. STATE.md is a
// generated mirror and is never read as input.

import { join } from "node:path";
import { atomicWriteFile } from "./fsx.js";

function cell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function shortHash(value) {
  return value ?? "not present";
}

function matchLabel(oldValue, newValue) {
  if (oldValue === null && newValue === null) return "not present";
  if (oldValue === newValue) return "matches recorded";
  return `differs, recorded ${shortHash(oldValue)}`;
}

function planTaskFor(plan, taskId) {
  return plan?.tasks?.find((entry) => entry.task_id === taskId) ?? null;
}

export function nextAction({ run, plan, tasks }) {
  const status = run?.run_status;
  if (status === "BLOCKED_DRIFT") return "stop: review drift, then boot again; dispatch nothing";
  if (status === "HALT_CORRUPT") return "stop: repair or reset the state root";
  if (status === "COMPLETE") return "none (run is complete)";
  if (!plan || plan.tasks.length === 0) {
    return "route the request, then write a one task bootstrap plan and call plan set";
  }
  const cursor = run?.cursor;
  if (!cursor) {
    const review = (tasks ?? []).find((task) => task.status === "needs_review");
    if (review) {
      return `stop: user decision required, then resolve --task ${review.task_id} --decision "<answer>"`;
    }
    const failed = (tasks ?? []).find((task) => task.status === "failed");
    if (failed) {
      return `stop: review the failure, then start --task ${failed.task_id} to retry`;
    }
    const interrupted = (tasks ?? []).find((task) => task.status === "in_progress");
    if (interrupted) {
      const idempotent = interrupted.current_step?.idempotent ?? planTaskFor(plan, interrupted.task_id)?.idempotent ?? false;
      return idempotent
        ? `retry (idempotent): start --task ${interrupted.task_id}`
        : "stop: review the interrupted non-idempotent step";
    }
    const blocked = (tasks ?? []).find((task) => task.status === "pending");
    if (blocked) return `stop: task ${blocked.task_id} is blocked by unmet dependencies`;
    return "stop: no eligible task; inspect the task table";
  }
  const task = (tasks ?? []).find((entry) => entry.task_id === cursor.task_id);
  if (!task) return "stop: cursor task is missing from the task set";
  if (task.status === "needs_review") {
    return `stop: user decision required, then resolve --task ${task.task_id} --decision "<answer>"`;
  }
  if (task.status === "failed") {
    return `stop: review the failure, then start --task ${task.task_id} to retry`;
  }
  if (task.status === "in_progress") {
    const idempotent = task.current_step?.idempotent ?? planTaskFor(plan, task.task_id)?.idempotent ?? false;
    return idempotent
      ? `retry (idempotent): start --task ${task.task_id}`
      : "stop: review the interrupted non-idempotent step";
  }
  return `start --task ${task.task_id}, then dispatch ${task.resolved_skill} to ${task.owner}`;
}

function renderTasks(tasks) {
  const lines = [
    "| id | capability | status | attempts | resolved skill | source | owner |",
    "|----|-----------|--------|----------|----------------|--------|-------|",
  ];
  if (!tasks || tasks.length === 0) {
    lines.push("| (none) | | | | | | |");
    return lines;
  }
  for (const task of tasks) {
    lines.push(
      `| ${cell(task.task_id)} | ${cell(task.capability)} | ${cell(task.status)} | ${cell(task.attempt ?? 0)} | ${cell(task.resolved_skill)} | ${cell(task.resolution_source)} | ${cell(task.owner)} |`,
    );
  }
  return lines;
}

function renderEvents(events) {
  const recent = (events ?? []).slice(-10);
  if (recent.length === 0) return ["- (none)"];
  return recent.map((event) => {
    const subject = event.task_id ?? event.step_id ?? "";
    return `- #${event.seq} ${event.ts} \`${event.type}\`${subject ? ` ${subject}` : ""}`;
  });
}

export function renderDrift(diff) {
  if (!diff || diff.match) return [];
  const lines = ["## Drift"];
  if (diff.manifest?.changed || diff.manifest?.old !== diff.manifest?.new) {
    lines.push(`- skills_lock_sha256: ${shortHash(diff.manifest?.old)} -> ${shortHash(diff.manifest?.new)}`);
  }
  if (diff.overrides?.changed || diff.overrides?.old !== diff.overrides?.new) {
    lines.push(`- library_overrides_sha256: ${shortHash(diff.overrides?.old)} -> ${shortHash(diff.overrides?.new)}`);
  }
  for (const path of diff.overrides?.paths ?? []) {
    lines.push(`- changed path \`${cell(path.path)}\` (${cell(path.change)}): ${shortHash(path.old)} -> ${shortHash(path.new)}`);
  }
  if (diff.design?.changed) {
    lines.push(`- design_registry.index_sha256: ${shortHash(diff.design.old?.index_sha256 ?? null)} -> ${shortHash(diff.design.new?.index_sha256 ?? null)}`);
    lines.push(`- design surfaces: ${diff.design.old?.surface_count ?? 0} -> ${diff.design.new?.surface_count ?? 0}`);
    for (const path of diff.design?.paths ?? []) {
      lines.push(`- changed path \`${cell(path.path)}\` (${cell(path.change)}): ${shortHash(path.old)} -> ${shortHash(path.new)}`);
    }
  }
  if (diff.paths) {
    for (const path of diff.paths) {
      lines.push(`- changed path \`${cell(path.path)}\` (${cell(path.change)}): ${shortHash(path.old)} -> ${shortHash(path.new)}`);
    }
  }
  if (diff.detail) lines.push(`- detail: ${cell(diff.detail)}`);
  return lines;
}

function renderEnvironment(recorded, current, diff) {
  const lines = ["## Environment fingerprint"];
  const manifestOld = recorded?.skills_lock_sha256 ?? null;
  const manifestNew = current?.skills_lock_sha256 ?? null;
  const overridesOld = recorded?.library_overrides_sha256 ?? null;
  const overridesNew = current?.library_overrides_sha256 ?? null;
  const designOld = recorded?.design_registry?.index_sha256 ?? null;
  const designNew = current?.design_registry?.index_sha256 ?? null;
  lines.push(`- skills-lock.json: ${shortHash(manifestNew)} (${matchLabel(manifestOld, manifestNew)})`);
  lines.push(`- library overrides: ${shortHash(overridesNew)} (${matchLabel(overridesOld, overridesNew)})`);
  lines.push(`- design registry: ${shortHash(designNew)} (${matchLabel(designOld, designNew)})`);
  if (current?.design_registry) {
    const counts = current.design_registry.status_counts ?? {};
    lines.push(`- design surfaces: ${current.design_registry.surface_count} (active ${counts.active ?? 0}, draft ${counts.draft ?? 0}, deprecated ${counts.deprecated ?? 0}, needs_review ${counts.needs_review ?? 0})`);
  }
  if (current?.orchestrator_version) {
    const oldVersion = recorded?.orchestrator_version ?? null;
    lines.push(`- orchestrator version: ${current.orchestrator_version} (recorded ${oldVersion ?? "unknown"})`);
  }
  if (diff && !diff.match) lines.push("- environment match: false");
  else lines.push("- environment match: true");
  return lines;
}

function renderReconciliation(reconciliation = {}) {
  const interrupted = reconciliation.interrupted?.length ?? 0;
  const retried = reconciliation.retried ?? [];
  const escalated = reconciliation.escalated ?? [];
  const malformed = reconciliation.malformedHandoffs ?? [];
  const lines = ["## Reconciliation"];
  lines.push(`- Interrupted tasks reconciled: ${interrupted}${retried.length ? ` (${retried.join(", ")} -> retry)` : ""}`);
  lines.push(`- Escalated to needs_review: ${escalated.length}${escalated.length ? ` (${escalated.join(", ")})` : ""}`);
  lines.push(`- Malformed handoffs: ${malformed.length}${malformed.length ? ` (${malformed.join(", ")})` : ""}`);
  return lines;
}

export function renderResumeReport({
  run,
  plan,
  tasks,
  events,
  status,
  drift = null,
  reconciliation = {},
  currentFingerprint = null,
  sessionId = null,
  generatedAt = null,
}) {
  const resolvedStatus = status ?? run?.run_status ?? "NEW_RUN";
  const lines = [
    "# Resume Report",
    "",
    `- Run: ${run?.run_id ?? "unknown"}`,
    `- Generated: ${generatedAt ?? "unknown"}`,
    `- Session: ${sessionId ?? "unknown"}`,
    `- Status: ${resolvedStatus}`,
    "",
    "## Cursor",
  ];
  const cursor = run?.cursor;
  if (!cursor) {
    lines.push("- Task: none");
  } else {
    const task = (tasks ?? []).find((entry) => entry.task_id === cursor.task_id);
    const attempt = task?.attempt ?? cursor.attempt ?? 0;
    lines.push(`- Task: ${cursor.task_id} (${task?.capability ?? cursor.capability ?? "unknown"}) - ${task?.status ?? cursor.status ?? "unknown"}, attempt ${attempt}`);
  }
  lines.push(`- Next action: ${nextAction({ run: { ...run, run_status: resolvedStatus }, plan, tasks, drift })}`);
  lines.push("", "## Tasks", ...renderTasks(tasks));
  lines.push("", ...renderReconciliation(reconciliation));
  lines.push("", ...renderEnvironment(run?.env_fingerprint, currentFingerprint, drift));
  const driftLines = renderDrift(drift);
  if (driftLines.length > 0) lines.push("", ...driftLines);
  lines.push("", "## Recent events", ...renderEvents(events), "");
  return lines.join("\n");
}

export function renderStateMd({
  run,
  tasks,
  events,
  drift = null,
  generatedAt = null,
}) {
  const lines = [
    "# Orchestrator State",
    "",
    "This file is a generated view. The engine never reads it.",
    "",
    `- Run: ${run?.run_id ?? "unknown"}`,
    `- Generated: ${generatedAt ?? "unknown"}`,
    `- Status: ${run?.run_status ?? "unknown"}`,
    `- Cursor: ${run?.cursor ? `${run.cursor.task_id} (${run.cursor.status ?? "pending"}, attempt ${run.cursor.attempt ?? 0})` : "none"}`,
    `- Last checkpoint: ${run?.last_checkpoint ?? "none"}`,
    `- Drift: ${drift && !drift.match ? "detected" : "none"}`,
    "",
    "## Tasks",
    ...renderTasks(tasks),
    "",
    "## Recent events",
    ...renderEvents(events),
    "",
  ];
  return lines.join("\n");
}

export async function writeResumeReport(root, content) {
  const path = join(root, "resume-report.md");
  await atomicWriteFile(path, content);
  return path;
}

export async function writeStateMd(root, content) {
  const path = join(root, "STATE.md");
  await atomicWriteFile(path, content);
  return path;
}

export async function writeRunReports({
  root,
  run,
  plan,
  tasks,
  events,
  status,
  drift = null,
  reconciliation = {},
  currentFingerprint = null,
  sessionId = null,
  generatedAt = null,
}) {
  const stamp = generatedAt ?? new Date().toISOString().slice(0, 19) + "Z";
  const report = renderResumeReport({
    run,
    plan,
    tasks,
    events,
    status,
    drift,
    reconciliation,
    currentFingerprint,
    sessionId,
    generatedAt: stamp,
  });
  const stateMd = renderStateMd({ run, plan, tasks, events, drift, generatedAt: stamp });
  const reportPath = await writeResumeReport(root, report);
  await writeStateMd(root, stateMd);
  return reportPath;
}
