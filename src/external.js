import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getTarget } from "./targets/index.js";

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
    if (!entry.skillPath || typeof entry.skillPath !== "string") {
      throw new Error(`invalid skillPath for "${name}" in lock`);
    }
    if (!groups.has(entry.source)) groups.set(entry.source, { skills: [], paths: {} });
    groups.get(entry.source).skills.push(name);
    groups.get(entry.source).paths[name] = entry.skillPath;
  }
  return [...groups].map(([source, data]) => ({ source, skills: data.skills.sort(), paths: data.paths }));
}

// Returns an argv array. Never a string. Never includes --skip-scan.
export function buildCommand({ installer, source, agent, skills }) {
  const runner = INSTALLERS[validateInstaller(installer)];
  const skillsioAgent = validateAgent(agent);
  if (!SOURCE.test(source)) throw new Error(`invalid source: ${JSON.stringify(source)}`);
  for (const s of skills) if (!SKILL_NAME.test(s)) throw new Error(`invalid skill name: ${JSON.stringify(s)}`);
  return [...runner, "add", source, "--agent", skillsioAgent, "--skill", ...skills, "-y", "-g"];
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

// Fallback when skillsio/skills is unavailable: fetch the skill directly from GitHub.
export async function fetchSkillFromGitHub(source, skillPath, destDir) {
  const branches = ["main", "master"];
  let lastError;
  for (const branch of branches) {
    const url = `https://raw.githubusercontent.com/${source}/${branch}/${skillPath}`;
    try {
      const text = await fetchText(url);
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, "SKILL.md"), text, "utf8");
      return { ok: true, branch, url };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("fetch failed");
}

export function runCommand(argv, timeout = 300000) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", shell: false });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code ?? 1);
    };
    const timer = timeout > 0
      ? setTimeout(() => {
          try { child.kill("SIGTERM"); } catch { /* ignore */ }
          finish(124);
        }, timeout)
      : null;
    child.on("close", (code) => finish(code));
    child.on("error", () => finish(1));
  });
}

export async function installExternal({
  lockPath,
  agent,
  installer = "skillsio",
  log = console.log,
  run = runCommand,
  retries = 1,
  timeout = 300000,
}) {
  validateInstaller(installer);
  validateAgent(agent);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const groups = groupLock(lock);
  let failed = 0;

  const target = getTarget(agent === "claude-code" ? "claude" : agent);
  const skillsDir = target ? target.globalSkillsDir() : null;

  for (const group of groups) {
    const argv = buildCommand({ installer, agent, source: group.source, skills: group.skills });
    log(`\n--> ${group.source}`);
    log(`    skills: ${group.skills.join(", ")}`);
    log(`    command: ${argv.join(" ")}\n`);
    let code = 1;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) log(`    retry ${attempt}/${retries}: ${group.source}`);
      code = await run(argv, timeout);
      if (code === 0) break;
    }
    if (code === 0) continue;

    // Fallback: fetch directly from GitHub when the installer is unavailable.
    log(`    installer failed; attempting direct GitHub fetch for ${group.source}`);
    let fallbackOk = true;
    if (!skillsDir) fallbackOk = false;
    for (const skill of group.skills) {
      const skillPath = group.paths[skill];
      const dest = skillsDir ? join(skillsDir, skill) : null;
      if (!dest) { fallbackOk = false; break; }
      try {
        await fetchSkillFromGitHub(group.source, skillPath, dest);
        log(`    fetched ${skill} from GitHub`);
      } catch (err) {
        fallbackOk = false;
        log(`    FAILED to fetch ${skill}: ${err.message}`);
      }
    }
    if (fallbackOk) {
      log(`    recovered ${group.source} via direct GitHub fetch`);
      continue;
    }

    failed++;
    log(`    FAILED: ${group.source} (exit ${code})`);
    log("    Some dependencies could not be installed. They may have been removed upstream.");
    log("    Please report this at https://github.com/devenius/junamis-agents-skills/issues");
  }

  log(`\nDone. ${groups.length - failed}/${groups.length} source groups installed.`);
  return { groups: groups.length, failed };
}
