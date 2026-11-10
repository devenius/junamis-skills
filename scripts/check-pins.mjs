#!/usr/bin/env node
// Thin launcher. The implementation is TypeScript in src/scripts/ and runs from
// the built dist/scripts/ output; the pinned-source helpers are imported from
// the built modules.
import { groupLock } from "../dist/external.js";
import { getSkillTreeSha, preparePinnedSource } from "../dist/pinned-source.js";
import { run } from "../dist/scripts/check-pins.js";

run({ groupLock, preparePinnedSource, getSkillTreeSha }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
