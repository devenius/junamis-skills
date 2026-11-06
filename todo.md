# Continuation Plan: External Skill Maintenance

## Handoff State

The requested `/memories/session/plan.md` is not present, and no plan-named Markdown files exist in the repository. This is a reconstructed handoff from the active session, the current code, and `docs/external-skills-maintenance.md`; it is not a verbatim copy of the missing memory file.

The existing uppercase `TODO.md` is an older completed setup checklist and remains unchanged. This lowercase `todo.md` is the active continuation plan. Preserve all existing worktree changes. The user specifically noted that `package.json` was edited by a formatter or another tool; reread it before editing it.

## Completed Maturity Work

- External installs use `skillsio@1.1.3`; the unscanned direct-fetch fallback and alternate unverified installer were removed.
- All 24 lock entries contain a reviewed 40-character upstream commit (`ref`) and skill-directory tree SHA (`treeSha`). Pins were selected at the latest source commit on or before the documented 2026-10-27 safety review.
- Installation fetches the exact commit with system Git, verifies every folder tree SHA before scanner invocation, and passes the verified local checkout to the scanner.
- Existing global skill directories and symlinks are reported as conflicts and not passed to the installer. The check runs before checkout and again before scanning to reduce replacement races.
- Scanner-decline output is treated as a non-retryable failure even though the pinned scanner exits zero for that cancellation.
- `check:skills-lock` validates lock shape, pins, tree SHAs, source types, paths, and licenses. `check:pack` verifies required package files and excludes nested upstream clones. CI and release gates invoke these checks.
- Manual publish and release workflows require an explicit version tag, check out that ref, and run the release gate against it.
- Scope-aware `status` and `doctor`, corrected operator routing, refreshed guide/target docs, and reviewed Cursor/Cline/Windsurf/Devin target paths are in the worktree.
- The external installer research and target research are in `docs/research/2026-11-02-external-installers.md` and `docs/research/2026-11-02-agent-targets.md`.

## Maintenance Procedure

Follow `docs/external-skills-maintenance.md`.

1. Finish a complete read-only inventory of every locked source group. Compare each current upstream head against its pinned commit, and identify changed files inside every pinned skill folder. Do not treat an empty/truncated GitHub comparison response as proof that no skill changed.
2. Review every changed skill's full folder diff, including `SKILL.md`, scripts, hooks, and referenced assets. Do not execute upstream skill content. Confirm the repository license and intended `skillPath` still apply.
3. Keep the 2026-10-27 reviewed pins unless the newer skill content has been reviewed and scanned. Record scan outcomes and reviewed alerts in `library/SAFETY.md`.
4. For an accepted update, set all skills from a source to the reviewed commit and update each `treeSha` from that commit's Git tree. Preserve license values unless deliberately changing them.
5. Run the lock checker and focused tests after any lock change. Run the full test, lint, YAML/config, pack, and release checks before reporting completion.

## Preliminary Upstream Inventory

These are only partial, read-only API results from 2026-11-02. They are not reviewed or scanned and must not be used to refresh pins by themselves.

- `JavaScript-Mastery-Pro/skills`, `Kadajett/agent-nestjs-skills`, `mattbx/shadcn-skills`, and `KairosSignal/driftlock-agent-docs` reported identical default-branch commits to their lock refs.
- `shadcn-ui/ui` reported 15 commits ahead; the comparison result did not list a changed locked skill, so review is still required.
- `mattpocock/skills` reported 5 commits ahead; the comparison result did not list a changed locked skill, so review is still required.
- `vercel-labs/agent-browser` reported 42 commits ahead and a modification to `skills/agent-browser/SKILL.md`.
- The GitHub API returned HTTP 403 while checking `netresearch/agent-rules-skill`, `vercel-labs/skills`, and `anthropics/skills`. Recheck those sources using read-only Git refs or another permitted public source when available.
- GitHub comparison file lists may be truncated for large repositories. Compare the actual locked skill folder tree SHA at the latest commit before classifying a skill as unchanged.

## Approval Gates

- The project safety policy requires exact approval before global installs or file deletion. A `skillsio add ... -g` command writes to the user's global skill directories. Do not run it there without asking for approval naming the exact command and effects.
- A scratch `HOME` can isolate a scanner/install rehearsal, but creating and deleting its temporary directory is also gated. Ask for approval naming the exact command and scratch path before running it.
- Scanner high/critical prompts must be shown to the user. Never answer those prompts on the user's behalf. Record scanner failures/unavailable results as unresolved, not as clean.
- The current conversation reports a `pnpm test` exit code of 0 from before the latest edits. The suite uses `rmSync` for temporary test directories, so ask before rerunning it under the repo safety policy.
- Do not commit, push, tag, or publish; those require a separate explicit request.

## Remaining Work

- Complete upstream change detection despite API limits, including exact folder-tree comparisons.
- Review changed skill content before considering any lock update.
- Obtain exact approval for any scratch scanner/install rehearsal that writes or cleans temporary/global locations.
- Update pins and `library/SAFETY.md` only after review and scanner evidence.
- Finish with the full test suite and release check after the required approval.
- The broader plan's final manual step remains real installation/routing verification in OpenCode and Claude environments. Other target integrations also need representative environment verification before expanding external-install support.# Continuation Plan: External Skill Maintenance

## Handoff State

The requested `/memories/session/plan.md` was not present, and no plan-named Markdown files exist in the repository. This file reconstructs the active maturity plan from the session record and the repository's maintenance procedure. The existing uppercase `TODO.md` is a completed historical checklist and is intentionally unchanged.

The worktree already contains implementation changes. Do not stage, revert, or overwrite them. `package.json` was edited by the user or another tool; reread it before any future change.

## Completed Maturity Work

- External installs use `skillsio@1.1.3` only. The unscanned direct-fetch fallback was removed, and scanner declines are treated as non-retryable failures.
- All 24 external skills have a reviewed commit SHA (`ref`) and per-skill Git tree SHA (`treeSha`). Pins use source commits no later than the documented 2026-10-27 safety review. The installer fetches the commit, verifies each tree, then passes the verified local checkout to the scanner.
- Existing global skill directories and symlinks are treated as conflicts. The check runs before checkout and again before scanner invocation to reduce replacement races.
- Lock validation is wired into CI and release checks. Package-content validation confirms required runtime files and excludes nested upstream clones.
- Manual publish and release workflows require an explicit version tag and run release checks against the selected tag.
- Status and doctor report scope-aware library state. Operator rollback/deploy-verification routes and target adapter documentation were corrected.
- Cursor, Cline, and Windsurf/Devin target paths have documentation evidence, with limitations recorded in `docs/research/2026-11-02-agent-targets.md`.
- Installer findings and pinning constraints are recorded in `docs/research/2026-11-02-external-installers.md`.

## Maintenance Run

Follow `docs/external-skills-maintenance.md`.

1. Inventory the ten locked source groups and their current commits. Compare each current upstream head with the pinned commit, and identify which locked skill folders changed. Keep this inventory read-only.
2. Review every changed skill's complete folder diff, including referenced files, scripts, hooks, and assets. Do not execute upstream skill content. Confirm the repository license and intended `skillPath` remain valid.
3. Do not advance a lock entry unless its new content has been reviewed and the scanner result is known. Record reviewed findings and dates in the matching `library/SAFETY.md` rows.
4. If a reviewed update is accepted, set every skill from that repository to the selected source commit and update each `treeSha` to that commit's skill-folder tree object. Preserve the license values unless they are deliberately changed.
5. Run `pnpm run check:skills-lock`, the focused external/pinned/library tests, `pnpm lint`, YAML/config checks, and package-content checks. Run `pnpm test` before reporting completion only after satisfying the test-cleanup approval gate.

## Approval Gates

- The project safety policy requires explicit approval for global installs and file deletion. A real `skillsio add` invocation can write to a global skill directory. Do not run it against the user's normal home without first presenting the exact command and changes.
- A scratch `HOME` can isolate a scanner/install rehearsal, but creating and deleting its temporary directory is also gated. Ask for approval naming the exact command and scratch path before running it.
- The test suite uses `rmSync` to clean temporary directories. The user reported `pnpm test` passing earlier, but a fresh run after the latest edits still needs explicit approval under the repository policy.
- Critical/high scanner findings must be shown to the user. Never answer the scanner's prompt on their behalf.

## Remaining Work

- Compare upstream heads with current pins and produce the changed-skill inventory.
- Ask for the exact approval required to run the scanner against an isolated scratch home if changed skills need scanning.
- Update pins and `library/SAFETY.md` only after review and scan evidence.
- Rerun focused checks and, after approval, the full test suite and `pnpm run release:check`.
- Consider the broader remaining work from the original maturity plan: confirm all target formats end to end, improve doctor integration coverage, and manually verify external installation in OpenCode and Claude environments.