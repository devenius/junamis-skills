// Parses every YAML file in the repository except pnpm-lock.yaml, so a broken
// workflow, manifest, or skill document fails here instead of at use time.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import * as yaml from "js-yaml";

import { errorMessage } from "../types/index.js";
import { packageRoot } from "./support.js";

function collectYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) out.push(...collectYamlFiles(path));
    else if (name.endsWith(".yml") || name.endsWith(".yaml")) out.push(path);
  }
  return out;
}

/** CLI entry. The launcher in `scripts/` calls this. */
export function run(): void {
  const files = collectYamlFiles(packageRoot).filter(
    (path) => !path.includes("/node_modules/") && !path.endsWith("pnpm-lock.yaml"),
  );

  let failed = false;
  for (const file of files) {
    try {
      yaml.load(readFileSync(file, "utf8"));
      console.log(`✔ ${relative(packageRoot, file)}`);
    } catch (error) {
      failed = true;
      console.error(`✖ ${relative(packageRoot, file)}: ${errorMessage(error)}`);
    }
  }

  if (failed) {
    console.error("\nyaml check failed");
    process.exitCode = 1;
    return;
  }
  console.log(`\nyaml check passed (${files.length} files)`);
}
