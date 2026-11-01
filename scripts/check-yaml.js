#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectYamlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectYamlFiles(p));
    else if (name.endsWith(".yml") || name.endsWith(".yaml")) out.push(p);
  }
  return out;
}

const files = collectYamlFiles(root).filter((p) => !p.includes("/node_modules/") && !p.endsWith("pnpm-lock.yaml"));
let failed = false;
for (const file of files) {
  try {
    yaml.load(readFileSync(file, "utf8"));
    console.log(`✔ ${relative(root, file)}`);
  } catch (e) {
    failed = true;
    console.error(`✖ ${relative(root, file)}: ${e.message}`);
  }
}

if (failed) {
  console.error("\nyaml check failed");
  process.exit(1);
}
console.log(`\nyaml check passed (${files.length} files)`);