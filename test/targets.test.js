import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { targets, getTarget } from "../src/targets/index.js";
import { statusLocations } from "../src/cli.js";

test("opencode target resolves external and internal skill directories separately", () => {
  const target = getTarget("opencode");
  const projectDir = join(homedir(), "opencode-project");

  assert.equal(target.globalSkillsDir(), join(homedir(), ".agents", "skills"));
  assert.equal(target.librarySkillsDir(), join(homedir(), ".config", "junamis", "skills", "skills"));
  assert.equal(target.projectSkillsDir(projectDir), join(projectDir, ".agents", "skills"));
  assert.equal(target.projectLibrarySkillsDir(projectDir), join(projectDir, ".config", "junamis", "skills", "skills"));
});

test("claude target resolves to ~/.claude/skills", () => {
  assert.equal(getTarget("claude").globalSkillsDir(), join(homedir(), ".claude", "skills"));
});

test("cursor target resolves to ~/.cursor/skills", () => {
  assert.equal(getTarget("cursor").globalSkillsDir(), join(homedir(), ".cursor", "skills"));
});

test("windsurf target resolves legacy skills and current Devin agent paths", () => {
  const target = getTarget("windsurf");
  const projectDir = join(homedir(), "windsurf-project");

  assert.equal(target.globalSkillsDir(), join(homedir(), ".codeium", "windsurf", "skills"));
  assert.equal(target.projectSkillsDir(projectDir), join(projectDir, ".windsurf", "skills"));
  assert.equal(target.libraryAgentsDir(), join(homedir(), ".config", "devin", "agents"));
  assert.equal(target.projectAgentsDir(projectDir), join(projectDir, ".devin", "agents"));
});

test("cline target resolves to ~/.cline/skills", () => {
  assert.equal(getTarget("cline").globalSkillsDir(), join(homedir(), ".cline", "skills"));
});

test("every registered target exposes the complete install adapter", () => {
  for (const t of targets) {
    assert.equal(typeof t.id, "string");
    assert.equal(typeof t.label, "string");
    assert.equal(typeof t.globalSkillsDir, "function");
    assert.equal(typeof t.librarySkillsDir, "function");
    assert.equal(typeof t.libraryAgentsDir, "function");
    assert.equal(typeof t.libraryAgentsCanonicalDir, "function");
    assert.equal(typeof t.projectSkillsDir, "function");
    assert.equal(typeof t.projectLibrarySkillsDir, "function");
    assert.equal(typeof t.projectLibraryAgentsCanonicalDir, "function");
    assert.equal(typeof t.projectAgentsDir, "function");
    assert.equal(typeof t.libraryAgentFormat, "string");
    assert.equal(typeof t.detect, "function");
  }
});

test("unknown target id returns null", () => {
  assert.equal(getTarget("nope"), null);
});

test("status locations include global and project manifests", () => {
  const projectDir = join(homedir(), "status-project");
  const locations = statusLocations("opencode", "all", projectDir);

  assert.deepEqual(locations.map(({ scope }) => scope), ["global", "project"]);
  assert.equal(locations[1].skillsDir, join(projectDir, ".agents", "skills"));
  assert.equal(locations[1].librarySkillsDir, join(projectDir, ".config", "junamis", "skills", "skills"));
  assert.equal(locations[1].manifestPath, join(projectDir, ".config", "junamis", "skills", "installed", "library-opencode.json"));
  assert.equal(locations[1].canonicalAgentsDir, join(projectDir, ".config", "junamis", "skills", "agents"));
  assert.equal(locations[1].agentsDir, join(projectDir, ".opencode", "agents"));
});

test("every non-OpenCode target shares one library and external skills directory", () => {
  for (const t of targets) {
    const globalLibrary = t.librarySkillsDir();
    const projectLibrary = t.projectLibrarySkillsDir(join(homedir(), "target-project"));
    assert.ok(typeof globalLibrary === "string" && globalLibrary.length > 0, `${t.id}: global library dir`);
    assert.ok(typeof projectLibrary === "string" && projectLibrary.length > 0, `${t.id}: project library dir`);
    if (t.id !== "opencode") {
      assert.equal(globalLibrary, t.globalSkillsDir(), `${t.id}: library and external dirs are shared`);
    }
  }
});

test("status locations can select one installation scope", () => {
  const projectDir = join(homedir(), "status-project");

  assert.deepEqual(statusLocations("opencode", "global", projectDir).map(({ scope }) => scope), ["global"]);
  assert.deepEqual(statusLocations("opencode", "project", projectDir).map(({ scope }) => scope), ["project"]);
});

test("status locations reject unknown scopes", () => {
  assert.throws(() => statusLocations("opencode", "workspace"), /unknown scope/);
});
