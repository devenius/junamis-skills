// The release gate: version and changelog consistency, verified licenses, every
// check script, the tag match, and the test suite. Each check script is run
// through its launcher in `scripts/` so the release path exercises the same
// entry points a user does.

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage, isRecord, isString } from "../types/index.js";
import { packageRoot, readJsonFile, readSkillsLock } from "./support.js";

const VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

function fail(message: string): void {
  console.error(`✖ ${message}`);
  process.exitCode = 1;
}

function checkScript(label: string, script: string): void {
  try {
    execFileSync(process.execPath, [join(packageRoot, "scripts", script)], { stdio: "inherit" });
  } catch {
    fail(label);
  }
}

function hasUnknownLicense(entry: unknown): boolean {
  if (!isRecord(entry)) return true;
  const license = entry["license"];
  return license === undefined || license === null || license === "unknown";
}

async function main(argv: readonly string[]): Promise<void> {
  const pkg = await readJsonFile(join(packageRoot, "package.json"));
  if (!isRecord(pkg)) throw new Error("package.json must contain an object");

  const rawVersion = pkg["version"];
  if (!isString(rawVersion) || !VERSION.test(rawVersion)) {
    fail(`invalid package version: ${String(rawVersion)}`);
    return;
  }
  const version = rawVersion;

  const changelog = await readFile(join(packageRoot, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(version) && !changelog.includes("[Unreleased]")) {
    fail(`CHANGELOG.md does not mention version ${version} or [Unreleased]`);
  }

  const lock = await readSkillsLock(join(packageRoot, "skills-lock.json"));
  const unknown = Object.entries(lock.skills)
    .filter(([, entry]) => hasUnknownLicense(entry))
    .map(([name]) => name);
  if (unknown.length > 0) fail(`skills with unknown license: ${unknown.join(", ")}`);

  // Validate opencode.json
  checkScript("opencode.json check failed", "check-opencode-config.mjs");

  // Validate YAML files
  checkScript("yaml check failed", "check-yaml.js");

  // Verify that every internal and external skill appears in SECURITY.md.
  checkScript("security record check failed", "check-security.mjs");

  // Validate the immutable external skill lock.
  checkScript("skills lock check failed", "check-skills-lock.mjs");

  // Verify the published file set without creating an archive.
  checkScript("package contents check failed", "check-pack.mjs");

  const tagIndex = argv.indexOf("--tag");
  const tag = tagIndex >= 0 ? argv[tagIndex + 1] : process.env["RELEASE_TAG"];
  if (tag !== undefined) {
    const expected = `v${version}`;
    if (tag !== expected) fail(`release tag ${tag} does not match package version ${expected}`);
  }

  // Run the test suite as part of the release gate.
  try {
    const testFiles = (await readdir(join(packageRoot, "test")))
      .filter((file) => file.endsWith(".test.js"))
      .map((file) => join("test", file));
    execFileSync(process.execPath, ["--test", ...testFiles], { cwd: packageRoot, stdio: "inherit" });
  } catch {
    fail("test suite failed");
  }

  const exitCode = process.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) {
    console.error("\nrelease check failed");
    process.exit(exitCode);
  }
  console.log(`✔ release check passed for ${version}`);
}

/** CLI entry. The launcher in `scripts/` calls this with `process.argv.slice(2)`. */
export async function run(argv: readonly string[]): Promise<void> {
  try {
    await main(argv);
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
