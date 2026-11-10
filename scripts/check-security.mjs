#!/usr/bin/env node
// Thin launcher. The implementation is TypeScript in src/scripts/ and runs from
// the built dist/scripts/ output.
import { run } from "../dist/scripts/check-security.js";

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
