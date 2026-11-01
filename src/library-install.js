import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { getTarget } from "./targets/index.js";

// Installs the library (skills, agents, shared docs) so an agent can load it.
// Copies by default. Records every written file in a manifest so later runs can
// update our files and never overwrite files the user changed by hand.

export const SHARED_DOCS = ["HANDOFF.md", "SAFETY.md", "EXTERNAL.md"];
export const ORCHESTRATOR = "orchestrator";

export function sharedDocsDir(scope = "global", projectDir = process.cwd()) {
  if (scope === "project") return join(projectDir, ".junamis", "library");
  return join(homedir(), ".junamis", "library");
}

export function manifestPath(agentId, scope = "global", projectDir = process.cwd()) {
  if (scope === "project") return join(projectDir, ".junamis", "installed", `library-${agentId}.json`);
  return join(homedir(), ".junamis", "installed", `library-${agentId}.json`);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// Write through a temp file in the same directory, then rename. A rename on the
// same filesystem is atomic, so a crash or error leaves the previous file intact.
async function atomicWriteFile(path, content) {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, content);
  await rename(tmp, path);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile()) out.push(p);
  }
  return out.sort();
}

// Parses the frontmatter we control. Returns { fields, body }.
export function parseAgent(text, file) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { fields, body: m[2] };
}

// Rewrites an agent definition into the frontmatter the target expects.
// Our internal keys (skills, version) are dropped: OpenCode would send them to the model.
export function renderAgent(text, { name, format }) {
  const { fields, body } = parseAgent(text, `${name}.md`);
  if (!fields.description) throw new Error(`${name}.md: description is required`);
  const description = JSON.stringify(fields.description);
  let header;
  if (format === "opencode") {
    header = [`description: ${description}`, `mode: ${name === ORCHESTRATOR ? "primary" : "subagent"}`];
  } else if (format === "claude") {
    header = [`name: ${name}`, `description: ${description}`];
  } else {
    throw new Error(`unknown agent format: ${format}`);
  }
  return `---\n${header.join("\n")}\n---\n${body}`;
}

export async function planLibraryInstall({ packageRoot, agent, scope = "global", projectDir = process.cwd() }) {
  const target = getTarget(agent);
  if (!target) throw new Error(`unknown agent "${agent}"`);
  const libDir = join(packageRoot, "library");
  const files = [];

  const skillsDir = scope === "project" ? target.projectSkillsDir(projectDir) : target.globalSkillsDir();
  const agentsDir = scope === "project" ? target.projectAgentsDir(projectDir) : target.libraryAgentsDir();

  const skillsRoot = join(libDir, "skills");
  for (const name of (await readdir(skillsRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const src of await walk(join(skillsRoot, name))) {
      const rel = relative(join(skillsRoot, name), src);
      files.push({ path: join(skillsDir, name, rel), content: await readFile(src) });
    }
  }

  const agentsRoot = join(libDir, "agents");
  for (const file of (await readdir(agentsRoot)).filter((f) => f.endsWith(".md")).sort()) {
    const name = file.replace(/\.md$/, "");
    const text = await readFile(join(agentsRoot, file), "utf8");
    files.push({
      path: join(agentsDir, `${name}.md`),
      content: Buffer.from(renderAgent(text, { name, format: target.libraryAgentFormat }), "utf8"),
    });
  }

  for (const doc of SHARED_DOCS) {
    files.push({ path: join(sharedDocsDir(scope, projectDir), doc), content: await readFile(join(libDir, doc)) });
  }

  return files.map((f) => ({ ...f, sha256: sha256(f.content) }));
}

async function readManifest(agentId, scope = "global", projectDir = process.cwd()) {
  const path = manifestPath(agentId, scope, projectDir);
  if (!existsSync(path)) return { files: [] };
  return JSON.parse(await readFile(path, "utf8"));
}

// Decides per file: create, update (ours, unmodified), unchanged, or conflict (user-edited or unmanaged).
export async function applyLibraryInstall({ agent, files, version, force = false, dryRun = false, scope = "global", projectDir = process.cwd() }) {
  const previous = await readManifest(agent, scope, projectDir);
  const owned = new Set(previous.files.map((f) => f.path));
  const previousHash = new Map(previous.files.map((f) => [f.path, f.sha256]));
  const actions = [];
  const conflicts = [];

  for (const f of files) {
    if (!existsSync(f.path)) {
      actions.push({ path: f.path, action: "create" });
      continue;
    }
    const current = sha256(await readFile(f.path));
    if (current === f.sha256) {
      actions.push({ path: f.path, action: "unchanged" });
      continue;
    }
    if (owned.has(f.path)) {
      // Only overwrite a managed file automatically when the user has not edited
      // it since our last install. An edited file is a conflict unless --force.
      const last = previousHash.get(f.path);
      if (last === undefined || current === last) {
        actions.push({ path: f.path, action: "update" });
      } else if (force) {
        actions.push({ path: f.path, action: "overwrite (--force)" });
      } else {
        conflicts.push(f.path);
      }
    } else if (force) {
      actions.push({ path: f.path, action: "overwrite (--force)" });
    } else {
      conflicts.push(f.path);
    }
  }

  const planned = new Set(files.map((f) => f.path));
  const stale = previous.files.map((f) => f.path).filter((p) => !planned.has(p));

  // Never delete a stale file the user has edited, unless --force.
  const removableStale = [];
  const staleConflicts = [];
  for (const p of stale) {
    if (!existsSync(p)) continue;
    const last = previousHash.get(p);
    const current = sha256(await readFile(p));
    if (last !== undefined && current !== last && !force) staleConflicts.push(p);
    else removableStale.push(p);
  }
  const allConflicts = [...conflicts, ...staleConflicts];

  if (allConflicts.length > 0) return { ok: false, actions, conflicts: allConflicts, stale };
  if (dryRun) return { ok: true, dryRun: true, actions, conflicts: [], stale };

  // Back up everything we are about to change so a failure can be rolled back.
  const backups = new Map();
  for (const f of files) {
    const act = actions.find((a) => a.path === f.path);
    if (!act || act.action === "unchanged") continue;
    backups.set(f.path, existsSync(f.path) ? await readFile(f.path) : null);
  }
  for (const p of removableStale) {
    if (existsSync(p)) backups.set(p, await readFile(p));
  }
  const mPath = manifestPath(agent, scope, projectDir);
  if (existsSync(mPath)) backups.set(mPath, await readFile(mPath));

  try {
    for (const f of files) {
      const act = actions.find((a) => a.path === f.path);
      if (!act || act.action === "unchanged") continue;
      await mkdir(dirname(f.path), { recursive: true });
      await atomicWriteFile(f.path, f.content);
    }
    for (const p of removableStale) {
      if (existsSync(p)) await rm(p, { force: true });
    }

    const manifest = {
      agent,
      version,
      installedAt: new Date().toISOString(),
      files: files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    };
    await mkdir(dirname(mPath), { recursive: true });
    await atomicWriteFile(mPath, JSON.stringify(manifest, null, 2) + "\n");
  } catch (error) {
    // Best-effort rollback to the pre-install state.
    const root = scope === "project" ? projectDir : homedir();
    for (const [path, content] of backups) {
      try {
        if (content === null) {
          if (existsSync(path)) await rm(path, { force: true });
        } else {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, content);
        }
      } catch {
        // Ignore rollback errors; rethrow the original.
      }
      // Remove directories that became empty because of the rollback.
      let dir = dirname(path);
      while (dir && dir !== root && dir !== dirname(dir)) {
        try {
          const entries = await readdir(dir);
          if (entries.length > 0) break;
          await rm(dir, { recursive: true, force: true });
          dir = dirname(dir);
        } catch {
          break;
        }
      }
    }
    throw error;
  }

  return { ok: true, actions, conflicts: [], stale };
}