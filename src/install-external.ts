#!/usr/bin/env node
// Thin entry point. The logic lives in ./external.ts so it can be tested.
// Usage: node dist/install-external.js [--agent opencode|claude] [--installer skillsio]

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installExternal } from "./external.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function main(argv: readonly string[]): Promise<number> {
  let agent = "opencode";
  let installer = "skillsio";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agent") agent = requireValue(argv, ++i, arg);
    else if (arg === "--installer") installer = requireValue(argv, ++i, arg);
    else throw new Error(`unknown option: ${String(arg)}`);
  }
  const { failed } = await installExternal({ lockPath: join(ROOT, "skills-lock.json"), agent, installer });
  return failed > 0 ? 1 : 0;
}

function requireValue(argv: readonly string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
