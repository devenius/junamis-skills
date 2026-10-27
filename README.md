# junamis-skills

Install and manage Agent Skills (folders containing `SKILL.md`) into the global skill directories of AI coding agents.

## Install

```bash
npx skills add junamis-skills
# or
npx skillsio add junamis-skills --agent opencode
```

The `--agent` value is the name the installer knows. For skillsio and the `skills` CLI that is `opencode` and `claude-code` (not `claude`). The installer copies the same `SKILL.md` files either way.

Then, in the project that needs the guide:

```bash
npx junamis-skills init
```

## Supported agents

| Agent | skillsio name | Skills directory |
|---|---|---|
| opencode | `opencode` | `~/.agents/skills` |
| claude | `claude-code` | `~/.claude/skills` |

Other agents are added on request, one target file each under `src/targets/`.

## License

MIT
