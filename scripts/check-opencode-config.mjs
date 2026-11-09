#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// V1 keys are accepted-but-inert or translated by OpenCode, so a file can look
// configured while a field does nothing. The shipped file must be V2-only.
const V1_ONLY_KEYS = [
  "permission",
  "tools",
  "lsp",
  "share",
  "autoupdate",
  "agent",
  "provider",
  "plugin",
  "command",
  "reference",
  "snapshot",
  "attachment",
];

const EFFECTS = new Set(["allow", "ask", "deny"]);

export const HARD_DENY_POLICIES = [
  "shell:git push *",
  "shell:git reset --hard *",
  "shell:git clean *",
  "shell:sudo *",
  "shell:rm -rf *",
  "shell:npm publish *",
  "shell:pnpm publish *",
  "shell:vercel * --prod*",
  "shell:kubectl delete *",
  "shell:terraform apply *",
  "shell:terraform destroy *",
  "edit:*.env",
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// OpenCode matches whole values: `*` matches zero or more characters including
// `/`, and `?` matches exactly one character.
function globToRegExp(pattern) {
  let source = "";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

// Last matching rule wins. A rule with action `*` applies to every action.
export function effectFor(permissions, action, resource) {
  let effect = null;
  for (const rule of permissions) {
    if (rule.action !== action && rule.action !== "*") continue;
    if (!globToRegExp(rule.resource).test(resource)) continue;
    effect = rule.effect;
  }
  return effect;
}

// Exported so tests can exercise each invariant directly as well as through the CLI.
export function validateConfig(cfg) {
  const fail = (message) => {
    throw new Error(message);
  };

  if (!isPlainObject(cfg)) fail("config must be a JSON object");
  for (const key of V1_ONLY_KEYS) {
    if (key in cfg) fail(`V1-only key is not allowed in opencode.json: ${key}`);
  }

  const permissions = cfg.permissions;
  if (!Array.isArray(permissions) || permissions.length === 0) {
    fail("permissions must be a non-empty array");
  }
  for (const [index, rule] of permissions.entries()) {
    if (!isPlainObject(rule)) fail(`permissions[${index}] must be an object`);
    if (typeof rule.action !== "string" || rule.action.length === 0) {
      fail(`permissions[${index}].action must be a non-empty string`);
    }
    if (typeof rule.resource !== "string") fail(`permissions[${index}].resource must be a string`);
    if (!EFFECTS.has(rule.effect)) fail(`permissions[${index}].effect must be allow, ask, or deny`);
  }

  const [baseline] = permissions;
  if (baseline.action !== "*" || baseline.resource !== "*" || baseline.effect !== "ask") {
    fail('permissions[0] must be { "action": "*", "resource": "*", "effect": "ask" }');
  }

  const expect = (action, resource, expected) => {
    const effect = effectFor(permissions, action, resource);
    if (effect !== expected) {
      fail(`${action} ${resource} must be ${expected} (found ${effect ?? "no matching rule"})`);
    }
  };

  expect("read", "src/index.js", "allow");
  expect("read", ".env", "deny");
  expect("read", ".git/config", "deny");
  expect("read", ".git/modules/x", "deny");

  expect("edit", "src/index.js", "allow");
  expect("edit", ".env", "deny");

  expect("glob", "src/index.js", "allow");
  expect("glob", ".env", "deny");
  expect("grep", "TODO", "allow");
  expect("grep", ".env", "deny");

  expect("external_directory", "/etc/passwd", "deny");

  expect("shell", "echo hi", "ask");

  expect("webfetch", "https://example.com", "ask");
  expect("webfetch", "https://opencode.ai/docs", "allow");

  expect("websearch", "anything", "ask");
  expect("websearch", "opencode.ai docs", "allow");

  expect("browser", "*", "deny");
  expect("execute", "*", "allow");

  const readDenyCount = permissions.filter((rule) => rule.action === "read" && rule.effect === "deny").length;
  if (readDenyCount < 30) fail(`read deny rules: found ${readDenyCount}, need at least 30`);

  // The allowlist must not open plaintext HTTP or user-content hosting.
  for (const rule of permissions) {
    if (rule.resource.startsWith("http://")) {
      fail(`permission resource must not use plaintext HTTP: ${rule.resource}`);
    }
    if (rule.resource.includes(".vercel.app") || rule.resource.includes(".netlify.app")) {
      fail(`permission resource must not use user-content hosting: ${rule.resource}`);
    }
  }

  if (!isPlainObject(cfg.mcp) || !isPlainObject(cfg.mcp.servers) || Object.keys(cfg.mcp.servers).length !== 0) {
    fail("mcp.servers must be an empty object");
  }
  if (!Array.isArray(cfg.plugins) || cfg.plugins.length !== 0) {
    fail("plugins must be an empty array");
  }
  if (cfg.update !== "notify") fail('update must be "notify"');
  if (cfg.formatter !== false) fail("formatter must be false");

  if (!Array.isArray(cfg.policies)) fail("policies must be an array");
  for (const resource of HARD_DENY_POLICIES) {
    const found = cfg.policies.some(
      (rule) => isPlainObject(rule) && rule.action === "tool.use" && rule.resource === resource && rule.effect === "deny",
    );
    if (!found) fail(`policies must hard-deny ${resource}`);
  }

  return cfg;
}

async function main() {
  const configPath = process.argv[2] ? resolve(process.argv[2]) : join(root, "opencode.json");
  const raw = await readFile(configPath, "utf8");
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { console.error("invalid JSON:", e.message); process.exit(1); }
  try {
    validateConfig(cfg);
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
  console.log("✔ opencode.json valid");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
