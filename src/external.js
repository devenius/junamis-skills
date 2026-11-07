import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { getSkillTreeSha, preparePinnedSource } from "./pinned-source.js";
import { getTarget } from "./targets/index.js";

// Installs every skill in skills-lock.json with the pinned skillsio scanner.
//
// Safety rules for this file:
// - No shell. Commands are argument arrays passed to spawn(), never strings.
// - Every value that reaches a command is validated against a strict pattern first.
// - The scanner is pinned and integrity-checked: registry, version, tarball URL,
//   and the SHA-512 integrity are constants in this file.
// - `-y` is required so `init` can install every skill non-interactively. It only
//   skips the overwrite prompt; it does NOT bypass the high/critical security
//   prompt, so a skill can be reported as installed while nothing was written.
// - `--skip-scan` is therefore always passed. Install-time scanning is skipped by
//   design; the recorded results in SECURITY.md plus the gate in library/SAFETY.md
//   are the vetting record. After a successful run every expected skill directory
//   is checked on disk before it is counted as installed.
// - Nothing else is answered on the user's behalf. stdin is inherited.

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;
const SECURITY_CANCELLATION = "Installation cancelled due to security concerns";
export { SECURITY_CANCELLATION };
const SECURITY_CANCELLATION_EXIT = 125;
const MAX_CAPTURE_BYTES = 64 * 1024;
export const KILL_GRACE_MS = 5000;
const SETTLE_GRACE_MS = KILL_GRACE_MS + 2000;

// The scanner is the trusted component in the whole supply-chain story, so its
// registry and tarball integrity are constants, not project configuration.
export const SCANNER = {
  name: "skillsio",
  version: "1.1.3",
  registry: "https://registry.npmjs.org/",
  integrity: "sha512-gsm2Urzgjrz9Mx84lkI4UOXSCkQlYgrUMqQqTDj5sn44vkRO+GDBg372UyUAw5vT/+h/I3MLh4+qgghm5tDDIA==",
};

const DENIED_ENV = /^(npm_config_|NPM_CONFIG_|pnpm_config_|PNPM_CONFIG_|NODE_OPTIONS|NODE_PATH|COREPACK_)/;
// CI markers make some tools switch to non-interactive or auto-accept paths.
const DENIED_ENV_EXACT = new Set(["CI", "GITHUB_ACTIONS"]);

// A hostile project can set registry or Node options through the environment.
// Only keep the variables a scanner needs, then force our own registry paths.
export function sanitizedEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (!DENIED_ENV.test(key) && !DENIED_ENV_EXACT.has(key) && value !== undefined) env[key] = value;
  }
  return Object.assign(env, {
    npm_config_registry: SCANNER.registry,
    npm_config_userconfig: devNull,
    npm_config_globalconfig: devNull,
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  });
}

const SCANNER_TARBALL = `${SCANNER.registry}${SCANNER.name}/-/${SCANNER.name}-${SCANNER.version}.tgz`;

export async function verifyScannerIntegrity(fetchImpl = fetch) {
  const url = `${SCANNER.registry}${SCANNER.name}/${SCANNER.version}`;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: globalThis.AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`could not verify ${SCANNER.name}@${SCANNER.version}: HTTP ${response.status}`);
  }
  const metadata = await response.json();
  const integrity = metadata?.dist?.integrity;
  if (integrity !== SCANNER.integrity) {
    throw new Error(
      `${SCANNER.name}@${SCANNER.version} integrity mismatch (expected ${SCANNER.integrity}, got ${String(integrity)})`,
    );
  }
  const tarball = metadata?.dist?.tarball;
  if (tarball !== SCANNER_TARBALL) {
    throw new Error(
      `${SCANNER.name}@${SCANNER.version} tarball mismatch (expected ${SCANNER_TARBALL}, got ${String(tarball)})`,
    );
  }
}

export function stripControlSequences(value) {
  return String(value)
    // OSC: ESC ] ... BEL or ST
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // CSI: ESC [ parameters final byte
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // Other two-byte ESC sequences.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[@-_]/g, "")
    // Remaining control characters except tab, newline, and carriage return.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function isValidSkillPath(value) {
  if (typeof value !== "string") return false;
  const segments = value.split("/");
  return segments.at(-1) === "SKILL.md" && segments.every((segment) =>
    segment !== "" && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment),
  );
}

// Agent ids accepted on the command line, mapped to the name skillsio expects.
const SKILLSIO_AGENT = { opencode: "opencode", claude: "claude-code", "claude-code": "claude-code" };

const INSTALLERS = {
  skillsio: ["pnpm", "--registry", SCANNER.registry, "dlx", `${SCANNER.name}@${SCANNER.version}`],
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

// A scan can be declined with wording or casing we do not control. Treat a
// line about security that also says cancel/decline/block/fail as a failure,
// but never turn an explicit pass into a cancellation. Match whole words only:
// a bare substring test would read the "fail" inside "failures" as a decline.
export function isSecurityCancellation(output) {
  const text = String(output);
  if (text.toLowerCase().includes(SECURITY_CANCELLATION.toLowerCase())) return true;
  return text.split(/\r?\n/).some((line) => {
    const lower = line.toLowerCase();
    if (!lower.includes("security")) return false;
    if (/no security issues|security scan passed/.test(lower)) return false;
    return /\b(?:cancel(?:led|ed)?|declin(?:ed|e)|block(?:ed)?|fail(?:ed|s|ure)?)\b/.test(lower);
  });
}

export function installerExitCode(code, output) {
  return isSecurityCancellation(output) ? SECURITY_CANCELLATION_EXIT : code ?? 1;
}

// Group lock entries by source so each source is one installer call.
export function groupLock(lock) {
  if (!lock || typeof lock !== "object" || !lock.skills || typeof lock.skills !== "object" || Array.isArray(lock.skills)) {
    throw new Error("lock must contain a skills object");
  }
  if (Object.keys(lock.skills).length === 0) {
    throw new Error("lock must contain at least one skill");
  }

  const groups = new Map();
  for (const [name, entry] of Object.entries(lock.skills ?? {})) {
    if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name in lock: "${name}"`);
    if (!entry || typeof entry.source !== "string" || !SOURCE.test(entry.source)) {
      throw new Error(`invalid source for "${name}" in lock: ${JSON.stringify(entry?.source)}`);
    }
    if (entry.sourceType !== "github") {
      throw new Error(`invalid sourceType for "${name}" in lock`);
    }
    if (!isValidSkillPath(entry.skillPath)) {
      throw new Error(`invalid skillPath for "${name}" in lock`);
    }
    if (typeof entry.license !== "string" || entry.license.trim() === "") {
      throw new Error(`missing license for "${name}" in lock`);
    }
    if (typeof entry.ref !== "string" || !SHA.test(entry.ref)) {
      throw new Error(`invalid commit SHA for "${name}" in lock`);
    }
    if (typeof entry.treeSha !== "string" || !SHA.test(entry.treeSha)) {
      throw new Error(`invalid tree SHA for "${name}" in lock`);
    }
    const key = `${entry.source}\0${entry.ref}`;
    if (!groups.has(key)) groups.set(key, { source: entry.source, ref: entry.ref, skills: [] });
    groups.get(key).skills.push({ name, skillPath: entry.skillPath, treeSha: entry.treeSha });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    skills: group.skills.sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

// Returns an argv array. Never a string. Always includes --skip-scan: the
// scanner's high/critical prompt cannot be bypassed with -y, and install-time
// scanning is skipped by design (SECURITY.md is the recorded vetting record).
export function buildCommand({ installer, source, agent, skills, local = false }) {
  const runner = INSTALLERS[validateInstaller(installer)];
  const skillsioAgent = validateAgent(agent);
  if (local ? !isAbsolute(source) : !SOURCE.test(source)) {
    throw new Error(`invalid ${local ? "local source path" : "source"}: ${JSON.stringify(source)}`);
  }
  for (const s of skills) if (!SKILL_NAME.test(s)) throw new Error(`invalid skill name: ${JSON.stringify(s)}`);
  return [...runner, "add", source, "--agent", skillsioAgent, "--skill", ...skills, "--skip-scan", "-g", "-y"];
}

export async function verifySkillTree(directory, skill, readTreeSha = getSkillTreeSha) {
  const actual = await readTreeSha(directory, skill.skillPath);
  if (actual !== skill.treeSha) {
    throw new Error(`locked tree SHA mismatch for "${skill.name}" (expected ${skill.treeSha}, got ${actual})`);
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export function partitionExistingSkills(skills, skillsDir, exists = pathExists) {
  const available = [];
  const conflicts = [];
  for (const skill of skills) {
    const path = join(skillsDir, skill.name);
    if (exists(path)) conflicts.push({ ...skill, path });
    else available.push(skill);
  }
  return { available, conflicts };
}

export function runCommand(argv, timeout = 300000, options = {}) {
  const { cwd = tmpdir(), env = sanitizedEnv() } = options;
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
      cwd,
      env,
      detached: true,
    });
    let settled = false;
    let capturedOutput = "";
    let securityCancellationDetected = false;
    let timedOut = false;
    let killTimer = null;
    let settleTimer = null;

    const killGroup = (signal) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* ignore */ }
      }
    };
    const capture = (stream, destination) => {
      stream?.on("data", (chunk) => {
        const text = chunk.toString();
        capturedOutput = (capturedOutput + text).slice(-MAX_CAPTURE_BYTES);
        securityCancellationDetected ||= isSecurityCancellation(capturedOutput);
        const readable = stripControlSequences(text);
        if (readable) destination.write(readable);
      });
    };
    capture(child.stdout, process.stdout);
    capture(child.stderr, process.stderr);

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      resolve(installerExitCode(timedOut ? 124 : code, securityCancellationDetected ? SECURITY_CANCELLATION : ""));
    };
    const timer = timeout > 0
      ? setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
        // A descendant can leave its own process group and keep the pipes open,
        // so `close` may never arrive. After the escalation window, settle anyway.
        settleTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(124);
        }, SETTLE_GRACE_MS);
      }, timeout)
      : null;
    // Resolve only once the child (and its process group) is actually gone.
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
  prepareSource = preparePinnedSource,
  verifyTree = verifySkillTree,
  verifyScanner = verifyScannerIntegrity,
  exists = pathExists,
  retries = 1,
  timeout = 300000,
}) {
  validateInstaller(installer);
  validateAgent(agent);
  const target = getTarget(agent);
  if (!target) throw new Error(`unknown agent "${agent}"`);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const groups = groupLock(lock);
  let installed = 0;
  let skipped = 0;
  let failed = 0;
  let scannerVerified = false;

  log("scan: skipped at install by design; recorded results are in SECURITY.md (see library/SAFETY.md)");

  for (const group of groups) {
    let checkout;
    let { available, conflicts } = partitionExistingSkills(group.skills, target.globalSkillsDir(), exists);
    skipped += conflicts.length;
    log(`\n--> ${group.source}`);
    log(`    commit: ${group.ref}`);
    log(`    skills: ${available.map((skill) => skill.name).join(", ") || "none"}`);
    for (const conflict of conflicts) {
      log(`    SKIPPED ${conflict.name}: existing skill was not overwritten (${conflict.path})`);
    }
    if (available.length === 0) {
      // Everything in this group is already installed. That is not a failure:
      // init runs again on machines that already have some or all skills.
      log(`    skipped: ${group.source} (all skills already installed)`);
      continue;
    }

    try {
      checkout = await prepareSource({ ...group, skills: available }, { timeout });
      const afterCheckout = partitionExistingSkills(available, target.globalSkillsDir(), exists);
      for (const conflict of afterCheckout.conflicts) {
        log(`    SKIPPED ${conflict.name}: skill appeared during checkout and was not overwritten (${conflict.path})`);
      }
      skipped += afterCheckout.conflicts.length;
      available = afterCheckout.available;
      if (available.length === 0) {
        log(`    skipped: ${group.source} (all remaining skills appeared during checkout)`);
        continue;
      }

      for (const skill of available) await verifyTree(checkout.path, skill);

      const argv = buildCommand({
        installer,
        source: checkout.path,
        agent,
        skills: available.map((skill) => skill.name),
        local: true,
      });
      log(`    command: ${argv.join(" ")}\n`);

      if (!scannerVerified) {
        await verifyScanner();
        scannerVerified = true;
      }

      let code = 1;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) log(`    retry ${attempt}/${retries}: ${group.source}`);
        code = await run(argv, timeout);
        if (code === 0 || code === SECURITY_CANCELLATION_EXIT) break;
      }
      if (code === 0) {
        // The scanner can exit 0 after silently skipping a skill whose scan
        // prompt went unanswered. Count only what actually landed on disk, and
        // treat a missing SKILL.md as a failure rather than a successful install.
        for (const skill of available) {
          const skillFile = join(target.globalSkillsDir(), skill.name, "SKILL.md");
          if (exists(skillFile)) {
            installed++;
          } else {
            failed++;
            log(`    MISSING ${skill.name}: no SKILL.md at ${skillFile} after a successful run`);
          }
        }
        continue;
      }

      failed++;
      if (code === SECURITY_CANCELLATION_EXIT) {
        log(`    FAILED: ${group.source} (security scan declined)`);
      } else {
        log(`    FAILED: ${group.source} (exit ${code})`);
      }
      log("    Some dependencies could not be installed. They may have been removed upstream.");
      log("    Please report this at https://github.com/devenius/junamis-agents-skills/issues");
    } catch (error) {
      failed++;
      log(`    FAILED: ${group.source} (${error instanceof Error ? error.message : String(error)})`);
      log("    No skills from this source were passed to the installer.");
    } finally {
      if (checkout) {
        try {
          await checkout.cleanup();
        } catch (error) {
          log(`    WARNING: could not clean temporary checkout: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  log(`\nDone. ${installed} installed, ${skipped} skipped, ${failed} failed across ${groups.length} source groups.`);
  return { groups: groups.length, installed, skipped, failed };
}
