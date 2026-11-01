#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
}

async function main() {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) fail(`invalid package version: ${version}`);

  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(version) && !changelog.includes("[Unreleased]")) {
    fail(`CHANGELOG.md does not mention version ${version} or [Unreleased]`);
  }

  const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  const unknown = Object.entries(lock.skills).filter(([, e]) => (e.license ?? "unknown") === "unknown").map(([n]) => n);
  if (unknown.length) fail(`skills with unknown license: ${unknown.join(", ")}`);

  // Validate opencode.json
  try {
    execFileSync(process.execPath, [join(root, "scripts", "check-opencode-config.mjs")], { stdio: "inherit" });
  } catch {
    fail("opencode.json check failed");
  }

  // Validate YAML files
  try {
    execFileSync(process.execPath, [join(root, "scripts", "check-yaml.js")], { stdio: "inherit" });
  } catch {
    fail("yaml check failed");
  }

  const tag = process.argv.includes("--tag") ? process.argv[process.argv.indexOf("--tag") + 1] : process.env.RELEASE_TAG;
  if (tag) {
    const expected = `v${version}`;
    if (tag !== expected) fail(`release tag ${tag} does not match package version ${expected}`);
  }

  // Run the test suite as part of the release gate.
  try {
    const testFiles = (await readdir(join(root, "test"))).filter((f) => f.endsWith(".test.js")).map((f) => join("test", f));
    execFileSync(process.execPath, ["--test", ...testFiles], { cwd: root, stdio: "inherit" });
  } catch {
    fail("test suite failed");
  }

  if (process.exitCode) {
    console.error("\nrelease check failed");
    process.exit(process.exitCode);
  }
  console.log(`✔ release check passed for ${version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});