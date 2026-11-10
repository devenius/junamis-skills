#!/usr/bin/env node
import { run } from "../dist/cli.js";

run(process.argv.slice(2)).catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
