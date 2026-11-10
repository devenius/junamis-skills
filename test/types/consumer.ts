// Consumer contract check.
//
// This file is compiled (never executed and never built) by
// `tsc -p tsconfig.types.json`. It imports only from the built package entry
// `dist/index.js`, so it proves the declarations a consumer actually gets:
// the types, the guards, and the strictness. A failure here means the package
// changed its public shape without updating the contract.
//
// Run `pnpm build` before `pnpm typecheck`.

import {
  assertNever,
  errorMessage,
  isOneOf,
  isRecord,
  isString,
  isStringArray,
  parseJsonUnknown,
  type Artifact,
  type ArtifactKind,
  type BootResult,
  type Candidate,
  type CandidateReason,
  type CommandResult,
  type DesignDelta,
  type DesignFingerprint,
  type DesignSurface,
  type DetectorManifest,
  type EnvFingerprint,
  type ErrorLike,
  type Finding,
  type Handoff,
  type HandoffStatus,
  type JournalEvent,
  type JsonObject,
  type JsonValue,
  type Lease,
  type OrchestratorContext,
  type PlanSnapshot,
  type PlanTask,
  type PriorityOverride,
  type QueueSummary,
  type Result,
  type RunStatus,
  type Severity,
  type StateSnapshot,
  type TaskRecord,
  type TaskStatus,
  type WorkQueue,
} from "../../dist/index.js";

const HANDOFF_STATUSES = ["complete", "blocked", "needs-decision", "failed"] as const;
const HANDOFF_ARTIFACT_KINDS = ["created", "updated", "read-only"] as const;

function artifactFrom(value: unknown): Artifact | null {
  if (!isRecord(value)) return null;
  const path = value["path"];
  const kind = value["kind"];
  if (!isString(path) || !isOneOf(kind, HANDOFF_ARTIFACT_KINDS)) return null;
  const artifactKind: ArtifactKind = kind;
  return { path, kind: artifactKind };
}

function findingFrom(value: unknown): Finding | null {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const severity = value["severity"];
  const summary = value["summary"];
  const evidence = value["evidence"];
  if (!isString(id) || !isOneOf(severity, ["critical", "high", "medium", "low"]) || !isString(summary) || !isString(evidence)) {
    return null;
  }
  const typed: Severity = severity;
  return { id, severity: typed, summary, evidence };
}

/** Narrow external input to the HANDOFF contract. */
export function handoffFrom(value: unknown): Handoff | null {
  if (!isRecord(value)) return null;
  const agent = value["agent"];
  const job = value["job"];
  const status = value["status"];
  const next = value["next"];
  if (!isString(agent) || !isString(job) || !isOneOf(status, HANDOFF_STATUSES) || !isString(next)) return null;

  const rawArtifacts = value["artifacts"];
  if (!Array.isArray(rawArtifacts)) return null;
  const artifacts: Artifact[] = [];
  for (const entry of rawArtifacts) {
    const artifact = artifactFrom(entry);
    if (!artifact) return null;
    artifacts.push(artifact);
  }

  const rawFindings = value["findings"] ?? [];
  if (!Array.isArray(rawFindings)) return null;
  const findings: Finding[] = [];
  for (const entry of rawFindings) {
    const finding = findingFrom(entry);
    if (!finding) return null;
    findings.push(finding);
  }

  const decisions = value["decisions_owed"] ?? [];
  if (!isStringArray(decisions)) return null;

  const handoffStatus: HandoffStatus = status;
  return { agent, job, status: handoffStatus, artifacts, findings, decisions_owed: decisions, next };
}

export function handoffAction(status: HandoffStatus): string {
  switch (status) {
    case "complete":
      return "continue";
    case "blocked":
      return "stop";
    case "needs-decision":
      return "ask";
    case "failed":
      return "stop";
    default:
      return assertNever(status, "unknown handoff status");
  }
}

const candidate: Candidate = {
  candidate_id: "cand-0000000000000000",
  capability: "develop",
  target: { kind: "task", id: "T-001" },
  reason: "plan_pending" satisfies CandidateReason,
  priority: "p2",
  severity: "medium",
  effort: "unknown",
  ready: true,
  blocked_by: [],
  resolved_skill: "library/develop",
  resolution_source: "internal_override",
  provenance: [{ detector: "plan_pending", at_seq: 1, at_ts: "2026-11-10T00:00:00Z" }],
  rationale: "plan task T-001 is pending",
  plan_position: 0,
};

const summary: QueueSummary = {
  total: 1,
  ready: 1,
  blocked: 0,
  needs_review: 0,
  by_priority: { p0: 0, p1: 0, p2: 1, p3: 0 },
};

const queue: WorkQueue = {
  schema_version: 1,
  pass_id: "rec-0000000000000000",
  generated_at: "2026-11-10T00:00:00Z",
  input_fingerprint: {
    journal_head_seq: 1,
    plan_checksum: null,
    design_index_sha256: null,
    env_fingerprint: { skills_lock_sha256: null, library_overrides_sha256: null },
  },
  status: "ready",
  summary,
  queue: [candidate],
};

const planTask: PlanTask = {
  task_id: "T-001",
  capability: "develop",
  depends_on: [],
  resolved_skill: "library/develop",
  resolution_source: "internal_override",
  owner: "orchestrator",
  adapter: null,
  idempotent: true,
  inputs_hash: "sha256:0",
};

const plan: PlanSnapshot = {
  schema_version: 1,
  run_id: "run-20261110-000000",
  created_at: "2026-11-10T00:00:00Z",
  env_fingerprint: null,
  capabilities: ["develop"],
  tasks: [planTask],
  checksum: "sha256:0",
};

const task: TaskRecord = {
  schema_version: 1,
  task_id: "T-001",
  capability: "develop",
  status: "pending" satisfies TaskStatus,
  resolved_skill: "library/develop",
  resolution_source: "internal_override",
  owner: "orchestrator",
  adapter: null,
  current_step: null,
  inputs_hash: "sha256:0",
  outputs: [],
  attempt: 0,
  updated_at: "2026-11-10T00:00:00Z",
};

const event: JournalEvent = {
  seq: 1,
  ts: "2026-11-10T00:00:00Z",
  type: "run_start",
  run_id: "run-20261110-000000",
  session_id: "s-contract",
  prev_hash: null,
  hash: "sha256:0",
  run_status: "NEW_RUN",
};

const designFingerprint: DesignFingerprint = {
  index_sha256: "sha256:0",
  surface_count: 1,
  status_counts: { active: 1, draft: 0, deprecated: 0, needs_review: 0 },
};

const fingerprint: EnvFingerprint = {
  skills_lock_sha256: null,
  library_overrides_sha256: null,
  library_overrides_files: null,
  design_registry: designFingerprint,
  design_registry_files: null,
  orchestrator_version: "1.0.0",
  handoff_schema_version: 1,
  library_root: null,
  manifest_path: null,
};

const state: StateSnapshot = {
  schema_version: 1,
  run_id: "run-20261110-000000",
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
  run_status: "RESUMING" satisfies RunStatus,
  cursor: null,
  plan: { path: "plan.json", checksum: plan.checksum },
  env_fingerprint: fingerprint,
  tasks_summary: { pending: 1, in_progress: 0, done: 0, failed: 0, needs_review: 0 },
  journal_head: { seq: 1, event_hash: event.hash },
  last_checkpoint: null,
  reconcile: "ready",
};

const surface: DesignSurface = {
  file: "docs/design/api/get-user.md",
  relative: "api/get-user.md",
  surface_id: "api/get-user",
  frontmatter: {
    surface_id: "api/get-user",
    kind: "api",
    status: "active",
    version: "1.0.0",
    owner: "library/develop",
    code_paths: ["src/**"],
    depends_on: [],
    related_tasks: [],
    last_reviewed: "2026-11-10",
    design_checksum: "sha256:0",
  },
  body: "",
  checksum: "sha256:0",
};

const delta: DesignDelta = {
  surface_id: "api/get-user",
  operation: "update",
  base_checksum: "sha256:0",
  sections: [{ section: "Known gaps", action: "append", content: "- None" }],
  code_paths_touched: [],
  rationale: "contract check",
  task_id: "T-001",
  skill: "library/develop",
  idempotent: true,
  bump: "minor",
};

const detectorManifest: DetectorManifest = {
  path: ".orchestrator/reconcile/detectors.yaml",
  created: false,
  detectors: [{ id: "plan_pending", enabled: true, order: 10 }],
  tickEvery: 10,
};

const override: PriorityOverride = {
  candidate_id: candidate.candidate_id,
  from: "p2",
  to: "p0",
  rationale: "blocks release",
  by: "operator",
};

const lease: Lease = {
  session_id: "s-contract",
  pid: 1,
  host: "localhost",
  acquired_at: "2026-11-10T00:00:00Z",
  heartbeat_at: "2026-11-10T00:00:00Z",
  ttl_seconds: 60,
};

const context: OrchestratorContext = {
  projectRoot: "/tmp/project",
  stateRoot: "/tmp/project/.orchestrator",
  sessionId: "s-contract",
  libraryRoot: "/tmp/project/library",
  manifestPath: null,
  designRoot: "/tmp/project/docs/design",
  baseTtl: 60,
  stepTtl: 900,
  allowTmp: false,
  packageVersion: "1.0.0",
  host: "localhost",
  pid: 1,
  json: true,
  quiet: false,
};

const command: CommandResult = {
  status: "RESUMING",
  exitCode: 0,
  runId: state.run_id,
  cursor: state.cursor,
  tasksSummary: state.tasks_summary,
  workQueue: queue,
  queueHead: candidate,
};

const boot: BootResult = {
  status: "RESUMING",
  exitCode: 0,
  halt: null,
  reportPath: "/tmp/project/.orchestrator/resume-report.md",
  run: state,
  plan,
  tasks: [task],
  runId: state.run_id,
  cursor: state.cursor,
  tasksSummary: state.tasks_summary,
  drift: null,
  lease,
  reconciliation: { interrupted: [], retried: [], escalated: [], malformedHandoffs: [] },
  workQueue: queue,
  workQueuePath: "/tmp/project/.orchestrator/work-queue.json",
  reconcileReportPath: "/tmp/project/.orchestrator/reconcile-report.md",
  reconcileStatus: "ready",
  queueHead: candidate,
};

const json: JsonObject = { surface: surface.surface_id, ready: candidate.ready };
const jsonValue: JsonValue = [json, delta.bump, true, null];

const parsed: Result<unknown> = parseJsonUnknown('{"ok":true}');
const parseError: ErrorLike | null = parsed.ok ? null : parsed.error;
const message: string = errorMessage(new Error("boom"));

/** Every exported type above is referenced so the compile proves it exists. */
export const contract = {
  artifact: artifactFrom({ path: "a.md", kind: "created" }),
  handoff: handoffFrom({ agent: "route", job: "j", status: "complete", artifacts: [], next: "none" }),
  handoffAction: handoffAction("complete"),
  queue,
  plan,
  task,
  event,
  fingerprint,
  surface,
  delta,
  detectorManifest,
  override,
  command,
  boot,
  jsonValue,
  parseError,
  message,
  context,
  candidates: summary.by_priority,
} as const;

// The contract stays strict: these would all compile if a field widened to
// `string` or `any`, so the expects prove it did not.
// @ts-expect-error severity is a closed union
const invalidSeverity: Severity = "urgent";
// @ts-expect-error a WorkQueue status is not a RunStatus
const invalidQueueStatus: WorkQueue["status"] = "RESUMING";
// @ts-expect-error snapshot fields are readonly
state.run_id = "run-other";

export { invalidSeverity, invalidQueueStatus };
