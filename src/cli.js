import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PACKAGE_ROOT, GUIDE_NAME, MARKER_PATH, writeGuide } from "./guide.js";
import { targets } from "./targets/index.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const HELP = `junamis-skills

Usage:
  junamis-skills init [--force] [--dir <path>] [--with-external] [--agent <name>]
      write ${GUIDE_NAME} into the project. With --with-external, also install
      every skill in skills-lock.json using skillsio and print its scan alerts.

  junamis-skills install-external [--agent <name>] [--installer skillsio|skills]
      install every skill in skills-lock.json. Shows skillsio scan alerts.

  junamis-skills status [--dir <path>]
      show guide state and detected agents.

  junamis-skills help

  --dir          project directory (default: current directory)
  --force        rewrite the guide even if it exists
  --with-external  also install external skills (runs skillsio, shows alerts)
  --agent        target agent name for skillsio (default: opencode)
  --installer    skillsio (default) or skills
`;

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", force: false, dir: process.cwd(), withExternal: false, agent: "opencode", installer: "skillsio" };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--with-external") args.withExternal = true;
    else if (a === "--dir") args.dir = resolve(argv[++i] ?? "");
    else if (a === "--agent") args.agent = argv[++i] ?? "opencode";
    else if (a === "--installer") args.installer = argv[++i] ?? "skillsio";
    else throw new Error(`unknown option: ${a}`);
  }
  return args;
}

async function countSkills(dir) {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

async function runExternalInstall(agent, installer) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(SRC_DIR, "install-external.js"), "--agent", agent, "--installer", installer], {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    child.on("close", (code) => resolvePromise(code ?? 0));
    child.on("error", (err) => {
      console.error(`error: ${err.message}`);
      resolvePromise(1);
    });
  });
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
    const code = await runExternalInstall(args.agent, args.installer);
    if (code !== 0) process.exitCode = code;
  }
}

async function installExternal(args) {
  const code = await runExternalInstall(args.agent, args.installer);
  if (code !== 0) process.exitCode = code;
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
  }
}

export async function run(argv) {
  const args = parseArgs(argv);
  switch (args.command) {
    case "init":
      return init(args);
    case "install-external":
      return installExternal(args);
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
