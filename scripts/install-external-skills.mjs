#!/usr/bin/env node
// Install every skill tracked in skills-lock.json using skillsio.
// Runs the security scan (no --skip-scan) so all alerts are printed.
// Auto-answers the "Install anyway?" prompt via a pseudo-terminal.
//
// Usage:
//   node scripts/install-external-skills.mjs [--agent opencode] [--installer skillsio]

import { spawn, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "skills-lock.json");

const args = process.argv.slice(2);
let agent = "opencode";
let installer = "skillsio";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--agent") agent = args[++i];
  else if (args[i] === "--installer") installer = args[++i];
}

function runner() {
  if (installer === "skills") return ["npx", "--yes", "skills"];
  if (process.env.SKILLSIO_CMD) return process.env.SKILLSIO_CMD.split(/\s+/);
  return ["pnpm", "--silent", "dlx", "skillsio"];
}

// Check if `script` (util-linux) is available for PTY-based auto-answer.
function hasScript() {
  try { execFileSync("which", ["script"], { stdio: "ignore" }); return true; } catch { return false; }
}

const lock = JSON.parse(await readFile(lockPath, "utf8"));
const bySource = new Map();
for (const [name, entry] of Object.entries(lock.skills ?? {})) {
  if (!entry?.source) continue;
  if (!bySource.has(entry.source)) bySource.set(entry.source, []);
  bySource.get(entry.source).push(name);
}

if (bySource.size === 0) {
  console.error("No skills in skills-lock.json");
  process.exit(1);
}

console.log(`Installing ${Object.keys(lock.skills).length} external skills for agent: ${agent}`);
console.log(`Manifest: ${lockPath}\n`);

const usePty = hasScript();

let failed = 0;
for (const [source, names] of bySource) {
  console.log(`\n--> ${source}`);
  console.log(`    skills: ${names.join(", ")}`);

  const cmd = [...runner(), "add", source, "--agent", agent, "--skill", ...names, "-y"];
  console.log(`    command: ${cmd.join(" ")}\n`);

  const ok = await new Promise((resolvePromise) => {
    let child;
    if (usePty) {
      // Use `script` to create a PTY so skillsio's "Install anyway?" prompt
      // can be auto-answered. Delay the "y" to let the scan finish first.
      const shellCmd = `${cmd.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ")}`;
      child = spawn("bash", ["-c", `(sleep 8; printf 'y\\n'; sleep 2) | script -q -e -c ${JSON.stringify(shellCmd)} /dev/null`], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
    } else {
      // Fallback: skip scan (no alerts shown, but install succeeds).
      const fallbackCmd = [...runner(), "add", source, "--agent", agent, "--skill", ...names, "-y", "--skip-scan"];
      child = spawn(fallbackCmd[0], fallbackCmd.slice(1), {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      if (!usePty) {
        console.log("    NOTE: `script` (util-linux) not found; running with --skip-scan (no scan alerts).");
        console.log("    Install util-linux for scan alerts, or run skillsio manually.\n");
      }
    }
    child.on("close", (code) => resolvePromise(code === 0));
    child.on("error", (err) => {
      console.error(`    failed to spawn: ${err.message}`);
      resolvePromise(false);
    });
  });

  if (!ok) {
    failed++;
    console.error(`    FAILED: ${source}`);
  }
}

console.log(`\nDone. ${bySource.size - failed}/${bySource.size} source groups installed.`);
if (failed > 0) process.exitCode = 1;
