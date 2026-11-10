// Asserts that SECURITY.md covers every internal and external skill and keeps a
// dated `Last external scan` line. SECURITY.md plus library/SAFETY.md is the
// vetting record, so a skill that is missing here is a release blocker.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "../types/index.js";
import { packageRoot, readSkillsLock } from "./support.js";

const SCAN_LINE = /^Last external scan:\s*\d{4}-\d{2}\s*$/m;

async function check(): Promise<void> {
  const security = await readFile(join(packageRoot, "SECURITY.md"), "utf8");
  if (!SCAN_LINE.test(security)) {
    throw new Error("SECURITY.md has no valid `Last external scan: YYYY-MM` line");
  }

  const covered = new Set<string>();
  for (const line of security.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const first = line.split("|")[1]?.trim();
    if (first === undefined) continue;
    if (first === "Skill" || first.startsWith("---")) continue;
    covered.add(first);
  }

  const internal = (await readdir(join(packageRoot, "library", "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const lock = await readSkillsLock(join(packageRoot, "skills-lock.json"));
  const external = Object.keys(lock.skills).sort();

  const missing = [...internal, ...external].filter((name) => !covered.has(name));
  if (missing.length > 0) {
    throw new Error(`SECURITY.md is missing ${missing.length} skill(s): ${missing.join(", ")}`);
  }

  console.log(
    `security record valid: ${internal.length} internal + ${external.length} external = ${internal.length + external.length} skills`,
  );
}

/** CLI entry. The launcher in `scripts/` calls this. */
export async function run(): Promise<void> {
  try {
    await check();
  } catch (error) {
    console.error(`security record invalid: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
