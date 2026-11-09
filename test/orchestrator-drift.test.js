import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareFingerprints, computeFingerprint } from "../src/orchestrator/drift.js";
import { makeFixture } from "./orchestrator-helpers.js";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "orch-fingerprint-"));
}

test("the library fingerprint is stable and covers only SKILL.md and agent files", async () => {
  const fixture = makeFixture();
  const first = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  const second = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  assert.equal(first.skills_lock_sha256, second.skills_lock_sha256);
  assert.equal(first.library_overrides_sha256, second.library_overrides_sha256);
  assert.match(first.library_overrides_sha256, /^sha256:[0-9a-f]{64}$/);

  writeFileSync(join(fixture.library, "skills", "route", "notes.md"), "nested file\n");
  const nested = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  assert.equal(nested.library_overrides_sha256, first.library_overrides_sha256);
});

test("an agent edit is drift and the changed path is named", async () => {
  const fixture = makeFixture();
  const recorded = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  writeFileSync(join(fixture.library, "agents", "orchestrator.md"), "---\nname: orchestrator\n---\nchanged\n");
  const current = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  const diff = compareFingerprints(recorded, current);
  assert.equal(diff.match, false);
  assert.equal(diff.manifest.changed, false);
  assert.equal(diff.overrides.changed, true);
  assert.deepEqual(diff.overrides.paths.map((entry) => entry.path), ["agents/orchestrator.md"]);
  assert.equal(diff.overrides.paths[0].change, "changed");
});

test("a new skill directory is drift and is listed as added", async () => {
  const fixture = makeFixture();
  const recorded = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  mkdirSync(join(fixture.library, "skills", "new-skill"), { recursive: true });
  writeFileSync(join(fixture.library, "skills", "new-skill", "SKILL.md"), "---\nname: new-skill\nidempotent: true\n---\n");
  const current = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  const diff = compareFingerprints(recorded, current);
  assert.equal(diff.match, false);
  assert.equal(diff.overrides.paths[0].path, "skills/new-skill/SKILL.md");
  assert.equal(diff.overrides.paths[0].change, "added");
});

test("manifest bytes are the lock hash and a manifest edit is drift", async () => {
  const fixture = makeFixture();
  const recorded = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  writeFileSync(fixture.manifest, `${JSON.stringify({ version: 1, skills: { extra: { source: "x" } } }, null, 2)}\n`);
  const current = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  const diff = compareFingerprints(recorded, current);
  assert.equal(diff.match, false);
  assert.equal(diff.manifest.changed, true);
  assert.notEqual(diff.manifest.old, diff.manifest.new);
  assert.match(diff.manifest.old, /^sha256:[0-9a-f]{64}$/);
  assert.match(diff.manifest.new, /^sha256:[0-9a-f]{64}$/);
});

test("a missing library or manifest is null and is not reported as present", async () => {
  const root = tempRoot();
  const fingerprint = await computeFingerprint({ libraryRoot: join(root, "missing"), manifestPath: join(root, "missing.json"), version: "1.0.0" });
  assert.equal(fingerprint.skills_lock_sha256, null);
  assert.equal(fingerprint.library_overrides_sha256, null);
  assert.equal(fingerprint.library_overrides_files, null);
  assert.equal(fingerprint.manifest_path, null);
});

test("a version change is reported but is not a drift gate", async () => {
  const fixture = makeFixture();
  const recorded = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.0" });
  const current = await computeFingerprint({ libraryRoot: fixture.library, manifestPath: fixture.manifest, version: "1.0.1" });
  const diff = compareFingerprints(recorded, current);
  assert.equal(diff.match, true);
  assert.equal(diff.versionChanged, true);
});
