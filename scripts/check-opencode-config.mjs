#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const raw = await readFile(join(root, "opencode.json"), "utf8");
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { console.error("invalid JSON:", e.message); process.exit(1); }
  const perm = cfg.permission;
  if (!perm || typeof perm !== "object") { console.error("missing permission object"); process.exit(1); }
  for (const key of ["read", "edit", "webfetch", "websearch", "external_directory"]) {
    if (!(key in perm)) { console.error(`missing permission key: ${key}`); process.exit(1); }
  }
  // Ensure secret deny rules present
  if (perm.read?.[".env"] !== "deny") { console.error("read .env must be deny"); process.exit(1); }
  if (perm.webfetch?.["*"] !== "ask") { console.error("webfetch default must be ask"); process.exit(1); }
  if (perm.websearch?.["*"] !== "allow") { console.error("websearch default must be allow"); process.exit(1); }
  console.log("✔ opencode.json valid");
}

main().catch((e) => { console.error(e); process.exit(1); });