import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "junamis-agents-skills.js");

test("install-library rolls back created files on failure", () => {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  try {
    // Block the agents directory so a later write fails after skills are written.
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(join(home, ".config", "opencode", "agents"), "blocker");

    let threw = false;
    try {
      execFileSync(process.execPath, [CLI, "install-library", "--agent", "opencode"], {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
        stdio: "pipe",
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "install should fail");
    // A skill written before the failure should have been rolled back.
    assert.equal(existsSync(join(home, ".agents", "skills", "route", "SKILL.md")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});