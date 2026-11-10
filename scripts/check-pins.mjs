#!/usr/bin/env node
// Thin launcher. The implementation is TypeScript in src/scripts/ and runs from
// the built dist/scripts/ output; the pinned-source Git helpers are still
// JavaScript in src/pinned-source.js, so they are passed in here.
import { groupLock } from "../src/external.js";
import { getSkillTreeSha, preparePinnedSource } from "../src/pinned-source.js";
import { run } from "../dist/scripts/check-pins.js";

run({ groupLock, preparePinnedSource, getSkillTreeSha }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
