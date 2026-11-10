# junamis-skills

An orchestrated set of Agent Skills and agents for AI coding tools. The package ships:

- **The library** (`library/`): the orchestrator, eight specialist agents, and the skills they use.
- **The manifest** (`skills-lock.json`): external skill sources, immutable commits, per-skill tree SHAs, and licenses.
- **A scan record** (`SECURITY.md`): per-skill kind, source, license, scan status, and last scan month.
- **An installer** (`junamis-skills`): one `init` command installs the library and every external skill, and writes a setup guide into your project.

## Quick start

Run these in the project that will use the skills. Use `--dry-run` first to see what will change. Requires Node.js 26+; external installs also require Git.

### Option A: Run directly from GitHub (no setup)

```bash
# 1. Preview the whole install, then apply it.
npx github:devenius/junamis-skills init --dry-run
npx github:devenius/junamis-skills init

# For Claude Code instead of OpenCode:
npx github:devenius/junamis-skills init --agent claude

# Install into the project instead of globally:
npx github:devenius/junamis-skills init --scope project

# 2. Check state.
npx github:devenius/junamis-skills status
```

`init` writes the setup guide, writes `opencode.json` when it is missing (OpenCode only), installs the library, and installs every pinned external skill. Use `--force` to overwrite a guide, config, or library file you edited.

### Option B: Install from GitHub Packages (faster after first setup)

Configure `~/.npmrc` once (see [Installing from GitHub Packages](#installing-from-github-packages)), then use the normal npx form:

```bash
npx @devenius/junamis-skills init --dry-run
npx @devenius/junamis-skills init
npx @devenius/junamis-skills status
```

Then open the project in your agent and send your first request to `orchestrator`.

## Commands

The CLI has two working commands and `help`.

| Command | What it does |
|---|---|
| `init [--agent opencode\|claude] [--scope global\|project] [--dir <path>] [--force] [--dry-run]` | In order: writes `junamis-skills-guide.md` and its marker; writes/refreshes `opencode.json` for OpenCode (only when missing, or with `--force`); installs the library; installs every pinned external skill non-interactively. Exits 1 only when an external install fails. |
| `status [--dir <path>] [--scope global\|project\|all]` | Reports the guide, marker, per-target internal/external skill counts, canonical agents and link state, legacy leftovers (informational), library manifest validity, `opencode.json` validity, external skill coverage, and the `SECURITY.md` scan record. Exits 1 only when a detected target's manifest or config is invalid, or project JSON is malformed. Default scope: `global` (matching `init`). |
| `help` | Prints usage. |

## Supported agents

| Agent (`--agent`) | External skills directory | Internal (library) skills directory | Agent definitions (canonical → link) | External install support |
|---|---|---|---|---|
| `opencode` | `~/.agents/skills` | `~/.config/junamis/skills/skills` | `~/.config/junamis/skills/agents` → `~/.config/opencode/agents` | `skillsio` |
| `claude` | `~/.claude/skills` | `~/.claude/skills` | `~/.config/junamis/skills/agents` → `~/.claude/agents` | `skillsio` |
| `cursor` | `~/.cursor/skills` | `~/.cursor/skills` | `~/.config/junamis/skills/agents` → `~/.cursor/agents` | Library only |
| `windsurf` | `~/.codeium/windsurf/skills` | `~/.codeium/windsurf/skills` | `~/.config/junamis/skills/agents` → `~/.config/devin/agents` | Library only |
| `cline` | `~/.cline/skills` | `~/.cline/skills` | `~/.config/junamis/skills/agents` → `~/.cline/agents` | Library only |

Agent definitions are written once to the canonical directory and symlinked into the target's agents directory. If a link cannot be created (for example Windows without developer mode), the file is copied instead and a warning is printed.

For OpenCode, the shipped `opencode.json` registers both skill roots, so internal and external skills resolve side by side. Other targets keep a single skills directory shared by both kinds.

The shipped `opencode.json` uses OpenCode V2 keys. It enables the built-in file tools and local skills, keeps shell and network fetches behind `ask`, denies secret paths and `external_directory`, hard-denies destructive shell verbs, and ships no MCP servers or third-party plugins. Add MCP servers or plugins only after a reviewed decision.

Library installation supports all five targets. Scanned external installation (`init`) currently accepts only OpenCode and Claude Code.
The Windsurf target keeps project skills in the legacy `.windsurf/skills` directory and installs subagents using Devin's current `.devin/agents` format and locations.

Other agents are added on request, one target file each under `src/targets/`.

## Where things go

- External skills: `<external skills directory>/<name>/SKILL.md`
- Internal (library) skills: `<internal skills directory>/<name>/SKILL.md`
- Canonical agents: `~/.config/junamis/skills/agents/<name>.md`
- Agent links: `<target agents directory>/<name>.md` → the canonical file
- Shared rules the agents read: `~/.config/junamis/skills/` (`HANDOFF.md`, `SAFETY.md`, `EXTERNAL.md`, `SECURITY.md`, `RESUME.md`)
- Installed manifest for the state engine: `~/.config/junamis/skills/skills-lock.json`
- Install record: `~/.config/junamis/skills/installed/library-<agent>.json`
- Project scope: `<project>/.config/junamis/skills/{skills,agents,*.md,installed}` mirrors the internal side. External skills stay at the target's project skills directory, and project agent links stay at its project agents directory.
- Session state and the guide marker stay in `.junamis/` (`handoff.md`, `junamis-skills.json`).

For OpenCode the split is: internal skills in `~/.config/junamis/skills/skills`, canonical agents in `~/.config/junamis/skills/agents`, shared docs in `~/.config/junamis/skills/*.md`, the install manifest in `~/.config/junamis/skills/installed/library-opencode.json`, links in `~/.config/opencode/agents`, and external skills in `~/.agents/skills`. Other targets keep one skills directory for both kinds.

`init` writes only the nested layout. There is no automatic migration: older flat files under `~/.config/junamis/` and flat skill folders directly under `~/.config/junamis/skills/` are reported by `status` as legacy leftovers and are never deleted. Move or remove them yourself once the new install is verified.

## Persistence and resume

The orchestrator is resumable. Every session starts by rehydrating execution state from disk, before `route` or any skill dispatch:

```bash
junamis-orchestrator boot --project <cwd> --session <new id>
```

The `junamis-orchestrator` bin also exposes `plan set`, `plan show`, `start`, `end`, `resolve`, `status`, `checkpoint`, `lease acquire|heartbeat|release|status`, and `finish`.

- **State root.** The default is `<project>/.orchestrator/` (gitignored). It holds `journal.ndjson` (the source of truth), `state.json`, `plan.json`, `tasks/<task_id>/`, `checkpoints/`, `locks/`, `resume-report.md`, and the generated `STATE.md` view. `ORCH_STATE_ROOT` overrides the location. The root must be persistent and host-local, never inside the operating system temp directory.
- **Report first.** `boot` writes `resume-report.md`. Read it in full. Its status is `NEW_RUN`, `RESUMING`, `COMPLETE`, `BLOCKED_DRIFT`, or `HALT_CORRUPT`. Exit codes are `0` success, `1` usage or I/O, `2` lease held or lost, `3` drift, `4` corrupt state, and `5` invalid transition or handoff. On a non-zero exit, stop and report the halt line and report path; dispatch nothing.
- **Single writer.** A lease under `locks/` prevents two sessions from writing one state root. A stale lease is taken over; a live lease halts the second session.
- **Drift gate.** `skills-lock.json` and the library override map are fingerprinted at plan time. A manifest or `library/` change makes boot report `BLOCKED_DRIFT` and refuse to dispatch.
- **Idempotent or escalate.** Every library skill declares `idempotent: true | false` in its frontmatter. An interrupted `true` step is retried; an interrupted `false` step becomes `needs_review` and waits for a user decision. An external skill records the value in its adapter and defaults to `false` when upstream does not declare one.
- **Contract.** `RESUME.md` is installed with `HANDOFF.md`, `SAFETY.md`, `EXTERNAL.md`, and `SECURITY.md` at the config root and is the normative persistence contract.

The state engine lives under `src/orchestrator/`, uses only Node 26 built-in modules, and adds no runtime dependency.

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

Each lock entry pins an upstream commit and skill tree SHA. Maintainers should follow the [external skill review and pinning procedure](docs/external-skills-maintenance.md) when changing this manifest.

## Security record (`SECURITY.md`)

[`SECURITY.md`](SECURITY.md) is the recorded vetting record for every skill the package installs. It lists each internal skill and each locked external skill with its source, license, scan status (`first-party`, `pass`, or `flagged`), and the month it was last reviewed. Install-time scanning is skipped by design (`--skip-scan`); `SECURITY.md` plus `library/SAFETY.md` is the vetting record. `Last external scan` records when the pinned `skillsio 1.1.3` scan (Trust Hub, Socket, Snyk) was last recorded. `scripts/check-security.mjs` fails CI when a skill is added and not recorded, or when that line is missing. `pnpm run check:pins` re-fetches every locked source and confirms its tree SHA.

## Installing from GitHub Packages

This package is published to GitHub Packages as `@devenius/junamis-skills`.

1. Create or edit `~/.npmrc` (or project `.npmrc`):

```ini
@devenius:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

2. Install or run:

```bash
npm install -g @devenius/junamis-skills
# or run without installing:
npx github:devenius/junamis-skills init
```

A GitHub personal access token with `read:packages` (and `write:packages` for publishing) is required.

## Safety

- The installer never runs a command through a shell. Every value is checked against a strict pattern before use.
- The scanner is pinned to `skillsio@1.1.3` with a verified registry, tarball URL, and SHA-512 integrity. Each locked commit, tree SHA, and checkout HEAD is verified before it runs.
- A skill folder must be a Git tree. An in-tree symlink such as `CLAUDE.md -> AGENTS.md` is allowed; an absolute or escaping symlink is rejected, as is a gitlink.
- `init` passes `-y` and `--skip-scan` so it can install every skill non-interactively. `-y` cannot bypass the scanner's high/critical prompt, so install-time scanning is skipped by design; the recorded scan is the gate. After each group it verifies that every expected `<name>/SKILL.md` exists and counts only verified installs.
- Flagged findings are vetted in `SECURITY.md` and gated in `library/SAFETY.md`.
- Destructive or external actions in the library need your explicit approval. See `library/SAFETY.md`.

## Development

The runtime code is TypeScript under `src/`. The built package ships `dist/` and its declarations; `src/` is not part of the published package.

```bash
pnpm install    # dev dependencies only; there is no runtime dependency
pnpm build      # tsc -> dist/ (JavaScript, declarations, source maps)
pnpm typecheck  # source check, then the compiled consumer contract
pnpm test       # build, typecheck, then the full Node test suite
```

Consumers import the package root (`@devenius/junamis-skills`) or the `./types` subpath; both resolve to `dist/`. `dist/` is generated and gitignored, so contributors never commit it. See [`docs/typescript.md`](docs/typescript.md) for the build outputs, strict compiler settings, and the `unknown`-at-the-boundary rules.

## Reporting issues

If an external skill is missing or an install fails, open an issue at
https://github.com/devenius/junamis-skills/issues with these details:
version, Node version, agent, installer, failing skill, and the command output.

## License

MIT. The external skills keep their own licenses, listed in `skills-lock.json`.
