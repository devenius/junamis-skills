# Contributing

`main` is protected and read-only. Every change reaches it through a task branch and a reviewed pull request. See `AGENTS.md` for the full policy.

## 1. Work on a task branch in its own worktree

```bash
git fetch origin
git worktree add ../junamis-skills-<task> -b <task> origin/main
cd ../junamis-skills-<task>
pnpm install
```

Do not edit, commit, tag, or push on `main`. If you are already on `main`, create the worktree before the first write.

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

`index --check` must be byte-equal to the committed `INDEX.md`. Run `index --write` after a surface change. The package's own registry is small on purpose: `other/overview` is the single-project overview, and `web/homepage` and `api/get-user` are the canonical examples. Never promote a draft automatically.

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

Push the task branch, open the pull request, and fill in `.github/pull_request_template.md`. Stop for the user's approval.

```bash
git push -u origin <task>
gh pr create --base main --head <task> --fill
```

No self-merge. No bypassing a check. A destructive git action (`reset --hard`, `clean`, `rebase`, force-push) needs the user's explicit approval and runs only inside the task worktree.
