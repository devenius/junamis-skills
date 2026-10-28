import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

// Installs every skill in skills-lock.json with skillsio (or the skills CLI).
//
// Safety rules for this file:
// - No shell. Commands are argument arrays passed to spawn(), never strings.
// - Every value that reaches a command is validated against a strict pattern first.
// - The security scan is never skipped. Critical findings still prompt the user.
// - Nothing is answered on the user's behalf. stdin is inherited.

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Agent ids accepted on the command line, mapped to the name skillsio expects.
const SKILLSIO_AGENT = { opencode: "opencode", claude: "claude-code", "claude-code": "claude-code" };

const INSTALLERS = {
  skillsio: ["pnpm", "--silent", "dlx", "skillsio"],
  skills: ["npx", "--yes", "skills"],
};

export function validateAgent(agent) {
  if (!Object.hasOwn(SKILLSIO_AGENT, agent)) {
    throw new Error(`unknown agent "${agent}"; expected one of: ${Object.keys(SKILLSIO_AGENT).join(", ")}`);
  }
  return SKILLSIO_AGENT[agent];
}

export function validateInstaller(installer) {
  if (!Object.hasOwn(INSTALLERS, installer)) {
    throw new Error(`unknown installer "${installer}"; expected one of: ${Object.keys(INSTALLERS).join(", ")}`);
  }
  return installer;
}

// Group lock entries by source so each source is one installer call.
export function groupLock(lock) {
  const groups = new Map();
  for (const [name, entry] of Object.entries(lock.skills ?? {})) {
    if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name in lock: "${name}"`);
    if (!entry || typeof entry.source !== "string" || !SOURCE.test(entry.source)) {
      throw new Error(`invalid source for "${name}" in lock: ${JSON.stringify(entry?.source)}`);
    }
    if (!groups.has(entry.source)) groups.set(entry.source, []);
    groups.get(entry.source).push(name);
  }
  return [...groups].map(([source, skills]) => ({ source, skills: skills.sort() }));
}

// Returns an argv array. Never a string. Never includes --skip-scan.
export function buildCommand({ installer, source, agent, skills }) {
  const runner = INSTALLERS[validateInstaller(installer)];
  const skillsioAgent = validateAgent(agent);
  if (!SOURCE.test(source)) throw new Error(`invalid source: ${JSON.stringify(source)}`);
  for (const s of skills) if (!SKILL_NAME.test(s)) throw new Error(`invalid skill name: ${JSON.stringify(s)}`);
  return [...runner, "add", source, "--agent", skillsioAgent, "--skill", ...skills, "-y", "-g"];
}

export function runCommand(argv) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", shell: false });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

export async function installExternal({
  lockPath,
  agent,
  installer = "skillsio",
  log = console.log,
  run = runCommand,
}) {
  validateInstaller(installer);
  validateAgent(agent);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const groups = groupLock(lock);
  let failed = 0;

  for (const group of groups) {
    const argv = buildCommand({ installer, agent, ...group });
    log(`\n--> ${group.source}`);
    log(`    skills: ${group.skills.join(", ")}`);
    log(`    command: ${argv.join(" ")}\n`);
    const code = await run(argv);
    if (code !== 0) {
      failed++;
      log(`    FAILED: ${group.source} (exit ${code})`);
    }
  }

  log(`\nDone. ${groups.length - failed}/${groups.length} source groups installed.`);
  return { groups: groups.length, failed };
}
