# Contributing

`main` is protected and read-only. Every change reaches it through a task branch and a reviewed pull request. See `AGENTS.md` for the full policy.

## 1. Work on a task branch in its own worktree

Every task that writes starts in its own worktree inside the project:

```bash
git fetch origin
git worktree add .worktrees/<task-slug> -b task/<task-slug> origin/main
cd .worktrees/<task-slug>
pnpm install
```

The worktree stays under `<project-root>/.worktrees/<task-slug>` on branch `task/<task-slug>`, so the original git keeps it (`git worktree list`). It is the project root for the task: the state root, the design registry, every write, test, commit, and destructive command run there.

**Worktree limit: 8.** Before creating a new worktree, count the `git worktree list` entries under `.worktrees/`. At 8 or more, prune only a worktree whose branch is merged into the default branch and whose tracked and untracked working tree is clean (`git status --porcelain` empty):

```bash
git worktree remove .worktrees/<task-slug>
```

Use `git worktree remove`; never `rm -rf`. If no merged and clean worktree can be pruned, stop and ask the user which one to remove. Never remove an unmerged or dirty worktree.

Do not edit, commit, tag, or push on `main`. If you are already on `main`, create the worktree before the first write. Read-only work (questions, reviews, lookups) may stay in the main checkout.

## 2. Make the change

- Read `AGENTS.md` and `docs/typescript.md` first. All runtime code is TypeScript under `src/`; `dist/` is built, never committed.
- Keep the change on one branch. Do not mix unrelated work.
- Update `CHANGELOG.md` in the same branch.
- Use Conventional Commits: `type(scope): summary` under 72 characters.

## 3. Run the local gate

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm run check:pack
pnpm run check:security
pnpm run check:yaml
pnpm run check:config
pnpm run check:skills-lock
pnpm lint
```

Do not open a pull request with a failing command.

## Design registry

The registry lives at `docs/design/`. Its contract is `docs/design/_schema.md`; implementation notes are in `docs/design/README.md`.

```bash
node scripts/design-registry.mjs validate
node scripts/design-registry.mjs index --check
```

`index --check` must be byte-equal to the committed `INDEX.md`. Run `index --write` after a surface change. The package's own registry is small on purpose: `cli/overview` is the single-project overview, and `web/homepage` and `api/get-user` are the canonical examples. Never promote a draft automatically.

## Reconcile

`docs/RECONCILE.md` is the work-queue contract. The queue is derived on every pass, lives under the state root, and is never committed. If a change alters detectors, scoring, or the queue schema, update that contract and its tests.

## Never commit

- `dist/` (build output)
- `node_modules/`
- `.orchestrator/` or any state-root file
- `.worktrees/`
- `.junamis/`
- secrets, `.env*`, `.npmrc`

## 4. Open the pull request and stop

Commit on `task/<task-slug>`, push that branch (`git push -u origin task/<task-slug>`), open the pull request, and fill in `.github/pull_request_template.md`. Stop for the user's approval. After the pull request merges, the task is done.

```bash
git push -u origin task/<task-slug>
gh pr create --base main --head task/<task-slug> --fill
```

No self-merge. No bypassing a check. Never push `main`, force-push, or commit with `--no-verify`; those stay denied. A destructive git action (`reset --hard`, `clean`, `rebase`, force-push) needs the user's explicit approval and runs only inside the task worktree.
