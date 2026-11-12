## Summary

<!-- What changes, for whom, and what "done" means. One paragraph. -->

## Change

<!-- The files or areas this touches. Note any design surface or reconcile contract change. -->

## Checks

- [ ] Branch check: `git branch --show-current` ran before any work. The orchestrator created `task/<task-slug>` from the latest default branch when on `main` or a detached HEAD, and continued on it.
- [ ] Task branch: every change for this batch is committed on `task/<task-slug>` in the project checkout, never on `main`.
- [ ] Delegation: each delegated task ran in `.worktrees/<task-slug>-<subtask>` on `task/<task-slug>-<subtask>`, cut from `task/<task-slug>`.
- [ ] Allowed files: each sub-agent edited only the files the brief allocated, and any out-of-allocation need was approved by the orchestrator before editing.
- [ ] Merge back: each sub-branch diff was a subset of the allowed files, the task checks passed, and it was merged into `task/<task-slug>` with `git merge --no-ff`. The worktree was removed with `git worktree remove` and the merged sub-branch was deleted with `git branch -d` (never `rm -rf`).
- [ ] Worktree limit: fewer than 8 worktrees existed under `.worktrees/` when each was created, or a merged and clean one was pruned. No unmerged or dirty worktree was removed.
- [ ] One pull request: this is the single pull request for the approved batch, it targets `main` from `task/<task-slug>`, and no direct push to `main`, force push, or `--no-verify` commit was made.
- [ ] `pnpm build` passes and `dist/` is rebuilt, not committed.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes, including the T1 to T7 resume tests.
- [ ] `pnpm run check:pack`, `pnpm run check:security`, `pnpm run check:yaml`, `pnpm run check:config`, `pnpm run check:skills-lock`, and `pnpm lint` pass.
- [ ] Design registry: `node scripts/design-registry.mjs validate` passes and `node scripts/design-registry.mjs index --check` is byte-equal. The `cli/overview` surface is updated if a code path or boundary changed.
- [ ] Reconciled: `docs/RECONCILE.md` and `docs/design/` still describe the change; no unclaimed code path or stale detector was introduced. `work-queue.json` is derived and not committed.
- [ ] No `dist/`, `node_modules/`, `.orchestrator/`, `.worktrees/`, `.junamis/`, state, or worktree files are staged.
- [ ] `CHANGELOG.md` is updated for this change.
- [ ] The pull request is ready for the user's review. It was created by the agent and not merged by it; `main` was not pushed, and no `--admin` merge or force push was attempted. The user reviews and merges.
- [ ] Every approval used in this task was single-use and no approval was reused: one command, one prompt, once, asked again each time.

## Risk and rollback

<!-- What can break, and how to undo it. Say "none" when the change is docs-only. -->
