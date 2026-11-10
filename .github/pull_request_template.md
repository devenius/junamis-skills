## Summary

<!-- What changes, for whom, and what "done" means. One paragraph. -->

## Change

<!-- The files or areas this touches. Note any design surface or reconcile contract change. -->

## Checks

- [ ] Branch: this pull request comes from a task branch/worktree, never from `main`.
- [ ] `pnpm build` passes and `dist/` is rebuilt, not committed.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes, including the T1 to T7 resume tests.
- [ ] `pnpm run check:pack`, `pnpm run check:security`, `pnpm run check:yaml`, `pnpm run check:config`, `pnpm run check:skills-lock`, and `pnpm lint` pass.
- [ ] Design registry: `node scripts/design-registry.mjs validate` passes and `node scripts/design-registry.mjs index --check` is byte-equal. The `other/overview` surface is updated if a code path or boundary changed.
- [ ] Reconciled: `docs/RECONCILE.md` and `docs/design/` still describe the change; no unclaimed code path or stale detector was introduced. `work-queue.json` is derived and not committed.
- [ ] No `dist/`, `node_modules/`, `.orchestrator/`, `.worktrees/`, `.junamis/`, state, or worktree files are staged.
- [ ] `CHANGELOG.md` is updated for this change.
- [ ] The pull request is ready for the user's review. It is not self-merged and no check is bypassed.

## Risk and rollback

<!-- What can break, and how to undo it. Say "none" when the change is docs-only. -->
