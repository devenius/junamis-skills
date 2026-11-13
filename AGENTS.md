<!-- Managed by agent: agent-rules | Last updated: 2026-10-27 -->
# AGENTS.md: junamis-skills

## What this repo is

`junamis-skills` is a public package. It installs Agent Skills (folders containing `SKILL.md`) into the global skill directories of AI coding agents.

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

## Design registry

- The registry is per project: `<cwd>/docs/design/`. It is never the package's own registry.
- When `<cwd>/docs/design/INDEX.md` or `_registry.json` is missing, tell the user what bootstrap will do: scan the project's apps and packages, create draft surfaces under `docs/design/`, copy the schema, create `_registry.json`, make no code changes, and never promote a draft. Ask once and wait.
- On approval run `junamis-design-registry bootstrap --project <cwd>`. On refusal continue with `design_context: none` and record the missing registry as a gap or finding.
- A monorepo gets explicit per-app and per-package folders: `docs/design/<kind>/<app>/overview.md`. A single project gets `docs/design/<kind>/overview.md`.
- Bootstrap creates drafts only. Never promote a draft to active automatically.
- Before dispatching a skill, run `junamis-design-registry load --project <cwd> --code-path <path or glob> --json` and pass the matching surfaces and checksums as `design_context`.
- Do not scan the whole registry when a code-path lookup is enough.

## Orchestrator state

Every orchestrator session rehydrates execution state from disk before `route` or any skill dispatch.

- **Boot before route.** Run `junamis-orchestrator boot --project <cwd> --session <new id>` and read `<state-root>/resume-report.md` in full. Stop and dispatch nothing when boot exits `2` (`lease_held`), `3` (`BLOCKED_DRIFT`), or `4` (`HALT_CORRUPT`), or when the report's next action says stop, needs review, or a user decision.
- **State root.** The default is `<project>/.orchestrator/`, gitignored. `journal.ndjson` is the source of truth; `state.json`, `plan.json`, and `tasks/<task_id>/task.json` are derived. `ORCH_STATE_ROOT` overrides the location. The root is host-local and must never be inside the operating system temp directory.
- **Contract.** `library/RESUME.md` is normative. `library/HANDOFF.md` defines the step output block, and `library/SAFETY.md` still gates every command a dispatched skill runs. `docs/RECONCILE.md` is the work-queue contract and is installed as a shared doc next to `RESUME.md`.
- **Idempotent rule.** Every library skill declares `idempotent: true | false` in its frontmatter. The engine retries an interrupted `true` task and escalates an interrupted `false` task to `needs_review`. External skills record the value in their adapter and default to `false`.
- **Engine paths.** `src/orchestrator/` holds the state engine. `scripts/orchestrator-state.mjs` is the thin launcher over `dist/orchestrator/cli.js`, and `package.json` exposes it as the `junamis-orchestrator` bin. The installer CLI keeps `init`, `status`, and `help`; the state engine is a separate bin.
- **No new dependency.** The engine uses only Node 26 built-in modules. Do not add a runtime dependency. `js-yaml` stays a dev dependency for `scripts/check-yaml.js` only.
- **Tests.** `test/orchestrator-t1-crash.test.js` through `test/orchestrator-t7-torn-write.test.js` prove crash recovery, replay, drift, lease safety, escalation, and torn-write recovery. Crash injection uses `ORCH_TEST_MODE=1` and `ORCH_TEST_CRASH_AT`; temporary state roots use `ORCH_TEST_ALLOW_TMP=1`.

## TypeScript build and types

- All runtime code is TypeScript under `src/**/*.ts` and is the source of truth. `src/types/` is the single type contract, exported from `src/types/index.ts` and the package entry `src/index.ts`.
- `dist/` is generated by `pnpm build` (`tsconfig.build.json`) and is never committed. The package ships `dist/` only: `files` lists `dist` and the launchers, never `src`. `pnpm typecheck` checks the source (`tsconfig.json`) and the consumer contract (`tsconfig.types.json` plus `test/types/consumer.ts`). `pnpm test` runs build, typecheck, and the Node test suite in that order.
- The strict settings in `tsconfig.json` are fixed: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, `isolatedModules`, `verbatimModuleSyntax`, `module`/`moduleResolution` `NodeNext`, `target`/`lib` `ES2024`, `types: ["node"]`. Do not relax one to make code compile.
- Use `interface` for object shapes, `type` for unions and aliases, and `readonly` for snapshot fields. No `any`. External input is `unknown` until a guard in `src/types/guards.ts` or a module validator proves the shape.
- ESLint ignores `dist/**`, `src/**/*.ts`, and `test/types/**`. TypeScript is gated by `tsc`, not ESLint. `eslint .` must still parse the JavaScript that ships.
- `bin/junamis-skills.js` and the `.mjs` launchers in `scripts/` are thin: they import their implementation from `dist/` and hold no logic. The dev checks run from `dist/scripts/*.js`, so `pnpm build` must run before any check or `pnpm test`; CI does this first.
- The area branches (`ts-core`, `ts-runtime`, `ts-scripts`) are merged into the integration branch with merge commits. Do not squash or rebase; every conversion commit is preserved.
- TypeScript stays a dev dependency. No runtime dependency is added. `typescript`, `@types/node`, and `@types/js-yaml` are dev dependencies.

## Install design

- **Global by default.** Skills are installed into the agent's global skills directory so they can be shared across projects. An install is a snapshot. Editing this repo does not change installed skills until the user reinstalls.
- **Layout split.** The config root is `~/.config/junamis/skills/` (project segment `skills`). Internal (library) skills install to `~/.config/junamis/skills/skills/<name>/SKILL.md`, canonical agents to `~/.config/junamis/skills/agents/<name>.md`, shared docs to `~/.config/junamis/skills/*.md`, and the install manifest to `~/.config/junamis/skills/installed/library-<agent>.json`. Agent definitions are symlinked from the target agents directory (`~/.config/opencode/agents` for OpenCode) to the canonical file; if a link cannot be created, the file is copied with a warning. External skills stay in the target's external skills directory (`~/.agents/skills` for OpenCode). Other targets keep one skills directory for both kinds. Project scope mirrors the config root under `<project>/.config/junamis/skills/{skills,agents,*.md,installed}`; external skills and project agent links stay at the target's project paths.
- External skills are installed by this package: it fetches the locked commit with the system `git` CLI, verifies each skill tree SHA (an in-tree symlink is allowed; an absolute or escaping symlink is rejected), then passes the local checkout to the pinned `skillsio` scanner with `--skip-scan`.
- Never fall back to a branch head, direct raw-file download, or unscanned installer. Existing skill directories are skipped, not overwritten and not counted as failures.
- Package-managed external installs support only OpenCode and Claude Code. Other targets can receive the owned library, but do not claim scanned external-install support until verified.
  The guide is written only by `npx junamis-skills init`. No install hook runs it: npm 11 and pnpm block dependency install scripts by default, so a postinstall hook is unreliable. Skill installers never run it.
- **Guide.** `npx junamis-skills init` writes `junamis-skills-guide.md` at the project root once, and records `.junamis/junamis-skills.json`. Run it in each project that needs the guide. The guide is a project file, not a skill, so skill installers never touch it. It is never overwritten unless `--force` is given.
- **Config.** `init` writes `opencode.json` for the OpenCode target only when it is missing, or with `--force`. It never prompts. If the file exists and differs, it is left unchanged and the output says to use `--force`.
- **External skills.** `init` installs every locked skill automatically through `skillsio@1.1.3` with `-y` and `--skip-scan`. `-y` only skips the overwrite prompt; it does not bypass the scanner's high/critical "Install anyway?" prompt, so install-time scanning is skipped by design and the recorded scan is the gate. After each successful group, `init` verifies that every expected `<name>/SKILL.md` exists under the target's global skills directory. Only verified skills count as installed; an already-present skill counts as skipped; a skill missing after a successful run counts as failed and is logged by name. `init` exits 1 when any install failed.
- **Scan record.** `SECURITY.md` at the repo root is the recorded vetting record for every internal and external skill (kind, source, license, scan status, last scan month). Install-time scanning is skipped by design (`--skip-scan`), so `SECURITY.md` plus `library/SAFETY.md` is the gate. `pnpm run check:pins` re-fetches every locked source/ref and compares the actual tree SHA with the lock; it is a network check and is not wired into CI or release. `check:security` fails CI when a skill is missing from `SECURITY.md` or the `Last external scan` line is absent.
- **CLI surface.** Only `init`, `status`, and `help` remain. `status` reports guide, marker, per-target counts, canonical agents and their link state, legacy leftovers, manifest and config validity, external coverage, and the scan record, and exits 1 when a required piece is missing. Legacy leftovers are informational and are never deleted.
- **No migration.** `init` writes only the nested layout. Older flat files under `~/.config/junamis/` and flat skill folders directly under `~/.config/junamis/skills/` are left in place; `status` reports them as legacy.
- Skills install as a set from the manifest. Never install one skill in isolation, because skills reference each other.

## Supported agents (targets)

Goal: support **all AI coding agents and models** that read the Agent Skills standard (`SKILL.md`). Supporting one only means teaching the installer where that agent reads skills from.

Current targets: **claude** (skillsio name: `claude-code`), **opencode** (skillsio name: `opencode`), **cursor**, **windsurf** (legacy skill path with current Devin subagent paths), **cline**. Others are added on request, one target file each.

Target-specific logic lives only in `src/targets/`.

To add a new agent or model:

1. Create `src/targets/<id>.ts` exporting `{ id, label, globalSkillsDir(), librarySkillsDir(), libraryAgentsCanonicalDir(), libraryAgentsDir(), projectSkillsDir(projectDir), projectLibrarySkillsDir(projectDir), projectLibraryAgentsCanonicalDir(projectDir), projectAgentsDir(projectDir), libraryAgentFormat, detect() }`.
2. Register it in `src/targets/index.ts`.
3. Add a test in `test/targets.test.js` covering the directory it resolves to.
4. Add a row to the target table in `README.md`.
5. Add it to the "Current targets" list above.

Do not hardcode agent names anywhere outside `src/targets/`.

## Branch, worktrees, and pull requests

`main` is protected and read-only. It is the published history, not a working tree.

### Branch per prompt

- At the start of every prompt the orchestrator runs `git branch --show-current` in the project checkout. This comes before Environment setup, `boot`, `route`, or any dispatch.
- On `main` or a detached HEAD (the command prints `main`, or prints nothing), it runs `git fetch origin`, then `git switch -c task/<task-slug> origin/main`. When the project has no remote, it runs `git switch -c task/<task-slug> main` instead. It tells the user the branch and continues. Never work on `main` and never commit there.
- On a task branch it continues on that branch. It does not create a second branch for the same prompt and does not switch branches mid-prompt.
- On another task's or a sub-agent's branch it stops and asks the user which branch to use.
- The orchestrator works in the project checkout on `task/<task-slug>` and commits there. The state root (`<project>/.orchestrator/`) and the design registry (`<project>/docs/design/`) live in that checkout.
- Read-only work (questions, reviews, lookups) may run in the main checkout.

### Delegation worktrees

Every delegated task runs in its own worktree inside the project: `<project>/.worktrees/<task-slug>-<subtask>` on branch `task/<task-slug>-<subtask>`, cut from the task branch.

```bash
git worktree add .worktrees/<task-slug>-<subtask> -b task/<task-slug>-<subtask> task/<task-slug>
```

- The brief names the worktree's absolute path, the branch, and an explicit allowed-file list. The sub-agent edits only those files and reads only what the brief allows. If it needs another file, it asks the orchestrator; it never checks out or edits outside its allocation.
- The Delegation plan records one owner per file, so two active tasks never edit the same file.
- Specialists work only in the worktree path the orchestrator gives them. They do not ask whether to use a worktree, do not leave it, and never touch `main`.
- **Limit: 8 worktrees.** Before creating a new one, count the `git worktree list` entries under `<project-root>/.worktrees/`. At 8 or more, prune only a worktree whose branch is merged into the task branch and whose tracked and untracked working tree is clean (`git status --porcelain` empty). Use `git worktree remove <path>`; never `rm -rf`. If no merged and clean worktree can be pruned, stop and ask the user which one to remove. Never remove an unmerged or dirty worktree.

### Merge back

When a sub-agent finishes:

1. `git -C <worktree> status --porcelain` is empty, or the sub-agent committed its allocated files on its sub-branch.
2. `git diff --name-only task/<task-slug>...task/<task-slug>-<subtask>` is a subset of the allowed files. A diff outside the allocation is a finding; do not merge.
3. Run the task checks in the worktree.
4. On the task branch, merge with `git merge --no-ff task/<task-slug>-<subtask>`.
5. On conflict, run `git merge --abort`, stop, and ask the user. Never hand-edit a conflict and never force a merge.
6. Then `git worktree remove <worktree>` and `git branch -d task/<task-slug>-<subtask>`.

Sub-agents never create a pull request and never merge.

### Pull requests

- One pull request per approved batch. After every task is merged into `task/<task-slug>` and the full gate passes, the orchestrator summarizes the work and asks the user to approve opening the pull request.
- On approval: commit any remaining orchestrator changes on the task branch, `git push -u origin task/<task-slug>`, open one pull request with `gh pr create`, report the URL, and stop. The agent's authority ends at `gh pr create`.
- The orchestrator never merges, never uses `--admin`, never pushes `main`, never force-pushes, never tags, and never rebases or resets `main`. The user reviews and merges; the orchestrator never does. `gh pr merge`, `--admin`, and `main` pushes are denied in `opencode.json`.
- No self-merge. No bypass. No direct push to `main`, even for the repository owner. `git push origin main`, force pushes, and `--no-verify` commits stay denied.
- Destructive git actions (`reset --hard`, `clean`, `rebase`, force-push, tag deletion) need the user's explicit approval and run only inside the task worktree.
- The one exception is the first push of an empty repository: a one-time user action. The user supplies and approves the instructions for that push. Every later change is a pull request.
- CI runs on `main` and on every pull request. A pull request merges only after its checks pass and the user approves it.

### Approvals are single-use

Every approval covers exactly one command, in exactly one prompt, exactly once. It ends when that command finishes or fails.

- It does not cover a retry, a second command, a later step, another task, another pull request, or another session.
- A general "go ahead", "continue", "yes", or an approval of the plan is not approval for a gated command. Name the exact command and show what it changes and what cannot be undone.
- Never ask for or rely on a persistent or always-allow. Never reuse a previous approval, including one from an earlier merge, push, install, admin override, or destructive command. Ask again every time.
- Commands already allowed by `opencode.json` (read-only git, build, test, task-branch pushes, `gh pr create`, and `gh pr view|list|checks|edit`) are not gated. Everything in `SAFETY.md`, everything that touches `main`, and everything destructive is gated.
- After a gated command runs once, the approval is spent. If the user wants it again, the user must repeat permission in a new prompt.

## Publishing and deprecation

npmjs is the primary public registry for `@devenius/junamis-skills`; GitHub Packages is the mirror. The package name is already scoped (`@devenius/junamis-skills`), so no rename is needed. The CLI binary stays `junamis-skills`.

- **The agent never runs registry mutations.** `npm publish`, `npm stage publish`, `npm deprecate`, `npm unpublish`, `npm dist-tag`, `npm owner`, and `npm access` are user actions. They are gated by `library/SAFETY.md` and require a single-use approval that names the exact command. The agent may prepare the exact command and the release metadata and then stops at the user.
- **First publish history.** The package was bootstrapped with `npm stage publish` and a placeholder (`1.0.0-placeholder.0`, published under the `placeholder` tag) because a trusted publisher needs an existing package. `latest` remains the `0.0.0-stage` placeholder until the first usable release. The first usable release is `1.1.0`; do not plan a real npm `1.0.0`, because the GitHub tag/release `v1.0.0` already exists and is not an npm release.
- **CI.** One `publish.yml` workflow runs two jobs: a GitHub Packages job and an npmjs job. The npmjs job uses `id-token: write`, the `npm-publish` environment, and `npm stage publish`; a maintainer then approves the staged version on npmjs.com with 2FA. The GitHub Packages job uses `GITHUB_TOKEN` and `packages: write`.
- **Deprecation policy.** Preferred over unpublish.

  | Situation | Action |
  |---|---|
  | Normal release | Publish normally; move `latest` with the release. |
  | Bad release | Publish the fix first, then deprecate the narrowest affected range; move `latest` to the fix only as a stopgap. |
  | Abandoned or renamed package | Deprecate the whole package with a pointer to the successor; never unpublish. |
  | Accidental publish | Unpublish only inside npm's 72-hour / no-dependents window and only with the user's explicit approval; otherwise deprecate. |
  | Prerelease | Publish under `next`, `beta`, `rc`, or `placeholder`; never to `latest`. |
  | Leaked secret | Rotate the secret first; deprecation or unpublish does not un-leak it. |

- **Deprecation message.** It must name the reason, the fixed version or range, and the action the user should take. Example: `npm deprecate "@devenius/junamis-skills@<1.1.0" "Broken install; use >=1.1.0"`.
- **Dist-tag policy.** `latest` is the stable release. Prereleases use a non-`latest` tag (`next`, `beta`, `rc`, or `placeholder`). Never publish a prerelease to `latest`.
- **Detection.** A request that mentions publish, release, stage, deprecate, unpublish, dist-tag, or the npm registry is the `release` path. The orchestrator routes it to `release-prep` and the operator, which prepare the release and stop at the user-run registry command.
- **Secrets.** Never put a token in the repository, the README, or a committed `.npmrc`. The runbook is [`docs/publishing/npm.md`](docs/publishing/npm.md).

## Working rules

- Node 26 or newer. ESM only (`"type": "module"`). External installs also require the system `git` CLI.
- Run `pnpm test` before reporting a change as done. This includes `pnpm build`, `pnpm typecheck`, and the T1 to T7 resume tests.
- Never commit `dist/`, `node_modules/`, or worktree state.
- When adding or changing work, use the current library skills in `library/skills/` (route, handoff, skill-author, etc.) and keep them in sync with tests.
- Every library skill keeps a valid `idempotent: true | false` frontmatter value. `test/library.test.js` enforces it.
- Do not add a runtime dependency for the state engine, and do not edit `.orchestrator/` state files by hand; use the `junamis-orchestrator` commands.
- When changing the package, the resume contract, or the installer, also run `pnpm run check:security`, `pnpm run check:pack`, and `pnpm run check:yaml`.
- Strict: update `CHANGELOG.md` before every commit. Do not commit with a stale changelog.
- Release notes come from the matching `## [x.y.z]` section of `CHANGELOG.md`. Do not maintain or paste a separate `RELEASE_NOTES.md`; ensure that section is sufficiently detailed before tagging.
- Before tagging a release, ask the user which version bump to use (patch/minor/major) and propose a clear tag name (for example `v1.0.1`) with a short release title so others can understand the change.
- When a commit is a versioning release (i.e. it bumps the package version and updates the changelog for release), the commit must also be tagged with the release tag (for example `git tag v1.0.1`) in the same step. A release commit without its tag is incomplete.
- Do not add dependencies without asking.
- Do not run `npm publish`, `npm stage publish`, `npm deprecate`, `npm unpublish`, `npm dist-tag`, `npm owner`, `npm access`, or `pnpm publish` without an explicit, single-use user request naming the exact command. These are user actions and are gated by `library/SAFETY.md`. The agent prepares the command and stops.
- Do not create a commit, push, or tag without an explicit request, and treat each request as single-use: it covers that one command in this prompt and is not standing permission (see "Approvals are single-use"). Stage changes only when asked. The orchestrator commits on `task/<task-slug>`. A sub-agent may commit only its allocated files on its assigned sub-branch when the delegation brief says so; it never commits to the task branch or `main`, never merges, and never opens a pull request. Tagging a release commit still requires the user's explicit request to commit/push/tag.

## Precedence

When multiple AGENTS.md files apply to the same file, the closest AGENTS.md wins.

## Index of scoped AGENTS.md

No scoped AGENTS.md files yet.
