#!/usr/bin/env node
// Thin launcher. The implementation is TypeScript in src/scripts/ and runs from
// the built dist/scripts/ output; the target adapter is imported from the built
// module.
import { getTarget } from "../dist/targets/index.js";
import { run } from "../dist/scripts/check-skills-sync.js";

const target = getTarget("opencode");
if (!target) throw new Error("the opencode target is not registered");

run({ skillsDir: target.globalSkillsDir() }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
