import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createColors, colorsEnabled, type Colors } from "./color.js";
import { PACKAGE_ROOT, GUIDE_NAME, MARKER_PATH, writeGuide } from "./guide.js";
import { getTarget, targets } from "./targets/index.js";
import { installExternal, validateAgent, validateInstaller } from "./external.js";
import { planLibraryInstall, applyLibraryInstall, manifestPath } from "./library-install.js";
import { configRoot, legacyConfigParent } from "./paths.js";
import { isOneOf, isRecord, parseJsonUnknown } from "./types/guards.js";
import type {
  ExternalInstallResult,
  GuideMarker,
  GuideResult,
  InstallScope,
  LibraryInstallResult,
  LibraryPlan,
  ScopeSelection,
  StatusLocation,
} from "./types/index.js";

const HELP = `junamis-skills

Usage:
  junamis-skills init [--agent opencode|claude] [--scope global|project] [--dir <path>] [--force] [--dry-run]
      Install everything this package provides:
        1. write ${GUIDE_NAME} into the project;
        2. write opencode.json (OpenCode only) when it is missing, or always with --force;
        3. install the library skills, canonical agents, links, and shared docs;
        4. install every pinned external skill from skills-lock.json.
      Existing config or library files you edited are left unchanged unless --force.
      --dry-run prints the plan without writing or using the network.

  junamis-skills status [--dir <path>] [--scope global|project|all]
      Report the guide, marker, per-target internal/external skill counts, canonical
      agents and link state, legacy leftovers, library manifests, opencode.json
      validity, external skill coverage, and the SECURITY.md scan record. Exits 1
      only when a detected target's manifest or config is invalid. Default scope:
      global (matching init).

  junamis-skills help

  --dir          project directory (default: current directory)
  --force        overwrite the guide, opencode.json, or edited library files
  --dry-run      print the install plan without writing anything
  --agent        opencode (default) or claude
  --scope        global or project for init; global, project, or all for status
`;

const INSTALL_SCOPES = ["global", "project"] as const;
const ALL_SCOPES = ["global", "project", "all"] as const;
const INIT_AGENTS = ["opencode", "claude"] as const;

export interface CliArgs {
  readonly command: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly dir: string;
  readonly agent: string;
  readonly scope: string | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: {
    command: string;
    force: boolean;
    dryRun: boolean;
    dir: string;
    agent: string;
    scope: string | null;
  } = {
    command: argv[0] ?? "help",
    force: false,
    dryRun: false,
    dir: process.cwd(),
    agent: "opencode",
    scope: null,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--dir") args.dir = resolve(requireValue(argv, ++i, a));
    else if (a === "--agent") args.agent = requireValue(argv, ++i, a);
    else if (a === "--scope") args.scope = requireValue(argv, ++i, a);
    else throw new Error(`unknown option: ${String(a)}`);
  }
  return args;
}

function requireValue(argv: readonly string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
  return v;
}

async function countSkills(dir: string): Promise<number | null> {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

async function packageVersion(): Promise<string> {
  const parsed = parseJsonUnknown(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"));
  if (!parsed.ok) throw new Error(`cannot read package.json: ${parsed.error.message}`);
  const version = isRecord(parsed.value) ? parsed.value["version"] : undefined;
  if (typeof version !== "string") {
    throw new Error("package.json has no version");
  }
  return version;
}

async function lockSkillNames(): Promise<string[]> {
  const parsed = parseJsonUnknown(await readFile(join(PACKAGE_ROOT, "skills-lock.json"), "utf8"));
  if (!parsed.ok) throw new Error(`cannot read skills-lock.json: ${parsed.error.message}`);
  const skills = isRecord(parsed.value) ? parsed.value["skills"] : undefined;
  if (!isRecord(skills)) return [];
  return Object.keys(skills).sort();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type JsonFileResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

// Project files are untrusted. Return a diagnostic instead of throwing so
// status can report the problem and keep checking other paths.
async function readJsonObject(path: string): Promise<JsonFileResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return { ok: false, error: `cannot read file: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = parseJsonUnknown(raw);
  if (!parsed.ok) return { ok: false, error: `invalid JSON: ${parsed.error.message}` };
  if (!isPlainObject(parsed.value)) return { ok: false, error: "expected a JSON object" };
  return { ok: true, value: parsed.value };
}

function describeLibraryManifest(value: Record<string, unknown>): string | null {
  const files = value["files"];
  if (!Array.isArray(files)) return "files must be an array";
  const bad = (files as unknown[]).find((entry) => !isPlainObject(entry) || typeof entry["path"] !== "string");
  if (bad !== undefined) return "every files entry needs a string path";
  return null;
}

function resolvedScope(scope: string | null | undefined, fallback: InstallScope): InstallScope {
  if (scope === null || scope === undefined) return fallback;
  if (!isOneOf(scope, INSTALL_SCOPES)) {
    throw new Error(`unknown scope "${scope}"; expected global or project`);
  }
  return scope;
}

export type ConfigStatus = "written" | "unchanged" | "kept" | "would-write" | "would-replace";

export interface OpencodeConfigResult {
  readonly status: ConfigStatus;
  readonly path: string;
}

export interface OpencodeConfigOptions {
  readonly dir?: string;
  readonly scope?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly packageRoot?: string;
}

// Write or refresh opencode.json for the OpenCode target. No prompts: when the
// file exists without --force it is left alone and the caller reports why.
export async function writeOpencodeConfig({
  dir = process.cwd(),
  scope = "global",
  force = false,
  dryRun = false,
  packageRoot = PACKAGE_ROOT,
}: OpencodeConfigOptions = {}): Promise<OpencodeConfigResult> {
  if (!isOneOf(scope, INSTALL_SCOPES)) {
    throw new Error(`unknown scope "${scope}"; expected global or project`);
  }
  const targetPath = scope === "global"
    ? join(homedir(), ".config", "opencode", "opencode.json")
    : join(dir, "opencode.json");

  let content = await readFile(join(packageRoot, "opencode.json"), "utf8");
  // Project-scope installs live under the project directory, so rewrite the
  // global paths in the template to project-relative ones.
  if (scope === "project") {
    content = content
      .replace(/"\{env:HOME\}\/\.config\/junamis\/skills\/skills"/g, '"./.config/junamis/skills/skills"')
      .replace(/"\{env:HOME\}\/\.config\/junamis\/skills\/\*\.md"/g, '"./.config/junamis/skills/*.md"')
      .replace(/"\{env:HOME\}\/\.agents\/skills"/g, '"./.agents/skills"');
  }

  if (existsSync(targetPath) && !force) {
    const existing = await readFile(targetPath, "utf8");
    return { status: existing === content ? "unchanged" : "kept", path: targetPath };
  }
  if (dryRun) {
    return { status: existsSync(targetPath) ? "would-replace" : "would-write", path: targetPath };
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return { status: "written", path: targetPath };
}

function palette(): Colors {
  return createColors({ enabled: colorsEnabled() });
}

function reportGuide(result: GuideResult, projectDir: string): void {
  const c = palette();
  if (result.status === "created") {
    console.log(`${c.cyan("guide:")} wrote ${c.gray(result.path)}`);
    console.log(`${c.cyan("marker:")} ${c.gray(join(projectDir, MARKER_PATH))}`);
  } else if (result.status === "exists") {
    console.log(`${c.cyan("guide:")} ${GUIDE_NAME} already written by junamis-skills ${result.version}; nothing to do.`);
    console.log(c.yellow("guide: use --force to rewrite it."));
  } else if (result.status === "kept-user-file") {
    console.log(`${c.cyan("guide:")} ${c.gray(result.path)} exists and was not written by junamis-skills; left unchanged.`);
    console.log(c.yellow("guide: use --force to replace it."));
  } else {
    console.log(`${c.cyan("guide:")} ${String(result.status)} (${c.gray(result.path)})`);
  }
}

function reportConfig(result: OpencodeConfigResult): void {
  const c = palette();
  if (result.status === "written") console.log(`${c.cyan("config:")} wrote ${c.gray(result.path)}`);
  else if (result.status === "unchanged") console.log(`${c.cyan("config:")} unchanged (${c.gray(result.path)})`);
  else if (result.status === "kept") console.log(`${c.yellow("config:")} left unchanged; use --force (${c.gray(result.path)})`);
  else if (result.status === "would-write") console.log(`${c.cyan("config:")} would write ${c.gray(result.path)}`);
  else if (result.status === "would-replace") console.log(`${c.cyan("config:")} would replace ${c.gray(result.path)} (--force)`);
  else console.log(`${c.cyan("config:")} ${String(result.status)} (${c.gray(result.path)})`);
}

function reportLibrary(args: { readonly agent?: string; readonly dryRun: boolean }, scope: InstallScope, result: LibraryInstallResult, version: string): number {
  const c = palette();
  const counts: Record<string, number> = {};
  for (const a of [...result.actions, ...(result.linkActions ?? [])]) {
    counts[a.action] = (counts[a.action] ?? 0) + 1;
  }
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing";
  console.log(`${c.cyan("library")} for ${args.agent} (junamis-skills ${version}, ${scope}): ${c.gray(summary)}`);

  if (args.dryRun) {
    for (const a of result.actions) console.log(`  ${a.action.padEnd(24)} ${c.gray(a.path)}`);
    for (const a of result.linkActions ?? []) console.log(`  ${a.action.padEnd(24)} ${c.gray(a.path)} -> ${c.gray(String(a.target))}`);
  }
  for (const p of result.stale) console.log(`  ${args.dryRun ? "would remove" : "removed"} stale ${c.gray(p)}`);
  for (const warning of result.warnings ?? []) console.warn(c.yellow(`  warning: ${warning}`));

  if (!result.ok) {
    console.error(c.red(`\n${result.conflicts.length} library file(s) were edited by you and are not managed by junamis-skills:`));
    for (const p of result.conflicts) console.error(c.red(`  ${p}`));
    console.error(c.yellow("Review them. Run again with --force to overwrite, or move your copy elsewhere."));
    return 1;
  }
  if (args.dryRun) console.log(c.green("library: dry run, nothing was written."));
  return 0;
}

/** Injectable dependencies, so tests never touch the network. */
export interface InitDeps {
  readonly writeGuide?: typeof writeGuide;
  readonly writeOpencodeConfig?: typeof writeOpencodeConfig;
  readonly planLibraryInstall?: typeof planLibraryInstall;
  readonly applyLibraryInstall?: typeof applyLibraryInstall;
  readonly installExternal?: typeof installExternal;
  readonly packageVersion?: () => Promise<string>;
}

export interface InitArgs {
  readonly agent?: string;
  readonly scope?: string | null;
  readonly dir: string;
  readonly force: boolean;
  readonly dryRun: boolean;
}

/** The external install tally plus the dry-run count. */
export interface InitExternalSummary extends ExternalInstallResult {
  readonly planned?: number;
}

export interface InitResult {
  readonly exitCode: number;
  readonly scope: InstallScope;
  readonly external: InitExternalSummary;
}

/**
 * Run `init` with injectable dependencies so tests never touch the network.
 * deps may override writeGuide, writeOpencodeConfig, planLibraryInstall,
 * applyLibraryInstall, installExternal, and packageVersion.
 */
export async function runInit(args: InitArgs, deps: InitDeps = {}): Promise<InitResult> {
  const d = {
    writeGuide: deps.writeGuide ?? writeGuide,
    writeOpencodeConfig: deps.writeOpencodeConfig ?? writeOpencodeConfig,
    planLibraryInstall: deps.planLibraryInstall ?? planLibraryInstall,
    applyLibraryInstall: deps.applyLibraryInstall ?? applyLibraryInstall,
    installExternal: deps.installExternal ?? installExternal,
    packageVersion: deps.packageVersion ?? packageVersion,
  };
  const agent = args.agent ?? "opencode";
  if (!isOneOf(agent, INIT_AGENTS)) {
    throw new Error(`unknown agent "${agent}"; expected opencode or claude`);
  }
  const scope = resolvedScope(args.scope, "global");
  const c = palette();
  let exitCode = 0;

  // 1. Guide.
  if (args.dryRun) {
    const guidePath = join(args.dir, GUIDE_NAME);
    const exists = existsSync(guidePath);
    console.log(`${c.cyan("guide:")} ${exists && !args.force ? "present, would not rewrite without --force" : `would write ${c.gray(guidePath)}`}`);
  } else {
    reportGuide(await d.writeGuide({ projectDir: args.dir, force: args.force }), args.dir);
  }

  // 2. opencode.json for OpenCode only.
  if (agent !== "opencode") {
    console.log(`${c.cyan("config:")} skipped (opencode.json is OpenCode only)`);
  } else {
    reportConfig(await d.writeOpencodeConfig({
      dir: args.dir,
      scope,
      force: args.force,
      dryRun: args.dryRun,
    }));
  }

  // 3. Library.
  const version = await d.packageVersion();
  const files: LibraryPlan = await d.planLibraryInstall({
    packageRoot: PACKAGE_ROOT,
    agent,
    scope,
    projectDir: args.dir,
  });
  const libraryResult = await d.applyLibraryInstall({
    agent,
    files,
    version,
    force: args.force,
    dryRun: args.dryRun,
    scope,
    projectDir: args.dir,
  });
  exitCode ||= reportLibrary(args, scope, libraryResult, version);

  // 4. Every pinned external skill, non-interactively.
  let external: InitExternalSummary = { groups: 0, installed: 0, skipped: 0, failed: 0, planned: 0 };
  if (args.dryRun) {
    const names = await lockSkillNames();
    external = { ...external, planned: names.length };
    console.log(`${c.cyan("external:")} ${names.length} pinned skills would be installed with skillsio`);
  } else {
    validateInstaller("skillsio");
    validateAgent(agent);
    external = await d.installExternal({
      lockPath: join(PACKAGE_ROOT, "skills-lock.json"),
      agent,
      installer: "skillsio",
    });
    console.log(`${c.cyan("external:")} ${external.installed} installed, ${external.skipped} skipped, ${external.failed} failed`);
    if (external.failed > 0) exitCode = 1;
  }

  // 5. Summary.
  console.log(`\n${c.cyan("summary:")}`);
  console.log(`  ${c.gray("guide:")}    ${args.dryRun ? c.yellow("planned") : c.green("done")}`);
  console.log(`  ${c.gray("config:")}   ${agent === "opencode" ? (args.dryRun ? c.yellow("planned") : c.green("done")) : "skipped"}`);
  console.log(`  ${c.gray("library:")}  ${args.dryRun ? c.yellow("planned") : c.green("done")} (${scope})`);
  console.log(`  ${c.gray("external:")} ${args.dryRun ? c.yellow(`planned (${String(external.planned)})`) : `${external.installed} installed, ${external.skipped} skipped, ${external.failed} failed`}`);
  console.log(`  ${c.gray("exit:")}     ${exitCode === 0 ? c.green("ok") : c.yellow("needs attention")}`);

  return { exitCode, scope, external };
}

export function statusLocations(
  agentId: string,
  scope: ScopeSelection = "all",
  projectDir: string = process.cwd(),
): StatusLocation[] {
  const target = getTarget(agentId);
  if (!target) throw new Error(`unknown agent "${agentId}"`);
  if (!isOneOf(scope, ALL_SCOPES)) {
    throw new Error(`unknown scope "${scope}"; expected global, project, or all`);
  }

  const scopes: InstallScope[] = scope === "all" ? ["global", "project"] : [scope];
  return scopes.map((installScope) => ({
    scope: installScope,
    skillsDir: installScope === "project" ? target.projectSkillsDir(projectDir) : target.globalSkillsDir(),
    librarySkillsDir: installScope === "project" ? target.projectLibrarySkillsDir(projectDir) : target.librarySkillsDir(),
    canonicalAgentsDir: installScope === "project"
      ? target.projectLibraryAgentsCanonicalDir(projectDir)
      : target.libraryAgentsCanonicalDir(),
    agentsDir: installScope === "project" ? target.projectAgentsDir(projectDir) : target.libraryAgentsDir(),
    manifestPath: manifestPath(agentId, installScope, projectDir),
  }));
}

async function canonicalAgents(dir: string): Promise<string[] | null> {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort();
}

function describeAgentLink(canonicalPath: string, linkPath: string): string {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(linkPath);
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") return "missing";
    const code = isRecord(error) ? error["code"] : undefined;
    return `unreadable (${typeof code === "string" ? code : "error"})`;
  }
  if (stat.isSymbolicLink()) {
    const current = readlinkSync(linkPath);
    return resolve(dirname(linkPath), current) === resolve(canonicalPath)
      ? "linked"
      : `wrong target (${current})`;
  }
  if (stat.isFile()) return "regular file (not a link)";
  return "not a file";
}

// Legacy leftovers from the flat layout. Reported only; never deleted.
async function legacyLeftovers(scope: InstallScope, projectDir: string): Promise<string[]> {
  const parent = legacyConfigParent(scope, projectDir);
  const found: string[] = [];
  if (!existsSync(parent)) return found;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(`${join(parent, entry.name)} (legacy shared doc)`);
    }
  }
  if (existsSync(join(parent, "installed"))) {
    found.push(`${join(parent, "installed")} (legacy manifest directory)`);
  }
  const root = configRoot(scope, projectDir);
  if (existsSync(root)) {
    const known = new Set(["skills", "agents", "installed"]);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !known.has(entry.name)) {
        found.push(`${join(root, entry.name)} (legacy flat skill folder)`);
      }
    }
  }
  return found;
}

async function status(args: CliArgs): Promise<number> {
  const c = palette();
  const scope = args.scope ?? "global";
  if (!isOneOf(scope, ALL_SCOPES)) {
    throw new Error(`unknown scope "${scope}"; expected global, project, or all`);
  }
  const scopes: InstallScope[] = scope === "all" ? ["global", "project"] : [scope];
  const failures: string[] = [];
  const check = (label: string, pass: boolean, detail: string = ""): boolean => {
    console.log(`${pass ? c.green("✔") : c.red("✖")} ${label}${detail ? `: ${c.gray(detail)}` : ""}`);
    if (!pass) failures.push(label);
    return pass;
  };

  // Guide and marker describe the project. A missing guide is informational:
  // only a present but malformed marker is a real problem.
  const guidePath = join(args.dir, GUIDE_NAME);
  const guideExists = existsSync(guidePath);
  console.log(`${c.cyan("project:")}  ${c.gray(args.dir)}`);
  console.log(`${c.cyan("package:")}  ${c.gray(PACKAGE_ROOT)}`);
  console.log(`${c.cyan("guide:")}    ${guideExists ? c.green("present") : "missing"} (${GUIDE_NAME})`);

  const markerPath = join(args.dir, MARKER_PATH);
  let marker: GuideMarker | null = null;
  let markerProblem: string | null = null;
  if (existsSync(markerPath)) {
    const parsed = await readJsonObject(markerPath);
    if (!parsed.ok) {
      markerProblem = parsed.error;
    } else {
      const writtenAt = parsed.value["writtenAt"];
      const version = parsed.value["version"];
      if (typeof writtenAt !== "string" || typeof version !== "string") {
        markerProblem = "writtenAt and version must be strings";
      } else {
        const guide = parsed.value["guide"];
        marker = { guide: typeof guide === "string" ? guide : "", writtenAt, version };
      }
    }
  }
  console.log(`${c.cyan("marker:")}   ${marker ? `written ${marker.writtenAt} by ${marker.version}` : "none"}`);
  if (markerProblem) {
    console.error(c.red(`✖ invalid marker ${markerPath}: ${markerProblem}`));
    failures.push("marker");
  }

  // Per-target counts and library manifests. Missing directories and manifests
  // are informational: a target can be detected without this package being
  // installed for it. A present manifest is always validated.
  console.log(c.cyan("agents:"));
  for (const t of targets) {
    const detected = t.detect();
    console.log(`  ${t.label.padEnd(12)} ${detected ? c.green("detected") : c.gray("not found")}`);
    for (const location of statusLocations(t.id, scope, args.dir)) {
      const libraryCount = await countSkills(location.librarySkillsDir);
      const externalCount = await countSkills(location.skillsDir);
      const state = (count: number | null): string => (count === null ? "no skills dir" : `${count} skill folders`);
      console.log(`    ${location.scope.padEnd(8)} internal ${location.librarySkillsDir} (${state(libraryCount)})`);
      console.log(`    ${location.scope.padEnd(8)} external ${location.skillsDir} (${state(externalCount)})`);

      const agentNames = await canonicalAgents(location.canonicalAgentsDir);
      if (agentNames === null) {
        console.log(`    ${location.scope.padEnd(8)} canonical agents ${location.canonicalAgentsDir} (none)`);
      } else {
        console.log(`    ${location.scope.padEnd(8)} canonical agents ${location.canonicalAgentsDir} (${agentNames.length} agents)`);
        for (const name of agentNames) {
          const linkPath = join(location.agentsDir, name);
          console.log(`      agent ${name.replace(/\.md$/, "")}: ${describeAgentLink(join(location.canonicalAgentsDir, name), linkPath)}`);
        }
      }

      if (!existsSync(location.manifestPath)) {
        console.log(`      library not installed in ${location.scope} scope`);
        continue;
      }
      const parsed = await readJsonObject(location.manifestPath);
      if (!parsed.ok) {
        console.error(c.red(`✖ library manifest invalid (${location.manifestPath}): ${parsed.error}`));
        failures.push("library manifest");
        continue;
      }
      const problem = describeLibraryManifest(parsed.value);
      if (problem) {
        console.error(c.red(`✖ library manifest invalid (${location.manifestPath}): ${problem}`));
        failures.push("library manifest");
        continue;
      }
      const manifestFiles = parsed.value["files"];
      const fileCount = Array.isArray(manifestFiles) ? manifestFiles.length : 0;
      console.log(`      library ${String(parsed.value["version"])} installed ${String(parsed.value["installedAt"])} (${fileCount} files)`);
    }
  }

  // Older installs used a flat layout. Report leftovers without failing and
  // without deleting anything; migration is the user's decision.
  for (const installScope of scopes) {
    const legacy = await legacyLeftovers(installScope, args.dir);
    for (const item of legacy) console.log(`legacy (${installScope}, informational): ${item}`);
  }

  // opencode.json validity for the selected scopes.
  const candidates: Array<{ readonly scope: InstallScope; readonly path: string }> = [
    { scope: "project", path: join(args.dir, "opencode.json") },
    { scope: "global", path: join(homedir(), ".config", "opencode", "opencode.json") },
  ];
  for (const candidate of candidates) {
    if (!scopes.includes(candidate.scope)) continue;
    if (!existsSync(candidate.path)) {
      console.log(`config (${candidate.scope}): missing (${candidate.path})`);
      continue;
    }
    const parsed = await readJsonObject(candidate.path);
    if (!parsed.ok) {
      check(`config (${candidate.scope})`, false, `${candidate.path}: ${parsed.error}`);
      continue;
    }
    const permissions = parsed.value["permissions"];
    const mcp = parsed.value["mcp"];
    const plugins = parsed.value["plugins"];
    const valid = parsed.value["permission"] === undefined
      && Array.isArray(permissions)
      && permissions.length > 0
      && isPlainObject(mcp)
      && isPlainObject(mcp["servers"])
      && Array.isArray(plugins);
    check(
      `config (${candidate.scope})`,
      valid,
      valid
        ? `${candidate.path} V2 permissions, mcp, and plugins present`
        : `${candidate.path}: expected V2 permissions array, mcp.servers object, and plugins array`,
    );
  }

  // External coverage: every pinned skill is present under the external
  // skills directory used by the OpenCode target. Report only; a missing skill
  // is not a status failure.
  const lockNames = await lockSkillNames();
  const opencode = getTarget("opencode");
  if (!opencode) throw new Error('unknown agent "opencode"');
  const externalDir = opencode.globalSkillsDir();
  const missing = lockNames.filter((name) => !existsSync(join(externalDir, name)));
  const coverage = `${lockNames.length - missing.length}/${lockNames.length}`;
  const coverageDetail = missing.length === 0 ? `${coverage} in ${externalDir}` : `${coverage}; missing ${missing.join(", ")}`;
  console.log(`${c.cyan("external coverage:")} ${missing.length === 0 ? c.green(coverageDetail) : c.yellow(coverageDetail)}`);

  // SECURITY.md is the recorded scan vetted at install time. Report its status
  // without failing; the scan record is part of the package, not the install.
  const securityPath = join(PACKAGE_ROOT, "SECURITY.md");
  let securityMonth: string | null = null;
  if (existsSync(securityPath)) {
    const text = await readFile(securityPath, "utf8");
    securityMonth = text.match(/^Last external scan:\s*(\d{4}-\d{2})/m)?.[1] ?? null;
  }
  console.log(
    `${c.cyan("SECURITY.md scan record:")} ${securityMonth ? `${c.gray(securityPath)} (last external scan ${securityMonth})` : c.yellow(`${securityPath} is missing or has no Last external scan line`)}`,
  );

  const passed = failures.length === 0;
  console.log(`\n${c.cyan("status:")} ${passed ? c.green("ok") : c.yellow(`${failures.length} required check(s) failed`)}`);
  if (!passed) process.exitCode = 1;
  return passed ? 0 : 1;
}

export async function run(argv: readonly string[]): Promise<InitResult | number | undefined> {
  const args = parseArgs(argv);
  switch (args.command) {
    case "init": {
      const result = await runInit(args);
      if (result.exitCode) process.exitCode = result.exitCode;
      return result;
    }
    case "status":
      return status(args);
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return undefined;
    default:
      throw new Error(`unknown command: ${args.command}. Use "init" or "status".`);
  }
}
