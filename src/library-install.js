import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getTarget } from "./targets/index.js";

// Installs the library (skills, agents, shared docs) so an agent can load it.
// Copies by default. Records every written file in a manifest so later runs can
// update our files and never overwrite files the user changed by hand.

// Shared docs are read from library/, except SECURITY.md, which lives at the
// package root because it is also the repository's public scan record.
export const SHARED_DOCS = ["HANDOFF.md", "SAFETY.md", "EXTERNAL.md", "SECURITY.md"];
export const ORCHESTRATOR = "orchestrator";

export function sharedDocsDir(scope = "global", projectDir = process.cwd()) {
  if (scope === "project") return join(projectDir, ".config", "junamis");
  return join(homedir(), ".config", "junamis");
}

export function manifestPath(agentId, scope = "global", projectDir = process.cwd()) {
  return join(sharedDocsDir(scope, projectDir), "installed", `library-${agentId}.json`);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// Write through a temp file in the same directory, then rename. A rename on the
// same filesystem is atomic, so a crash or error leaves the previous file intact.
async function atomicWriteFile(path, content) {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, content, { flag: "wx" });
  try {
    await rename(tmp, path);
  } catch (error) {
    try { await rm(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw error;
  }
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

  const skillsDir = scope === "project" ? target.projectLibrarySkillsDir(projectDir) : target.librarySkillsDir();
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
    const source = doc === "SECURITY.md" ? join(packageRoot, "SECURITY.md") : join(libDir, doc);
    files.push({ path: join(sharedDocsDir(scope, projectDir), doc), content: await readFile(source) });
  }

  return files.map((f) => ({ ...f, sha256: sha256(f.content) }));
}

const HEX64 = /^[a-f0-9]{64}$/;

function managedRoots(agentId, scope, projectDir) {
  const target = getTarget(agentId);
  if (!target) throw new Error(`unknown agent "${agentId}"`);
  // The internal skills directory may be nested inside the shared docs
  // directory (OpenCode). Both stay roots so each is checked for symlinks; a
  // destination may therefore belong to more than one valid root.
  return scope === "project"
    ? [target.projectLibrarySkillsDir(projectDir), target.projectAgentsDir(projectDir), sharedDocsDir("project", projectDir)]
    : [target.librarySkillsDir(), target.libraryAgentsDir(), sharedDocsDir("global")];
}

function isInside(root, target) {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function isMissingPath(error) {
  return Boolean(error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"));
}

function realpathOrNull(path) {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

// Resolve the real path a write or delete would hit, even when the final
// segments do not exist yet: realpath the deepest existing ancestor, then
// re-append the missing segments. Lexical containment alone is not enough,
// because a symlinked parent can redirect the path outside the managed roots.
function actualPath(path) {
  const missing = [];
  let current = resolve(path);
  for (;;) {
    const real = realpathOrNull(current);
    if (real !== null) return missing.length === 0 ? real : join(real, ...missing);
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    missing.unshift(basename(current));
    current = parent;
  }
}

// A managed root may only be absent or a directory. A symlinked root is
// resolved by the containment check below, but its target must still be a
// directory. ENOTDIR means an ancestor is a file, which is never usable as a
// root, so it becomes a clean rejection instead of a raw filesystem error.
function assertRootIsDirectory(root) {
  let stat;
  try {
    stat = lstatSync(root);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") return;
      if (error.code === "ENOTDIR") throw new Error(`managed root is not a directory: ${root}`, { cause: error });
    }
    throw error;
  }
  if (stat.isDirectory()) return;
  if (stat.isSymbolicLink()) {
    let followed;
    try {
      followed = statSync(root);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        if (error.code === "ENOENT") return;
        if (error.code === "ENOTDIR") throw new Error(`managed root is not a directory: ${root}`, { cause: error });
      }
      throw error;
    }
    if (followed.isDirectory()) return;
  }
  throw new Error(`managed root is not a directory: ${root}`);
}

// The managed roots themselves must not be symlinks that redirect writes or
// deletes away from the location we planned. Project scope keeps the exact
// expected real path. Global scope accepts any root inside the real home
// directory, so legitimate dotfile symlinks such as ~/.agents or ~/.config
// keep working, while a root that escapes home is still rejected.
export function assertManagedRoots(agentId, scope = "global", projectDir = process.cwd()) {
  const roots = managedRoots(agentId, scope, projectDir).map((root) => resolve(root));
  for (const root of roots) assertRootIsDirectory(root);
  const actualRoots = roots.map((root) => actualPath(root));

  if (scope === "project") {
    // The base directory may itself be reached through a symlink: relative()
    // keeps the same suffix, so only a symlink in the root's own location fails.
    const base = resolve(projectDir);
    // The project directory may not exist yet (init --dir <new>), so fall back
    // to the lexical path. actualPath() above already handles missing segments.
    const realBase = realpathOrNull(base) ?? base;
    for (const [index, actualRoot] of actualRoots.entries()) {
      const expected = join(realBase, relative(base, roots[index]));
      if (actualRoot !== expected) {
        throw new Error(`managed root contains a symlink or escapes its expected location: ${roots[index]}`);
      }
    }
  } else {
    const home = resolve(homedir());
    const realHome = realpathOrNull(home) ?? home;
    for (const [index, actualRoot] of actualRoots.entries()) {
      if (actualRoot !== realHome && !isInside(realHome, actualRoot)) {
        throw new Error(`managed root contains a symlink or escapes its expected location: ${roots[index]}`);
      }
    }
  }

  return { roots, actualRoots };
}

// Planned destinations are checked before anything is written, even when there
// is no manifest or the manifest is empty. Each destination must resolve to a
// path strictly inside exactly one actual managed root.
export function assertPlannedDestinations(files, roots, actualRoots, scope) {
  for (const f of files) {
    if (typeof f.path !== "string" || !isAbsolute(f.path)) {
      throw new Error(`invalid library destination ${String(f.path)}: path must be an absolute path`);
    }
    const target = resolve(f.path);
    const owners = roots.filter((root) => isInside(root, target));
    if (owners.length === 0) {
      throw new Error(`invalid library destination ${f.path}: path is outside the managed ${scope} roots`);
    }
    const actualTarget = actualPath(f.path);
    const actualOwners = actualRoots.filter((root) => isInside(root, actualTarget));
    if (actualOwners.length === 0) {
      throw new Error(`invalid library destination ${f.path}: path escapes the managed ${scope} roots through a symlink`);
    }
  }
}

// A project-scoped manifest lives in the project, so it is attacker-controlled.
// Accept only absolute paths under this scope's managed roots, with a real hash,
// and never point at a symlink. Reject the whole manifest (fail closed).
export function validateLibraryManifest(agentId, manifest, scope = "global", projectDir = process.cwd()) {
  const path = manifestPath(agentId, scope, projectDir);
  const fail = (message) => {
    throw new Error(`invalid library manifest ${path}: ${message}`);
  };

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("expected a JSON object");
  }
  if (!Array.isArray(manifest.files)) {
    fail("files must be an array");
  }

  const { roots, actualRoots } = assertManagedRoots(agentId, scope, projectDir);
  const seen = new Set();
  for (const [index, entry] of manifest.files.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`files[${index}] must be an object`);
    }
    if (typeof entry.path !== "string" || !isAbsolute(entry.path)) {
      fail(`files[${index}].path must be an absolute path`);
    }
    if (typeof entry.sha256 !== "string" || !HEX64.test(entry.sha256)) {
      fail(`files[${index}].sha256 must be 64 lowercase hex characters`);
    }
    if (seen.has(entry.path)) {
      fail(`duplicate path: ${entry.path}`);
    }
    seen.add(entry.path);

    const target = resolve(entry.path);
    const owners = roots.filter((root) => isInside(root, target));
    if (owners.length === 0) {
      fail(`path is outside the managed ${scope} roots: ${entry.path}`);
    }

    const stat = lstatOrNull(entry.path);
    if (stat?.isSymbolicLink()) {
      fail(`refusing symlinked path: ${entry.path}`);
    }
    if (stat && !stat.isFile()) {
      fail(`refusing non-regular file: ${entry.path}`);
    }

    // The final component may not exist, but an ancestor can still be a symlink
    // that redirects the write outside the managed roots.
    const actualTarget = actualPath(entry.path);
    const actualOwners = actualRoots.filter((root) => isInside(root, actualTarget));
    if (actualOwners.length === 0) {
      fail(`path escapes the managed ${scope} roots through a symlink: ${entry.path}`);
    }
  }

  return manifest;
}

async function readManifest(agentId, scope = "global", projectDir = process.cwd()) {
  // Run the root check even when there is no manifest, so an empty install
  // cannot skip containment.
  assertManagedRoots(agentId, scope, projectDir);
  const path = manifestPath(agentId, scope, projectDir);
  if (!existsSync(path)) return { files: [] };
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `invalid library manifest ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return validateLibraryManifest(agentId, parsed, scope, projectDir);
}

// Decides per file: create, update (ours, unmodified), unchanged, or conflict (user-edited or unmanaged).
export async function applyLibraryInstall({ agent, files, version, force = false, dryRun = false, scope = "global", projectDir = process.cwd() }) {
  // Containment is checked before any write or delete, even when no manifest
  // exists or the manifest is empty and --force is given.
  const { roots, actualRoots } = assertManagedRoots(agent, scope, projectDir);
  assertPlannedDestinations(files, roots, actualRoots, scope);
  const previous = await readManifest(agent, scope, projectDir);
  const owned = new Set(previous.files.map((f) => f.path));
  const previousHash = new Map(previous.files.map((f) => [f.path, f.sha256]));
  const actions = [];
  const conflicts = [];

  for (const f of files) {
    const stat = lstatOrNull(f.path);
    if (!stat) {
      actions.push({ path: f.path, action: "create" });
      continue;
    }
    if (!stat.isFile()) {
      // A directory or other special file is never read, overwritten, or deleted.
      conflicts.push(f.path);
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
    const stat = lstatOrNull(p);
    if (!stat) continue;
    if (!stat.isFile()) {
      // Never read or delete a path that is no longer a regular file.
      staleConflicts.push(p);
      continue;
    }
    const last = previousHash.get(p);
    // Never delete a path whose recorded hash is unknown. A valid manifest always
    // has one, so this only protects against a hand-edited record.
    if (last === undefined) {
      staleConflicts.push(p);
      continue;
    }
    const current = sha256(await readFile(p));
    if (current !== last && !force) staleConflicts.push(p);
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
