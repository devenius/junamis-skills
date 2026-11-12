// Proves the published file set without creating an archive: every required file
// is present and no nested upstream clone leaks into the package.
//
// `npm pack` is the source of truth for what ships, so its JSON output is
// external input and is parsed as `unknown`.

import { execFileSync } from "node:child_process";

import { errorMessage, isRecord, isString, parseJsonUnknown } from "../types/index.js";
import { isUnknownArray, packageRoot } from "./support.js";

const REQUIRED_FILES: readonly string[] = [
  "bin/junamis-skills.js",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/types/index.js",
  "dist/types/index.d.ts",
  "dist/cli.js",
  "dist/guide.js",
  "dist/orchestrator/cli.js",
  "dist/design/cli.js",
  "dist/reconcile/cli.js",
  "scripts/orchestrator-state.mjs",
  "scripts/design-registry.mjs",
  "scripts/reconcile.mjs",
  "docs/design/_schema.md",
  "docs/RECONCILE.md",
  "library/agents/orchestrator.md",
  "library/skills/route/SKILL.md",
  "library/RESUME.md",
  "skills-lock.json",
  "junamis-skills.yml",
  "SECURITY.md",
];
const EXCLUDED_PREFIXES: readonly string[] = ["skills/", "nestjs-agent-skills/"];

function packedFilesOf(manifest: unknown): { files: Set<string>; unpackedSize: unknown } {
  const [pack] = isUnknownArray(manifest) ? manifest : [];
  if (!isRecord(pack) || !isUnknownArray(pack["files"])) {
    throw new Error("npm pack returned no file manifest");
  }

  const files = new Set<string>();
  for (const file of pack["files"]) {
    if (!isRecord(file) || !isString(file["path"])) {
      throw new Error("npm pack returned an invalid file entry");
    }
    files.add(file["path"]);
  }

  return { files, unpackedSize: pack["unpackedSize"] };
}

function main(): void {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
  });

  const parsed = parseJsonUnknown(output);
  if (!parsed.ok) throw new Error(`npm pack returned invalid JSON: ${parsed.error.message}`);

  const { files, unpackedSize } = packedFilesOf(parsed.value);
  const missing = REQUIRED_FILES.filter((file) => !files.has(file));
  if (missing.length > 0) throw new Error(`package is missing required files: ${missing.join(", ")}`);

  const leaked = [...files].filter((file) => EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)));
  if (leaked.length > 0) throw new Error(`package includes nested upstream clones: ${leaked.join(", ")}`);

  console.log(`package contents valid: ${files.size} files, ${String(unpackedSize)} unpacked bytes`);
}

/** CLI entry. The launcher in `scripts/` calls this. */
export function run(): void {
  try {
    main();
  } catch (error) {
    console.error(`package contents invalid: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
