#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Exported so tests can exercise each invariant directly as well as through the CLI.
export function validateConfig(cfg) {
  const fail = (message) => { throw new Error(message); };
  const perm = cfg.permission;
  if (!perm || typeof perm !== "object" || Array.isArray(perm)) fail("missing permission object");
  for (const key of ["read", "edit", "webfetch", "websearch", "external_directory"]) {
    if (!(key in perm)) fail(`missing permission key: ${key}`);
  }
  // Ensure secret deny rules present
  if (perm.read?.[".env"] !== "deny") fail("read .env must be deny");
  if (perm.webfetch?.["*"] !== "ask") fail("webfetch default must be ask");
  if (perm.websearch?.["*"] !== "allow") fail("websearch default must be allow");

  // The documented invariants. The glob denylist is not the whole control, so
  // bash must require confirmation and no plaintext or user-content host may
  // bypass the webfetch default. OpenCode also accepts string permission forms,
  // which would otherwise hide an unrestricted bash behind a missing "*" key.
  if (perm.bash === "allow") fail('permission.bash must not be "allow" (use "ask")');
  if (!perm.bash || typeof perm.bash !== "object" || Array.isArray(perm.bash)) {
    fail("permission.bash must be a non-array object of command rules");
  }
  if (perm.bash["*"] === "allow") {
    fail('permission.bash["*"] must not be "allow" (use "ask")');
  }
  if (perm.bash["**"] === "allow") {
    fail('permission.bash["**"] must not be "allow" (broad catch-all)');
  }
  if (perm.external_directory !== "deny") fail('permission.external_directory must be "deny"');
  for (const key of Object.keys(perm.webfetch ?? {})) {
    if (key.startsWith("http://")) fail(`webfetch must not allow plaintext HTTP: ${key}`);
    if (key.includes(".vercel.app") || key.includes(".netlify.app")) {
      fail(`webfetch must not allow user-content hosting: ${key}`);
    }
  }
  const readDenyCount = Object.values(perm.read ?? {}).filter((value) => value === "deny").length;
  if (readDenyCount < 30) fail(`read deny rules: found ${readDenyCount}, need at least 30`);
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
