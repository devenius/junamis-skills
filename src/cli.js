import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PACKAGE_ROOT, GUIDE_NAME, MARKER_PATH, writeGuide } from "./guide.js";
import { getTarget, targets } from "./targets/index.js";
import { installExternal, validateAgent, validateInstaller } from "./external.js";
import { planLibraryInstall, applyLibraryInstall, manifestPath } from "./library-install.js";

const HELP = `junamis-skills

Usage:
  junamis-skills init [--force] [--dir <path>] [--with-external] [--agent <name>]
      write ${GUIDE_NAME} into the project. --with-external also installs the external skills.

  junamis-skills install-library [--agent opencode|claude] [--dry-run] [--force]
      install the library skills, agent definitions, and shared docs so the agent can load them.
      Shows what would change first when --dry-run is given. Never overwrites a file you edited unless --force.

  junamis-skills install-external [--agent opencode|claude] [--installer skillsio|skills]
      install every external skill in skills-lock.json. Scan alerts are shown and critical
      findings still ask you to confirm. The scan is never skipped.

  junamis-skills status [--dir <path>]
      show guide state, installed library, and detected agents.

  junamis-skills help

  --dir          project directory (default: current directory)
  --force        overwrite the guide or edited library files
  --dry-run      print the install plan without writing anything
  --agent        opencode (default) or claude
  --installer    skillsio (default) or skills
`;

function parseArgs(argv) {
  const args = {
    command: argv[0] ?? "help",
    force: false,
    dryRun: false,
    dir: process.cwd(),
    withExternal: false,
    agent: "opencode",
    installer: "skillsio",
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--with-external") args.withExternal = true;
    else if (a === "--dir") args.dir = resolve(requireValue(argv, ++i, a));
    else if (a === "--agent") args.agent = requireValue(argv, ++i, a);
    else if (a === "--installer") args.installer = requireValue(argv, ++i, a);
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

async function init(args) {
  const result = await writeGuide({ projectDir: args.dir, force: args.force });
  if (result.status === "created") {
    console.log(`wrote ${result.path}`);
    console.log(`marker: ${join(args.dir, MARKER_PATH)}`);
  } else if (result.status === "exists") {
    console.log(`${GUIDE_NAME} already written by junamis-skills ${result.version}; nothing to do.`);
    console.log("use --force to rewrite it.");
  } else if (result.status === "kept-user-file") {
    console.log(`${result.path} exists and was not written by junamis-skills; left unchanged.`);
    console.log("use --force to replace it.");
  }

  if (args.withExternal) {
    console.log("\n--- Installing external skills ---\n");
    await installExternalCommand(args);
  }
}

async function installExternalCommand(args) {
  validateInstaller(args.installer);
  validateAgent(args.agent);
  const { failed } = await installExternal({
    lockPath: join(PACKAGE_ROOT, "skills-lock.json"),
    agent: args.agent,
    installer: args.installer,
  });
  if (failed > 0) process.exitCode = 1;
}

async function installLibraryCommand(args) {
  if (!getTarget(args.agent)) throw new Error(`unknown agent "${args.agent}"; expected opencode or claude`);
  const version = await packageVersion();
  const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: args.agent });
  const result = await applyLibraryInstall({
    agent: args.agent,
    files,
    version,
    force: args.force,
    dryRun: args.dryRun,
  });

  const counts = {};
  for (const a of result.actions) counts[a.action] = (counts[a.action] ?? 0) + 1;
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing";
  console.log(`library for ${args.agent} (junamis-skills ${version}): ${summary}`);

  if (args.dryRun) {
    for (const a of result.actions) console.log(`  ${a.action.padEnd(12)} ${a.path}`);
  }
  for (const p of result.stale) console.log(`  ${args.dryRun ? "would remove" : "removed"} stale ${p}`);

  if (!result.ok) {
    console.error(`\n${result.conflicts.length} file(s) were edited by you and are not managed by junamis-skills:`);
    for (const p of result.conflicts) console.error(`  ${p}`);
    console.error("Review them. Run again with --force to overwrite, or move your copy elsewhere.");
    process.exitCode = 1;
    return;
  }
  if (args.dryRun) console.log("\ndry run: nothing was written.");
}

async function status(args) {
  const marker = existsSync(join(args.dir, MARKER_PATH))
    ? JSON.parse(await readFile(join(args.dir, MARKER_PATH), "utf8"))
    : null;
  const guideExists = existsSync(join(args.dir, GUIDE_NAME));

  console.log(`project:  ${args.dir}`);
  console.log(`package:  ${PACKAGE_ROOT}`);
  console.log(`guide:    ${guideExists ? "present" : "missing"} (${GUIDE_NAME})`);
  console.log(`marker:   ${marker ? `written ${marker.writtenAt} by ${marker.version}` : "none"}`);
  console.log("agents:");
  for (const t of targets) {
    const dir = t.globalSkillsDir();
    const count = await countSkills(dir);
    const state = count === null ? "no skills dir" : `${count} skill folders`;
    console.log(`  ${t.label.padEnd(12)} ${t.detect() ? "detected" : "not found"}  ${dir}  (${state})`);
    const mpath = manifestPath(t.id);
    if (existsSync(mpath)) {
      const data = JSON.parse(await readFile(mpath, "utf8"));
      console.log(`               library ${data.version} installed ${data.installedAt} (${data.files.length} files)`);
    } else {
      console.log("               library not installed (run: junamis-skills install-library)");
    }
  }
}

export async function run(argv) {
  const args = parseArgs(argv);
  switch (args.command) {
    case "init":
      return init(args);
    case "install-library":
      return installLibraryCommand(args);
    case "install-external":
      return installExternalCommand(args);
    case "status":
      return status(args);
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      throw new Error(`unknown command: ${args.command}\n\n${HELP}`);
  }
}
