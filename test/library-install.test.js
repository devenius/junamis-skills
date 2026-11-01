import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planLibraryInstall,
  applyLibraryInstall,
} from "../src/library-install.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    });
}

test("install-library creates files, then reports them unchanged", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const first = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });
    assert.equal(first.ok, true);
    assert.ok(first.actions.every((a) => a.action === "create"), "first run must create");

    const secondFiles = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const second = await applyLibraryInstall({ agent: "opencode", files: secondFiles, version: "1.0.0" });
    assert.equal(second.ok, true);
    assert.ok(second.actions.every((a) => a.action === "unchanged"), "second run must be unchanged");
  });
});

test("editing a managed file makes the next install a conflict", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const target = files.find((f) => f.path.endsWith("orchestrator.md"));
    assert.ok(target);
    writeFileSync(target.path, "user edit\n");

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0" });
    assert.equal(result.ok, false);
    assert.ok(result.conflicts.includes(target.path));
  });
});

test("--force overwrites an edited managed file", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const target = files.find((f) => f.path.endsWith("orchestrator.md"));
    writeFileSync(target.path, "user edit\n");

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0", force: true });
    assert.equal(result.ok, true);
    assert.match(readFileSync(target.path, "utf8"), /orchestrator/);
  });
});

test("--dry-run reports actions without writing", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    // Nothing should have been written.
    assert.equal(existsSync(files[0].path), false);
  });
});

test("stale unmodified files are removed", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const routeFile = files.find((f) => f.path.endsWith("/route/SKILL.md"));
    assert.ok(routeFile);
    const subset = files.filter((f) => f.path !== routeFile.path);

    const result = await applyLibraryInstall({ agent: "opencode", files: subset, version: "1.0.0" });
    assert.equal(result.ok, true);
    assert.ok(result.stale.includes(routeFile.path));
    assert.equal(existsSync(routeFile.path), false);
  });
});

test("project scope installs under the project directory", async () => {
  await withHome(async (_home) => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    try {
      const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode", scope: "project", projectDir: project });
      const result = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", scope: "project", projectDir: project });
      assert.equal(result.ok, true);
      assert.ok(existsSync(join(project, ".agents", "skills", "route", "SKILL.md")));
      assert.ok(existsSync(join(project, ".opencode", "agents", "orchestrator.md")));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test("stale edited files are not removed and become conflicts", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const routeFile = files.find((f) => f.path.endsWith("/route/SKILL.md"));
    writeFileSync(routeFile.path, "user edit\n");
    const subset = files.filter((f) => f.path !== routeFile.path);

    const result = await applyLibraryInstall({ agent: "opencode", files: subset, version: "1.0.0" });
    assert.equal(result.ok, false);
    assert.ok(result.conflicts.includes(routeFile.path));
    assert.equal(existsSync(routeFile.path), true);
  });
});