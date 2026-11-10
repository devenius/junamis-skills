// RECONCILE: detectors, dedupe, resolution, dependency closure, scoring,
// overrides, escalation, and deterministic work-queue emission.
//
// This module never writes the design registry or plan.json and never invokes
// a model or a skill. It reads state, journal, plan, design surfaces, and the
// detector manifest, then writes work-queue.json, reconcile-report.md, and the
// reconcile journal events.

import { join } from "node:path";
import { atomicWriteFile, exists, readJsonFile } from "../orchestrator/fsx.js";
import { computeFingerprint } from "../orchestrator/drift.js";
import { canonicalJson, sha256Hex } from "../orchestrator/hash.js";
import { JournalWriter, readJournal } from "../orchestrator/journal.js";
import { renderDrift } from "../orchestrator/report.js";
import { loadRun, refreshLoaded } from "../orchestrator/store.js";
import { allTasksDone, writeState } from "../orchestrator/state.js";
import { loadSurfaces } from "../design/schema.js";
import { DETECTOR_RUNNERS } from "./detectors.js";
import { loadDetectorManifest } from "./manifest.js";
import { compareCandidates, isKnownReason, reasonWeight, score } from "./score.js";

const CAPABILITY_RE = /^[a-z0-9][a-z0-9-]*$/;
const PRIORITIES = new Set(["p0", "p1", "p2", "p3"]);

function cell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function short(value) {
  return value ?? "not present";
}

function candidateId(target, reason) {
  return `cand-${sha256Hex(`${target.kind}:${target.id}:${reason}`).slice(0, 16)}`;
}

function isReconcileEvent(event) {
  return event?.type === "reconcile_pass" || event?.reconcile === true;
}

function lastMeaningfulEvent(events) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!isReconcileEvent(event)) return event ?? null;
  }
  return null;
}

async function resolveSkill({ capability, libraryRoot, manifestPath }) {
  if (!CAPABILITY_RE.test(capability)) return { resolved_skill: null, resolution_source: "needs_review" };
  if (libraryRoot && (await exists(join(libraryRoot, "skills", capability, "SKILL.md")))) {
    return { resolved_skill: `library/${capability}`, resolution_source: "internal_override" };
  }
  if (manifestPath) {
    const parsed = await readJsonFile(manifestPath);
    if (parsed.exists && !parsed.error && parsed.value?.skills?.[capability]) {
      return { resolved_skill: `external/${capability}`, resolution_source: "manifest" };
    }
  }
  return { resolved_skill: null, resolution_source: "needs_review" };
}

function mergeProvenance(existing, incoming) {
  const seen = new Set(existing.map((entry) => `${entry.detector}:${entry.at_seq}`));
  for (const entry of incoming) {
    const key = `${entry.detector}:${entry.at_seq}`;
    if (!seen.has(key)) {
      existing.push(entry);
      seen.add(key);
    }
  }
}

function groupCandidates(rawCandidates) {
  const groups = new Map();
  for (const raw of rawCandidates) {
    const key = `${raw.target.kind}\0${raw.target.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        primary: raw,
        rationales: [raw.rationale],
        provenance: [...raw.provenance],
        nonDispatchable: raw.non_dispatchable === true,
      });
      continue;
    }
    const group = groups.get(key);
    mergeProvenance(group.provenance, raw.provenance);
    if (raw.rationale && !group.rationales.includes(raw.rationale)) group.rationales.push(raw.rationale);
    group.nonDispatchable = group.nonDispatchable || raw.non_dispatchable === true;
    if (reasonWeight(raw.reason) < reasonWeight(group.primary.reason)) group.primary = raw;
  }
  return [...groups.values()];
}

function blockersFor(candidate, { plan, tasks, surfaces }) {
  const blockers = [];
  if (candidate.target.kind === "task") {
    const planTask = (plan?.tasks ?? []).find((task) => task.task_id === candidate.target.id);
    const byId = new Map((tasks ?? []).map((task) => [task.task_id, task]));
    for (const dep of planTask?.depends_on ?? []) {
      if (byId.get(dep)?.status !== "done") blockers.push(dep);
    }
    // A surface awaiting operator review is a design-level gate on plan work.
    for (const surface of surfaces.values()) {
      if (surface.frontmatter?.status === "needs_review") blockers.push(surface.surface_id);
    }
  }
  if (candidate.target.kind === "surface") {
    const surface = surfaces.get(candidate.target.id);
    for (const dep of surface?.frontmatter?.depends_on ?? []) {
      const dependency = surfaces.get(dep);
      if (dependency && dependency.frontmatter?.status !== "active") blockers.push(dep);
    }
  }
  return [...new Set(blockers)];
}

async function buildCandidate(group, { plan, tasks, surfaces, libraryRoot, manifestPath, shadowConflict }) {
  const primary = group.primary;
  let capability = primary.capability;
  let reason = primary.reason;
  let severity = primary.severity;
  let resolved = await resolveSkill({ capability, libraryRoot, manifestPath });
  let nonDispatchable = group.nonDispatchable || reason === "needs_review" || reason === "shadow_conflict";

  if (!nonDispatchable && resolved.resolution_source === "needs_review") nonDispatchable = true;
  if (!nonDispatchable && shadowConflict && resolved.resolution_source === "internal_override") nonDispatchable = true;

  if (nonDispatchable) {
    if (reason !== "needs_review") reason = "shadow_conflict";
    capability = "needs_review";
    severity = "critical";
    resolved = { resolved_skill: "needs_review", resolution_source: "needs_review" };
  }

  const blockers = nonDispatchable ? [] : blockersFor(primary, { plan, tasks, surfaces });
  const planPosition = reason === "plan_pending" && Number.isInteger(primary.plan_position)
    ? primary.plan_position
    : null;
  const { priority } = score({ reason, severity, planPosition });
  return {
    candidate_id: candidateId(primary.target, reason),
    capability,
    target: primary.target,
    reason,
    priority,
    severity,
    effort: "unknown",
    ready: nonDispatchable ? false : blockers.length === 0,
    blocked_by: blockers,
    resolved_skill: resolved.resolved_skill,
    resolution_source: resolved.resolution_source,
    provenance: group.provenance,
    rationale: [
      ...group.rationales,
      ...(shadowConflict ? ["shadow conflict: library overrides changed"] : []),
      ...(nonDispatchable && resolved.resolution_source === "needs_review" && !group.nonDispatchable
        ? ["capability has no dispatchable skill"]
        : []),
    ].filter(Boolean).join(" · "),
    plan_position: planPosition,
    ...(reason === "shadow_conflict" ? { shadow_conflict: true } : {}),
  };
}

function summaryFor(queue, { stalled = false, blockingSet = [] } = {}) {
  const byPriority = { p0: 0, p1: 0, p2: 0, p3: 0 };
  let ready = 0;
  let blocked = 0;
  let needsReview = 0;
  for (const candidate of queue) {
    byPriority[candidate.priority] += 1;
    if (candidate.ready) ready += 1;
    else blocked += 1;
    if (candidate.resolution_source === "needs_review") needsReview += 1;
  }
  return {
    total: queue.length,
    ready,
    blocked,
    needs_review: needsReview,
    by_priority: byPriority,
    ...(stalled ? { stalled: true, blocking_set: blockingSet } : {}),
  };
}

function blockedCandidate({ status, drift, seq, ts }) {
  const target = { kind: "repo", id: "drift" };
  return {
    candidate_id: candidateId(target, "needs_review"),
    capability: "needs_review",
    target,
    reason: "needs_review",
    priority: "p0",
    severity: "critical",
    effort: "unknown",
    ready: false,
    blocked_by: [],
    resolved_skill: "needs_review",
    resolution_source: "needs_review",
    provenance: [{ detector: "drift_guard", at_seq: seq ?? 0, at_ts: ts ?? null }],
    rationale: `resume status ${status}: reconcile is blocked until the drift is reviewed`,
    plan_position: null,
    drift: drift ?? null,
  };
}

function makeQueue({ passId, generatedAt, inputFingerprint, status, queue, drift, stalled = false, blockingSet = [] }) {
  return {
    schema_version: 1,
    pass_id: passId,
    generated_at: generatedAt,
    input_fingerprint: inputFingerprint,
    status,
    summary: summaryFor(queue, { stalled, blockingSet }),
    queue,
    ...(stalled ? { stalled: true } : {}),
    ...(status === "blocked_drift" ? { drift: drift ?? null } : {}),
  };
}

function renderReport({ queue, detectorStatus, tick }) {
  const lines = [
    "# Reconcile Report",
    "",
    `- Pass: ${queue.pass_id}`,
    `- Generated: ${queue.generated_at}`,
    `- Status: ${queue.status}`,
    `- Tick: ${tick ? "yes" : "no"}`,
    `- Input fingerprint: journal@${queue.input_fingerprint.journal_head_seq} · plan ${short(queue.input_fingerprint.plan_checksum)} · design ${short(queue.input_fingerprint.design_index_sha256)}`,
    "",
    "## Head",
    "",
  ];
  const head = queue.queue[0];
  if (!head) {
    lines.push("- Candidate: none");
  } else {
    lines.push(`- Candidate: ${head.candidate_id}`);
    lines.push(`- Capability: ${head.capability} → ${head.resolved_skill ?? "unresolved"} (${head.resolution_source})`);
    lines.push(`- Target: ${head.target.id}`);
    lines.push(`- Reason: ${head.reason} (provenance: ${head.provenance.map((entry) => `${entry.detector}@${entry.at_seq}`).join(", ")})`);
    lines.push(`- Priority: ${head.priority} · severity: ${head.severity} · ready: ${head.ready}`);
  }
  if (queue.stalled) {
    lines.push(`- Stalled: yes (blocking: ${(queue.summary.blocking_set ?? []).join(", ") || "none"})`);
  }
  lines.push("", "## Queue", "", "| # | priority | ready | capability | target | reason | skill |", "|---|----------|-------|-----------|--------|--------|-------|");
  if (queue.queue.length === 0) {
    lines.push("| (none) | | | | | | |");
  } else {
    queue.queue.forEach((candidate, index) => {
      lines.push(`| ${index + 1} | ${candidate.priority} | ${candidate.ready ? "yes" : "no"} | ${cell(candidate.capability)} | ${cell(candidate.target.id)} | ${cell(candidate.reason)} | ${cell(candidate.resolved_skill ?? "none")} |`);
    });
  }
  lines.push("", "## Blocked", "");
  const blocked = queue.queue.filter((candidate) => !candidate.ready);
  if (blocked.length === 0) lines.push("- none");
  for (const candidate of blocked) {
    if (candidate.blocked_by.length > 0) {
      lines.push(`- ${candidate.candidate_id} blocked_by: [${candidate.blocked_by.join(", ")}]`);
    } else {
      lines.push(`- ${candidate.candidate_id} requires operator review (${candidate.reason})`);
    }
  }
  lines.push("", "## Detector status", "", "| detector | enabled | fired | candidates |", "|----------|---------|-------|------------|");
  if (detectorStatus.length === 0) {
    lines.push("| (not run) | | | |");
  } else {
    for (const detector of detectorStatus) {
      lines.push(`| ${detector.id} | ${detector.enabled ? "yes" : "no"} | ${detector.fired} | ${detector.candidates} |`);
    }
  }
  if (queue.status === "blocked_drift") {
    const driftLines = renderDrift(queue.drift);
    if (driftLines.length > 0) lines.push("", ...driftLines);
  }
  lines.push("");
  return lines.join("\n");
}

function mismatchedField(previous, current) {
  for (const key of ["journal_head_seq", "plan_checksum", "design_index_sha256", "env_fingerprint"]) {
    if (canonicalJson(previous?.[key] ?? null) !== canonicalJson(current?.[key] ?? null)) return key;
  }
  return "unknown";
}

function readOverrides(events) {
  const applied = new Map();
  const rejected = [];
  const alreadyRejected = new Set(
    events
      .filter((event) => event?.type === "priority_override_rejected" && Number.isInteger(event.override_seq))
      .map((event) => event.override_seq),
  );
  for (const event of events) {
    if (event?.type !== "priority_override") continue;
    let reason = null;
    if (typeof event.candidate_id !== "string" || event.candidate_id.length === 0) reason = "missing candidate_id";
    else if (!PRIORITIES.has(event.from) || !PRIORITIES.has(event.to)) reason = "invalid priority value";
    else if (typeof event.rationale !== "string" || event.rationale.trim().length === 0) reason = "missing rationale";
    else if (typeof event.by !== "string" || event.by.trim().length === 0) reason = "missing by";
    if (reason) {
      if (!alreadyRejected.has(event.seq)) {
        rejected.push({
          type: "priority_override_rejected",
          candidate_id: event.candidate_id ?? null,
          from: event.from ?? null,
          to: event.to ?? null,
          by: event.by ?? null,
          reason,
          override_seq: event.seq,
        });
      }
      continue;
    }
    applied.set(event.candidate_id, event.to);
  }
  return { applied, rejected };
}

function stalledInfo(queueItems, surfaces) {
  const planItems = queueItems.filter((candidate) => candidate.target.kind === "task" && candidate.reason === "plan_pending");
  if (planItems.length === 0) return null;
  const byId = new Map(planItems.map((candidate) => [candidate.target.id, candidate]));
  const blocking = new Set();
  const visiting = new Set();

  const blockedByDesign = (candidate) => {
    if (candidate.ready) return false;
    if (candidate.blocked_by.length === 0) return false;
    let reachedDesign = false;
    for (const blocker of candidate.blocked_by) {
      const surface = surfaces.get(blocker);
      if (surface && surface.frontmatter?.status === "needs_review") {
        blocking.add(blocker);
        reachedDesign = true;
        continue;
      }
      const dependency = byId.get(blocker);
      if (dependency && !visiting.has(blocker)) {
        visiting.add(blocker);
        const ok = blockedByDesign(dependency);
        visiting.delete(blocker);
        if (!ok) return false;
        reachedDesign = true;
        continue;
      }
      return false;
    }
    return reachedDesign;
  };

  for (const candidate of planItems) {
    if (!blockedByDesign(candidate)) return null;
  }
  return { blocking_set: [...blocking].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))) };
}

function tickDue(events, tickEvery) {
  let lastPassSeq = 0;
  for (const event of events) {
    if (event?.type === "reconcile_pass" && Number.isInteger(event.seq) && event.seq > lastPassSeq) {
      lastPassSeq = event.seq;
    }
  }
  const stepEnds = events.filter((event) => event?.type === "step_end" && event.seq > lastPassSeq).length;
  return stepEnds >= tickEvery;
}

async function appendEvent({ loaded, stateRoot, payload }) {
  if (loaded) {
    return loaded.journal.append({
      ...payload,
      run_id: loaded.run?.run_id ?? null,
    });
  }
  const journalPath = join(stateRoot, "journal.ndjson");
  const info = await readJournal(journalPath);
  if (!info.exists || info.errors.length > 0) return null;
  const last = info.events.at(-1) ?? null;
  const writer = new JournalWriter({
    path: journalPath,
    events: info.events,
    prevHash: last?.hash ?? null,
    lastSeq: last?.seq ?? 0,
  });
  return writer.append({
    ...payload,
    run_id: last?.run_id ?? null,
  });
}

export async function runReconcile({
  stateRoot,
  projectRoot,
  designRoot = null,
  libraryRoot = null,
  manifestPath = null,
  packageVersion = "0.0.0",
  trigger = "manual",
  status = null,
  drift = null,
  loaded: providedLoaded = null,
  sessionId = "s-reconcile",
} = {}) {
  const current = await computeFingerprint({
    libraryRoot,
    manifestPath,
    designRoot,
    version: packageVersion,
  });

  let loaded = providedLoaded;
  if (!loaded) {
    try {
      if (await exists(join(stateRoot, "journal.ndjson"))) loaded = await loadRun(stateRoot);
    } catch {
      loaded = null;
    }
  }

  const resolvedStatus = status ?? loaded?.run?.run_status ?? null;
  const blocked = resolvedStatus === "BLOCKED_DRIFT" || resolvedStatus === "HALT_CORRUPT";
  const events = loaded?.journal?.events ?? [];
  const last = lastMeaningfulEvent(events);
  const stateFile = loaded ? null : await readJsonFile(join(stateRoot, "state.json"));
  const generatedAt = loaded?.run?.updated_at ?? stateFile?.value?.updated_at ?? last?.ts ?? "1970-01-01T00:00:00Z";
  const inputFingerprint = {
    journal_head_seq: last?.seq ?? 0,
    plan_checksum: loaded?.plan?.checksum ?? null,
    design_index_sha256: current.design_registry?.index_sha256 ?? null,
    env_fingerprint: {
      skills_lock_sha256: current.skills_lock_sha256,
      library_overrides_sha256: current.library_overrides_sha256,
    },
  };
  const passId = `rec-${sha256Hex(canonicalJson(inputFingerprint)).slice(0, 16)}`;
  const previousQueue = await readJsonFile(join(stateRoot, "work-queue.json"));
  const stale = previousQueue.exists &&
    !previousQueue.error &&
    previousQueue.value?.input_fingerprint &&
    canonicalJson(previousQueue.value.input_fingerprint) !== canonicalJson(inputFingerprint)
    ? {
        pass_id: previousQueue.value.pass_id ?? null,
        mismatched_field: mismatchedField(previousQueue.value.input_fingerprint, inputFingerprint),
      }
    : null;

  let queue;
  let detectorStatus = [];
  let tick = false;
  const unknownReasons = new Map();
  const overrides = readOverrides(events);
  const driftForReport = drift ?? loaded?.run?.drift ?? null;

  if (blocked) {
    const item = blockedCandidate({
      status: resolvedStatus,
      drift: driftForReport,
      seq: inputFingerprint.journal_head_seq,
      ts: generatedAt,
    });
    queue = makeQueue({
      passId,
      generatedAt,
      inputFingerprint,
      status: "blocked_drift",
      queue: [item],
      drift: driftForReport,
    });
  } else {
    const manifest = await loadDetectorManifest(stateRoot);
    tick = tickDue(events, manifest.tickEvery);
    const loadedDesign = designRoot
      ? await loadSurfaces(designRoot, { validate: false })
      : { surfaces: [] };
    const surfaces = new Map(loadedDesign.surfaces.map((surface) => [surface.surface_id, surface]));
    const overridesStale = Boolean(
      loaded?.run?.env_fingerprint?.library_overrides_sha256 &&
      current.library_overrides_sha256 &&
      loaded.run.env_fingerprint.library_overrides_sha256 !== current.library_overrides_sha256,
    );

    const rawCandidates = [];
    for (const detector of manifest.detectors) {
      if (!detector.enabled) {
        detectorStatus.push({ id: detector.id, enabled: false, fired: 0, candidates: 0 });
        continue;
      }
      const runner = DETECTOR_RUNNERS[detector.id];
      if (!runner) {
        detectorStatus.push({ id: detector.id, enabled: true, fired: 0, candidates: 0, skipped: "not_implemented" });
        continue;
      }
      try {
        const produced = await runner({
          plan: loaded?.plan ?? null,
          tasks: loaded?.tasks ?? [],
          events,
          surfaces: [...surfaces.values()],
          designRoot,
          projectRoot,
          libraryRoot,
          manifestPath,
          overridesStale,
          lastSeq: inputFingerprint.journal_head_seq,
          lastTs: last?.ts ?? generatedAt,
          params: detector.params,
        });
        for (const raw of produced) {
          if (!isKnownReason(raw.reason)) {
            unknownReasons.set(`${raw.reason}:${detector.id}`, { reason: raw.reason, detector: detector.id });
          }
        }
        rawCandidates.push(...produced);
        detectorStatus.push({ id: detector.id, enabled: true, fired: produced.length > 0 ? 1 : 0, candidates: produced.length });
      } catch (error) {
        detectorStatus.push({
          id: detector.id,
          enabled: true,
          fired: 0,
          candidates: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const queueItems = [];
    for (const group of groupCandidates(rawCandidates)) {
      queueItems.push(await buildCandidate(group, {
        plan: loaded?.plan ?? null,
        tasks: loaded?.tasks ?? [],
        surfaces,
        libraryRoot,
        manifestPath,
        shadowConflict: overridesStale,
      }));
    }

    for (const candidate of queueItems) {
      if (overrides.applied.has(candidate.candidate_id)) {
        candidate.priority = overrides.applied.get(candidate.candidate_id);
      }
    }

    const stall = stalledInfo(queueItems, surfaces);
    queueItems.sort(compareCandidates);
    const queueStatus = queueItems.length === 0 || stall ? "no_work" : "ready";
    queue = makeQueue({
      passId,
      generatedAt,
      inputFingerprint,
      status: queueStatus,
      queue: queueItems,
      stalled: Boolean(stall),
      blockingSet: stall?.blocking_set ?? [],
    });
  }

  const queuePath = join(stateRoot, "work-queue.json");
  const reportPath = join(stateRoot, "reconcile-report.md");
  await atomicWriteFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
  await atomicWriteFile(reportPath, renderReport({ queue, detectorStatus, tick }));

  const emitted = [];
  const passEvent = await appendEvent({
    loaded,
    stateRoot,
    payload: {
      type: "reconcile_pass",
      session_id: sessionId,
      trigger,
      pass_id: queue.pass_id,
      input_fingerprint: queue.input_fingerprint,
      candidate_count: queue.summary.total,
      ready_count: queue.summary.ready,
      head_candidate_id: queue.queue[0]?.candidate_id ?? null,
      status: queue.status,
      queue_status: queue.status,
      stalled: Boolean(queue.stalled),
      tick,
      reconcile: true,
    },
  });
  emitted.push(passEvent);

  if (stale) {
    emitted.push(await appendEvent({
      loaded,
      stateRoot,
      payload: {
        type: "queue_stale",
        session_id: sessionId,
        pass_id: stale.pass_id,
        mismatched_field: stale.mismatched_field,
        reconcile: true,
      },
    }));
  }
  for (const entry of unknownReasons.values()) {
    emitted.push(await appendEvent({
      loaded,
      stateRoot,
      payload: {
        type: "unknown_reason",
        session_id: sessionId,
        reason: entry.reason,
        detector: entry.detector,
        reconcile: true,
      },
    }));
  }
  for (const rejection of overrides.rejected) {
    emitted.push(await appendEvent({
      loaded,
      stateRoot,
      payload: {
        type: "priority_override_rejected",
        session_id: sessionId,
        ...rejection,
        reconcile: true,
      },
    }));
  }

  const head = queue.queue[0] ?? null;
  if (queue.status === "blocked_drift" && head) {
    emitted.push(await appendEvent({
      loaded,
      stateRoot,
      payload: {
        type: "escalation",
        session_id: sessionId,
        reason: "drift",
        candidate_id: head.candidate_id,
        reconcile: true,
      },
    }));
  } else if (queue.status === "no_work") {
    if (queue.stalled) {
      emitted.push(await appendEvent({
        loaded,
        stateRoot,
        payload: {
          type: "run_stalled",
          session_id: sessionId,
          blocking_set: queue.summary.blocking_set ?? [],
          reconcile: true,
        },
      }));
    } else if (loaded?.plan && loaded.plan.tasks.length > 0 && allTasksDone(loaded.plan, loaded.tasks) && !loaded.run.completed_at) {
      emitted.push(await appendEvent({
        loaded,
        stateRoot,
        payload: {
          type: "run_complete",
          session_id: sessionId,
          reconcile: true,
        },
      }));
    }
  } else if (head) {
    if (!head.ready && head.blocked_by.length > 0) {
      emitted.push(await appendEvent({
        loaded,
        stateRoot,
        payload: {
          type: "queue_blocked",
          session_id: sessionId,
          candidate_id: head.candidate_id,
          blocked_by: head.blocked_by,
          reconcile: true,
        },
      }));
    }
    if (head.resolution_source === "needs_review") {
      emitted.push(await appendEvent({
        loaded,
        stateRoot,
        payload: {
          type: "escalation",
          session_id: sessionId,
          reason: "shadow_conflict",
          candidate_id: head.candidate_id,
          reconcile: true,
        },
      }));
    }
  }

  if (loaded) {
    // Replay all new events so the state model carries reconcile, then write
    // state.json only. plan.json is owned by the plan and is never rewritten.
    refreshLoaded(loaded);
    loaded.run.reconcile = queue.status === "ready" ? "ready" : queue.status === "no_work" ? "no_work" : "blocked_drift";
    loaded.run.stalled = Boolean(queue.stalled);
    loaded.run.journal_head = loaded.journal.head;
    if (queue.stalled) loaded.run.stalled = true;
    await writeState(loaded.paths.root, loaded.run);
  }

  return {
    ok: true,
    status: queue.status,
    passId: queue.pass_id,
    queue,
    queuePath,
    reportPath,
    head,
    detectorStatus,
    event: passEvent,
    events: emitted.filter(Boolean),
    tick,
    stale,
    overridesRejected: overrides.rejected,
  };
}
