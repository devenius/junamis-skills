<!-- Managed by agent: agent-rules | Last updated: 2026-10-27 -->
# AGENTS.md: junamis-agents-skills

## What this repo is

`junamis-agents-skills` is a public package. It installs Agent Skills (folders containing `SKILL.md`) into the global skill directories of AI coding agents.

The package ships the installer and a manifest. It does not ship third-party skill content.

## Ownership: skills are external

- Every skill in `skills-lock.json` is external. Each entry names its upstream `source` and `skillPath`.
- Do not copy external skill content into anything the package publishes.
- Do not edit upstream skill content in place. Change it upstream, or keep a clearly named local override.
- Every manifest entry must record its `license`. If the license is not verified, set `"license": "unknown"` and block publishing until it is verified.
- Every manifest entry must pin a 40-character upstream commit in `ref` and a 40-character Git tree SHA for its skill directory in `treeSha`.
- Nested clones in this repo are not part of the package and must never be added to `files`: `skills/` (JavaScript-Mastery-Pro/skills, MIT) and `nestjs-agent-skills/` (MIT).
- Keep `skills-lock.json` as the single source of truth for what gets installed.
- Follow `docs/external-skills-maintenance.md` when reviewing or updating upstream skill pins.

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
- **Layout split.** For OpenCode, internal (library) skills install to `~/.config/junamis/skills`, shared docs to `~/.config/junamis/`, and the install manifest to `~/.config/junamis/installed/library-<agent>.json`. External skills stay in the target's external skills directory (`~/.agents/skills` for OpenCode). Other targets keep one skills directory for both. Project scope mirrors the internal side under `<project>/.config/junamis/`; external skills and project agents stay at the target's project paths.
- External skills are installed by this package: it fetches the locked commit with the system `git` CLI, verifies each skill tree SHA (an in-tree symlink is allowed; an absolute or escaping symlink is rejected), then passes the local checkout to the pinned `skillsio` scanner with `--skip-scan`.
- Never fall back to a branch head, direct raw-file download, or unscanned installer. Existing skill directories are skipped, not overwritten and not counted as failures.
- Package-managed external installs support only OpenCode and Claude Code. Other targets can receive the owned library, but do not claim scanned external-install support until verified.
  The guide is written only by `npx junamis-agents-skills init`. No install hook runs it: npm 11 and pnpm block dependency install scripts by default, so a postinstall hook is unreliable. Skill installers never run it.
- **Guide.** `npx junamis-agents-skills init` writes `junamis-agents-skills-guide.md` at the project root once, and records `.junamis/install.json`. Run it in each project that needs the guide. The guide is a project file, not a skill, so skill installers never touch it. It is never overwritten unless `--force` is given.
- **Config.** `init` writes `opencode.json` for the OpenCode target only when it is missing, or with `--force`. It never prompts. If the file exists and differs, it is left unchanged and the output says to use `--force`.
- **External skills.** `init` installs every locked skill automatically through `skillsio@1.1.3` with `-y` and `--skip-scan`. `-y` only skips the overwrite prompt; it does not bypass the scanner's high/critical "Install anyway?" prompt, so install-time scanning is skipped by design and the recorded scan is the gate. After each successful group, `init` verifies that every expected `<name>/SKILL.md` exists under the target's global skills directory. Only verified skills count as installed; an already-present skill counts as skipped; a skill missing after a successful run counts as failed and is logged by name. `init` exits 1 when any install failed.
- **Scan record.** `SECURITY.md` at the repo root is the recorded vetting record for every internal and external skill (kind, source, license, scan status, last scan month). Install-time scanning is skipped by design (`--skip-scan`), so `SECURITY.md` plus `library/SAFETY.md` is the gate. `pnpm run check:pins` re-fetches every locked source/ref and compares the actual tree SHA with the lock; it is a network check and is not wired into CI or release. `check:security` fails CI when a skill is missing from `SECURITY.md` or the `Last external scan` line is absent.
- **CLI surface.** Only `init`, `status`, and `help` remain. `status` reports guide, marker, per-target counts, manifest and config validity, external coverage, and the scan record, and exits 1 when a required piece is missing.
- Skills install as a set from the manifest. Never install one skill in isolation, because skills reference each other.

## Supported agents (targets)

Goal: support **all AI coding agents and models** that read the Agent Skills standard (`SKILL.md`). Supporting one only means teaching the installer where that agent reads skills from.

Current targets: **claude** (skillsio name: `claude-code`), **opencode** (skillsio name: `opencode`), **cursor**, **windsurf** (legacy skill path with current Devin subagent paths), **cline**. Others are added on request, one target file each.

Target-specific logic lives only in `src/targets/`.

To add a new agent or model:

1. Create `src/targets/<id>.js` exporting `{ id, label, globalSkillsDir(), libraryAgentsDir(), projectSkillsDir(projectDir), projectAgentsDir(projectDir), libraryAgentFormat, detect() }`.
2. Register it in `src/targets/index.js`.
3. Add a test in `test/targets.test.js` covering the directory it resolves to.
4. Add a row to the target table in `README.md`.
5. Add it to the "Current targets" list above.

Do not hardcode agent names anywhere outside `src/targets/`.

## Working rules

- Node 26 or newer. ESM only (`"type": "module"`). External installs also require the system `git` CLI.
- Run `pnpm test` before reporting a change as done.
- When adding or changing work, use the current library skills in `library/skills/` (route, handoff, skill-author, etc.) and keep them in sync with tests.
- Strict: update `CHANGELOG.md` before every commit. Do not commit with a stale changelog.
- Release notes come from the matching `## [x.y.z]` section of `CHANGELOG.md`. Do not maintain or paste a separate `RELEASE_NOTES.md`; ensure that section is sufficiently detailed before tagging.
- Before tagging a release, ask the user which version bump to use (patch/minor/major) and propose a clear tag name (for example `v1.0.1`) with a short release title so others can understand the change.
- When a commit is a versioning release (i.e. it bumps the package version and updates the changelog for release), the commit must also be tagged with the release tag (for example `git tag v1.0.1`) in the same step. A release commit without its tag is incomplete.
- Do not add dependencies without asking.
- Do not run `npm publish` or `pnpm publish` without an explicit request.
- Do not run `git commit`, `git push`, or `git tag` without an explicit request. Stage changes only when asked. Tagging a release commit still requires the user's explicit request to commit/push/tag.

## Precedence

When multiple AGENTS.md files apply to the same file, the closest AGENTS.md wins.

## Index of scoped AGENTS.md

No scoped AGENTS.md files yet.
