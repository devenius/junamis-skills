#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groupLock } from "../dist/external.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  if (lock.version !== 1) throw new Error(`unsupported lock version: ${lock.version}`);

  const unknownLicenses = Object.entries(lock.skills ?? {})
    .filter(([, entry]) => !entry.license || entry.license === "unknown")
    .map(([name]) => name);
  if (unknownLicenses.length > 0) {
    throw new Error(`unverified licenses: ${unknownLicenses.join(", ")}`);
  }

  const groups = groupLock(lock);
  const skillCount = groups.reduce((count, group) => count + group.skills.length, 0);
  console.log(`skills lock valid: ${skillCount} pinned skills across ${groups.length} source commits`);
}

main().catch((error) => {
  console.error(`skills lock invalid: ${error.message}`);
  process.exitCode = 1;
});
