#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const security = await readFile(join(root, "SECURITY.md"), "utf8");
  if (!/^Last external scan:\s*\d{4}-\d{2}\s*$/m.test(security)) {
    throw new Error("SECURITY.md has no valid `Last external scan: YYYY-MM` line");
  }

  const covered = new Set();
  for (const line of security.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const first = line.split("|")[1].trim();
    if (first === "Skill" || first.startsWith("---")) continue;
    covered.add(first);
  }

  const internal = (await readdir(join(root, "library", "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  const external = Object.keys(lock.skills ?? {}).sort();

  const missing = [...internal, ...external].filter((name) => !covered.has(name));
  if (missing.length > 0) {
    throw new Error(`SECURITY.md is missing ${missing.length} skill(s): ${missing.join(", ")}`);
  }

  console.log(`security record valid: ${internal.length} internal + ${external.length} external = ${internal.length + external.length} skills`);
}

main().catch((error) => {
  console.error(`security record invalid: ${error.message}`);
  process.exitCode = 1;
});
