// Command line parser, dispatcher, and stdout contract.

import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PACKAGE_ROOT } from "../guide.js";
import {
  checkpoint,
  end,
  finish,
  leaseAcquire,
  leaseHeartbeat,
  leaseRelease,
  leaseStatus,
  planSet,
  planShow,
  resolveTask,
  start,
  status,
} from "./commands.js";
import { boot } from "./boot.js";
import { driftSummary } from "./drift.js";
import { EXIT, OrchestratorError, UsageError } from "./errors.js";
import { expandHome } from "./fsx.js";

const HELP = `junamis-orchestrator

Usage:
  junamis-orchestrator boot [common]
  junamis-orchestrator plan set --file <plan.json> [--replace] [common]
  junamis-orchestrator plan show [common]
  junamis-orchestrator start --task <task_id> [common]
  junamis-orchestrator end --task <task_id> --step <step_id> --handoff <path> [common]
  junamis-orchestrator end --task <task_id> --step <step_id> --status failed --reason <text> [common]
  junamis-orchestrator resolve --task <task_id> --decision <text> [common]
  junamis-orchestrator status [common]
  junamis-orchestrator checkpoint [common]
  junamis-orchestrator lease acquire|heartbeat|release|status [common]
  junamis-orchestrator finish [common]

Common options:
  --project <dir>        Project root (default: ORCH_PROJECT_ROOT, then cwd)
  --state-root <dir>     State root (default: ORCH_STATE_ROOT, then <project>/.orchestrator)
  --session <id>         Session id (default: ORCH_SESSION_ID, then s- plus 8 hex)
  --library-root <dir>   Directory containing skills/ and agents/
  --manifest <path>      skills-lock.json path
  --json                 Emit exactly one JSON object on stdout
  --quiet                Suppress human output
  --help                 Print this help

Exit codes: 0 ok, 1 usage or I/O, 2 lease, 3 drift, 4 corrupt state, 5 invalid transition or handoff.
`;

const VALUE_OPTIONS = new Set([
  "--project",
  "--state-root",
  "--session",
  "--library-root",
  "--manifest",
  "--file",
  "--task",
  "--step",
  "--handoff",
  "--status",
  "--reason",
  "--decision",
]);

const FLAG_OPTIONS = new Set(["--json", "--quiet", "--help", "--replace"]);

function parseArgs(argv) {
  if (argv.includes("--help") || argv[0] === "help" || argv.length === 0) {
    return { help: true };
  }
  const options = {
    json: false,
    quiet: false,
    replace: false,
    project: null,
    stateRoot: null,
    session: null,
    libraryRoot: null,
    manifest: null,
    file: null,
    task: null,
    step: null,
    handoff: null,
    status: null,
    reason: null,
    decision: null,
  };

  const first = argv[0];
  let command = first;
  let index = 1;
  if (first === "plan") {
    if (!argv[1]) throw new UsageError("plan needs set or show");
    command = `plan ${argv[1]}`;
    index = 2;
  } else if (first === "lease") {
    if (!argv[1]) throw new UsageError("lease needs acquire, heartbeat, release, or status");
    command = `lease ${argv[1]}`;
    index = 2;
  }
  const known = new Set([
    "boot",
    "plan set",
    "plan show",
    "start",
    "end",
    "resolve",
    "status",
    "checkpoint",
    "lease acquire",
    "lease heartbeat",
    "lease release",
    "lease status",
    "finish",
  ]);
  if (!known.has(command)) throw new UsageError(`unknown command ${JSON.stringify(command)}`);

  for (let i = index; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAG_OPTIONS.has(arg)) {
      if (arg === "--json") options.json = true;
      else if (arg === "--quiet") options.quiet = true;
      else if (arg === "--replace") options.replace = true;
      else return { help: true };
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      i += 1;
      const key = arg === "--state-root"
        ? "stateRoot"
        : arg === "--library-root"
          ? "libraryRoot"
          : arg.slice(2);
      options[key] = value;
      continue;
    }
    throw new UsageError(`unexpected argument ${JSON.stringify(arg)}`);
  }
  return { command, options };
}

function positiveInteger(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

function resolveConfig(raw, base) {
  if (!raw) return null;
  const expanded = expandHome(raw);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

export function resolveContext(options, { env = process.env, cwd = process.cwd() } = {}) {
  const projectRoot = resolveConfig(options.project ?? env.ORCH_PROJECT_ROOT, cwd) ?? cwd;
  const stateRoot =
    resolveConfig(options.stateRoot ?? env.ORCH_STATE_ROOT, projectRoot) ??
    join(projectRoot, ".orchestrator");

  const sessionId = options.session ?? env.ORCH_SESSION_ID ?? `s-${randomBytes(4).toString("hex")}`;
  if (!/^s-[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new UsageError(`invalid session id ${JSON.stringify(sessionId)}; expected s- followed by letters, digits, dot, underscore, or dash`);
  }

  let libraryRoot = resolveConfig(options.libraryRoot ?? env.ORCH_LIBRARY_ROOT, projectRoot);
  if (!libraryRoot) {
    const projectLibrary = join(projectRoot, "library");
    if (existsSync(projectLibrary)) {
      libraryRoot = projectLibrary;
    } else {
      const installed = join(homedir(), ".config", "junamis", "skills");
      if (existsSync(join(installed, "skills")) || existsSync(join(installed, "agents"))) {
        libraryRoot = installed;
      }
    }
  }

  let manifestPath = resolveConfig(options.manifest ?? env.ORCH_MANIFEST, projectRoot);
  if (!manifestPath) {
    const projectManifest = join(projectRoot, "skills-lock.json");
    if (existsSync(projectManifest)) {
      manifestPath = projectManifest;
    } else {
      const installed = join(homedir(), ".config", "junamis", "skills", "skills-lock.json");
      manifestPath = existsSync(installed) ? installed : null;
    }
  }

  return {
    projectRoot,
    stateRoot,
    sessionId,
    libraryRoot,
    manifestPath,
    baseTtl: positiveInteger(env.ORCH_LEASE_TTL_SECONDS, 60),
    stepTtl: positiveInteger(env.ORCH_STEP_TTL_SECONDS, 900),
    allowTmp: env.ORCH_TEST_ALLOW_TMP === "1",
    packageVersion: packageVersion(),
    host: hostname(),
    pid: process.pid,
    json: options.json,
    quiet: options.quiet,
  };
}

async function dispatch(command, options, ctx) {
  switch (command) {
    case "boot":
      return boot(ctx);
    case "plan set":
      return planSet(ctx, { file: options.file, replace: options.replace });
    case "plan show":
      return planShow(ctx);
    case "start":
      return start(ctx, { taskId: options.task });
    case "end":
      return end(ctx, {
        taskId: options.task,
        stepId: options.step,
        handoff: options.handoff,
        status: options.status,
        reason: options.reason,
      });
    case "resolve":
      return resolveTask(ctx, { taskId: options.task, decision: options.decision });
    case "status":
      return status(ctx);
    case "checkpoint":
      return checkpoint(ctx);
    case "lease acquire":
      return leaseAcquire(ctx);
    case "lease heartbeat": {
      const value = await leaseHeartbeat(ctx);
      return {
        status: value.status,
        exitCode: 0,
        lease: value.lease,
        run: null,
        plan: null,
        tasks: [],
        runId: null,
        cursor: null,
        tasksSummary: null,
        drift: null,
        reportPath: null,
        reconciliation: null,
      };
    }
    case "lease release": {
      const value = await leaseRelease(ctx);
      return {
        status: value.status,
        exitCode: 0,
        lease: value.lease,
        loaded: value.loaded,
        run: value.loaded?.run ?? null,
        plan: value.loaded?.plan ?? null,
        tasks: value.loaded?.tasks ?? [],
        runId: value.loaded?.run?.run_id ?? null,
        cursor: value.loaded?.run?.cursor ?? null,
        tasksSummary: value.loaded?.run?.tasks_summary ?? null,
        drift: null,
        reportPath: null,
        reconciliation: null,
      };
    }
    case "lease status": {
      const value = await leaseStatus(ctx);
      return {
        status: value.status,
        exitCode: 0,
        lease: value.leases,
        leases: value.leases,
        run: null,
        plan: null,
        tasks: [],
        runId: null,
        cursor: null,
        tasksSummary: null,
        drift: null,
        reportPath: null,
        reconciliation: null,
      };
    }
    case "finish":
      return finish(ctx);
    default:
      throw new UsageError(`unknown command ${command}`);
  }
}

function summaryLine(summary) {
  if (!summary) return "none";
  return Object.entries(summary)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function emitHuman(command, res, ctx) {
  const lines = [];
  switch (command) {
    case "boot":
      lines.push(`run: ${res.runId ?? "unknown"}`);
      lines.push(`session: ${ctx.sessionId}`);
      lines.push(`cursor: ${res.cursor?.task_id ?? "none"}`);
      lines.push(`lease: ${res.leaseAction ?? res.lease?.action ?? "held"}`);
      if (res.drift && !res.drift.match) lines.push("drift: detected");
      lines.push(`status: ${res.status}`);
      lines.push(`report: ${res.reportPath}`);
      break;
    case "plan set":
      lines.push(`plan: ${res.checksum}`);
      lines.push(`tasks: ${res.plan.tasks.length}`);
      lines.push(`status: ${res.status}`);
      break;
    case "plan show":
      lines.push(`plan: ${res.checksum ?? "none"}`);
      lines.push(`tasks: ${res.plan?.tasks?.length ?? 0}`);
      for (const task of res.plan?.tasks ?? []) {
        lines.push(`task: ${task.task_id} ${task.capability} -> ${task.resolved_skill}`);
      }
      break;
    case "start":
      lines.push(`task: ${res.task}`);
      lines.push(`step: ${res.step}`);
      lines.push(`attempt: ${res.attempt}`);
      lines.push(`idempotent: ${res.idempotent}`);
      lines.push("status: started");
      break;
    case "end":
      lines.push(`task: ${res.task}`);
      lines.push(`step: ${res.step}`);
      lines.push(`status: ${res.status}`);
      lines.push(`handoff: ${res.handoff ?? "none"}`);
      lines.push(`next: ${res.next}`);
      break;
    case "resolve":
      lines.push(`task: ${res.task}`);
      lines.push(`decision: ${res.decision}`);
      lines.push("status: pending");
      break;
    case "status":
      lines.push(`run: ${res.runId ?? "none"}`);
      lines.push(`status: ${res.status}`);
      lines.push(`cursor: ${res.cursor?.task_id ?? "none"}`);
      lines.push(`tasks: ${summaryLine(res.tasksSummary)}`);
      lines.push(`lease: ${(res.leases ?? []).map((lease) => `${lease.session_id ?? "invalid"}:${lease.live ? "live" : "stale"}`).join(",") || "none"}`);
      lines.push(`drift: ${res.drift && !res.drift.match ? "detected" : "none"}`);
      lines.push(`checkpoint: ${res.checkpoint ?? "none"}`);
      lines.push(`journal: seq=${res.journalHead?.seq ?? 0}`);
      lines.push(`report: ${res.reportPath}`);
      break;
    case "checkpoint":
      lines.push(`checkpoint: ${res.path}`);
      lines.push(`seq: ${res.seq}`);
      lines.push(`journal: seq=${res.run?.journal_head?.seq ?? 0}`);
      lines.push("status: checkpointed");
      break;
    case "lease acquire":
      lines.push(`lease: ${res.action}`);
      lines.push(`session: ${ctx.sessionId}`);
      lines.push(`ttl: ${res.lease?.ttl_seconds ?? "unknown"}`);
      break;
    case "lease heartbeat":
      lines.push("lease: renewed");
      lines.push(`session: ${ctx.sessionId}`);
      lines.push(`heartbeat: ${res.lease?.heartbeat_at ?? "unknown"}`);
      break;
    case "lease release":
      lines.push("lease: released");
      lines.push(`session: ${ctx.sessionId}`);
      break;
    case "lease status": {
      const leases = res.leases ?? [];
      if (leases.length === 0) lines.push("lease: none");
      for (const lease of leases) {
        lines.push(
          `lease: ${lease.session_id ?? "invalid"} ${lease.live ? "live" : "stale"} owner=${lease.pid ?? "unknown"} heartbeat=${lease.heartbeat_at ?? "unknown"} ttl=${lease.ttl_seconds ?? "unknown"}`,
        );
      }
      break;
    }
    case "finish":
      lines.push(`run: ${res.runId ?? "unknown"}`);
      lines.push("status: COMPLETE");
      lines.push(`report: ${res.reportPath}`);
      break;
    default:
      break;
  }
  if (!ctx.quiet && lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

function jsonResult(command, res, ctx, error) {
  const resolved = res ?? {};
  const drift = resolved.drift ? driftSummary(resolved.drift) : null;
  const out = {
    ok: !error && (resolved.exitCode ?? 0) === 0,
    command,
    status: resolved.status ?? null,
    exitCode: error?.exitCode ?? resolved.exitCode ?? 0,
    runId: resolved.runId ?? resolved.run?.run_id ?? null,
    sessionId: ctx?.sessionId ?? null,
    projectRoot: ctx?.projectRoot ?? null,
    stateRoot: ctx?.stateRoot ?? null,
    reportPath: resolved.reportPath ?? null,
    cursor: resolved.cursor ?? resolved.run?.cursor ?? null,
    tasksSummary: resolved.tasksSummary ?? resolved.run?.tasks_summary ?? null,
    drift,
    lease: resolved.lease ?? resolved.leases ?? null,
    error: error
      ? {
          reason: error.code ?? "error",
          detail: error.detail ?? error.message,
          halt: error.halt ?? null,
        }
      : null,
  };
  for (const key of ["task", "step", "attempt", "idempotent", "handoff", "next", "checksum", "plan", "leases", "checkpoint", "journalHead", "path", "seq", "action"]) {
    if (resolved[key] !== undefined) out[key] = resolved[key];
  }
  return out;
}

export async function run(argv, { env = process.env, cwd = process.cwd() } = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    const wantsJson = argv.includes("--json");
    return finishWithError(error, wantsJson, null, null);
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return EXIT.OK;
  }

  let ctx;
  try {
    ctx = resolveContext(parsed.options, { env, cwd });
  } catch (error) {
    return finishWithError(error, parsed.options.json, null, null);
  }

  try {
    const res = await dispatch(parsed.command, parsed.options, ctx);
    const exitCode = res?.exitCode ?? EXIT.OK;
    if (ctx.json) {
      process.stdout.write(`${JSON.stringify(jsonResult(parsed.command, res, ctx, null))}\n`);
    } else {
      emitHuman(parsed.command, res, ctx);
    }
    if (exitCode !== 0) {
      if (ctx.json) {
        // The single JSON object already carries the halt in status/error.
      } else {
        if (res?.halt) process.stderr.write(`halt: ${res.halt}\n`);
        if (res?.reportPath) process.stderr.write(`report: ${res.reportPath}\n`);
      }
    }
    process.exitCode = exitCode;
    return exitCode;
  } catch (error) {
    return finishWithError(error, ctx.json, ctx, parsed.command);
  }
}

function finishWithError(error, json, ctx, command) {
  const typed = error instanceof OrchestratorError
    ? error
    : new OrchestratorError(error?.message ?? String(error), { code: "unexpected", exitCode: EXIT.ERROR });
  const exitCode = typed.exitCode ?? EXIT.ERROR;
  if (json) {
    process.stdout.write(`${JSON.stringify(jsonResult(command, null, ctx, typed))}\n`);
  } else {
    if (typed.halt) {
      process.stderr.write(`halt: ${typed.halt}\n`);
      if (typed.detail?.owner) process.stderr.write(`owner: ${typed.detail.owner}\n`);
    } else {
      process.stderr.write(`error: ${typed.code ?? "error"}: ${typed.message}\n`);
    }
  }
  process.exitCode = exitCode;
  return exitCode;
}
