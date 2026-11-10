#!/usr/bin/env node
import { run } from "../dist/orchestrator/cli.js";

run(process.argv.slice(2)).catch((error) => {
  console.error(`error: unexpected: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
