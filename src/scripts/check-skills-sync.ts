// Compares skills-lock.json with the global OpenCode skills directory where
// `skillsio -g` installs. The directory is resolved by the launcher from the
// target adapter, so this file never hardcodes an agent path.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage, isRecord, isString } from "../types/index.js";
import { packageRoot, readSkillsLock } from "./support.js";

export interface CheckSkillsSyncDeps {
  /** The OpenCode global skills directory, from `getTarget("opencode").globalSkillsDir()`. */
  readonly skillsDir: string;
}

// Colors follow the same convention as the Node test runner:
// on when stdout is a TTY, off when NO_COLOR is set, forced on by FORCE_COLOR.
const useColor =
  process.env["NO_COLOR"] === undefined &&
  (process.env["FORCE_COLOR"] !== undefined || process.stdout.isTTY === true);

const paint = (code: string) => (text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
const style = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
};

const PASS = style.green("✔");
const FAIL = style.red("✖");
const WARN = style.yellow("⚠");
const INFO = style.cyan("ℹ");

const log = (line = ""): void => console.log(line);
const step = (n: number, total: number, title: string): void =>
  log(`\n${style.bold(`[${n}/${total}]`)} ${style.cyan(title)}`);
const detail = (text: string): void => log(`      ${style.dim(text)}`);

async function listInstalled(skillsDir: string): Promise<Set<string>> {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name),
  );
}

async function readSkillName(dir: string): Promise<string> {
  const text = await readFile(join(dir, "SKILL.md"), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const body = frontmatter?.[1];
  if (body === undefined) {
    throw new Error("SKILL.md has no frontmatter");
  }

  const line = /^name:\s*(.+?)\s*$/m.exec(body);
  const declared = line?.[1];
  if (declared === undefined) {
    throw new Error("SKILL.md frontmatter has no name");
  }

  return declared.replace(/^["']|["']$/g, "");
}

async function check(skillsDir: string): Promise<void> {
  const lockPath = join(packageRoot, "skills-lock.json");
  const skillsLabel = skillsDir;
  const started = Date.now();
  const TOTAL_STEPS = 5;

  log(style.bold("Skills sync check"));
  detail(`root: ${packageRoot}`);

  // 1. Manifest
  step(1, TOTAL_STEPS, "Read manifest");
  detail(`reading ${lockPath}`);
  const lock = await readSkillsLock(lockPath);
  const tracked = new Set(Object.keys(lock.skills));
  log(`      ${PASS} ${tracked.size} skills tracked in skills-lock.json`);

  // 2. Installed directory
  step(2, TOTAL_STEPS, "Scan installed skills");
  detail(`listing ${skillsDir}`);
  let installed: Set<string>;
  try {
    installed = await listInstalled(skillsDir);
  } catch {
    throw new Error(`missing ${skillsDir}`);
  }
  log(`      ${PASS} ${installed.size} directories found in ${skillsLabel}`);

  // 3. Membership
  step(3, TOTAL_STEPS, "Compare membership");
  const missing = [...tracked].filter((name) => !installed.has(name)).sort();
  const untracked = [...installed].filter((name) => !tracked.has(name)).sort();

  for (const name of missing) log(`      ${FAIL} missing from disk: ${name}`);
  // Untracked skills are expected in a shared global directory, so they warn only.
  for (const name of untracked) log(`      ${WARN} not managed by this manifest (warning only): ${name}`);
  const membershipOk = [...tracked].filter((name) => installed.has(name)).length;
  if (missing.length === 0) {
    log(`      ${PASS} every tracked skill is on disk and every installed skill is tracked`);
  } else {
    detail(`${membershipOk} of ${tracked.size} tracked skills present`);
  }

  // 4. Per-skill identity
  step(4, TOTAL_STEPS, "Verify each installed skill");
  const invalid: string[] = [];
  const toCheck = [...tracked].filter((name) => installed.has(name)).sort();
  let verified = 0;

  for (const name of toCheck) {
    const problems: string[] = [];
    const entry = lock.skills[name];
    const source = isRecord(entry) ? entry["source"] : undefined;

    if (!isString(source) || source.length === 0) {
      problems.push("lock entry has no source");
    }

    try {
      const declared = await readSkillName(join(skillsDir, name));
      if (declared !== name) {
        problems.push(`SKILL.md declares name "${declared}"`);
      }
    } catch (error) {
      problems.push(errorMessage(error));
    }

    if (problems.length === 0) {
      verified += 1;
      const label = isString(source) ? source : "unknown";
      log(`      ${PASS} ${name} ${style.dim(`(source: ${label})`)}`);
    } else {
      for (const problem of problems) {
        invalid.push(`${name}: ${problem}`);
        log(`      ${FAIL} ${name}: ${problem}`);
      }
    }
  }

  detail(`${verified} of ${toCheck.length} installed skills verified`);

  // 5. Result
  step(5, TOTAL_STEPS, "Result");
  const drift = missing.length + invalid.length;
  const seconds = ((Date.now() - started) / 1000).toFixed(2);

  log(`      ${INFO} tracked: ${tracked.size}   installed: ${installed.size}   verified: ${verified}`);
  log(`      ${INFO} missing: ${missing.length}   invalid: ${invalid.length}   unmanaged (warning): ${untracked.length}`);
  log(`      ${INFO} duration: ${seconds}s`);

  if (drift > 0) {
    log(`\n${FAIL} ${style.red("FAIL")}: skills-lock.json and ${skillsLabel} are out of sync.`);
    process.exitCode = 1;
    return;
  }

  log(`\n${PASS} ${style.green("OK")}: skills-lock.json and ${skillsLabel} are in sync.`);
}

/** CLI entry. The launcher in `scripts/` calls this with the resolved skills directory. */
export async function run(deps: CheckSkillsSyncDeps): Promise<void> {
  try {
    await check(deps.skillsDir);
  } catch (error) {
    console.error(`\n${FAIL} ${style.red("ERROR")}: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
