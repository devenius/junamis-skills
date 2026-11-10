import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { planLibraryInstall, applyLibraryInstall } from "../dist/library-install.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("applyLibraryInstall rolls back created files on failure", async () => {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    // Block the agents directory so a later write fails after skills are written.
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(join(home, ".config", "opencode", "agents"), "blocker");

    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await assert.rejects(
      applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" }),
      /managed root is not a directory/,
    );
    // A skill written before the failure should have been rolled back.
    assert.equal(existsSync(join(home, ".config", "junamis", "skills", "skills", "route", "SKILL.md")), false);
  } finally {
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
