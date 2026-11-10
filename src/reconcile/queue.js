// RECONCILE pass A: detectors, dedupe, resolution, dependency closure,
// scoring, and deterministic work-queue emission.
//
// This module never writes the design registry or plan.json. It reads state,
// journal, plan, design surfaces, and the detector manifest, then writes
// work-queue.json, reconcile-report.md, and one reconcile_pass journal event.

import { join } from "node:path";
import { atomicWriteFile, exists, readJsonFile } from "../orchestrator/fsx.js";
import { computeFingerprint } from "../orchestrator/drift.js";
import { canonicalJson, sha256Hex } from "../orchestrator/hash.js";
import { JournalWriter, readJournal } from "../orchestrator/journal.js";
import { renderDrift } from "../orchestrator/report.js";
import { loadRun, refreshLoaded } from "../orchestrator/store.js";
import { writeState } from "../orchestrator/state.js";
import { loadSurfaces } from "../design/schema.js";
import { DETECTOR_RUNNERS } from "./detectors.js";
import { loadDetectorManifest } from "./manifest.js";
import { compareCandidates, reasonWeight, score } from "./score.js";

const CAPABILITY_RE = /^[a-z0-9][a-z0-9-]*$/;

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

function lastMeaningfulEvent(events) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== "reconcile_pass") return event ?? null;
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
      groups.set(key, { primary: raw, rationales: [raw.rationale], provenance: [...raw.provenance] });
      continue;
    }
    const group = groups.get(key);
    mergeProvenance(group.provenance, raw.provenance);
    if (raw.rationale && !group.rationales.includes(raw.rationale)) group.rationales.push(raw.rationale);
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
  }
  if (candidate.target.kind === "surface") {
    const surface = surfaces.get(candidate.target.id);
    for (const dep of surface?.frontmatter?.depends_on ?? []) {
      const dependency = surfaces.get(dep);
      if (dependency && dependency.frontmatter?.status !== "active") blockers.push(dep);
    }
  }
  return blockers;
}

async function buildCandidate(group, { plan, tasks, surfaces, libraryRoot, manifestPath, shadowConflict }) {  const primary = group.primary;
  const resolved = await resolveSkill({
    capability: primary.capability,
    libraryRoot,
    manifestPath,
  });
  const blockers = blockersFor(primary, { plan, tasks, surfaces });
  const { priority } = score({ reason: primary.reason, severity: primary.severity });
  return {
    candidate_id: candidateId(primary.target, primary.reason),
    capability: primary.capability,
    target: primary.target,
    reason: primary.reason,
    priority,
    severity: primary.severity,
    effort: "unknown",
    ready: blockers.length === 0,
    blocked_by: blockers,
    resolved_skill: resolved.resolved_skill,
    resolution_source: resolved.resolution_source,
    provenance: group.provenance,
    rationale: [
      ...group.rationales,
      ...(shadowConflict ? ["shadow conflict: library overrides changed"] : []),
    ].filter(Boolean).join(" · "),
    plan_position: primary.reason === "plan_pending" && Number.isInteger(primary.plan_position)
      ? primary.plan_position
      : null,
    ...(shadowConflict ? { shadow_conflict: true } : {}),
  };
}

function summaryFor(queue) {
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
  return { total: queue.length, ready, blocked, needs_review: needsReview, by_priority: byPriority };
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

function makeQueue({ passId, generatedAt, inputFingerprint, status, queue, drift }) {
  return {
    schema_version: 1,
    pass_id: passId,
    generated_at: generatedAt,
    input_fingerprint: inputFingerprint,
    status,
    summary: summaryFor(queue),
    queue,
    ...(status === "blocked_drift" ? { drift: drift ?? null } : {}),
  };
}

function renderReport({ queue, detectorStatus }) {
  const lines = [
    "# Reconcile Report",
    "",
    `- Pass: ${queue.pass_id}`,
    `- Generated: ${queue.generated_at}`,
    `- Status: ${queue.status}`,
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
  let queue;
  let detectorStatus = [];
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
          designRoot,
          projectRoot,
          lastSeq: inputFingerprint.journal_head_seq,
          lastTs: last?.ts ?? generatedAt,
          params: detector.params,
        });
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

    const loadedDesign = designRoot
      ? await loadSurfaces(designRoot, { validate: false })
      : { surfaces: [] };
    const surfaces = new Map(loadedDesign.surfaces.map((surface) => [surface.surface_id, surface]));
    const shadowConflict = Boolean(
      loaded?.run?.env_fingerprint?.library_overrides_sha256 &&
      current.library_overrides_sha256 &&
      loaded.run.env_fingerprint.library_overrides_sha256 !== current.library_overrides_sha256,
    );
    const queueItems = [];
    for (const group of groupCandidates(rawCandidates)) {
      queueItems.push(await buildCandidate(group, {
        plan: loaded?.plan ?? null,
        tasks: loaded?.tasks ?? [],
        surfaces,
        libraryRoot,
        manifestPath,
        shadowConflict,
      }));
    }
    queueItems.sort(compareCandidates);
    const queueStatus = queueItems.length === 0 ? "no_work" : "ready";
    queue = makeQueue({
      passId,
      generatedAt,
      inputFingerprint,
      status: queueStatus,
      queue: queueItems,
    });
  }

  const queuePath = join(stateRoot, "work-queue.json");
  const reportPath = join(stateRoot, "reconcile-report.md");
  await atomicWriteFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
  await atomicWriteFile(reportPath, renderReport({ queue, detectorStatus }));

  const event = await appendEvent({
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
      queue_status: queue.status,
    },
  });

  if (loaded) {
    // Replay the new event so the state model carries reconcile, then write
    // state.json only. plan.json is owned by the plan and is never rewritten.
    refreshLoaded(loaded);
    loaded.run.reconcile = queue.status === "ready" ? "ready" : queue.status === "no_work" ? "no_work" : "blocked_drift";
    loaded.run.journal_head = loaded.journal.head;
    await writeState(loaded.paths.root, loaded.run);
  }

  return {
    ok: true,
    status: queue.status,
    passId: queue.pass_id,
    queue,
    queuePath,
    reportPath,
    head: queue.queue[0] ?? null,
    detectorStatus,
    event,
  };
}
