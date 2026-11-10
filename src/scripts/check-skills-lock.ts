// Validates skills-lock.json: version 1, a verified license on every entry, and
// a grouping that the installer can consume. Grouping is the installer's own
// rule, so the launcher passes `groupLock` in from `src/external.js` rather than
// a second copy living here.

import { join } from "node:path";

import { errorMessage, isRecord, isString } from "../types/index.js";
import { lockGroups, packageRoot, readSkillsLock, type GroupLock } from "./support.js";

export interface CheckSkillsLockDeps {
  readonly groupLock: GroupLock;
}

function licenseOf(entry: unknown): unknown {
  return isRecord(entry) ? entry["license"] : undefined;
}

function hasUnverifiedLicense(entry: unknown): boolean {
  const license = licenseOf(entry);
  return !isString(license) || license.trim() === "" || license === "unknown";
}

/** CLI entry. The launcher in `scripts/` calls this with the installer's `groupLock`. */
export async function run(deps: CheckSkillsLockDeps): Promise<void> {
  try {
    const lock = await readSkillsLock(join(packageRoot, "skills-lock.json"));
    if (lock.version !== 1) throw new Error(`unsupported lock version: ${String(lock.version)}`);

    const unknownLicenses = Object.entries(lock.skills)
      .filter(([, entry]) => hasUnverifiedLicense(entry))
      .map(([name]) => name);
    if (unknownLicenses.length > 0) {
      throw new Error(`unverified licenses: ${unknownLicenses.join(", ")}`);
    }

    const groups = lockGroups(deps.groupLock(lock));
    const skillCount = groups.reduce((count, group) => count + group.skills.length, 0);
    console.log(`skills lock valid: ${skillCount} pinned skills across ${groups.length} source commits`);
  } catch (error) {
    console.error(`skills lock invalid: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
