// Network check for skills-lock.json. For every locked source/commit it fetches
// the ref into a temporary checkout and compares the actual folder tree SHA with
// the `treeSha` in the lock, printing every mismatch. This is intentionally NOT
// wired into CI or release because it needs network access. Run it when pins
// change or when an install reports a tree mismatch.
//
// The Git work is the installer's own code in src/pinned-source.js, so the
// launcher passes those functions in rather than a second implementation here.

import { join } from "node:path";

import { errorMessage } from "../types/index.js";
import {
  lockGroups,
  packageRoot,
  readSkillsLock,
  type GroupLock,
  type PinnedCheckout,
  type PreparePinnedSource,
  type SkillTreeSha,
} from "./support.js";

export interface CheckPinsDeps {
  readonly groupLock: GroupLock;
  readonly preparePinnedSource: PreparePinnedSource;
  readonly getSkillTreeSha: SkillTreeSha;
}

async function check(deps: CheckPinsDeps): Promise<void> {
  const lock = await readSkillsLock(join(packageRoot, "skills-lock.json"));
  const groups = lockGroups(deps.groupLock(lock));

  let checked = 0;
  let mismatches = 0;
  let errors = 0;

  for (const group of groups) {
    console.log(`\n--> ${group.source} @ ${group.ref}`);
    let checkout: PinnedCheckout | undefined;
    try {
      const pinned = await deps.preparePinnedSource(group);
      checkout = pinned;
      for (const skill of group.skills) {
        checked++;
        const actual = await deps.getSkillTreeSha(pinned.path, skill.skillPath);
        if (actual === skill.treeSha) {
          console.log(`    ok ${skill.name}`);
        } else {
          mismatches++;
          console.log(`    MISMATCH ${skill.name}: lock ${skill.treeSha}, actual ${actual}`);
        }
      }
    } catch (error) {
      errors++;
      console.log(`    ERROR ${group.source}: ${errorMessage(error)}`);
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

/** CLI entry. The launcher in `scripts/` calls this with the pinned-source functions. */
export async function run(deps: CheckPinsDeps): Promise<void> {
  try {
    await check(deps);
  } catch (error) {
    console.error(`pin check failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
