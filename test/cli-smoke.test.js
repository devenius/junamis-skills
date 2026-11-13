import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { runInit } from "../dist/cli.js";

// Force plain output so the captured streams below are not wrapped in ANSI
// codes even if the test runner happens to expose a TTY.
process.env.NO_COLOR = "1";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "junamis-skills.js");

function tempDirs() {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
  return { home, project };
}

test("status reports a malformed project marker without crashing", () => {
  const { home, project } = tempDirs();
  try {
    mkdirSync(join(project, ".junamis"), { recursive: true });
    writeFileSync(join(project, ".junamis", "junamis-skills.json"), "{not json");
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project, "--scope", "project"], {
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
    const manifestDir = join(project, ".config", "junamis", "skills", "installed");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, "library-opencode.json"), JSON.stringify({ files: "not-an-array" }));
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project, "--scope", "project"], {
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

test("status reports a malformed opencode.json without throwing a type error", () => {
  const { home, project } = tempDirs();
  try {
    writeFileSync(join(project, "opencode.json"), JSON.stringify({ permission: 5 }));
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project, "--scope", "project"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /expected V2 permissions array, mcp\.servers object, and plugins array/);
    assert.doesNotMatch(result.stderr, /Cannot read properties/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("status reports a non-array permissions value without throwing a type error", () => {
  const { home, project } = tempDirs();
  try {
    writeFileSync(join(project, "opencode.json"), JSON.stringify({ permissions: "bad" }));
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project, "--scope", "project"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /expected V2 permissions array, mcp\.servers object, and plugins array/);
    assert.doesNotMatch(result.stderr, /Cannot read properties/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init --dry-run reports guide, config, library, and external plan without writing or network", () => {
  const { home, project } = tempDirs();
  try {
    const out = execFileSync(process.execPath, [
      CLI, "init", "--dry-run", "--agent", "opencode", "--scope", "project", "--dir", project,
    ], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.match(out, /guide: would write/);
    assert.match(out, /config: would write/);
    assert.match(out, /library for opencode/);
    assert.match(out, /external: 24 pinned skills would be installed/);
    assert.equal(existsSync(join(project, "junamis-skills-guide.md")), false);
    assert.equal(existsSync(join(project, ".junamis", "junamis-skills.json")), false);
    assert.equal(existsSync(join(project, "opencode.json")), false);
    assert.equal(existsSync(join(project, ".config")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init --dry-run on a missing project directory prints the plan without creating it", () => {
  const { home } = tempDirs();
  const parent = mkdtempSync(join(tmpdir(), "junamis-parent-"));
  const project = join(parent, "not-created-yet");
  try {
    const result = spawnSync(process.execPath, [
      CLI, "init", "--dry-run", "--agent", "opencode", "--scope", "project", "--dir", project,
    ], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /guide: would write/);
    assert.match(result.stdout, /config: would write/);
    assert.match(result.stdout, /library for opencode/);
    assert.match(result.stdout, /external: 24 pinned skills would be installed/);
    assert.equal(existsSync(project), false, "the dry run must not create the directory");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("init --dir installs into a project directory that does not exist yet", async () => {
  const { home } = tempDirs();
  const parent = mkdtempSync(join(tmpdir(), "junamis-parent-"));
  const project = join(parent, "created-by-init");
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const result = await runInit(
      { agent: "opencode", scope: "project", dir: project, force: false, dryRun: false },
      // The external install needs the network; the library install is the path
      // under test, so only the network step is stubbed.
      { installExternal: async () => ({ groups: 0, installed: 0, skipped: 0, failed: 0 }) },
    );
    assert.equal(result.exitCode, 0);
    assert.ok(existsSync(project), "init must create the project directory");
    assert.ok(existsSync(join(project, "junamis-skills-guide.md")));
    assert.ok(existsSync(join(project, ".junamis", "junamis-skills.json")));
    assert.ok(existsSync(join(project, "opencode.json")));
    assert.ok(existsSync(join(project, ".config", "junamis", "skills", "skills", "route", "SKILL.md")));
    assert.ok(existsSync(join(project, ".opencode", "agents", "orchestrator.md")));
    assert.ok(existsSync(join(project, ".config", "junamis", "skills", "installed", "library-opencode.json")));
  } finally {
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("status exits 0 when only OpenCode is installed and other targets are absent", () => {
  const { home, project } = tempDirs();
  try {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(join(home, ".config", "junamis", "skills", "skills", "route"), { recursive: true });
    mkdirSync(join(home, ".agents", "skills", "route"), { recursive: true });
    const manifestDir = join(home, ".config", "junamis", "skills", "installed");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, "library-opencode.json"), JSON.stringify({
      version: "1.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      files: [],
    }));
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project, "--scope", "global"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /OpenCode\s+detected/);
    assert.match(result.stdout, /Claude Code\s+not found/);
    assert.match(result.stdout, /status: ok/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("status exits 1 when a detected target has a malformed library manifest", () => {
  const { home, project } = tempDirs();
  try {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(join(home, ".config", "junamis", "skills", "skills", "route"), { recursive: true });
    mkdirSync(join(home, ".agents", "skills", "route"), { recursive: true });
    const manifestDir = join(home, ".config", "junamis", "skills", "installed");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, "library-opencode.json"), JSON.stringify({ files: "not-an-array" }));
    const result = spawnSync(process.execPath, [CLI, "status", "--dir", project, "--scope", "global"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /library manifest invalid/);
    assert.match(result.stderr, /files must be an array/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("removed commands fail with a two-command pointer", () => {
  for (const command of ["install-library", "install-external", "sync", "doctor", "init-config"]) {
    const result = spawnSync(process.execPath, [CLI, command], { encoding: "utf8" });
    assert.equal(result.status, 1, `${command} must fail`);
    assert.match(
      result.stderr,
      new RegExp(`unknown command: ${command}\\. Use "init" or "status"\\.`),
      `${command} must point at init/status`,
    );
  }
});

test("runInit installs every external skill through the injected installer", async () => {
  const { project } = tempDirs();
  try {
    let externalArgs = null;
    const result = await runInit(
      { agent: "opencode", scope: "project", dir: project, force: false, dryRun: false },
      {
        writeGuide: async () => ({ status: "created", path: join(project, "guide.md"), version: "1.0.0" }),
        writeOpencodeConfig: async () => ({ status: "written", path: join(project, "opencode.json") }),
        planLibraryInstall: async () => [],
        applyLibraryInstall: async () => ({ ok: true, actions: [], conflicts: [], stale: [] }),
        installExternal: async (args) => {
          externalArgs = args;
          return { groups: 5, installed: 24, skipped: 0, failed: 0 };
        },
        packageVersion: async () => "1.0.0",
      },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.external.installed, 24);
    assert.equal(externalArgs.agent, "opencode");
    assert.equal(externalArgs.installer, "skillsio");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runInit exits 1 when the external install reports a failure", async () => {
  const { project } = tempDirs();
  try {
    const result = await runInit(
      { agent: "claude", scope: "global", dir: project, force: false, dryRun: false },
      {
        writeGuide: async () => ({ status: "created", path: join(project, "guide.md"), version: "1.0.0" }),
        writeOpencodeConfig: async () => ({ status: "written", path: "" }),
        planLibraryInstall: async () => [],
        applyLibraryInstall: async () => ({ ok: true, actions: [], conflicts: [], stale: [] }),
        installExternal: async () => ({ groups: 5, installed: 23, skipped: 0, failed: 1 }),
        packageVersion: async () => "1.0.0",
      },
    );
    assert.equal(result.exitCode, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
