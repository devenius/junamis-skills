#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTarget } from "../src/targets/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "skills-lock.json");
// The sync check verifies the global OpenCode skills directory, where skillsio -g installs.
const skillsDir = getTarget("opencode").globalSkillsDir();
const skillsLabel = skillsDir;

// Colors follow the same convention as the Node test runner:
// on when stdout is a TTY, off when NO_COLOR is set, forced on by FORCE_COLOR.
const useColor =
  process.env.NO_COLOR === undefined &&
  (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY === true);

const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
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

const log = (line = "") => console.log(line);
const step = (n, total, title) => log(`\n${style.bold(`[${n}/${total}]`)} ${style.cyan(title)}`);
const detail = (text) => log(`      ${style.dim(text)}`);

const started = Date.now();
const TOTAL_STEPS = 5;

async function readLock() {
  let raw;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch {
    throw new Error(`missing ${lockPath}`);
  }

  const lock = JSON.parse(raw);
  if (
    !lock ||
    typeof lock !== "object" ||
    !lock.skills ||
    typeof lock.skills !== "object" ||
    Array.isArray(lock.skills)
  ) {
    throw new Error("skills-lock.json must contain a skills object");
  }

  return lock;
}

async function listInstalled() {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name),
  );
}

async function readSkillName(dir) {
  const text = await readFile(join(dir, "SKILL.md"), "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    throw new Error("SKILL.md has no frontmatter");
  }

  const line = frontmatter[1].match(/^name:\s*(.+?)\s*$/m);
  if (!line) {
    throw new Error("SKILL.md frontmatter has no name");
  }

  return line[1].replace(/^["']|["']$/g, "");
}

async function main() {
  log(style.bold("Skills sync check"));
  detail(`root: ${root}`);

  // 1. Manifest
  step(1, TOTAL_STEPS, "Read manifest");
  detail(`reading ${lockPath}`);
  const lock = await readLock();
  const tracked = new Set(Object.keys(lock.skills));
  log(`      ${PASS} ${tracked.size} skills tracked in skills-lock.json`);

  // 2. Installed directory
  step(2, TOTAL_STEPS, "Scan installed skills");
  detail(`listing ${skillsDir}`);
  let installed;
  try {
    installed = await listInstalled();
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
  const invalid = [];
  const toCheck = [...tracked].filter((name) => installed.has(name)).sort();
  let verified = 0;

  for (const name of toCheck) {
    const problems = [];
    const entry = lock.skills[name];

    if (!entry || typeof entry.source !== "string" || entry.source.length === 0) {
      problems.push("lock entry has no source");
    }

    try {
      const declared = await readSkillName(join(skillsDir, name));
      if (declared !== name) {
        problems.push(`SKILL.md declares name "${declared}"`);
      }
    } catch (error) {
      problems.push(error.message);
    }

    if (problems.length === 0) {
      verified += 1;
      log(`      ${PASS} ${name} ${style.dim(`(source: ${entry.source})`)}`);
    } else {
      for (const p of problems) {
        invalid.push(`${name}: ${p}`);
        log(`      ${FAIL} ${name}: ${p}`);
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

main().catch((error) => {
  console.error(`\n${FAIL} ${style.red("ERROR")}: ${error.message}`);
  process.exit(1);
});
