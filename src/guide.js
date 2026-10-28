import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const GUIDE_NAME = "junamis-skills-guide.md";
export const MARKER_PATH = join(".junamis", "install.json");

async function readPackageVersion(packageRoot) {
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  return pkg.version;
}

async function listLibrarySkills(packageRoot) {
  const dir = join(packageRoot, "library", "skills");
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function listLibraryAgents(packageRoot) {
  const dir = join(packageRoot, "library", "agents");
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries.filter((x) => x.isFile() && x.name.endsWith(".md"))) {
    const text = await readFile(join(dir, e.name), "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    const fields = {};
    if (fm) for (const line of fm[1].split("\n")) {
      const kv = line.match(/^([a-z]+):\s*(.*)$/);
      if (kv) fields[kv[1]] = kv[2].trim();
    }
    const skills = (fields.skills || "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    out.push({ name: e.name.replace(/\.md$/, ""), description: fields.description || "", skills });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function listLockedSkills(packageRoot) {
  const lock = JSON.parse(await readFile(join(packageRoot, "skills-lock.json"), "utf8"));
  const skills = Object.entries(lock.skills)
    .map(([name, entry]) => ({ name, source: entry.source, license: entry.license ?? "unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Group by source so the guide can print one install command per source.
  const bySource = new Map();
  for (const sk of skills) {
    if (!bySource.has(sk.source)) bySource.set(sk.source, []);
    bySource.get(sk.source).push(sk.name);
  }
  const installCommands = [...bySource.entries()]
    .map(([source, names]) => `npx skillsio add ${source} --agent <agent> --skill ${names.join(" ")} -y`)
    .join("\n");
  skills.installCommands = installCommands;
  return skills;
}

export function renderGuide({ version, library, agents, locked }) {
  const installCommands = locked.installCommands || "";
  const unknown = locked.filter((s) => s.license === "unknown").map((s) => s.name);
  const lockedLines = locked
    .map((s) => `| ${s.name} | ${s.source} | ${s.license} |`)
    .join("\n");

  const agentLines = agents
    .map((a) => `- **${a.name}** — ${a.description}\n  Owns: ${a.skills.join(", ")}`)
    .join("\n");

  const libraryLines = library.join(", ");

  return `# junamis-skills setup guide

Installed junamis-skills ${version}. This guide explains how the agents are wired together and how to drive them. It is a project file, not a skill, and no agent loads it automatically. Read it once, then keep it for reference or delete it.

## What was installed

- **Library skills** (owned by this project, in \`library/skills/\`): ${libraryLines}.
- **External skills** (from \`skills-lock.json\`, installed globally by your skills installer): ${locked.length} entries.

| Skill | Source | License |
|---|---|---|
${lockedLines}

${unknown.length > 0 ? `Licenses marked \`unknown\` are not verified. Do not publish work that depends on: ${unknown.join(", ")}.\n` : ""}
## How the agents are structured

There is one entry point and five specialists. Every request starts at the orchestrator. The orchestrator never does the work itself; it routes and dispatches.

${agentLines}

### The dispatch loop

1. You send a request to the **orchestrator**.
2. The orchestrator runs the \`route\` skill, which classifies the request into one path: feature, bug, refactor, dependency, migration, release, incident, security, performance, environment, decision, skill, research, or question.
3. The orchestrator looks up the owning agent and skill for that path and dispatches exactly one step.
4. The specialist runs its skill and ends with a HANDOFF block (see \`~/.junamis/library/HANDOFF.md\` in the installed package).
5. The orchestrator reads only the HANDOFF block. It checks that every listed artifact exists on disk.
6. It then decides: dispatch the \`next\` skill, ask you a question, or stop.

### Handoff contract

Every specialist ends with one YAML block:

\`\`\`yaml
agent: <name>
status: complete | blocked | needs-decision | failed
artifacts:
  - path: <file written>
next: <one skill name, agent name, user, or none>
\`\`\`

- \`complete\` means the files exist on disk. The orchestrator checks before moving on.
- \`needs-decision\` stops the chain. You answer, then the orchestrator continues from that step.
- \`blocked\` and \`failed\` stop the chain and report. Nothing retries silently.
- \`next\` names exactly one target. A specialist never calls another specialist directly.
- Chat is not state. Anything a later agent needs must be in a file.

### Safety

Destructive or external actions need your explicit approval for that exact command. The full list is in \`~/.junamis/library/SAFETY.md\` in the installed package. In short: deleting files, \`sudo\`, global installs, \`git push\`, production deploys, forced overwrites, and data changes. The \`-y\` flag is not approval.

## Always start with the orchestrator

Do not call a library skill or an external skill directly, even if you know its name. Send the request to the orchestrator. It reads the skills available to it, both the library skills and the external skills in your global skills folder, and uses their descriptions to decide what runs next. You do not need to name a skill yourself.

If a skill you need is not installed, the orchestrator stops and tells you which one is missing. It does not improvise.

## Installing the library and the external skills

Two commands, run once per machine. Review the dry run before the real install.

1. Preview what the library install will change, then install it:

        npx junamis-skills install-library --agent opencode --dry-run
        npx junamis-skills install-library --agent opencode

2. Install the external skills from the manifest. skillsio shows its security scan. Critical findings still ask you to confirm; nothing is skipped or answered for you:

        npx junamis-skills install-external --agent opencode

Use \`--agent claude\` instead of \`opencode\` for Claude Code. The library install never overwrites a file you edited; it stops and lists the file. Use \`--force\` only after you have reviewed it.

Skills install as a set from the manifest. Never install one skill in isolation, because skills reference each other.

## What to configure

1. **Your CLIs.** Tell the agent which CLIs you use (for example \`vercel\`, \`gh\`, \`pnpm\`). The setup step records their versions in \`docs/env-report.md\`.
2. **Environment names.** Local env variable names the project needs. The agent records names only, never values.
3. **Tokens and logins.** Any token (for example Vercel) is yours to create and paste when asked. The agent never stores one in a file.

## Where state lives

- \`.junamis/handoff.md\`: session state, written by the orchestrator at the end of work.
- \`docs/decisions/\`: decisions you make, so later work checks against them.
- \`docs/research/\`, \`docs/reviews/\`, \`docs/releases/\`: outputs of their skills.

## To start

Open a project in OpenCode and send your first request to the orchestrator. For example: "set up this project's environment" or "what should I work on next".
`;
}

async function readMarker(projectDir) {
  const path = join(projectDir, MARKER_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Write the one-time setup guide into projectDir.
 * - Idempotent: if the guide was already written by this package, do nothing.
 * - Never overwrites a guide the user has, unless force is true.
 */
export async function writeGuide({ projectDir, force = false, packageRoot = PACKAGE_ROOT } = {}) {
  const guidePath = join(projectDir, GUIDE_NAME);
  const marker = await readMarker(projectDir);
  const version = await readPackageVersion(packageRoot);

  if (!force && marker?.guide === GUIDE_NAME && existsSync(guidePath)) {
    return { status: "exists", path: guidePath, version: marker.version };
  }
  if (!force && existsSync(guidePath) && !marker) {
    return { status: "kept-user-file", path: guidePath, version };
  }

  const library = await listLibrarySkills(packageRoot);
  const agents = await listLibraryAgents(packageRoot);
  const locked = await listLockedSkills(packageRoot);
  await writeFile(guidePath, renderGuide({ version, library, agents, locked }), "utf8");

  await mkdir(join(projectDir, ".junamis"), { recursive: true });
  await writeFile(
    join(projectDir, MARKER_PATH),
    JSON.stringify({ guide: GUIDE_NAME, version, writtenAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );

  return { status: "created", path: guidePath, version };
}
