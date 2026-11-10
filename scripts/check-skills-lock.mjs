#!/usr/bin/env node
// Thin launcher. The implementation is TypeScript in src/scripts/ and runs from
// the built dist/scripts/ output; the installer's groupLock is imported from
// the built external module.
import { groupLock } from "../dist/external.js";
import { run } from "../dist/scripts/check-skills-lock.js";

run({ groupLock }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
