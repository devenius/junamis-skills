# Contributing

`main` is protected and read-only. Every change reaches it through a task branch and a reviewed pull request. See `AGENTS.md` for the full policy.

## 1. Check the branch and create the task branch

At the start of every prompt, check the branch before anything else:

```bash
git branch --show-current
```

- On `main` or a detached HEAD (the command prints `main`, or prints nothing), create a task branch from the latest default branch and switch to it:

  ```bash
  git fetch origin
  git switch -c task/<task-slug> origin/main
  ```

  With no remote, use `git switch -c task/<task-slug> main` instead. Tell the user the branch and continue.
- On a task branch, continue on it. Do not create a second branch for the same prompt and do not switch branches mid-prompt.
- On another task's or a sub-agent's branch, stop and ask the user which branch to use.

The orchestrator works in the project checkout on `task/<task-slug>` and commits there. The state root (`<project>/.orchestrator/`) and the design registry (`<project>/docs/design/`) live in that checkout. Do not edit, commit, tag, or push on `main`. Read-only work (questions, reviews, lookups) may run in the main checkout.

## 2. Delegate sub-agent worktrees with file allocation

Each delegated task gets a worktree under `.worktrees/<task-slug>-<subtask>` on branch `task/<task-slug>-<subtask>`, cut from the task branch:

```bash
git worktree add .worktrees/<task-slug>-<subtask> -b task/<task-slug>-<subtask> task/<task-slug>
```

- The brief names the worktree's absolute path, the branch, and an explicit allowed-file list. A sub-agent edits only those files and reads only what the brief allows. If it needs another file, it asks the orchestrator; it never checks out or edits outside its allocation.
- The Delegation plan records one owner per file, so two active tasks never edit the same file.
- The sub-agent works only in its worktree and on its branch, does not ask whether to use a worktree, and never touches `main`.
- The sub-agent never creates a pull request and never merges.

**Worktree limit: 8.** Before creating a new worktree, count the `git worktree list` entries under `.worktrees/`. At 8 or more, prune only a worktree whose branch is merged into the task branch and whose tracked and untracked working tree is clean (`git status --porcelain` empty):

```bash
git worktree remove .worktrees/<task-slug>-<subtask>
```

Use `git worktree remove`; never `rm -rf`. If no merged and clean worktree can be pruned, stop and ask the user which one to remove. Never remove an unmerged or dirty worktree.

## 3. Make the change

- Read `AGENTS.md` and `docs/typescript.md` first. All runtime code is TypeScript under `src/`; `dist/` is built, never committed.
- Each sub-agent edits only its allocated files on its assigned sub-branch; the orchestrator does not edit code itself.
- Keep the change on one task branch. Do not mix unrelated work.
- Update `CHANGELOG.md` in the same branch.
- Use Conventional Commits: `type(scope): summary` under 72 characters.

## 4. Merge back and clean up

When the sub-agent reports, verify and merge on the task branch:

```bash
git -C .worktrees/<task-slug>-<subtask> status --porcelain
git diff --name-only task/<task-slug>...task/<task-slug>-<subtask>
git merge --no-ff task/<task-slug>-<subtask>
git worktree remove .worktrees/<task-slug>-<subtask>
git branch -d task/<task-slug>-<subtask>
```

- The working tree is clean, or the sub-agent committed its allocated files on its sub-branch.
- The diff is a subset of the allowed files. A diff outside the allocation is a finding; do not merge.
- Run the task checks before merging.
- On conflict, run `git merge --abort`, stop, and ask the user. Never hand-edit a conflict and never force a merge.

## 5. Run the local gate

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

## 6. Open one pull request per approved batch and stop

After every task is merged into `task/<task-slug>` and the full gate passes, summarize the work and ask the user to approve opening the pull request. On approval, commit any remaining changes on `task/<task-slug>`, push the branch (`git push -u origin task/<task-slug>`), open one pull request with `gh pr create`, fill in `.github/pull_request_template.md`, report the URL, and stop. The agent's authority ends at `gh pr create`: it never merges, never uses `--admin`, never pushes `main`, never force-pushes, never tags, and never rebases or resets `main`. The user reviews and merges; the orchestrator never does.

```bash
git push -u origin task/<task-slug>
gh pr create --base main --head task/<task-slug> --fill
```

No self-merge. No bypassing a check. Never push `main`, force-push, or commit with `--no-verify`; those stay denied, and `gh pr merge`, `--admin`, and `main` pushes are hard-denied in `opencode.json`. A destructive git action (`reset --hard`, `clean`, `rebase`, force-push) needs the user's explicit approval and runs only inside a task worktree.

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

## 7. Approvals are single-use

Every approval covers exactly one command, in exactly one prompt, exactly once. It ends when that command finishes or fails.

- It does not cover a retry, a second command, a later step, another task, another pull request, or another session.
- A general "go ahead", "continue", "yes", or an approval of the plan is not approval for a gated command. Name the exact command and show what it changes and what cannot be undone.
- Never ask for or rely on a persistent or always-allow. Never reuse a previous approval, including one from an earlier merge, push, install, admin override, or destructive command. Ask again every time.
- Commands already allowed by `opencode.json` (read-only git, build, test, task-branch pushes, and `gh pr` reads) are not gated. Everything in `SAFETY.md`, everything that touches `main`, and everything destructive is gated.
- After a gated command runs once, the approval is spent. If the user wants it again, the user must repeat permission in a new prompt.
