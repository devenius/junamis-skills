// Boot sequence B1 to B8.
//
// B1 resolve, B2 lease, B3 load and verify, B4 drift, B5 reconcile in-flight
// work, B6 handoffs, B7 report, B8 cursor.

import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  assertStateRootSafe,
  ensureTree,
  exists,
  listFiles,
  readText,
  relativePosix,
  removeFile,
} from "./fsx.js";
import { CorruptStateError } from "./errors.js";
import { computeFingerprint, compareFingerprints } from "./drift.js";
import { acquireLease, leasePath } from "./lease.js";
import { readJournal, truncatePartialTail } from "./journal.js";
import { parseHandoff } from "./handoff.js";
import {
  createRun,
  loadFromPaths,
  maybeAutoCheckpoint,
  refreshLoaded,
  saveLoaded,
  statePaths,
  validateSnapshots,
} from "./store.js";
import { writeResumeReport, writeStateMd, writeRunReports } from "./report.js";
import { crashPoint } from "./test-hooks.js";
import { nowIso } from "./time.js";

function leaseEventFor(action) {
  if (action === "taken_over") return "lease_taken_over";
  if (action === "reacquired") return "lease_reacquired";
  return "lease_acquired";
}

function makeRunId(iso) {
  const date = iso.slice(0, 10).replaceAll("-", "");
  return `run-${date}-${randomBytes(3).toString("hex")}`;
}

async function writeReports({ loaded, status, drift, reconciliation, currentFingerprint, sessionId }) {
  const generatedAt = nowIso();
  loaded.run.journal_head = loaded.journal.head;
  return writeRunReports({
    root: loaded.paths.root,
    run: loaded.run,
    plan: loaded.plan,
    tasks: loaded.tasks,
    events: loaded.journal.events,
    status,
    drift,
    reconciliation,
    currentFingerprint,
    sessionId,
    generatedAt,
  });
}

async function releaseAfterHalt(loaded, { sessionId, status }) {
  try {
    await loaded.journal.append({
      type: "lease_released",
      run_id: loaded.run.run_id,
      session_id: sessionId,
    });
    refreshLoaded(loaded);
  } catch {
    // The journal may be unreadable; releasing the file still matters.
  }
  try {
    await removeFile(leasePath(loaded.paths.root, sessionId));
  } catch {
    // best effort
  }
  if (loaded.run) {
    try {
      await saveLoaded(loaded, { status });
    } catch {
      // best effort; the journal is the source of truth.
    }
  }
}

async function haltCorrupt({ paths, sessionId, stateRoot, error, currentFingerprint }) {
  try {
    await removeFile(leasePath(stateRoot, sessionId));
  } catch {
    // best effort
  }
  const generatedAt = nowIso();
  const details = error instanceof Error ? error.message : String(error);
  const report = [
    "# Resume Report",
    "",
    "- Run: unknown",
    `- Generated: ${generatedAt}`,
    `- Session: ${sessionId}`,
    "- Status: HALT_CORRUPT",
    "",
    "## Cursor",
    "- Task: none",
    "- Next action: stop: repair or reset the state root",
    "",
    "## Tasks",
    "| id | capability | status | attempts | resolved skill | source | owner |",
    "|----|-----------|--------|----------|----------------|--------|-------|",
    "| (none) | | | | | | |",
    "",
    "## Reconciliation",
    "- Interrupted tasks reconciled: 0",
    "- Escalated to needs_review: 0",
    "- Malformed handoffs: 0",
    "",
    "## Halt",
    `- reason: corrupt_state`,
    `- detail: ${details}`,
    "",
    "## Environment fingerprint",
    `- skills-lock.json: ${currentFingerprint?.skills_lock_sha256 ?? "not present"}`,
    `- library overrides: ${currentFingerprint?.library_overrides_sha256 ?? "not present"}`,
    "",
    "## Recent events",
    "- (not available)",
    "",
  ].join("\n");
  const stateMd = [
    "# Orchestrator State",
    "",
    "This file is a generated view. The engine never reads it.",
    "",
    `- Run: unknown`,
    `- Generated: ${generatedAt}`,
    "- Status: HALT_CORRUPT",
    "- Cursor: none",
    `- Halt: ${details}`,
    "",
  ].join("\n");
  let reportPath = paths.report;
  try {
    reportPath = await writeResumeReport(stateRoot, report);
  } catch {
    // The state root may be unwritable; the halt line still goes to the caller.
  }
  try {
    await writeStateMd(stateRoot, stateMd);
  } catch {
    // best effort
  }
  return {
    status: "HALT_CORRUPT",
    exitCode: 4,
    halt: "corrupt_state",
    error: details,
    reportPath,
    run: null,
    plan: null,
    tasks: [],
    runId: null,
    cursor: null,
    tasksSummary: null,
    drift: null,
    lease: null,
    reconciliation: null,
  };
}

function finalStatus(loaded) {
  if (loaded.run?.completed_at) return "COMPLETE";
  if (!loaded.plan || loaded.plan.tasks.length === 0) return "NEW_RUN";
  const byId = new Map(loaded.tasks.map((task) => [task.task_id, task]));
  const done = loaded.plan.tasks.every((task) => byId.get(task.task_id)?.status === "done");
  return done ? "COMPLETE" : "RESUMING";
}

export async function boot(ctx) {
  const {
    stateRoot,
    libraryRoot,
    manifestPath,
    sessionId,
    host,
    pid,
    baseTtl,
    allowTmp,
    packageVersion,
  } = ctx;

  await assertStateRootSafe(stateRoot, { allowTmp });
  const paths = statePaths(stateRoot);
  const journalExisted = await exists(paths.journal);
  const stateExisted = await exists(paths.state);
  const planExisted = await exists(paths.plan);
  const isNew = !journalExisted && !stateExisted && !planExisted;

  await ensureTree(stateRoot);

  const leaseResult = await acquireLease({
    root: stateRoot,
    sessionId,
    pid,
    host,
    ttlSeconds: baseTtl,
  });
  crashPoint("after_lease");

  const currentFingerprint = await computeFingerprint({ libraryRoot, manifestPath, version: packageVersion });
  const leaseEvent = { type: leaseEventFor(leaseResult.action), lease: leaseResult.lease };

  if (isNew) {
    const createdAt = nowIso();
    const runId = makeRunId(createdAt);
    const loaded = await createRun({
      paths,
      runId,
      createdAt,
      envFingerprint: currentFingerprint,
      sessionId,
      leaseEvent,
    });
    crashPoint("after_plan_journal");
    await saveLoaded(loaded, { status: "NEW_RUN" });
    const drift = compareFingerprints(loaded.run.env_fingerprint, currentFingerprint);
    await maybeAutoCheckpoint(loaded, { sessionId });
    const reportPath = await writeReports({
      loaded,
      status: "NEW_RUN",
      drift,
      reconciliation: { interrupted: [], retried: [], escalated: [], malformedHandoffs: [] },
      currentFingerprint,
      sessionId,
    });
    return {
      status: "NEW_RUN",
      exitCode: 0,
      halt: null,
      reportPath,
      run: loaded.run,
      plan: loaded.plan,
      tasks: loaded.tasks,
      runId,
      cursor: loaded.run.cursor,
      tasksSummary: loaded.run.tasks_summary,
      drift,
      lease: leaseResult.lease,
      leaseAction: leaseResult.action,
      reconciliation: { interrupted: [], retried: [], escalated: [], malformedHandoffs: [] },
    };
  }

  let journalInfo = await readJournal(paths.journal);
  let truncatedBytes = 0;
  if (journalInfo.truncated) {
    truncatedBytes = await truncatePartialTail(paths.journal, journalInfo);
    journalInfo = await readJournal(paths.journal);
  }

  let loaded;
  try {
    loaded = await loadFromPaths({ paths, journalInfo });
    await validateSnapshots(loaded);
    if (!loaded.run) throw new CorruptStateError("journal is empty and no checkpoint exists");
  } catch (error) {
    return haltCorrupt({ paths, sessionId, stateRoot, error, currentFingerprint });
  }

  if (truncatedBytes > 0) {
    await loaded.journal.append({
      type: "journal_truncated",
      run_id: loaded.run.run_id,
      session_id: sessionId,
      bytes_removed: truncatedBytes,
      last_valid_seq: loaded.journal.head.seq,
    });
    refreshLoaded(loaded);
  }

  await loaded.journal.append({ type: "run_resume", run_id: loaded.run.run_id, session_id: sessionId });
  await loaded.journal.append({ type: leaseEventFor(leaseResult.action), run_id: loaded.run.run_id, session_id: sessionId, lease: leaseResult.lease });
  refreshLoaded(loaded);

  // B4 drift.
  const drift = compareFingerprints(loaded.run.env_fingerprint, currentFingerprint);
  if (!drift.match) {
    await loaded.journal.append({
      type: "drift_detected",
      run_id: loaded.run.run_id,
      session_id: sessionId,
      diff: drift,
    });
    refreshLoaded(loaded);
    loaded.run.run_status = "BLOCKED_DRIFT";
    await releaseAfterHalt(loaded, { sessionId, status: "BLOCKED_DRIFT" });
    const reportPath = await writeReports({
      loaded,
      status: "BLOCKED_DRIFT",
      drift,
      reconciliation: { interrupted: [], retried: [], escalated: [], malformedHandoffs: [] },
      currentFingerprint,
      sessionId,
    });
    return {
      status: "BLOCKED_DRIFT",
      exitCode: 3,
      halt: "drift",
      reportPath,
      run: loaded.run,
      plan: loaded.plan,
      tasks: loaded.tasks,
      runId: loaded.run.run_id,
      cursor: loaded.run.cursor,
      tasksSummary: loaded.run.tasks_summary,
      drift,
      lease: leaseResult.lease,
      leaseAction: leaseResult.action,
      reconciliation: null,
    };
  }

  // A previous boot may have left the run blocked on drift. A matching
  // fingerprint now clears it; the journal records the recovery.
  if (loaded.run.run_status === "BLOCKED_DRIFT" || loaded.run.drift) {
    await loaded.journal.append({
      type: "drift_cleared",
      run_id: loaded.run.run_id,
      session_id: sessionId,
    });
    refreshLoaded(loaded);
  }

  // B5 reconcile in-flight work.
  const reconciliation = { interrupted: [], retried: [], escalated: [], malformedHandoffs: [] };
  const planById = new Map((loaded.plan?.tasks ?? []).map((task) => [task.task_id, task]));
  for (const task of loaded.tasks) {
    if (task.status !== "in_progress") continue;
    reconciliation.interrupted.push(task.task_id);
    const idempotent = task.current_step?.idempotent ?? planById.get(task.task_id)?.idempotent ?? false;
    if (idempotent === true) {
      await loaded.journal.append({
        type: "task_status",
        run_id: loaded.run.run_id,
        session_id: sessionId,
        task_id: task.task_id,
        status: "pending",
        reason: "reconciled_idempotent",
      });
      reconciliation.retried.push(task.task_id);
    } else {
      await loaded.journal.append({
        type: "escalation",
        run_id: loaded.run.run_id,
        session_id: sessionId,
        task_id: task.task_id,
        reason: "interrupted_non_idempotent",
      });
      reconciliation.escalated.push(task.task_id);
    }
  }
  if (reconciliation.interrupted.length > 0) refreshLoaded(loaded);

  // B6 validate stored handoffs. A malformed handoff is kept and escalated.
  for (const task of loaded.tasks) {
    const dir = join(stateRoot, "tasks", task.task_id, "handoffs");
    const files = await listFiles(dir, ".yaml");
    for (const file of files) {
      const text = await readText(file);
      try {
        parseHandoff(text ?? "");
      } catch (error) {
        const relative = relativePosix(stateRoot, file);
        reconciliation.malformedHandoffs.push(relative);
        if (task.status !== "needs_review") {
          await loaded.journal.append({
            type: "escalation",
            run_id: loaded.run.run_id,
            session_id: sessionId,
            task_id: task.task_id,
            reason: "invalid_handoff",
            path: relative,
            message: error.message,
          });
          task.status = "needs_review";
        }
      }
    }
  }
  if (reconciliation.malformedHandoffs.length > 0) refreshLoaded(loaded);

  // B7 and B8.
  const status = finalStatus(loaded);
  await saveLoaded(loaded, { status });
  await maybeAutoCheckpoint(loaded, { sessionId });
  const reportPath = await writeReports({
    loaded,
    status,
    drift,
    reconciliation,
    currentFingerprint,
    sessionId,
  });

  return {
    status,
    exitCode: 0,
    halt: null,
    reportPath,
    run: loaded.run,
    plan: loaded.plan,
    tasks: loaded.tasks,
    runId: loaded.run.run_id,
    cursor: loaded.run.cursor,
    tasksSummary: loaded.run.tasks_summary,
    drift,
    lease: leaseResult.lease,
    leaseAction: leaseResult.action,
    reconciliation,
  };
}
