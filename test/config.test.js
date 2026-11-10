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

  assert.equal(effect("shell", "echo hi"), "ask");
  assert.equal(effect("shell", "junamis-orchestrator boot"), "allow");
  assert.equal(effect("shell", "node scripts/orchestrator-state.mjs boot"), "allow");
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
    { action: "tool.use", resource: "shell:git push *", effect: "deny" },
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
