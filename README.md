# junamis-agents-skills

An orchestrated set of Agent Skills and agents for AI coding tools. The package ships:

- **The library** (`library/`): the orchestrator, eight specialist agents, and the skills they use.
- **The manifest** (`skills-lock.json`): the external skills the library refers to, pinned by source and license.
- **An installer** (`junamis-agents-skills`): installs the library and the external skills, and writes a setup guide into your project.

## Quick start

Run these in the project that will use the skills. Use `--dry-run` first to see what will change. Requires Node.js 26+.

### Option A: Run directly from GitHub (no setup)

```bash
# 1. Write the setup guide into the project (once).
npx github:devenius/junamis-agents-skills init

# 1b. (Optional) Also install all external skills now.
npx github:devenius/junamis-agents-skills init --with-external

# 2. Install the library: skills, agents, and shared docs.
#    Preview first:
npx github:devenius/junamis-agents-skills install-library --agent opencode --dry-run
#    Then apply:
npx github:devenius/junamis-agents-skills install-library --agent opencode

# For Claude Code instead of OpenCode:
npx github:devenius/junamis-agents-skills install-library --agent claude

# 3. Install the external skills. skillsio shows its security scan.
npx github:devenius/junamis-agents-skills install-external --agent opencode

# 4. (Optional) Write opencode.json with secret deny rules + webfetch allowlist.
npx github:devenius/junamis-agents-skills init-config --scope project
# or globally:
npx github:devenius/junamis-agents-skills init-config --scope global

# 5. Check state.
npx github:devenius/junamis-agents-skills status
```

### Option B: Install from GitHub Packages (faster after first setup)

Configure `~/.npmrc` once (see [Installing from GitHub Packages](#installing-from-github-packages)), then use the normal npx form:

```bash
# 1. Write the setup guide into the project (once).
npx @devenius/junamis-agents-skills init

# 1b. (Optional) Also install all external skills now.
npx @devenius/junamis-agents-skills init --with-external

# 2. Install the library: skills, agents, and shared docs.
#    Preview first:
npx @devenius/junamis-agents-skills install-library --agent opencode --dry-run
#    Then apply:
npx @devenius/junamis-agents-skills install-library --agent opencode

# For Claude Code instead of OpenCode:
npx @devenius/junamis-agents-skills install-library --agent claude

# 3. Install the external skills. skillsio shows its security scan.
npx @devenius/junamis-agents-skills install-external --agent opencode

# 4. (Optional) Write opencode.json with secret deny rules + webfetch allowlist.
npx @devenius/junamis-agents-skills init-config --scope project
# or globally:
npx @devenius/junamis-agents-skills init-config --scope global

# 5. Check state.
npx @devenius/junamis-agents-skills status
```

Then open the project in your agent and send your first request to `orchestrator`.

## Commands

| Command | What it does |
|---|---|
| `init [--force] [--with-external] [--with-library] [--with-all]` | Writes `junamis-agents-skills-guide.md` at the project root, once. `--with-external` also runs `install-external`; `--with-library` also installs the library; `--with-all` does both. |
| `install-library --agent <a> [--dry-run] [--force]` | Copies library skills, agent definitions, and shared docs to the agent's directories. Never overwrites a file you edited unless `--force`. |
| `install-external --agent <a> [--installer skillsio\|skills]` | Installs every skill in `skills-lock.json` globally. The security scan is never skipped. |
| `status` | Shows the guide, the installed library version, and detected agents. |
| `doctor` | Checks Node version, detected agents, skills dirs, shared docs, manifest licenses, and `opencode.json`. |
| `sync [--agent <a>] [--dry-run] [--force]` | Reinstalls/refreshes the library for an agent (alias of `install-library`). |

## Supported agents

| Agent (`--agent`) | Skills directory | Agent definitions | Installer name |
|---|---|---|---|
| `opencode` | `~/.agents/skills` | `~/.config/opencode/agents` | `opencode` |
| `claude` | `~/.claude/skills` | `~/.claude/agents` | `claude-code` |
| `cursor` | `~/.cursor/skills` | `~/.cursor/agents` | (not supported by skillsio; use `skills`) |
| `windsurf` | `~/.windsurf/skills` | `~/.windsurf/agents` | (not supported by skillsio; use `skills`) |
| `cline` | `~/.cline/skills` | `~/.cline/agents` | (not supported by skillsio; use `skills`) |

Other agents are added on request, one target file each under `src/targets/`.

## Where things go

- Skills: `<skills directory>/<name>/SKILL.md`
- Agents: `<agent directory>/<name>.md`
- Shared rules the agents read: `~/.junamis/library/` (`HANDOFF.md`, `SAFETY.md`, `EXTERNAL.md`)
- Install record: `~/.junamis/installed/library-<agent>.json`

## External skills (manifest)

These are installed from `skills-lock.json` into the agent's global skills directory.

| Skill | Source | License |
|---|---|---|
| `agent-browser` | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Apache-2.0 |
| `agent-rules` | [netresearch/agent-rules-skill](https://github.com/netresearch/agent-rules-skill) | MIT OR CC-BY-SA-4.0 |
| `architect` | [JavaScript-Mastery-Pro/skills](https://github.com/JavaScript-Mastery-Pro/skills) | MIT |
| `check` | [JavaScript-Mastery-Pro/skills](https://github.com/JavaScript-Mastery-Pro/skills) | MIT |
| `debug` | [JavaScript-Mastery-Pro/skills](https://github.com/JavaScript-Mastery-Pro/skills) | MIT |
| `develop` | [JavaScript-Mastery-Pro/skills](https://github.com/JavaScript-Mastery-Pro/skills) | MIT |
| `doc-coauthoring` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 |
| `document` | [JavaScript-Mastery-Pro/skills](https://github.com/JavaScript-Mastery-Pro/skills) | MIT |
| `driftlock` | [KairosSignal/driftlock-agent-docs](https://github.com/KairosSignal/driftlock-agent-docs) | MIT |
| `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | MIT |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 |
| `grill-me` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT |
| `grill-with-docs` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT |
| `mcp-builder` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 |
| `nestjs-best-practices` | [Kadajett/agent-nestjs-skills](https://github.com/Kadajett/agent-nestjs-skills) | MIT |
| `scope` | [JavaScript-Mastery-Pro/skills](https://github.com/JavaScript-Mastery-Pro/skills) | MIT |
| `shadcn` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | MIT |
| `shadcn-component-discovery` | [mattbx/shadcn-skills](https://github.com/mattbx/shadcn-skills) | MIT |
| `shadcn-component-review` | [mattbx/shadcn-skills](https://github.com/mattbx/shadcn-skills) | MIT |
| `skill-creator` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 |
| `tdd` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT |
| `test` | [JavaScript-Mastery-Pro/skills](https://github.com/JavaScript-Mastery-Pro/skills) | MIT |
| `theme-factory` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 |
| `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 |

## Installing from GitHub Packages

This package is published to GitHub Packages as `@devenius/junamis-agents-skills`.

1. Create or edit `~/.npmrc` (or project `.npmrc`):

```ini
@devenius:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

2. Install or run:

```bash
npm install -g @devenius/junamis-agents-skills
# or run without installing:
npx github:devenius/junamis-agents-skills init
```

A GitHub personal access token with `read:packages` (and `write:packages` for publishing) is required.

## Safety

- The installer never runs a command through a shell. Every value is checked against a strict pattern before use.
- The security scan of external skills is never skipped. Critical findings still ask you to confirm.
- Destructive or external actions in the library need your explicit approval. See `library/SAFETY.md`.

## Development

```bash
pnpm install
pnpm test
```

## Reporting issues

If an external skill is missing or an install fails, open an issue at
https://github.com/devenius/junamis-agents-skills/issues with these details:
version, Node version, agent, installer, failing skill, and the command output.

## License

MIT. The external skills keep their own licenses, listed in `skills-lock.json`.
