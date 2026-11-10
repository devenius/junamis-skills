#!/usr/bin/env node
// Thin launcher. The implementation is TypeScript in src/scripts/ and runs from
// the built dist/scripts/ output; the installer's own `groupLock` is still
// JavaScript in src/external.js, so it is passed in here instead of copied.
import { groupLock } from "../src/external.js";
import { run } from "../dist/scripts/check-skills-lock.js";

run({ groupLock }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
