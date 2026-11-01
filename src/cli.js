import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { PACKAGE_ROOT, GUIDE_NAME, MARKER_PATH, writeGuide } from "./guide.js";
import { getTarget, targets } from "./targets/index.js";
import { installExternal, validateAgent, validateInstaller } from "./external.js";
import { planLibraryInstall, applyLibraryInstall, manifestPath } from "./library-install.js";

const HELP = `junamis-agents-skills

Usage:
  junamis-agents-skills init [--force] [--dir <path>] [--with-external] [--with-library] [--with-all] [--agent <name>]
      write ${GUIDE_NAME} into the project. --with-external also installs the external skills.
      --with-library also installs the library. --with-all installs library + external skills.

  junamis-agents-skills install-library [--agent opencode|claude] [--dry-run] [--force]
      install the library skills, agent definitions, and shared docs so the agent can load them.
      Shows what would change first when --dry-run is given. Never overwrites a file you edited unless --force.

  junamis-agents-skills install-external [--agent opencode|claude] [--installer skillsio|skills]
      install every external skill in skills-lock.json. Scan alerts are shown and critical
      findings still ask you to confirm. The scan is never skipped.

  junamis-agents-skills status [--dir <path>]
      show guide state, installed library, and detected agents.

  junamis-agents-skills sync [--agent opencode|claude] [--dry-run] [--force]
      reinstall/refresh the library for an agent using the installed manifest.

  junamis-agents-skills doctor [--dir <path>]
      check Node, agents, installed skills, shared docs, manifest, and opencode.json.

  junamis-agents-skills init-config [--scope global|project] [--force] [--dir <path>]
      write opencode.json with the secret-access deny rules and webfetch allowlist.
      Prompts for scope when run interactively; defaults to project (cwd) otherwise.

  junamis-agents-skills help

  --dir          project directory (default: current directory)
  --force        overwrite the guide or edited library files
  --dry-run      print the install plan without writing anything
  --agent        opencode (default) or claude
  --installer    skillsio (default) or skills
  --scope        global or project (for init-config)
`;

function parseArgs(argv) {
  const args = {
    command: argv[0] ?? "help",
    force: false,
    dryRun: false,
    dir: process.cwd(),
    withExternal: false,
    withLibrary: false,
    withAll: false,
    agent: "opencode",
    installer: "skillsio",
    scope: null,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--with-external") args.withExternal = true;
    else if (a === "--with-library") args.withLibrary = true;
    else if (a === "--with-all") args.withAll = true;
    else if (a === "--dir") args.dir = resolve(requireValue(argv, ++i, a));
    else if (a === "--agent") args.agent = requireValue(argv, ++i, a);
    else if (a === "--installer") args.installer = requireValue(argv, ++i, a);
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

async function init(args) {
  const result = await writeGuide({ projectDir: args.dir, force: args.force });
  if (result.status === "created") {
    console.log(`wrote ${result.path}`);
    console.log(`marker: ${join(args.dir, MARKER_PATH)}`);
  } else if (result.status === "exists") {
    console.log(`${GUIDE_NAME} already written by junamis-agents-skills ${result.version}; nothing to do.`);
    console.log("use --force to rewrite it.");
  } else if (result.status === "kept-user-file") {
    console.log(`${result.path} exists and was not written by junamis-agents-skills; left unchanged.`);
    console.log("use --force to replace it.");
  }

  if (args.withLibrary || args.withAll) {
    console.log("\n--- Installing library ---\n");
    await installLibraryCommand(args);
  }

  if (args.withExternal || args.withAll) {
    console.log("\n--- Installing external skills ---\n");
    await installExternalCommand(args);
  }
}

async function resolveScope(scope) {
  if (scope === "global" || scope === "project") return scope;
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Write opencode.json globally (~/.config/opencode) or in current project (cwd)? [project/global]: ");
    rl.close();
    const v = answer.trim().toLowerCase();
    if (v === "global" || v === "g") return "global";
    return "project";
  }
  return "project";
}

async function initConfig(args) {
  const scope = await resolveScope(args.scope);
  const targetPath =
    scope === "global"
      ? join(process.env.HOME || "", ".config", "opencode", "opencode.json")
      : join(args.dir, "opencode.json");

  let content = await readFile(join(PACKAGE_ROOT, "opencode.json"), "utf8");
  // Project-scope installs live under the project directory, so rewrite the
  // global paths in the template to project-relative ones.
  if (scope === "project") {
    content = content
      .replace(/"\{env:HOME\}\/\.agents\/skills"/g, '"./.agents/skills"')
      .replace(/"\{env:HOME\}\/\.junamis\/library\/\*\.md"/g, '"./.junamis/library/*.md"');
  }
  await mkdir(dirname(targetPath), { recursive: true });

  if (existsSync(targetPath) && !args.force) {
    let choice;
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      console.log(`${targetPath} already exists.`);
      const answer = await rl.question("Choose: (o)verwrite, (b)ackup and write, (i)gnore? [i]: ");
      rl.close();
      choice = answer.trim().toLowerCase();
    } else {
      // Support piped input (e.g. tests) without blocking when stdin is closed.
      choice = await new Promise((resolve) => {
        let data = "";
        const timer = setTimeout(() => resolve(data), 50);
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { data += chunk; });
        process.stdin.on("end", () => { clearTimeout(timer); resolve(data); });
        process.stdin.resume();
      });
      choice = choice.trim().toLowerCase();
      if (choice === "") {
        console.log(`${targetPath} already exists; use --force to overwrite.`);
        return;
      }
    }
    if (choice === "i" || choice === "ignore") {
      console.log("ignored; existing file left unchanged.");
      return;
    }
    if (choice === "b" || choice === "backup") {
      const backup = `${targetPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await rename(targetPath, backup);
      console.log(`backed up existing file to ${backup}`);
    } else if (choice === "o" || choice === "overwrite") {
      // fall through to overwrite
    } else {
      console.log("unknown choice; ignored.");
      return;
    }
  }

  await writeFile(targetPath, content, "utf8");
  console.log(`wrote ${targetPath}`);
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
  if (args.scope && args.scope !== "global" && args.scope !== "project") throw new Error(`unknown scope "${args.scope}"; expected global or project`);
  const scope = args.scope === "global" ? "global" : args.scope === "project" ? "project" : (process.stdin.isTTY ? await (async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Install library globally or into the current project? [global/project]: ");
    rl.close();
    return answer.trim().toLowerCase() === "project" ? "project" : "global";
  })() : "global");
  const projectDir = args.dir;
  const version = await packageVersion();
  const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: args.agent, scope, projectDir });
  const result = await applyLibraryInstall({
    agent: args.agent,
    files,
    version,
    force: args.force,
    dryRun: args.dryRun,
    scope,
    projectDir,
  });

  const counts = {};
  for (const a of result.actions) counts[a.action] = (counts[a.action] ?? 0) + 1;
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing";
  console.log(`library for ${args.agent} (junamis-agents-skills ${version}): ${summary}`);

  if (args.dryRun) {
    for (const a of result.actions) console.log(`  ${a.action.padEnd(12)} ${a.path}`);
  }
  for (const p of result.stale) console.log(`  ${args.dryRun ? "would remove" : "removed"} stale ${p}`);

  if (!result.ok) {
    console.error(`\n${result.conflicts.length} file(s) were edited by you and are not managed by junamis-agents-skills:`);
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
      console.log("               library not installed (run: junamis-agents-skills install-library)");
    }
  }
}

async function doctor(args) {
  const home = process.env.HOME || "";
  const checks = [];
  const ok = (label, pass, detail = "") => {
    checks.push({ label, pass, detail });
    console.log(`${pass ? "✔" : "✖"} ${label}${detail ? `: ${detail}` : ""}`);
  };

  const nodeMajor = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
  ok("Node.js >= 26", nodeMajor >= 26, process.version);

  const lock = JSON.parse(await readFile(join(PACKAGE_ROOT, "skills-lock.json"), "utf8"));
  const unknown = Object.entries(lock.skills).filter(([, e]) => (e.license ?? "unknown") === "unknown").map(([n]) => n);
  ok("Manifest licenses verified", unknown.length === 0, unknown.length ? unknown.join(", ") : `${Object.keys(lock.skills).length} skills`);

  for (const t of targets) {
    ok(`${t.label} detected`, t.detect());
    const dir = t.globalSkillsDir();
    ok(`${t.label} skills dir`, existsSync(dir), dir);
  }

  for (const doc of ["HANDOFF.md", "SAFETY.md", "EXTERNAL.md"]) {
    const p = join(home, ".junamis", "library", doc);
    ok(`Shared doc ${doc}`, existsSync(p), p);
  }

  const candidateConfigs = [join(args.dir, "opencode.json"), join(home, ".config", "opencode", "opencode.json")];
  for (const cfgPath of candidateConfigs) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
      const perm = cfg.permission;
      const valid = perm && ["read", "edit", "webfetch", "websearch", "external_directory"].every((k) => k in perm);
      ok(`opencode.json valid (${cfgPath})`, valid, valid ? "permission keys present" : "missing permission keys");
    } catch (e) {
      ok(`opencode.json valid (${cfgPath})`, false, e.message);
    }
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\ndoctor: ${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exitCode = 1;
}

export async function run(argv) {
  const args = parseArgs(argv);
  switch (args.command) {
    case "init":
      return init(args);
    case "init-config":
      return initConfig(args);
    case "install-library":
      return installLibraryCommand(args);
    case "install-external":
      return installExternalCommand(args);
    case "status":
      return status(args);
    case "sync":
      return installLibraryCommand(args);
    case "doctor":
      return doctor(args);
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      throw new Error(`unknown command: ${args.command}\n\n${HELP}`);
  }
}
