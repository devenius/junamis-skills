import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { targets, getTarget } from "../src/targets/index.js";

test("opencode target resolves to the global Agent Skills directory", () => {
  assert.equal(getTarget("opencode").globalSkillsDir(), join(homedir(), ".agents", "skills"));
});

test("claude target resolves to ~/.claude/skills", () => {
  assert.equal(getTarget("claude").globalSkillsDir(), join(homedir(), ".claude", "skills"));
});

test("cursor target resolves to ~/.cursor/skills", () => {
  assert.equal(getTarget("cursor").globalSkillsDir(), join(homedir(), ".cursor", "skills"));
});

test("windsurf target resolves to ~/.windsurf/skills", () => {
  assert.equal(getTarget("windsurf").globalSkillsDir(), join(homedir(), ".windsurf", "skills"));
});

test("cline target resolves to ~/.cline/skills", () => {
  assert.equal(getTarget("cline").globalSkillsDir(), join(homedir(), ".cline", "skills"));
});

test("every registered target exposes id, label, globalSkillsDir, detect", () => {
  for (const t of targets) {
    assert.equal(typeof t.id, "string");
    assert.equal(typeof t.label, "string");
    assert.equal(typeof t.globalSkillsDir, "function");
    assert.equal(typeof t.detect, "function");
  }
});

test("unknown target id returns null", () => {
  assert.equal(getTarget("nope"), null);
});
