import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "junamis-agents-skills.js");

function tempDirs() {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
  return { home, project };
}

test("init-config writes opencode.json in project scope", () => {
  const { home, project } = tempDirs();
  try {
    execFileSync(process.execPath, [CLI, "init-config", "--scope", "project", "--dir", project], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.ok(existsSync(join(project, "opencode.json")));
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init-config ignores existing file when user chooses ignore", () => {
  const { home, project } = tempDirs();
  try {
    const target = join(project, "opencode.json");
    writeFileSync(target, "EXISTING\n");
    execFileSync(process.execPath, [CLI, "init-config", "--scope", "project", "--dir", project], {
      encoding: "utf8",
      input: "i\n",
      env: { ...process.env, HOME: home },
    });
    assert.equal(readFileSync(target, "utf8"), "EXISTING\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init-config backs up existing file when user chooses backup", () => {
  const { home, project } = tempDirs();
  try {
    const target = join(project, "opencode.json");
    writeFileSync(target, "EXISTING\n");
    execFileSync(process.execPath, [CLI, "init-config", "--scope", "project", "--dir", project], {
      encoding: "utf8",
      input: "b\n",
      env: { ...process.env, HOME: home },
    });
    assert.notEqual(readFileSync(target, "utf8"), "EXISTING\n");
    const backups = readdirSync(project).filter((f) => f.startsWith("opencode.json.bak."));
    assert.ok(backups.length > 0, "backup file should exist");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init-config overwrites existing file when user chooses overwrite", () => {
  const { home, project } = tempDirs();
  try {
    const target = join(project, "opencode.json");
    writeFileSync(target, "EXISTING\n");
    execFileSync(process.execPath, [CLI, "init-config", "--scope", "project", "--dir", project], {
      encoding: "utf8",
      input: "o\n",
      env: { ...process.env, HOME: home },
    });
    assert.notEqual(readFileSync(target, "utf8"), "EXISTING\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init-config project scope uses project-relative skill paths", () => {
  const { home, project } = tempDirs();
  try {
    execFileSync(process.execPath, [CLI, "init-config", "--scope", "project", "--dir", project, "--force"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    const text = readFileSync(join(project, "opencode.json"), "utf8");
    assert.match(text, /"\.\/\.agents\/skills"/);
    assert.match(text, /"\.\/\.config\/junamis\/skills"/);
    assert.match(text, /"\.\/\.config\/junamis\/\*\.md"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init-config global scope uses home-relative skill paths", () => {
  const { home, project } = tempDirs();
  try {
    execFileSync(process.execPath, [CLI, "init-config", "--scope", "global", "--dir", project, "--force"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    const text = readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8");
    assert.match(text, /"\{env:HOME\}\/\.agents\/skills"/);
    assert.match(text, /"\{env:HOME\}\/\.config\/junamis\/skills"/);
    assert.match(text, /"\{env:HOME\}\/\.config\/junamis\/\*\.md"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("init-config --force overwrites without prompt", () => {
  const { home, project } = tempDirs();
  try {
    const target = join(project, "opencode.json");
    writeFileSync(target, "EXISTING\n");
    execFileSync(process.execPath, [CLI, "init-config", "--scope", "project", "--dir", project, "--force"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    assert.notEqual(readFileSync(target, "utf8"), "EXISTING\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
