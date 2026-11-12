import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectFor, validateConfig } from "../dist/scripts/check-opencode-config.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECKER = fileURLToPath(new URL("../scripts/check-opencode-config.mjs", import.meta.url));
const config = JSON.parse(readFileSync(new URL("../opencode.json", import.meta.url), "utf8"));
const clone = () => JSON.parse(JSON.stringify(config));
const effect = (action, resource) => effectFor(config.permissions, action, resource);

test("opencode.json is V2-native with the reviewed top-level shape", () => {
  assert.deepEqual(Object.keys(config), [
    "$schema",
    "default_agent",
    "skills",
    "instructions",
    "update",
    "formatter",
    "plugins",
    "mcp",
    "permissions",
    "policies",
  ]);
  assert.ok(Array.isArray(config.permissions), "permissions must be an array");
  assert.equal("permission" in config, false, "the V1 permission map must be gone");
  for (const key of ["tools", "lsp", "share", "autoupdate", "agent", "provider", "plugin", "command", "reference", "snapshot", "attachment"]) {
    assert.equal(key in config, false, `V1-only key must be absent: ${key}`);
  }
});

test("opencode.json starts from an ask-everything baseline", () => {
  assert.deepEqual(config.permissions[0], { action: "*", resource: "*", effect: "ask" });
});

test("opencode.json expresses the reviewed read, edit, shell, and network posture", () => {
  assert.equal(effect("read", "src/index.js"), "allow");
  assert.equal(effect("read", ".env"), "deny");
  assert.equal(effect("read", ".git/config"), "deny");
  assert.equal(effect("read", ".git/modules/x"), "deny");

  assert.equal(effect("edit", "src/index.js"), "allow");
  assert.equal(effect("edit", ".env"), "deny");

  assert.equal(effect("glob", "src/index.js"), "allow");
  assert.equal(effect("glob", ".env"), "deny");
  assert.equal(effect("grep", "TODO"), "allow");
  assert.equal(effect("grep", ".env"), "deny");

  assert.equal(effect("external_directory", "/etc/passwd"), "deny");
  assert.equal(effect("external_directory", "/tmp/opencode/work"), "allow");
  assert.equal(effect("external_directory", ".worktrees/task/file"), "allow");

  assert.equal(effect("shell", "echo hi"), "ask");
  assert.equal(effect("shell", "junamis-orchestrator boot"), "allow");
  assert.equal(effect("shell", "node scripts/orchestrator-state.mjs boot"), "allow");
  assert.equal(effect("shell", "git status"), "allow");
  assert.equal(effect("shell", "pnpm test"), "allow");
  assert.equal(effect("shell", "git push origin task/foo"), "allow");
  assert.equal(effect("shell", "git fetch origin"), "allow");
  assert.equal(effect("shell", "git switch -c task/foo"), "allow");
  assert.equal(effect("shell", "git checkout -b task/foo"), "allow");
  assert.equal(effect("shell", "git merge task/foo"), "allow");
  assert.equal(effect("shell", "git merge --no-ff task/foo"), "allow");
  assert.equal(effect("shell", "git merge --abort"), "allow");
  assert.equal(effect("shell", "git worktree add .worktrees/foo -b task/foo task/bar"), "allow");
  assert.equal(effect("shell", "gh pr create --base main"), "allow");
  assert.equal(effect("shell", "gh pr checks"), "allow");
  assert.equal(effect("shell", "cat .env"), "deny");

  assert.equal(effect("webfetch", "https://example.com"), "ask");
  assert.equal(effect("webfetch", "https://opencode.ai/docs"), "allow");
  assert.equal(effect("websearch", "anything"), "ask");
  assert.equal(effect("websearch", "opencode.ai docs"), "allow");

  assert.equal(effect("browser", "*"), "deny");
  assert.equal(effect("execute", "*"), "allow");

  const readDenyCount = config.permissions.filter((rule) => rule.action === "read" && rule.effect === "deny").length;
  assert.ok(readDenyCount >= 30, `expected at least 30 read deny rules, found ${readDenyCount}`);
});

test("opencode.json ships no MCP servers or plugins and keeps updates and formatting quiet", () => {
  assert.deepEqual(config.mcp, { servers: {} });
  assert.deepEqual(config.plugins, []);
  assert.equal(config.update, "notify");
  assert.equal(config.formatter, false);
});

test("opencode.json carries the hard-deny policies", () => {
  assert.deepEqual(config.policies, [
    { action: "tool.use", resource: "shell:git push origin main", effect: "deny" },
    { action: "tool.use", resource: "shell:git push origin main *", effect: "deny" },
    { action: "tool.use", resource: "shell:git push origin HEAD:main", effect: "deny" },
    { action: "tool.use", resource: "shell:git switch main", effect: "deny" },
    { action: "tool.use", resource: "shell:git checkout main", effect: "deny" },
    { action: "tool.use", resource: "shell:git branch -d main", effect: "deny" },
    { action: "tool.use", resource: "shell:git branch -D main", effect: "deny" },
    { action: "tool.use", resource: "shell:git push --force *", effect: "deny" },
    { action: "tool.use", resource: "shell:git push -f *", effect: "deny" },
    { action: "tool.use", resource: "shell:git push --force-with-lease *", effect: "deny" },
    { action: "tool.use", resource: "shell:git commit --no-verify *", effect: "deny" },
    { action: "tool.use", resource: "shell:gh pr merge", effect: "deny" },
    { action: "tool.use", resource: "shell:gh pr merge *", effect: "deny" },
    { action: "tool.use", resource: "shell:git reset --hard *", effect: "deny" },
    { action: "tool.use", resource: "shell:git clean *", effect: "deny" },
    { action: "tool.use", resource: "shell:sudo *", effect: "deny" },
    { action: "tool.use", resource: "shell:rm -rf *", effect: "deny" },
    { action: "tool.use", resource: "shell:npm publish *", effect: "deny" },
    { action: "tool.use", resource: "shell:pnpm publish *", effect: "deny" },
    { action: "tool.use", resource: "shell:vercel * --prod*", effect: "deny" },
    { action: "tool.use", resource: "shell:kubectl delete *", effect: "deny" },
    { action: "tool.use", resource: "shell:terraform apply *", effect: "deny" },
    { action: "tool.use", resource: "shell:terraform destroy *", effect: "deny" },
    { action: "tool.use", resource: "edit:*.env", effect: "deny" },
  ]);
});

test("task-branch work is allowed while main, merge, force, no-verify, and admin stay denied", () => {
  const policyEffect = (command) =>
    effectFor(
      config.policies
        .filter((rule) => rule.resource.startsWith("shell:"))
        .map((rule) => ({ action: "*", resource: rule.resource.slice("shell:".length), effect: rule.effect })),
      "*",
      command,
    );

  assert.equal(effect("shell", "git push origin task/foo"), "allow");
  assert.equal(effect("shell", "git push -u origin task/foo"), "allow");
  assert.equal(effect("shell", "git switch -c task/foo"), "allow");
  assert.equal(effect("shell", "git checkout -b task/foo"), "allow");
  assert.equal(effect("shell", "git merge --no-ff task/foo"), "allow");
  assert.equal(effect("shell", "git merge --abort"), "allow");
  assert.equal(effect("shell", "gh pr create --base main"), "allow");
  assert.equal(policyEffect("git push origin task/foo"), null);
  assert.equal(policyEffect("gh pr create --base main"), null);

  assert.equal(policyEffect("git switch main"), "deny");
  assert.equal(policyEffect("git checkout main"), "deny");
  assert.equal(policyEffect("git branch -d main"), "deny");
  assert.equal(policyEffect("git branch -D main"), "deny");
  assert.equal(policyEffect("git push origin main"), "deny");
  assert.equal(policyEffect("git push origin main --tags"), "deny");
  assert.equal(policyEffect("git push origin HEAD:main"), "deny");
  assert.equal(policyEffect("git push --force origin task/foo"), "deny");
  assert.equal(policyEffect("git push -f origin task/foo"), "deny");
  assert.equal(policyEffect("git push --force-with-lease origin task/foo"), "deny");
  assert.equal(policyEffect("git commit --no-verify -m done"), "deny");
  assert.equal(policyEffect("gh pr merge"), "deny");
  assert.equal(policyEffect("gh pr merge 1"), "deny");
  assert.equal(policyEffect("gh pr merge 1 --admin"), "deny");
});

test("opencode.json registers both internal and external skill roots", () => {
  assert.deepEqual(config.skills, ["{env:HOME}/.config/junamis/skills/skills", "{env:HOME}/.agents/skills"]);
  assert.deepEqual(config.instructions, ["{env:HOME}/.config/junamis/skills/*.md"]);
  assert.equal(config.default_agent, "orchestrator");
});

test("validateConfig rejects V1 and weakened V2 configurations", () => {
  const cases = [
    [
      "V1 permission map",
      (copy) => { copy.permission = { "*": "ask" }; },
      /V1-only key/,
    ],
    [
      "missing baseline",
      (copy) => { copy.permissions = copy.permissions.slice(1); },
      /permissions\[0\]/,
    ],
    [
      "fewer than 30 read denies",
      (copy) => {
        const kept = new Set([".env", ".git/config", ".git/modules/*"]);
        const readDenies = copy.permissions.filter((rule) => rule.action === "read" && rule.effect === "deny");
        const selected = readDenies.filter((rule) => kept.has(rule.resource));
        for (let index = selected.length; index < 29; index += 1) {
          selected.push({ action: "read", resource: `.generated-secret-${index}`, effect: "deny" });
        }
        copy.permissions = [
          ...copy.permissions.filter((rule) => !(rule.action === "read" && rule.effect === "deny")),
          ...selected,
        ];
      },
      /read deny rules: found 29/,
    ],
    [
      "unrestricted shell",
      (copy) => { copy.permissions.push({ action: "shell", resource: "*", effect: "allow" }); },
      /shell echo hi must be ask/,
    ],
    [
      "allowed external_directory",
      (copy) => { copy.permissions.push({ action: "external_directory", resource: "*", effect: "allow" }); },
      /external_directory \/etc\/passwd must be deny/,
    ],
    [
      "removed worktree external_directory allow",
      (copy) => {
        copy.permissions = copy.permissions.filter(
          (rule) => !(rule.action === "external_directory" && rule.resource === ".worktrees/**"),
        );
      },
      /external_directory \.worktrees\/task\/file must be allow/,
    ],
    [
      "removed task-branch push allow",
      (copy) => {
        copy.permissions = copy.permissions.filter(
          (rule) => !(rule.action === "shell" && rule.resource === "git push origin task/*"),
        );
      },
      /shell git push origin task\/foo must be allow/,
    ],
    [
      "removed gh pr allow",
      (copy) => {
        copy.permissions = copy.permissions.filter(
          (rule) => !(rule.action === "shell" && rule.resource === "gh pr create *"),
        );
      },
      /shell gh pr create --base main must be allow/,
    ],
    [
      "allow-by-default webfetch",
      (copy) => { copy.permissions.push({ action: "webfetch", resource: "*", effect: "allow" }); },
      /webfetch https:\/\/example\.com must be ask/,
    ],
    [
      "allow-by-default websearch",
      (copy) => { copy.permissions.push({ action: "websearch", resource: "*", effect: "allow" }); },
      /websearch anything must be ask/,
    ],
    [
      "non-empty mcp.servers",
      (copy) => { copy.mcp.servers = { example: {} }; },
      /mcp\.servers must be an empty object/,
    ],
    [
      "non-empty plugins",
      (copy) => { copy.plugins = ["third-party"]; },
      /plugins must be an empty array/,
    ],
    [
      "update not notify",
      (copy) => { copy.update = "auto"; },
      /update must be "notify"/,
    ],
    [
      "formatter enabled",
      (copy) => { copy.formatter = true; },
      /formatter must be false/,
    ],
    [
      "removed bare gh pr merge deny",
      (copy) => {
        copy.policies = copy.policies.filter((rule) => rule.resource !== "shell:gh pr merge");
      },
      /policies must hard-deny shell:gh pr merge/,
    ],
    [
      "removed main push deny",
      (copy) => {
        copy.policies = copy.policies.filter((rule) => rule.resource !== "shell:git push origin HEAD:main");
      },
      /policies must hard-deny shell:git push origin HEAD:main/,
    ],
    [
      "removed main switch deny",
      (copy) => {
        copy.policies = copy.policies.filter((rule) => rule.resource !== "shell:git switch main");
      },
      /policies must hard-deny shell:git switch main/,
    ],
    [
      "removed main checkout deny",
      (copy) => {
        copy.policies = copy.policies.filter((rule) => rule.resource !== "shell:git checkout main");
      },
      /policies must hard-deny shell:git checkout main/,
    ],
    [
      "removed forced main branch delete deny",
      (copy) => {
        copy.policies = copy.policies.filter((rule) => rule.resource !== "shell:git branch -D main");
      },
      /policies must hard-deny shell:git branch -D main/,
    ],
    [
      "removed main branch delete deny",
      (copy) => {
        copy.policies = copy.policies.filter((rule) => rule.resource !== "shell:git branch -d main");
      },
      /policies must hard-deny shell:git branch -d main/,
    ],
    [
      "removed force-with-lease deny",
      (copy) => {
        copy.policies = copy.policies.filter((rule) => rule.resource !== "shell:git push --force-with-lease *");
      },
      /policies must hard-deny shell:git push --force-with-lease \*/,
    ],
  ];

  for (const [label, mutate, pattern] of cases) {
    const copy = clone();
    mutate(copy);
    assert.throws(() => validateConfig(copy), pattern, label);
  }
});

test("the config check passes for the shipped opencode.json", () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [CHECKER], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
});

test("the config check exits 1 for a temp config with an unrestricted shell", () => {
  const dir = mkdtempSync(join(tmpdir(), "junamis-config-"));
  try {
    const copy = clone();
    copy.permissions.push({ action: "shell", resource: "*", effect: "allow" });
    const path = join(dir, "opencode.json");
    writeFileSync(path, JSON.stringify(copy));
    assert.throws(
      () =>
        execFileSync(process.execPath, [CHECKER, path], {
          cwd: ROOT,
          encoding: "utf8",
          stdio: "pipe",
        }),
      (error) => error.status === 1,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
