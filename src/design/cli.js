// Command line interface for the design registry.
//
// The CLI owns stdout and the exit code. The modules own the work. Commands:
// validate, apply, index, drift, bootstrap, load, fingerprint.

import { resolve } from "node:path";
import { isInside, readText, realpathDeep } from "../orchestrator/fsx.js";
import { applyDelta } from "./delta.js";
import { runDrift } from "./drift.js";
import { DeltaError, UsageError, ValidationError } from "./errors.js";
import { generateIndex, writeIndex } from "./index-gen.js";
import { readSurface, validateDesignText, validateRegistry } from "./schema.js";

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

async function applyCommand(ctx) {
  if (!ctx.delta) throw new UsageError("apply needs --delta <path>");
  const result = await applyDelta({
    projectRoot: ctx.projectRoot,
    designRoot: ctx.designRoot,
    stateRoot: ctx.stateRoot,
    deltaPath: ctx.delta,
    now: ctx.now,
  });
  if (!result.ok) {
    throw new DeltaError(result.reason ?? "design delta rejected", {
      code: result.code ?? "design_delta_rejected",
      detail: result,
    });
  }
  return result;
}

async function loadCommand(ctx) {
  if (!ctx.surface) throw new UsageError("load needs --surface <surface_id>");
  const surface = await readSurface(ctx.designRoot, ctx.surface);
  if (!surface) throw new ValidationError(`surface ${ctx.surface} does not exist`);
  if (!surface.ok) throw new ValidationError(`surface ${ctx.surface} is invalid`, { errors: surface.errors });
  return {
    surface_id: surface.surfaceId,
    frontmatter: surface.frontmatter,
    checksum: surface.checksum,
    body: surface.body,
  };
}

async function indexCommand(ctx) {
  const result = ctx.write
    ? await writeIndex({ designRoot: ctx.designRoot, generatedAt: ctx.generatedAt })
    : await generateIndex({ designRoot: ctx.designRoot, generatedAt: ctx.generatedAt });
  return {
    path: result.path ?? null,
    generatedAt: result.generatedAt,
    surfaceCount: result.surfaceCount,
    statusCounts: result.statusCounts,
    content: result.content,
  };
}

async function driftCommand(ctx) {
  const result = await runDrift({
    designRoot: ctx.designRoot,
    projectRoot: ctx.projectRoot,
  });
  return { ...result, exitCode: result.ok ? 0 : 1 };
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
  if (command === "apply") {
    process.stdout.write(`surface: ${result.surface_id}\n`);
    process.stdout.write(`status: ${result.unchanged ? "unchanged" : "applied"}\n`);
    if (result.version) process.stdout.write(`version: ${result.version}\n`);
    return;
  }
  if (command === "load") {
    process.stdout.write(`${result.body ?? ""}`);
    return;
  }
  if (command === "index") {
    if (result.path) process.stdout.write(`index: ${result.path}\n`);
    process.stdout.write(result.content ?? "");
    return;
  }
  if (command === "drift") {
    process.stdout.write(`drift: ${result.ok ? "none" : "detected"}\n`);
    process.stdout.write(`code: ${result.code.length}\n`);
    process.stdout.write(`dependency: ${result.dependency.length}\n`);
    process.stdout.write(
      `coverage: overlaps ${result.coverage.overlaps.length}, unclaimed ${result.coverage.unclaimed.length}, enforced ${result.coverage.enforced}\n`,
    );
    for (const flag of [...result.code, ...result.dependency]) {
      process.stdout.write(`- ${flag.type} ${flag.surface_id}${flag.files ? `: ${flag.files.join(", ")}` : ""}\n`);
    }
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
      case "apply":
        result = await applyCommand(ctx);
        break;
      case "load":
        result = await loadCommand(ctx);
        break;
      case "index":
        result = await indexCommand(ctx);
        break;
      case "drift":
        result = await driftCommand(ctx);
        break;
      default:
        throw new UsageError(`unknown command ${JSON.stringify(parsed.command)}`);
    }
    emit(parsed.command, ctx, result);
    const exitCode = result?.exitCode ?? 0;
    if (exitCode !== 0) process.exitCode = exitCode;
    return exitCode;
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
