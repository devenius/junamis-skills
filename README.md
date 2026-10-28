# junamis-skills

An orchestrated set of Agent Skills and agents for AI coding tools. The package ships:

- **The library** (`library/`): the orchestrator, six specialist agents, and the skills they use.
- **The manifest** (`skills-lock.json`): the external skills the library refers to, pinned by source and license.
- **An installer** (`junamis-skills`): installs the library and the external skills, and writes a setup guide into your project.

## Quick start

Run these in the project that will use the skills. Use `--dry-run` first to see what will change.

```bash
# 1. Write the setup guide into the project (once).
npx junamis-skills@latest init

# 2. Install the library: skills, agents, and shared docs.
npx junamis-skills@latest install-library --agent opencode --dry-run
npx junamis-skills@latest install-library --agent opencode

# 3. Install the external skills. skillsio shows its security scan.
npx junamis-skills@latest install-external --agent opencode
```

Then open the project in your agent and send your first request to `orchestrator`.

## Commands

| Command | What it does |
|---|---|
| `init [--force] [--with-external]` | Writes `junamis-skills-guide.md` at the project root, once. `--with-external` also runs `install-external`. |
| `install-library --agent <a> [--dry-run] [--force]` | Copies library skills, agent definitions, and shared docs to the agent's directories. Never overwrites a file you edited unless `--force`. |
| `install-external --agent <a> [--installer skillsio\|skills]` | Installs every skill in `skills-lock.json` globally. The security scan is never skipped. |
| `status` | Shows the guide, the installed library version, and detected agents. |

## Supported agents

| Agent (`--agent`) | Skills directory | Agent definitions | Installer name |
|---|---|---|---|
| `opencode` | `~/.agents/skills` | `~/.config/opencode/agents` | `opencode` |
| `claude` | `~/.claude/skills` | `~/.claude/agents` | `claude-code` |

Other agents are added on request, one target file each under `src/targets/`.

## Where things go

- Skills: `<skills directory>/<name>/SKILL.md`
- Agents: `<agent directory>/<name>.md`
- Shared rules the agents read: `~/.junamis/library/` (`HANDOFF.md`, `SAFETY.md`, `EXTERNAL.md`)
- Install record: `~/.junamis/installed/library-<agent>.json`

## Safety

- The installer never runs a command through a shell. Every value is checked against a strict pattern before use.
- The security scan of external skills is never skipped. Critical findings still ask you to confirm.
- Destructive or external actions in the library need your explicit approval. See `library/SAFETY.md`.

## Development

```bash
pnpm install
pnpm test
```

## License

MIT. The external skills keep their own licenses, listed in `skills-lock.json`.
