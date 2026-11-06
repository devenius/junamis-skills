import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "junamis-agents-skills.js");

function tempDirs() {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
  return { home, project };
}

test("doctor runs and reports checks", () => {
  const { home, project } = tempDirs();
  try {
    let out = "";
    try {
      out = execFileSync(process.execPath, [CLI, "doctor", "--dir", project], {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
      });
    } catch (e) {
      out = (e.stdout || "") + (e.stderr || "");
    }
    assert.match(out, /doctor:/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("sync dry-run reports library actions", () => {
  const { home, project } = tempDirs();
  try {
    const out = execFileSync(process.execPath, [CLI, "sync", "--agent", "opencode", "--dir", project, "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.match(out, /library for opencode/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("status reports a malformed project marker without crashing", () => {
  const { home, project } = tempDirs();
  try {
    mkdirSync(join(project, ".junamis"), { recursive: true });
    writeFileSync(join(project, ".junamis", "install.json"), "{not json");
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid marker/);
    assert.doesNotMatch(result.stderr, /Cannot read properties/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("status reports a malformed library manifest without crashing", () => {
  const { home, project } = tempDirs();
  try {
    const manifestDir = join(project, ".junamis", "installed");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, "library-opencode.json"), JSON.stringify({ files: "not-an-array" }));
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /library manifest invalid/);
    assert.match(result.stderr, /files must be an array/);
    assert.doesNotMatch(result.stderr, /Cannot read properties/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("doctor reports a malformed opencode.json without throwing a type error", () => {
  const { home, project } = tempDirs();
  try {
    writeFileSync(join(project, "opencode.json"), JSON.stringify({ permission: 5 }));
    const result = spawnSync(process.execPath, [CLI, "doctor", "--dir", project], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /permission must be an object/);
    assert.doesNotMatch(result.stderr, /Cannot read properties/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init --with-library writes guide and installs library", () => {
  const { home, project } = tempDirs();
  try {
    const out = execFileSync(process.execPath, [CLI, "init", "--dir", project, "--with-library", "--agent", "opencode"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.match(out, /wrote .*junamis-agents-skills-guide\.md/);
    assert.match(out, /library for opencode/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
