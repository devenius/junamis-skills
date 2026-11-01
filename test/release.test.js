import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPackageVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

function latestTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function toComparable(version) {
  return version.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewer(a, b) {
  if (!b) return true;
  const pa = toComparable(a);
  const pb = toComparable(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function changelogSection(version) {
  const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^## \\[${version.replace(/^v/, "")}\\]`).test(l));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  return (end === -1 ? lines.slice(start + 1) : lines.slice(start + 1, end)).join("\n");
}

test("CHANGELOG.md has an entry for the current package version", () => {
  const version = readPackageVersion();
  const section = changelogSection(version);
  assert.ok(section !== null, `CHANGELOG.md is missing a "## [${version}]" section`);
});

test("CHANGELOG.md is updated when releasing a newer tag than the latest available", () => {
  const version = readPackageVersion();
  const tag = `v${version}`;
  const latest = latestTag();

  // Only enforce when this release is newer than the latest published tag.
  if (!isNewer(version, latest)) return;

  const section = changelogSection(version);
  assert.ok(section !== null, `No CHANGELOG entry for new release ${tag}`);

  const bullets = section.split("\n").filter((l) => /^\s*[-*]\s+/.test(l));
  assert.ok(bullets.length >= 3, `CHANGELOG section for ${version} has too few change bullets (${bullets.length}); document the changes more thoroughly`);

  const hasSubsection = /^###\s+(Added|Changed|Fixed|Removed|Deprecated|Security)/m.test(section);
  assert.ok(hasSubsection, `CHANGELOG section for ${version} lacks an "Added/Changed/Fixed" subsection`);
});