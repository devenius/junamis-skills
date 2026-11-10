import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { getSkillTreeSha, preparePinnedSource } from "./pinned-source.js";
import { getTarget } from "./targets/index.js";
import { isRecord, parseJsonUnknown } from "./types/guards.js";
import type {
  ExternalInstallResult,
  LockGroup,
  LockedSkill,
  PinnedSourceSkill,
  PreparedCheckout,
  SkillPartition,
  SkillRef,
} from "./types/index.js";

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

export interface Scanner {
  readonly name: string;
  readonly version: string;
  readonly registry: string;
  readonly integrity: string;
}

// The scanner is the trusted component in the whole supply-chain story, so its
// registry and tarball integrity are constants, not project configuration.
export const SCANNER: Scanner = {
  name: "skillsio",
  version: "1.1.3",
  registry: "https://registry.npmjs.org/",
  integrity: "sha512-gsm2Urzgjrz9Mx84lkI4UOXSCkQlYgrUMqQqTDj5sn44vkRO+GDBg372UyUAw5vT/+h/I3MLh4+qgghm5tDDIA==",
};

const DENIED_ENV = /^(npm_config_|NPM_CONFIG_|pnpm_config_|PNPM_CONFIG_|NODE_OPTIONS|NODE_PATH|COREPACK_)/;
// CI markers make some tools switch to non-interactive or auto-accept paths.
const DENIED_ENV_EXACT: ReadonlySet<string> = new Set(["CI", "GITHUB_ACTIONS"]);

// A hostile project can set registry or Node options through the environment.
// Only keep the variables a scanner needs, then force our own registry paths.
export function sanitizedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
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

/** The subset of a fetch Response the integrity check reads. */
export interface RegistryResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal },
) => Promise<RegistryResponse>;

export async function verifyScannerIntegrity(fetchImpl: FetchLike = fetch): Promise<void> {
  const url = `${SCANNER.registry}${SCANNER.name}/${SCANNER.version}`;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: globalThis.AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`could not verify ${SCANNER.name}@${SCANNER.version}: HTTP ${response.status}`);
  }
  const metadata: unknown = await response.json();
  const dist = isRecord(metadata) && isRecord(metadata["dist"]) ? metadata["dist"] : {};
  const integrity = dist["integrity"];
  if (integrity !== SCANNER.integrity) {
    throw new Error(
      `${SCANNER.name}@${SCANNER.version} integrity mismatch (expected ${SCANNER.integrity}, got ${String(integrity)})`,
    );
  }
  const tarball = dist["tarball"];
  if (tarball !== SCANNER_TARBALL) {
    throw new Error(
      `${SCANNER.name}@${SCANNER.version} tarball mismatch (expected ${SCANNER_TARBALL}, got ${String(tarball)})`,
    );
  }
}

export function stripControlSequences(value: unknown): string {
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

function isValidSkillPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const segments = value.split("/");
  return segments.at(-1) === "SKILL.md" && segments.every((segment) =>
    segment !== "" && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment),
  );
}

// Agent ids accepted on the command line, mapped to the name skillsio expects.
const SKILLSIO_AGENT: ReadonlyMap<string, string> = new Map([
  ["opencode", "opencode"],
  ["claude", "claude-code"],
  ["claude-code", "claude-code"],
]);

const INSTALLERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["skillsio", ["pnpm", "--registry", SCANNER.registry, "dlx", `${SCANNER.name}@${SCANNER.version}`]],
]);

function installerRunner(installer: string): readonly string[] {
  const runner = INSTALLERS.get(installer);
  if (!runner) {
    throw new Error(`unknown installer "${installer}"; expected one of: ${[...INSTALLERS.keys()].join(", ")}`);
  }
  return runner;
}

export function validateAgent(agent: string): string {
  const mapped = SKILLSIO_AGENT.get(agent);
  if (mapped === undefined) {
    throw new Error(`unknown agent "${agent}"; expected one of: ${[...SKILLSIO_AGENT.keys()].join(", ")}`);
  }
  return mapped;
}

export function validateInstaller(installer: string): string {
  installerRunner(installer);
  return installer;
}

// A scan can be declined with wording or casing we do not control. Treat a
// line about security that also says cancel/decline/block/fail as a failure,
// but never turn an explicit pass into a cancellation. Match whole words only:
// a bare substring test would read the "fail" inside "failures" as a decline.
export function isSecurityCancellation(output: unknown): boolean {
  const text = String(output);
  if (text.toLowerCase().includes(SECURITY_CANCELLATION.toLowerCase())) return true;
  return text.split(/\r?\n/).some((line) => {
    const lower = line.toLowerCase();
    if (!lower.includes("security")) return false;
    if (/no security issues|security scan passed/.test(lower)) return false;
    return /\b(?:cancel(?:led|ed)?|declin(?:ed|e)|block(?:ed)?|fail(?:ed|s|ure)?)\b/.test(lower);
  });
}

export function installerExitCode(code: number | null | undefined, output: unknown): number {
  return isSecurityCancellation(output) ? SECURITY_CANCELLATION_EXIT : code ?? 1;
}

// Lock entries are external input: every field is proved before it is grouped.
export function groupLock(lock: unknown): LockGroup[] {
  if (!isRecord(lock)) throw new Error("lock must contain a skills object");
  const skills = lock["skills"];
  if (!isRecord(skills)) throw new Error("lock must contain a skills object");
  if (Object.keys(skills).length === 0) {
    throw new Error("lock must contain at least one skill");
  }

  const groups = new Map<string, { source: string; ref: string; skills: LockedSkill[] }>();
  for (const [name, entry] of Object.entries(skills)) {
    if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name in lock: "${name}"`);
    const source = isRecord(entry) ? entry["source"] : undefined;
    if (typeof source !== "string" || !SOURCE.test(source)) {
      throw new Error(`invalid source for "${name}" in lock: ${JSON.stringify(source)}`);
    }
    if (!isRecord(entry) || entry["sourceType"] !== "github") {
      throw new Error(`invalid sourceType for "${name}" in lock`);
    }
    const skillPath = entry["skillPath"];
    if (!isValidSkillPath(skillPath)) {
      throw new Error(`invalid skillPath for "${name}" in lock`);
    }
    const license = entry["license"];
    if (typeof license !== "string" || license.trim() === "") {
      throw new Error(`missing license for "${name}" in lock`);
    }
    const ref = entry["ref"];
    if (typeof ref !== "string" || !SHA.test(ref)) {
      throw new Error(`invalid commit SHA for "${name}" in lock`);
    }
    const treeSha = entry["treeSha"];
    if (typeof treeSha !== "string" || !SHA.test(treeSha)) {
      throw new Error(`invalid tree SHA for "${name}" in lock`);
    }
    const key = `${source}\0${ref}`;
    const skill: LockedSkill = { name, skillPath, treeSha };
    const group = groups.get(key);
    if (group) group.skills.push(skill);
    else groups.set(key, { source, ref, skills: [skill] });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    skills: [...group.skills].sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

export interface BuildCommandInput {
  readonly installer: string;
  readonly source: string;
  readonly agent: string;
  readonly skills: readonly string[];
  readonly local?: boolean;
}

// Returns an argv array. Never a string. Always includes --skip-scan: the
// scanner's high/critical prompt cannot be bypassed with -y, and install-time
// scanning is skipped by design (SECURITY.md is the recorded vetting record).
export function buildCommand({ installer, source, agent, skills, local = false }: BuildCommandInput): string[] {
  const runner = installerRunner(validateInstaller(installer));
  const skillsioAgent = validateAgent(agent);
  if (local ? !isAbsolute(source) : !SOURCE.test(source)) {
    throw new Error(`invalid ${local ? "local source path" : "source"}: ${JSON.stringify(source)}`);
  }
  for (const s of skills) if (!SKILL_NAME.test(s)) throw new Error(`invalid skill name: ${JSON.stringify(s)}`);
  return [...runner, "add", source, "--agent", skillsioAgent, "--skill", ...skills, "--skip-scan", "-g", "-y"];
}

export async function verifySkillTree(
  directory: string,
  skill: PinnedSourceSkill,
  readTreeSha: (directory: string, skillPath: string) => Promise<string> = getSkillTreeSha,
): Promise<void> {
  const actual = await readTreeSha(directory, skill.skillPath);
  if (actual !== skill.treeSha) {
    throw new Error(`locked tree SHA mismatch for "${skill.name}" (expected ${skill.treeSha}, got ${actual})`);
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") return false;
    throw error;
  }
}

export function partitionExistingSkills<T extends SkillRef>(
  skills: readonly T[],
  skillsDir: string,
  exists: (path: string) => boolean = pathExists,
): SkillPartition<T> {
  const available: T[] = [];
  const conflicts: Array<T & { readonly path: string }> = [];
  for (const skill of skills) {
    const path = join(skillsDir, skill.name);
    if (exists(path)) conflicts.push({ ...skill, path });
    else available.push(skill);
  }
  return { available, conflicts };
}

export interface RunCommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function runCommand(argv: readonly string[], timeout = 300000, options: RunCommandOptions = {}): Promise<number> {
  const { cwd = tmpdir(), env = sanitizedEnv() } = options;
  return new Promise((resolve) => {
    const [program, ...args] = argv;
    if (program === undefined) throw new Error("runCommand needs a program");
    const child = spawn(program, args, {
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
    let killTimer: NodeJS.Timeout | undefined;
    let settleTimer: NodeJS.Timeout | undefined;

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* ignore */ }
      }
    };
    const capture = (stream: NodeJS.ReadableStream, destination: NodeJS.WritableStream): void => {
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        capturedOutput = (capturedOutput + text).slice(-MAX_CAPTURE_BYTES);
        securityCancellationDetected ||= isSecurityCancellation(capturedOutput);
        const readable = stripControlSequences(text);
        if (readable) destination.write(readable);
      });
    };
    capture(child.stdout, process.stdout);
    capture(child.stderr, process.stderr);

    const finish = (code: number | null): void => {
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
      : undefined;
    // Resolve only once the child (and its process group) is actually gone.
    child.on("close", (code: number | null) => finish(code));
    child.on("error", () => finish(1));
  });
}

export interface InstallExternalOptions {
  readonly lockPath: string;
  readonly agent: string;
  readonly installer?: string;
  readonly log?: (message: string) => void;
  readonly run?: (argv: readonly string[], timeout: number) => Promise<number>;
  readonly prepareSource?: (group: LockGroup, options: { readonly timeout: number }) => Promise<PreparedCheckout>;
  readonly verifyTree?: (directory: string, skill: PinnedSourceSkill) => Promise<void>;
  readonly verifyScanner?: () => Promise<void>;
  readonly exists?: (path: string) => boolean;
  readonly retries?: number;
  readonly timeout?: number;
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
}: InstallExternalOptions): Promise<ExternalInstallResult> {
  validateInstaller(installer);
  validateAgent(agent);
  const target = getTarget(agent);
  if (!target) throw new Error(`unknown agent "${agent}"`);
  const parsed = parseJsonUnknown(await readFile(lockPath, "utf8"));
  if (!parsed.ok) throw new Error(`cannot read ${lockPath}: ${parsed.error.message}`);
  const groups = groupLock(parsed.value);
  let installed = 0;
  let skipped = 0;
  let failed = 0;
  let scannerVerified = false;

  log("scan: skipped at install by design; recorded results are in SECURITY.md (see library/SAFETY.md)");

  for (const group of groups) {
    let checkout: PreparedCheckout | undefined;
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
      log("    Please report this at https://github.com/devenius/junamis-skills/issues");
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
