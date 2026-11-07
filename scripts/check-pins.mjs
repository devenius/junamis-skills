#!/usr/bin/env node

// Network check for skills-lock.json. For every locked source/commit it fetches
// the ref into a temporary checkout and compares the actual folder tree SHA with
// the `treeSha` in the lock, printing every mismatch. This is intentionally NOT
// wired into CI or release because it needs network access. Run it when pins
// change or when an install reports a tree mismatch.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groupLock } from "../src/external.js";
import { getSkillTreeSha, preparePinnedSource } from "../src/pinned-source.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  const groups = groupLock(lock);

  let checked = 0;
  let mismatches = 0;
  let errors = 0;

  for (const group of groups) {
    console.log(`\n--> ${group.source} @ ${group.ref}`);
    let checkout;
    try {
      checkout = await preparePinnedSource(group);
      for (const skill of group.skills) {
        checked++;
        const actual = await getSkillTreeSha(checkout.path, skill.skillPath);
        if (actual === skill.treeSha) {
          console.log(`    ok ${skill.name}`);
        } else {
          mismatches++;
          console.log(`    MISMATCH ${skill.name}: lock ${skill.treeSha}, actual ${actual}`);
        }
      }
    } catch (error) {
      errors++;
      console.log(`    ERROR ${group.source}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (checkout) {
        try {
          await checkout.cleanup();
        } catch {
          // A failed cleanup must not hide a pin mismatch.
        }
      }
    }
  }

  console.log(`\n${checked} checked, ${mismatches} mismatch(es), ${errors} error(s).`);
  if (mismatches > 0 || errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`pin check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
