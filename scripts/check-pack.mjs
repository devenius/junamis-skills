#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_FILES = [
  "bin/junamis-skills.js",
  "src/cli.js",
  "src/external.js",
  "src/pinned-source.js",
  "src/library-install.js",
  "src/paths.js",
  "library/agents/orchestrator.md",
  "library/skills/route/SKILL.md",
  "skills-lock.json",
  "junamis-skills.yml",
  "SECURITY.md",
];
const EXCLUDED_PREFIXES = ["skills/", "nestjs-agent-skills/"];

function main() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  const [pack] = JSON.parse(output);
  if (!pack || !Array.isArray(pack.files)) throw new Error("npm pack returned no file manifest");

  const files = new Set(pack.files.map((file) => file.path));
  const missing = REQUIRED_FILES.filter((file) => !files.has(file));
  if (missing.length > 0) throw new Error(`package is missing required files: ${missing.join(", ")}`);

  const leaked = [...files].filter((file) => EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)));
  if (leaked.length > 0) throw new Error(`package includes nested upstream clones: ${leaked.join(", ")}`);

  console.log(`package contents valid: ${files.size} files, ${pack.unpackedSize} unpacked bytes`);
}

try {
  main();
} catch (error) {
  console.error(`package contents invalid: ${error.message}`);
  process.exitCode = 1;
}
