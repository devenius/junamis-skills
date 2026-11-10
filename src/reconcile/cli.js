// Command line entry for one RECONCILE pass.
//
// It does not dispatch a skill. It reads durable state and writes the queue,
// report, and one reconcile_pass journal event.

import { resolveContext } from "../orchestrator/cli.js";
import { UsageError } from "../orchestrator/errors.js";
import { runReconcile } from "./queue.js";

const HELP = `junamis-reconcile

Usage:
  junamis-reconcile pass [--trigger <name>] [common]

Common options:
  --project <dir>       Project root (default: cwd)
  --state-root <dir>    State root (default: ORCH_STATE_ROOT, then <project>/.orchestrator)
  --design-root <dir>   Design registry root (default: <project>/docs/design)
  --library-root <dir>  Directory containing skills/ and agents/
  --manifest <path>     skills-lock.json path
  --json                Emit exactly one JSON object on stdout
  --quiet               Suppress human output
  --help                Print this help
`;

const VALUE_OPTIONS = new Set(["--project", "--state-root", "--design-root", "--library-root", "--manifest", "--trigger"]);
const FLAG_OPTIONS = new Set(["--json", "--quiet", "--help"]);

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv[0] === "help") return { help: true };
  const command = argv[0];
  if (command !== "pass") throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  const options = {
    json: false,
    quiet: false,
    project: null,
    stateRoot: null,
    designRoot: null,
    libraryRoot: null,
    manifest: null,
    trigger: "manual",
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAG_OPTIONS.has(arg)) {
      if (arg === "--json") options.json = true;
      else if (arg === "--quiet") options.quiet = true;
      else return { help: true };
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      i += 1;
      const key = arg === "--state-root"
        ? "stateRoot"
        : arg === "--design-root"
          ? "designRoot"
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

function emit(command, ctx, result) {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command,
      status: result.status,
      pass_id: result.passId,
      queue_path: result.queuePath,
      report_path: result.reportPath,
      summary: result.queue.summary,
      head: result.head,
    })}\n`);
    return;
  }
  if (ctx.quiet) return;
  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`pass: ${result.passId}\n`);
  process.stdout.write(`queue: ${result.queuePath}\n`);
  process.stdout.write(`report: ${result.reportPath}\n`);
  process.stdout.write(`head: ${result.head?.candidate_id ?? "none"}\n`);
}

export async function run(argv, { env = process.env, cwd = process.cwd() } = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return finishWithError(error, argv.includes("--json"), null, null);
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  let ctx;
  try {
    ctx = resolveContext(parsed.options, { env, cwd });
  } catch (error) {
    return finishWithError(error, parsed.options.json, null, null);
  }
  try {
    const result = await runReconcile({
      stateRoot: ctx.stateRoot,
      projectRoot: ctx.projectRoot,
      designRoot: ctx.designRoot,
      libraryRoot: ctx.libraryRoot,
      manifestPath: ctx.manifestPath,
      packageVersion: ctx.packageVersion,
      trigger: parsed.options.trigger,
      sessionId: ctx.sessionId,
    });
    emit(parsed.command, ctx, result);
    return 0;
  } catch (error) {
    return finishWithError(error, ctx.json, ctx, parsed.command);
  }
}

function finishWithError(error, json, ctx, command) {
  const exitCode = error?.exitCode ?? 1;
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      command,
      error: { code: error?.code ?? "error", message: error?.message ?? String(error) },
      stateRoot: ctx?.stateRoot ?? null,
    })}\n`);
  } else {
    process.stderr.write(`error: ${error?.code ?? "error"}: ${error?.message ?? String(error)}\n`);
  }
  process.exitCode = exitCode;
  return exitCode;
}
