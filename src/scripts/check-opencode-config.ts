// Validates the shipped opencode.json against the reviewed V2 invariants.
//
// The file is external input: it is parsed as `unknown` and only becomes typed
// once every rule below has proved its shape.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { errorMessage, isRecord, isString, parseJsonUnknown } from "../types/index.js";
import { isUnknownArray, packageRoot } from "./support.js";

// V1 keys are accepted-but-inert or translated by OpenCode, so a file can look
// configured while a field does nothing. The shipped file must be V2-only.
const V1_ONLY_KEYS: readonly string[] = [
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

export const HARD_DENY_POLICIES: readonly string[] = [
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

/** One permission rule, after `validateConfig` has proved its shape. */
export interface PermissionRule {
  readonly action: string;
  readonly resource: string;
  readonly effect: string;
}

function fail(message: string): never {
  throw new Error(message);
}

// OpenCode matches whole values: `*` matches zero or more characters including
// `/`, and `?` matches exactly one character.
function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

// Last matching rule wins. A rule with action `*` applies to every action.
export function effectFor(
  permissions: readonly PermissionRule[],
  action: string,
  resource: string,
): string | null {
  let effect: string | null = null;
  for (const rule of permissions) {
    if (rule.action !== action && rule.action !== "*") continue;
    if (!globToRegExp(rule.resource).test(resource)) continue;
    effect = rule.effect;
  }
  return effect;
}

// Exported so tests can exercise each invariant directly as well as through the CLI.
export function validateConfig(config: unknown): unknown {
  if (!isRecord(config)) fail("config must be a JSON object");

  for (const key of V1_ONLY_KEYS) {
    if (key in config) fail(`V1-only key is not allowed in opencode.json: ${key}`);
  }

  const rawPermissions = config["permissions"];
  if (!isUnknownArray(rawPermissions) || rawPermissions.length === 0) {
    fail("permissions must be a non-empty array");
  }

  const permissions: PermissionRule[] = [];
  for (const [index, rawRule] of rawPermissions.entries()) {
    if (!isRecord(rawRule)) fail(`permissions[${index}] must be an object`);
    const action = rawRule["action"];
    if (!isString(action) || action.length === 0) {
      fail(`permissions[${index}].action must be a non-empty string`);
    }
    const resource = rawRule["resource"];
    if (!isString(resource)) fail(`permissions[${index}].resource must be a string`);
    const effect = rawRule["effect"];
    if (!isString(effect) || !EFFECTS.has(effect)) {
      fail(`permissions[${index}].effect must be allow, ask, or deny`);
    }
    permissions.push({ action, resource, effect });
  }

  const baseline = permissions[0];
  if (!baseline || baseline.action !== "*" || baseline.resource !== "*" || baseline.effect !== "ask") {
    fail('permissions[0] must be { "action": "*", "resource": "*", "effect": "ask" }');
  }

  const expect = (action: string, resource: string, expected: string): void => {
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
  expect("shell", "junamis-orchestrator boot", "allow");
  expect("shell", "node scripts/orchestrator-state.mjs boot", "allow");
  expect("shell", "cat .env", "deny");

  expect("webfetch", "https://example.com", "ask");
  expect("webfetch", "https://opencode.ai/docs", "allow");

  expect("websearch", "anything", "ask");
  expect("websearch", "opencode.ai docs", "allow");

  expect("browser", "*", "deny");
  expect("execute", "*", "allow");

  const readDenyCount = permissions.filter(
    (rule) => rule.action === "read" && rule.effect === "deny",
  ).length;
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

  const mcp = config["mcp"];
  if (
    !isRecord(mcp) ||
    !isRecord(mcp["servers"]) ||
    Object.keys(mcp["servers"]).length !== 0
  ) {
    fail("mcp.servers must be an empty object");
  }
  const plugins = config["plugins"];
  if (!isUnknownArray(plugins) || plugins.length !== 0) {
    fail("plugins must be an empty array");
  }
  if (config["update"] !== "notify") fail('update must be "notify"');
  if (config["formatter"] !== false) fail("formatter must be false");

  const policies = config["policies"];
  if (!isUnknownArray(policies)) fail("policies must be an array");
  for (const resource of HARD_DENY_POLICIES) {
    const found = policies.some(
      (rule) =>
        isRecord(rule) &&
        rule["action"] === "tool.use" &&
        rule["resource"] === resource &&
        rule["effect"] === "deny",
    );
    if (!found) fail(`policies must hard-deny ${resource}`);
  }

  return config;
}

/** CLI entry. The launcher in `scripts/` calls this with `process.argv.slice(2)`. */
export async function run(argv: readonly string[]): Promise<void> {
  const requested = argv[0];
  const configPath = requested ? resolve(requested) : join(packageRoot, "opencode.json");

  const raw = await readFile(configPath, "utf8");
  const parsed = parseJsonUnknown(raw);
  if (!parsed.ok) {
    console.error(`invalid JSON: ${parsed.error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    validateConfig(parsed.value);
  } catch (error) {
    console.error(`✖ ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log("✔ opencode.json valid");
}
