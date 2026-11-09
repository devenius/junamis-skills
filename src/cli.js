import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PACKAGE_ROOT, GUIDE_NAME, MARKER_PATH, writeGuide } from "./guide.js";
import { getTarget, targets } from "./targets/index.js";
import { installExternal, validateAgent, validateInstaller } from "./external.js";
import { planLibraryInstall, applyLibraryInstall, manifestPath } from "./library-install.js";
import { configRoot, legacyConfigParent } from "./paths.js";

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

function parseArgs(argv) {
  const args = {
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
    else throw new Error(`unknown option: ${a}`);
  }
  return args;
}

function requireValue(argv, i, flag) {
  const v = argv[i];
  if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
  return v;
}

async function countSkills(dir) {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

async function packageVersion() {
  return JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

async function lockSkillNames() {
  const lock = JSON.parse(await readFile(join(PACKAGE_ROOT, "skills-lock.json"), "utf8"));
  return Object.keys(lock.skills ?? {}).sort();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Project files are untrusted. Return a diagnostic instead of throwing so
// status can report the problem and keep checking other paths.
async function readJsonObject(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return { error: `cannot read file: ${error instanceof Error ? error.message : String(error)}` };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isPlainObject(value)) return { error: "expected a JSON object" };
  return { value };
}

function describeLibraryManifest(value) {
  if (!Array.isArray(value.files)) return "files must be an array";
  const bad = value.files.find((entry) => !isPlainObject(entry) || typeof entry.path !== "string");
  if (bad) return "every files entry needs a string path";
  return null;
}

function resolvedScope(scope, fallback) {
  if (scope === null || scope === undefined) return fallback;
  if (!new Set(["global", "project"]).has(scope)) {
    throw new Error(`unknown scope "${scope}"; expected global or project`);
  }
  return scope;
}

// Write or refresh opencode.json for the OpenCode target. No prompts: when the
// file exists without --force it is left alone and the caller reports why.
export async function writeOpencodeConfig({
  dir = process.cwd(),
  scope = "global",
  force = false,
  dryRun = false,
  packageRoot = PACKAGE_ROOT,
} = {}) {
  if (!new Set(["global", "project"]).has(scope)) {
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

function reportGuide(result, projectDir) {
  if (result.status === "created") {
    console.log(`guide: wrote ${result.path}`);
    console.log(`marker: ${join(projectDir, MARKER_PATH)}`);
  } else if (result.status === "exists") {
    console.log(`guide: ${GUIDE_NAME} already written by junamis-skills ${result.version}; nothing to do.`);
    console.log("guide: use --force to rewrite it.");
  } else if (result.status === "kept-user-file") {
    console.log(`guide: ${result.path} exists and was not written by junamis-skills; left unchanged.`);
    console.log("guide: use --force to replace it.");
  } else {
    console.log(`guide: ${result.status} (${result.path})`);
  }
}

function reportConfig(result) {
  if (result.status === "written") console.log(`config: wrote ${result.path}`);
  else if (result.status === "unchanged") console.log(`config: unchanged (${result.path})`);
  else if (result.status === "kept") console.log(`config: left unchanged; use --force (${result.path})`);
  else if (result.status === "would-write") console.log(`config: would write ${result.path}`);
  else if (result.status === "would-replace") console.log(`config: would replace ${result.path} (--force)`);
  else console.log(`config: ${result.status} (${result.path})`);
}

function reportLibrary(args, scope, result, version) {
  const counts = {};
  for (const a of [...result.actions, ...(result.linkActions ?? [])]) {
    counts[a.action] = (counts[a.action] ?? 0) + 1;
  }
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing";
  console.log(`library for ${args.agent} (junamis-skills ${version}, ${scope}): ${summary}`);

  if (args.dryRun) {
    for (const a of result.actions) console.log(`  ${a.action.padEnd(24)} ${a.path}`);
    for (const a of result.linkActions ?? []) console.log(`  ${a.action.padEnd(24)} ${a.path} -> ${a.target}`);
  }
  for (const p of result.stale) console.log(`  ${args.dryRun ? "would remove" : "removed"} stale ${p}`);
  for (const warning of result.warnings ?? []) console.warn(`  warning: ${warning}`);

  if (!result.ok) {
    console.error(`\n${result.conflicts.length} library file(s) were edited by you and are not managed by junamis-skills:`);
    for (const p of result.conflicts) console.error(`  ${p}`);
    console.error("Review them. Run again with --force to overwrite, or move your copy elsewhere.");
    return 1;
  }
  if (args.dryRun) console.log("library: dry run, nothing was written.");
  return 0;
}

/**
 * Run `init` with injectable dependencies so tests never touch the network.
 * deps may override writeGuide, writeOpencodeConfig, planLibraryInstall,
 * applyLibraryInstall, installExternal, and packageVersion.
 */
export async function runInit(args, deps = {}) {
  const d = {
    writeGuide,
    writeOpencodeConfig,
    planLibraryInstall,
    applyLibraryInstall,
    installExternal,
    packageVersion,
    ...deps,
  };
  const agent = args.agent ?? "opencode";
  if (!new Set(["opencode", "claude"]).has(agent)) {
    throw new Error(`unknown agent "${agent}"; expected opencode or claude`);
  }
  const scope = resolvedScope(args.scope, "global");
  let exitCode = 0;

  // 1. Guide.
  if (args.dryRun) {
    const guidePath = join(args.dir, GUIDE_NAME);
    const exists = existsSync(guidePath);
    console.log(`guide: ${exists && !args.force ? "present, would not rewrite without --force" : `would write ${guidePath}`}`);
  } else {
    reportGuide(await d.writeGuide({ projectDir: args.dir, force: args.force }), args.dir);
  }

  // 2. opencode.json for OpenCode only.
  if (agent !== "opencode") {
    console.log("config: skipped (opencode.json is OpenCode only)");
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
  const files = await d.planLibraryInstall({
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
  let external = { groups: 0, installed: 0, skipped: 0, failed: 0, planned: 0 };
  if (args.dryRun) {
    const names = await lockSkillNames();
    external.planned = names.length;
    console.log(`external: ${names.length} pinned skills would be installed with skillsio`);
  } else {
    validateInstaller("skillsio");
    validateAgent(agent);
    external = await d.installExternal({
      lockPath: join(PACKAGE_ROOT, "skills-lock.json"),
      agent,
      installer: "skillsio",
    });
    console.log(`external: ${external.installed} installed, ${external.skipped} skipped, ${external.failed} failed`);
    if (external.failed > 0) exitCode = 1;
  }

  // 5. Summary.
  console.log("\nsummary:");
  console.log(`  guide:    ${args.dryRun ? "planned" : "done"}`);
  console.log(`  config:   ${agent === "opencode" ? (args.dryRun ? "planned" : "done") : "skipped"}`);
  console.log(`  library:  ${args.dryRun ? "planned" : "done"} (${scope})`);
  console.log(`  external: ${args.dryRun ? `planned (${external.planned})` : `${external.installed} installed, ${external.skipped} skipped, ${external.failed} failed`}`);
  console.log(`  exit:     ${exitCode === 0 ? "ok" : "needs attention"}`);

  return { exitCode, scope, external };
}

export function statusLocations(agentId, scope = "all", projectDir = process.cwd()) {
  const target = getTarget(agentId);
  if (!target) throw new Error(`unknown agent "${agentId}"`);
  if (!new Set(["global", "project", "all"]).has(scope)) {
    throw new Error(`unknown scope "${scope}"; expected global, project, or all`);
  }

  const scopes = scope === "all" ? ["global", "project"] : [scope];
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

async function canonicalAgents(dir) {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort();
}

function describeAgentLink(canonicalPath, linkPath) {
  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return "missing";
    return `unreadable (${error?.code ?? "error"})`;
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
async function legacyLeftovers(scope, projectDir) {
  const parent = legacyConfigParent(scope, projectDir);
  const found = [];
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

async function status(args) {
  const scope = args.scope ?? "global";
  if (!new Set(["global", "project", "all"]).has(scope)) {
    throw new Error(`unknown scope "${scope}"; expected global, project, or all`);
  }
  const scopes = scope === "all" ? ["global", "project"] : [scope];
  const failures = [];
  const check = (label, pass, detail = "") => {
    console.log(`${pass ? "✔" : "✖"} ${label}${detail ? `: ${detail}` : ""}`);
    if (!pass) failures.push(label);
    return pass;
  };

  // Guide and marker describe the project. A missing guide is informational:
  // only a present but malformed marker is a real problem.
  const guidePath = join(args.dir, GUIDE_NAME);
  const guideExists = existsSync(guidePath);
  console.log(`project:  ${args.dir}`);
  console.log(`package:  ${PACKAGE_ROOT}`);
  console.log(`guide:    ${guideExists ? "present" : "missing"} (${GUIDE_NAME})`);

  const markerPath = join(args.dir, MARKER_PATH);
  let marker = null;
  let markerProblem = null;
  if (existsSync(markerPath)) {
    const parsed = await readJsonObject(markerPath);
    if (parsed.error) {
      markerProblem = parsed.error;
    } else if (typeof parsed.value.writtenAt !== "string" || typeof parsed.value.version !== "string") {
      markerProblem = "writtenAt and version must be strings";
    } else {
      marker = parsed.value;
    }
  }
  console.log(`marker:   ${marker ? `written ${marker.writtenAt} by ${marker.version}` : "none"}`);
  if (markerProblem) {
    console.error(`✖ invalid marker ${markerPath}: ${markerProblem}`);
    failures.push("marker");
  }

  // Per-target counts and library manifests. Missing directories and manifests
  // are informational: a target can be detected without this package being
  // installed for it. A present manifest is always validated.
  console.log("agents:");
  for (const t of targets) {
    const detected = t.detect();
    console.log(`  ${t.label.padEnd(12)} ${detected ? "detected" : "not found"}`);
    for (const location of statusLocations(t.id, scope, args.dir)) {
      const libraryCount = await countSkills(location.librarySkillsDir);
      const externalCount = await countSkills(location.skillsDir);
      const state = (count) => (count === null ? "no skills dir" : `${count} skill folders`);
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
      const problem = parsed.error ?? (parsed.value ? describeLibraryManifest(parsed.value) : "unknown error");
      if (problem) {
        console.error(`✖ library manifest invalid (${location.manifestPath}): ${problem}`);
        failures.push("library manifest");
        continue;
      }
      const data = parsed.value;
      console.log(`      library ${data.version} installed ${data.installedAt} (${data.files.length} files)`);
    }
  }

  // Older installs used a flat layout. Report leftovers without failing and
  // without deleting anything; migration is the user's decision.
  for (const installScope of scopes) {
    const legacy = await legacyLeftovers(installScope, args.dir);
    for (const item of legacy) console.log(`legacy (${installScope}, informational): ${item}`);
  }

  // opencode.json validity for the selected scopes.
  const candidates = [
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
    if (parsed.error) {
      check(`config (${candidate.scope})`, false, `${candidate.path}: ${parsed.error}`);
      continue;
    }
    const perm = parsed.value.permission;
    const valid = isPlainObject(perm)
      && ["read", "edit", "webfetch", "websearch", "external_directory"].every((k) => k in perm);
    check(
      `config (${candidate.scope})`,
      valid,
      valid ? `${candidate.path} permission keys present` : `${candidate.path}: permission must be an object with all permission keys`,
    );
  }

  // External coverage: every pinned skill is present under the external
  // skills directory used by the OpenCode target. Report only; a missing skill
  // is not a status failure.
  const lockNames = await lockSkillNames();
  const externalDir = getTarget("opencode").globalSkillsDir();
  const missing = lockNames.filter((name) => !existsSync(join(externalDir, name)));
  const coverage = `${lockNames.length - missing.length}/${lockNames.length}`;
  const coverageDetail = missing.length === 0 ? `${coverage} in ${externalDir}` : `${coverage}; missing ${missing.join(", ")}`;
  console.log(`external coverage: ${coverageDetail}`);

  // SECURITY.md is the recorded scan vetted at install time. Report its status
  // without failing; the scan record is part of the package, not the install.
  const securityPath = join(PACKAGE_ROOT, "SECURITY.md");
  let securityMonth = null;
  if (existsSync(securityPath)) {
    const text = await readFile(securityPath, "utf8");
    securityMonth = text.match(/^Last external scan:\s*(\d{4}-\d{2})/m)?.[1] ?? null;
  }
  console.log(
    `SECURITY.md scan record: ${securityMonth ? `${securityPath} (last external scan ${securityMonth})` : `${securityPath} is missing or has no Last external scan line`}`,
  );

  const passed = failures.length === 0;
  console.log(`\nstatus: ${passed ? "ok" : `${failures.length} required check(s) failed`}`);
  if (!passed) process.exitCode = 1;
  return passed ? 0 : 1;
}

export async function run(argv) {
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
      return;
    default:
      throw new Error(`unknown command: ${args.command}. Use "init" or "status".`);
  }
}
