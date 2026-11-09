import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeOpencodeConfig } from "../src/cli.js";

function tempDirs() {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
  return { home, project };
}

async function withHome(home, fn) {
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    process.env.HOME = previous;
  }
}

test("writeOpencodeConfig writes opencode.json in project scope", async () => {
  const { home, project } = tempDirs();
  try {
    const result = await writeOpencodeConfig({ dir: project, scope: "project" });
    assert.equal(result.status, "written");
    assert.ok(existsSync(join(project, "opencode.json")));
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("writeOpencodeConfig leaves a different existing file unchanged without force", async () => {
  const { home, project } = tempDirs();
  try {
    const target = join(project, "opencode.json");
    writeFileSync(target, "EXISTING\n");
    const result = await writeOpencodeConfig({ dir: project, scope: "project" });
    assert.equal(result.status, "kept");
    assert.equal(readFileSync(target, "utf8"), "EXISTING\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("writeOpencodeConfig reports an identical existing file as unchanged", async () => {
  const { home, project } = tempDirs();
  try {
    await writeOpencodeConfig({ dir: project, scope: "project" });
    const before = readFileSync(join(project, "opencode.json"), "utf8");
    const result = await writeOpencodeConfig({ dir: project, scope: "project" });
    assert.equal(result.status, "unchanged");
    assert.equal(readFileSync(join(project, "opencode.json"), "utf8"), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("writeOpencodeConfig --force overwrites without a prompt", async () => {
  const { home, project } = tempDirs();
  try {
    const target = join(project, "opencode.json");
    writeFileSync(target, "EXISTING\n");
    const result = await writeOpencodeConfig({ dir: project, scope: "project", force: true });
    assert.equal(result.status, "written");
    assert.notEqual(readFileSync(target, "utf8"), "EXISTING\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("writeOpencodeConfig project scope uses project-relative skill paths", async () => {
  const { home, project } = tempDirs();
  try {
    await writeOpencodeConfig({ dir: project, scope: "project" });
    const text = readFileSync(join(project, "opencode.json"), "utf8");
    assert.match(text, /"\.\/\.agents\/skills"/);
    assert.match(text, /"\.\/\.config\/junamis\/skills\/skills"/);
    assert.match(text, /"\.\/\.config\/junamis\/skills\/\*\.md"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("writeOpencodeConfig global scope uses home-relative skill paths", async () => {
  const { home, project } = tempDirs();
  try {
    await withHome(home, async () => {
      await writeOpencodeConfig({ dir: project, scope: "global" });
    });
    const text = readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8");
    assert.match(text, /"\{env:HOME\}\/\.agents\/skills"/);
    assert.match(text, /"\{env:HOME\}\/\.config\/junamis\/skills\/skills"/);
    assert.match(text, /"\{env:HOME\}\/\.config\/junamis\/skills\/\*\.md"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("writeOpencodeConfig dry-run writes nothing", async () => {
  const { home, project } = tempDirs();
  try {
    const result = await writeOpencodeConfig({ dir: project, scope: "project", dryRun: true });
    assert.equal(result.status, "would-write");
    assert.equal(existsSync(join(project, "opencode.json")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
