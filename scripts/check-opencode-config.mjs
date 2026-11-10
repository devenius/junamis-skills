#!/usr/bin/env node
// Thin launcher. The implementation is TypeScript in src/scripts/ and runs from
// the built dist/scripts/ output.
import { run } from "../dist/scripts/check-opencode-config.js";

// Temporary compatibility re-export. `test/config.test.js` switches to importing
// the built module directly in the follow-up test commit.
export { effectFor, validateConfig } from "../dist/scripts/check-opencode-config.js";

run(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
