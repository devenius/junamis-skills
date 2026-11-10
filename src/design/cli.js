// Command line interface for the design registry.
//
// The CLI owns stdout and the exit code. The modules own the work. Commands:
// validate, apply, index, drift, bootstrap, load, fingerprint.

import { resolve } from "node:path";
import { isInside, readText, realpathDeep } from "../orchestrator/fsx.js";
import { UsageError, ValidationError } from "./errors.js";
import { validateDesignText, validateRegistry } from "./schema.js";

const HELP = `junamis-design-registry

Usage:
  design-registry validate [<file>] [common]
  design-registry load --surface <surface_id> [common]
  design-registry apply --delta <path> [common]
  design-registry index [--generated-at <iso>] [--write] [common]
  design-registry drift [common]
  design-registry bootstrap [common]
  design-registry fingerprint [common]

Common options:
  --project <dir>       Project root (default: cwd)
  --design-root <dir>   Design root (default: ORCH_DESIGN_ROOT, then <project>/docs/design)
  --state-root <dir>    State root for design events (default: <project>/.orchestrator)
  --now <date>          Override today for deterministic writes (YYYY-MM-DD)
  --json                Emit exactly one JSON object on stdout
  --quiet               Suppress human output
  --help                Print this help
`;

const VALUE_OPTIONS = new Set([
  "--project",
  "--design-root",
  "--state-root",
  "--surface",
  "--delta",
  "--generated-at",
  "--now",
]);

const FLAG_OPTIONS = new Set(["--json", "--quiet", "--help", "--write"]);

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv[0] === "help") return { help: true };
  const command = argv[0];
  const options = {
    json: false,
    quiet: false,
    write: false,
    project: null,
    designRoot: null,
    stateRoot: null,
    surface: null,
    delta: null,
    generatedAt: null,
    now: null,
    rest: [],
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAG_OPTIONS.has(arg)) {
      if (arg === "--json") options.json = true;
      else if (arg === "--quiet") options.quiet = true;
      else if (arg === "--write") options.write = true;
      else return { help: true };
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      i += 1;
      const key = arg === "--design-root" ? "designRoot" : arg === "--state-root" ? "stateRoot" : arg.slice(2);
      options[key] = value;
      continue;
    }
    if (arg.startsWith("--")) throw new UsageError(`unknown option ${JSON.stringify(arg)}`);
    options.rest.push(arg);
  }
  return { command, options };
}

export function resolveContext(options, { env = process.env, cwd = process.cwd() } = {}) {
  const projectRoot = resolve(options.project ?? env.ORCH_PROJECT_ROOT ?? cwd);
  const designRoot = resolve(options.designRoot ?? env.ORCH_DESIGN_ROOT ?? resolve(projectRoot, "docs", "design"));
  const stateRoot = resolve(options.stateRoot ?? env.ORCH_STATE_ROOT ?? resolve(projectRoot, ".orchestrator"));
  return {
    projectRoot,
    designRoot,
    stateRoot,
    json: options.json,
    quiet: options.quiet,
    write: options.write,
    now: options.now ?? null,
    generatedAt: options.generatedAt ?? null,
    surface: options.surface ?? null,
    delta: options.delta ?? null,
    rest: options.rest ?? [],
  };
}

async function validateCommand(ctx) {
  if (ctx.rest.length > 0) {
    const target = resolve(ctx.projectRoot, ctx.rest[0]);
    const realDesign = await realpathDeep(ctx.designRoot);
    const realTarget = await realpathDeep(target);
    const inside = isInside(realDesign, realTarget);
    const result = validateDesignText(await readTarget(target), {      file: target,
      designRoot: inside ? ctx.designRoot : null,
      requireChecksum: true,
    });
    if (!result.ok) throw new ValidationError(`invalid design file ${target}`, { errors: result.errors });
    return { status: "valid", count: 1, files: [target], errors: [] };
  }

  const registry = await validateRegistry(ctx.designRoot);
  if (!registry.ok) {
    const lines = registry.errors.flatMap((entry) => entry.errors.map((error) => `${entry.file}: ${error}`));
    throw new ValidationError(`design registry is invalid (${lines.length} problem(s))`, { errors: lines });
  }
  return { status: "valid", count: registry.count, files: registry.files, errors: [] };
}

async function readTarget(path) {
  return (await readText(path)) ?? "";
}

function emit(command, ctx, result) {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, command, ...result })}\n`);
    return;
  }
  if (ctx.quiet) return;
  if (command === "validate") {
    process.stdout.write(`valid: ${result.count} file(s)\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
  const ctx = resolveContext(parsed.options, { env, cwd });
  try {
    let result;
    switch (parsed.command) {
      case "validate":
        result = await validateCommand(ctx);
        break;
      default:
        throw new UsageError(`unknown command ${JSON.stringify(parsed.command)}`);
    }
    emit(parsed.command, ctx, result);
    return 0;
  } catch (error) {
    return finishWithError(error, ctx.json, ctx, parsed.command);
  }
}

function finishWithError(error, json, ctx, command) {
  const exitCode = error?.exitCode ?? 1;
  const detail = error?.detail ?? null;
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      command,
      error: { code: error?.code ?? "error", message: error?.message ?? String(error), detail },
      designRoot: ctx?.designRoot ?? null,
    })}\n`);
  } else {
    process.stderr.write(`error: ${error?.code ?? "error"}: ${error?.message ?? String(error)}\n`);
    for (const line of detail?.errors ?? []) process.stderr.write(`- ${line}\n`);
  }
  process.exitCode = exitCode;
  return exitCode;
}
