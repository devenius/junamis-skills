# Fresh-repo runbook — publish 1.0.0 from the new empty repository

**Status:** one-time runbook. The user runs every command; an agent does not.
**Target repository:** `https://github.com/devenius/junamis-skills.git` (substitute if the new empty repo has another URL).
**Release candidate:** branch `fresh-main`, tag `v1.0.0`.

This is the single approved exception to the branch policy in `AGENTS.md`: the
first push creates `main` in a repository that has no history. After this run,
`main` is read-only and every change arrives through a pull request.

## Before you start

- The new GitHub repository exists and is empty (no README, no license, no
  initial commit).
- The tag `v1.0.0` exists locally; step 4 verifies it points at the release commit before it is pushed.
- `pnpm`, Node 26+, the Git CLI, and the GitHub CLI (`gh auth status`) are
  available.

## 1. Set the remote

Use `set-url` if the checkout already has an `origin`, `add` if it does not.

```bash
git remote set-url origin https://github.com/devenius/junamis-skills.git
# or, with no origin yet:
# git remote add origin https://github.com/devenius/junamis-skills.git
git remote -v
```

## 2. Prove the candidate locally

```bash
git checkout fresh-main
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm run check:pack
pnpm run check:security
pnpm run check:yaml
pnpm run check:config
pnpm run check:skills-lock
pnpm lint
pnpm run release:check -- --tag v1.0.0
```

Every command must pass before you push. `release:check` also runs the full
test suite and refuses a tag that does not match `package.json`.

## 3. Push the default branch, once

```bash
git push origin fresh-main:main
```

This creates `main` in the empty repository from the release candidate. It is
the only direct push to `main` this project allows.

## 4. Verify the tag, then push it

The tag must point at the same commit as `fresh-main`. Check that before pushing:

```bash
git rev-parse fresh-main
git rev-list -n1 v1.0.0
```

If the two SHAs differ, **stop**. The existing `v1.0.0` tag belongs to the
earlier 2026-10-31 release, and pushing it would publish the old code. Moving a
tag is destructive and needs the user's explicit approval. After approval, and
only on the release commit:

```bash
git tag -d v1.0.0
git tag -a v1.0.0 -m "Release v1.0.0"
```

Then confirm and push:

```bash
git tag --list v1.0.0
git show --no-patch --format='%H %s' v1.0.0
git push origin v1.0.0
```

## 5. Watch the `v*` workflows

The tag starts two workflows: **Release** (creates the GitHub Release from the
`## [1.0.0]` changelog section and uploads the packed archive) and **Publish to
GitHub Packages** (runs `release:check` and publishes the package). The push to
`main` starts **ci**.

```bash
gh run list --limit 5
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$(gh run list --workflow publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run list --workflow ci.yml --branch main --limit 3
```

If a workflow fails, fix the release candidate on a task branch and open a pull
request. Do not re-point or re-push the tag: delete it only after an explicit
approval, then tag the corrected release commit.
