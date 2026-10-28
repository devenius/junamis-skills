<!-- Managed by agent: agent-rules | Last updated: 2026-10-27 -->
# AGENTS.md: junamis-skills

## What this repo is

`junamis-skills` is a public npm package. It installs Agent Skills (folders containing `SKILL.md`) into the global skill directories of AI coding agents.

The package ships the installer and a manifest. It does not ship third-party skill content.

## Ownership: skills are external

- Every skill in `skills-lock.json` is external. Each entry names its upstream `source` and `skillPath`.
- Do not copy external skill content into anything the package publishes.
- Do not edit upstream skill content in place. Change it upstream, or keep a clearly named local override.
- Every manifest entry must record its `license`. If the license is not verified, set `"license": "unknown"` and block publishing until it is verified.
- Nested clones in this repo are not part of the package and must never be added to `files`: `skills/` (JavaScript-Mastery-Pro/skills, MIT) and `nestjs-agent-skills/` (MIT).
- Keep `skills-lock.json` as the single source of truth for what gets installed.

## Our library: `library/`

`library/` holds the skills and agents this project writes and owns. It is published with the package.

- `library/skills/<name>/SKILL.md`: one skill per folder. Each skill ends with the HANDOFF block defined in `library/HANDOFF.md`.
- `library/agents/<name>.md`: one agent per file. Each lists the library skills it owns in `skills:`. Every library skill has exactly one owner.
- `orchestrator` is the only entry point. It routes requests, dispatches one step at a time, and stops on `needs-decision`, `blocked`, or `failed`.
- External skills (`debug`, `architect`, `develop`, `test`, `check`) are referenced by name and come from the upstream manifest. Do not copy them into `library/`.
- `library/` is validated by `pnpm test`. Adding a skill or agent means updating the owner list and passing that test.

The old agent layer (`.agents/`, `.opencode/`) was removed from the repo. It is not part of the package, and no file here depends on it.

## Entry point for agents

- Every request from a user goes to the `orchestrator` agent first. Do not dispatch a skill or specialist directly.
- The orchestrator reads the available skills (library and installed external) and uses their descriptions to choose the next step. Keep skill descriptions accurate, because routing depends on them.

## Install design

- **Global by default.** Skills are installed into the agent's global skills directory so they can be shared across projects. An install is a snapshot. Editing this repo does not change installed skills until the user reinstalls.
- Skill installation is performed by an external installer (`skillsio` or the `skills` CLI), not by this package. This package ships the manifest (`skills-lock.json`) and the guide writer.
- Install methods the user may use:
  - `skills` CLI: `npx skills add <repo>` or `pnpm dlx skills add <repo>`
  - `skillsio`: `npx skillsio` or `pnpm dlx skillsio`
  The guide is written only by `junamis-skills init`. No install hook runs it: npm 11 and pnpm block dependency install scripts by default, so a postinstall hook is unreliable. Skill installers never run it.
- **Guide.** `junamis-skills init` writes `junamis-skills-guide.md` at the project root once, and records `.junamis/install.json`. Run it in each project that needs the guide. The guide is a project file, not a skill, so skill installers never touch it. It is never overwritten unless `--force` is given.
- **External skills.** `junamis-skills init --with-external` (or `junamis-skills install-external`) installs every skill in `skills-lock.json` using skillsio. It prints skillsio's security scan alerts. It never skips the scan.
- Skills install as a set from the manifest. Never install one skill in isolation, because skills reference each other.

## Supported agents (targets)

Goal: support **all AI coding agents and models** that read the Agent Skills standard (`SKILL.md`). Supporting one only means teaching the installer where that agent reads skills from.

Current targets: **claude** (skillsio name: `claude-code`), **opencode** (skillsio name: `opencode`). Others are added on request, one target file each.

Target-specific logic lives only in `src/targets/`.

To add a new agent or model:

1. Create `src/targets/<id>.js` exporting `{ id, label, globalSkillsDir(), detect() }`.
2. Register it in `src/targets/index.js`.
3. Add a test in `test/targets.test.js` covering the directory it resolves to.
4. Add a row to the target table in `README.md`.
5. Add it to the "Current targets" list above.

Do not hardcode agent names anywhere outside `src/targets/`.

## Working rules

- Node 20 or newer. ESM only (`"type": "module"`).
- Run `pnpm test` before reporting a change as done.
- Do not add dependencies without asking.
- Do not run `npm publish` or `pnpm publish` without an explicit request.
- Do not run `git commit`, `git push`, or `git tag` without an explicit request. Stage changes only when asked.

## Precedence

When multiple AGENTS.md files apply to the same file, the closest AGENTS.md wins.

## Index of scoped AGENTS.md

No scoped AGENTS.md files yet.
