import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { writeGuide, GUIDE_NAME, MARKER_PATH, PACKAGE_ROOT } from "../src/guide.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "junamis-skills.js");

function tempProject() {
  return mkdtempSync(join(tmpdir(), "junamis-proj-"));
}

test("writeGuide creates the guide and marker once", async () => {
  const dir = tempProject();
  try {
    const first = await writeGuide({ projectDir: dir });
    assert.equal(first.status, "created");
    assert.ok(existsSync(join(dir, GUIDE_NAME)));
    assert.ok(existsSync(join(dir, MARKER_PATH)));

    const second = await writeGuide({ projectDir: dir });
    assert.equal(second.status, "exists", "second run must not rewrite");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guide lists library skills, locked externals, and the orchestrator rule", async () => {
  const dir = tempProject();
  try {
    await writeGuide({ projectDir: dir });
    const text = readFileSync(join(dir, GUIDE_NAME), "utf8");
    assert.match(text, /Always start with the orchestrator/);
    assert.match(text, /orchestrator/);
    assert.match(text, /\| architect \| JavaScript-Mastery-Pro\/skills \| MIT \|/);
    assert.match(text, /route/, "library skill route missing from guide");
    assert.doesNotMatch(text, /Licenses marked `unknown`/, "no unknown licenses remain, so the guide must not flag any");
    assert.match(text, /library\/SAFETY\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeGuide keeps a user-authored file that has no marker", async () => {
  const dir = tempProject();
  try {
    writeFileSync(join(dir, GUIDE_NAME), "my own notes\n");
    const result = await writeGuide({ projectDir: dir });
    assert.equal(result.status, "kept-user-file");
    assert.equal(readFileSync(join(dir, GUIDE_NAME), "utf8"), "my own notes\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeGuide with force replaces the file", async () => {
  const dir = tempProject();
  try {
    writeFileSync(join(dir, GUIDE_NAME), "old\n");
    const result = await writeGuide({ projectDir: dir, force: true });
    assert.equal(result.status, "created");
    assert.match(readFileSync(join(dir, GUIDE_NAME), "utf8"), /setup guide/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI init writes the guide into --dir", () => {
  const dir = tempProject();
  try {
    const out = execFileSync(process.execPath, [CLI, "init", "--dir", dir], { encoding: "utf8" });
    assert.match(out, /wrote /);
    assert.ok(existsSync(join(dir, GUIDE_NAME)));
    const again = execFileSync(process.execPath, [CLI, "init", "--dir", dir], { encoding: "utf8" });
    assert.match(again, /nothing to do/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI status reports guide and agents without writing anything", () => {
  const dir = tempProject();
  try {
    const out = execFileSync(process.execPath, [CLI, "status", "--dir", dir], { encoding: "utf8" });
    assert.match(out, /guide:\s+missing/);
    assert.match(out, /OpenCode/);
    assert.match(out, /Claude Code/);
    assert.equal(existsSync(join(dir, GUIDE_NAME)), false, "status must not write");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI rejects unknown commands with a non-zero exit", () => {
  assert.throws(() =>
    execFileSync(process.execPath, [CLI, "nope"], { encoding: "utf8", stdio: "pipe" }),
  );
});

test("package root is the repo root", () => {
  assert.ok(existsSync(join(PACKAGE_ROOT, "skills-lock.json")));
});
