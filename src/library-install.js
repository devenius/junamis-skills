import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { getTarget } from "./targets/index.js";

// Installs the library (skills, agents, shared docs) so an agent can load it.
// Copies by default. Records every written file in a manifest so later runs can
// update our files and never overwrite files the user changed by hand.

export const SHARED_DOCS = ["HANDOFF.md", "SAFETY.md", "EXTERNAL.md"];
export const ORCHESTRATOR = "orchestrator";

export function sharedDocsDir() {
  return join(homedir(), ".junamis", "library");
}

export function manifestPath(agentId) {
  return join(homedir(), ".junamis", "installed", `library-${agentId}.json`);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

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

export async function planLibraryInstall({ packageRoot, agent }) {
  const target = getTarget(agent);
  if (!target) throw new Error(`unknown agent "${agent}"`);
  const libDir = join(packageRoot, "library");
  const files = [];

  const skillsRoot = join(libDir, "skills");
  for (const name of (await readdir(skillsRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const src of await walk(join(skillsRoot, name))) {
      const rel = relative(join(skillsRoot, name), src);
      files.push({ path: join(target.globalSkillsDir(), name, rel), content: await readFile(src) });
    }
  }

  const agentsRoot = join(libDir, "agents");
  for (const file of (await readdir(agentsRoot)).filter((f) => f.endsWith(".md")).sort()) {
    const name = file.replace(/\.md$/, "");
    const text = await readFile(join(agentsRoot, file), "utf8");
    files.push({
      path: join(target.libraryAgentsDir(), `${name}.md`),
      content: Buffer.from(renderAgent(text, { name, format: target.libraryAgentFormat }), "utf8"),
    });
  }

  for (const doc of SHARED_DOCS) {
    files.push({ path: join(sharedDocsDir(), doc), content: await readFile(join(libDir, doc)) });
  }

  return files.map((f) => ({ ...f, sha256: sha256(f.content) }));
}

async function readManifest(agentId) {
  const path = manifestPath(agentId);
  if (!existsSync(path)) return { files: [] };
  return JSON.parse(await readFile(path, "utf8"));
}

// Decides per file: create, update (ours), unchanged, or conflict (user-edited, not ours).
export async function applyLibraryInstall({ agent, files, version, force = false, dryRun = false }) {
  const previous = await readManifest(agent);
  const owned = new Set(previous.files.map((f) => f.path));
  const actions = [];
  const conflicts = [];

  for (const f of files) {
    if (!existsSync(f.path)) {
      actions.push({ path: f.path, action: "create" });
      continue;
    }
    const current = sha256(await readFile(f.path));
    if (current === f.sha256) actions.push({ path: f.path, action: "unchanged" });
    else if (owned.has(f.path)) actions.push({ path: f.path, action: "update" });
    else if (force) actions.push({ path: f.path, action: "overwrite (--force)" });
    else conflicts.push(f.path);
  }

  const planned = new Set(files.map((f) => f.path));
  const stale = previous.files.map((f) => f.path).filter((p) => !planned.has(p));

  if (conflicts.length > 0) return { ok: false, actions, conflicts, stale };
  if (dryRun) return { ok: true, dryRun: true, actions, conflicts, stale };

  for (const f of files) {
    const act = actions.find((a) => a.path === f.path);
    if (act.action === "unchanged") continue;
    await mkdir(dirname(f.path), { recursive: true });
    await writeFile(f.path, f.content);
  }
  for (const p of stale) {
    if (existsSync(p)) await rm(p, { force: true });
  }

  const manifest = {
    agent,
    version,
    installedAt: new Date().toISOString(),
    files: files.map((f) => ({ path: f.path, sha256: f.sha256 })),
  };
  await mkdir(dirname(manifestPath(agent)), { recursive: true });
  await writeFile(manifestPath(agent), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return { ok: true, actions, conflicts, stale };
}
