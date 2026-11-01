#!/usr/bin/env node
// Thin entry point. The logic lives in ./external.js so it can be tested.
// Usage: node src/install-external.js [--agent opencode|claude] [--installer skillsio|skills]

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installExternal } from "./external.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function main(argv) {
  let agent = "opencode";
  let installer = "skillsio";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent") agent = argv[++i];
    else if (argv[i] === "--installer") installer = argv[++i];
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  const { failed } = await installExternal({ lockPath: join(ROOT, "skills-lock.json"), agent, installer });
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => { console.error(`error: ${error.message}`); process.exitCode = 1; });
}
