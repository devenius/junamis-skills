import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPinnedCheckoutCommands, getSkillTreeSha, validatePinnedSource, verifyCheckout } from "../src/pinned-source.js";

const commit = "a".repeat(40);
const treeSha = "b".repeat(40);
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

function git(directory, ...args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

function makeRepo() {
  const directory = mkdtempSync(join(tmpdir(), "junamis-pinned-test-"));
  git(directory, "init", "--quiet");
  git(directory, "config", "user.email", "test@example.com");
  git(directory, "config", "user.name", "Test");
  return directory;
}

function commitAll(directory) {
  git(directory, "add", "-A");
  git(directory, "commit", "--quiet", "-m", "test");
  return git(directory, "rev-parse", "HEAD");
}

test("pinned source validation accepts root and nested skills", () => {
  assert.doesNotThrow(() => validatePinnedSource({
    source: "owner/repo",
    ref: commit,
    skills: [
      { name: "root-skill", skillPath: "SKILL.md", treeSha },
      { name: "nested-skill", skillPath: "skills/nested/SKILL.md", treeSha },
    ],
  }));
});

test("pinned source validation rejects mutable refs and unsafe paths", () => {
  const valid = {
    source: "owner/repo",
    ref: commit,
    skills: [{ name: "example", skillPath: "skills/example/SKILL.md", treeSha }],
  };

  assert.throws(() => validatePinnedSource({ ...valid, ref: "main" }), /commit SHA/);
  assert.throws(() => validatePinnedSource({ ...valid, skills: [{ ...valid.skills[0], treeSha: "not-a-sha" }] }), /tree SHA/);
  assert.throws(() => validatePinnedSource({ ...valid, skills: [{ ...valid.skills[0], skillPath: "skills/../SKILL.md" }] }), /skill path/);
});

test("pinned checkout commands fetch and detach at the exact commit", () => {
  const commands = buildPinnedCheckoutCommands("owner/repo", commit, "/tmp/repo");

  assert.deepEqual(commands, [
    ["init", "--quiet", "/tmp/repo"],
    ["-C", "/tmp/repo", "remote", "add", "origin", "https://github.com/owner/repo.git"],
    ["-C", "/tmp/repo", "fetch", "--quiet", "--depth=1", "origin", commit],
    ["-C", "/tmp/repo", "checkout", "--quiet", "--detach", "FETCH_HEAD"],
  ]);
});

test("getSkillTreeSha reads the locked Git tree object", async () => {
  const actual = await getSkillTreeSha(PACKAGE_ROOT, "library/skills/route/SKILL.md");
  assert.match(actual, /^[a-f0-9]{40}$/);
});

test("large local tree listings are not limited by the remote capture cap", async () => {
  const directory = makeRepo();
  try {
    const dir = join(directory, "skills", "large");
    mkdirSync(dir, { recursive: true });
    const prefix = "x".repeat(160);
    for (let i = 0; i < 600; i++) writeFileSync(join(dir, `${prefix}${i}.txt`), "");
    commitAll(directory);

    const actual = await getSkillTreeSha(directory, "skills/large/SKILL.md");
    assert.match(actual, /^[a-f0-9]{40}$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a skill path that resolves to a symlink or blob is not a tree", async () => {
  const directory = makeRepo();
  try {
    mkdirSync(join(directory, "skills"), { recursive: true });
    writeFileSync(join(directory, "target.txt"), "outside\n");
    symlinkSync("../target.txt", join(directory, "skills", "linked"));
    commitAll(directory);

    await assert.rejects(
      getSkillTreeSha(directory, "skills/linked/SKILL.md"),
      /not a directory tree/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a skill tree containing a symlink is rejected", async () => {
  const directory = makeRepo();
  try {
    mkdirSync(join(directory, "skills", "with-link"), { recursive: true });
    writeFileSync(join(directory, "skills", "with-link", "SKILL.md"), "---\nname: with-link\n---\n");
    symlinkSync("../../../outside", join(directory, "skills", "with-link", "link"));
    commitAll(directory);

    await assert.rejects(
      getSkillTreeSha(directory, "skills/with-link/SKILL.md"),
      /contains a symlink/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("checkout verification requires HEAD to equal the locked commit", async () => {
  const directory = makeRepo();
  try {
    writeFileSync(join(directory, "file.txt"), "content\n");
    const head = commitAll(directory);

    assert.equal(await verifyCheckout(directory, head), head);
    await assert.rejects(
      verifyCheckout(directory, "c".repeat(40)),
      /does not match locked commit/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
