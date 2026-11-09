import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../scripts/check-opencode-config.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECKER = fileURLToPath(new URL("../scripts/check-opencode-config.mjs", import.meta.url));
const config = JSON.parse(readFileSync(new URL("../opencode.json", import.meta.url), "utf8"));
const permission = config.permission;

test("opencode.json keeps the documented permission invariants", () => {
  assert.equal(typeof permission.bash, "object", "bash must be an object of command rules");
  assert.ok(!Array.isArray(permission.bash), "bash must not be an array");
  assert.notEqual(permission.bash?.["*"], "allow", "bash must ask, never allow every command");
  assert.notEqual(permission.bash?.["**"], "allow", "bash must not allow a broad catch-all");
  assert.equal(permission.external_directory, "deny", "external_directory must stay denied");
  assert.equal(permission.read?.[".env"], "deny", "read .env must stay denied");
  assert.equal(permission.read?.[".git/config"], "deny", ".git/config must be denied");
  assert.equal(permission.read?.[".git/modules/*"], "deny", ".git/modules must be denied");

  const readDenyCount = Object.values(permission.read ?? {}).filter((value) => value === "deny").length;
  assert.ok(readDenyCount >= 30, `expected at least 30 read deny rules, found ${readDenyCount}`);

  for (const key of Object.keys(permission.webfetch ?? {})) {
    assert.ok(!key.startsWith("http://"), `webfetch must not allow plaintext HTTP: ${key}`);
    assert.ok(!key.includes(".vercel.app"), `webfetch must not allow user-content hosting: ${key}`);
    assert.ok(!key.includes(".netlify.app"), `webfetch must not allow user-content hosting: ${key}`);
  }
  assert.equal(permission.webfetch?.["*"], "ask", "webfetch default must be ask");
});

test("opencode.json registers both internal and external skill roots", () => {
  assert.deepEqual(config.skills, ["{env:HOME}/.config/junamis/skills/skills", "{env:HOME}/.agents/skills"]);
  assert.deepEqual(config.instructions, ["{env:HOME}/.config/junamis/skills/*.md"]);
  assert.equal(config.default_agent, "orchestrator");
});

test("validateConfig rejects the string and catch-all bash allow forms", () => {
  for (const [bash, pattern] of [
    ["allow", /must not be "allow"/],
    [{ "*": "allow" }, /\["\*"\] must not be "allow"/],
    [{ "**": "allow" }, /\["\*\*"\] must not be "allow"/],
    [[], /non-array object/],
  ]) {
    const copy = JSON.parse(JSON.stringify(config));
    copy.permission.bash = bash;
    assert.throws(() => validateConfig(copy), pattern, `bash=${JSON.stringify(bash)}`);
  }
});

test("the config check enforces those invariants", () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [CHECKER], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
});

test("the config check exits 1 for a temp config with an unrestricted bash", () => {
  const dir = mkdtempSync(join(tmpdir(), "junamis-config-"));
  try {
    for (const [index, bash] of ["allow", { "*": "allow" }, { "**": "allow" }].entries()) {
      const copy = JSON.parse(JSON.stringify(config));
      copy.permission.bash = bash;
      const path = join(dir, `opencode-${index}.json`);
      writeFileSync(path, JSON.stringify(copy));
      assert.throws(
        () =>
          execFileSync(process.execPath, [CHECKER, path], {
            cwd: ROOT,
            encoding: "utf8",
            stdio: "pipe",
          }),
        (error) => error.status === 1,
        `bash=${JSON.stringify(bash)}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
