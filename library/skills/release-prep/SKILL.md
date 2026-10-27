---
name: release-prep
description: Use when a set of commits is ready to become a release. Checks the tree is clean, runs the test command, picks the semver bump from the commits, drafts docs/releases/<version>.md from the real commit log, and produces a release candidate. Do not use to tag, push, publish, or deploy; those are user actions.
---

# release-prep

Get a release candidate to the point where a person can ship it with one command, and stop there.

## Steps

1. **Clean tree.** Run `git status`. Stop with `status: blocked` if there are uncommitted changes. Name them.
2. **Range.** Find the last tag (`git describe --tags --abbrev=0`). If none, use the first commit and say so.
3. **Tests.** Run the project's test command. Stop with `status: failed` if it fails. Record the summary line. If the external `check` skill is installed, run `check review` on the release diff and record its findings. It reads the code and does not edit it.
4. **Bump.** Read the commits since the tag.
   - Any breaking change (`!` after type, or `BREAKING CHANGE:` footer): major.
   - Any `feat`: minor.
   - Otherwise, patch.
   - If commits do not follow conventional format, classify by reading the subject. Name the ones you were unsure about.
5. **Version.** Update the version field in the manifest (`package.json` or the project's equivalent). Do not create the tag.
6. **Notes.** Write `docs/releases/<version>.md`:

```markdown
# <version> (<YYYY-MM-DD>)

## Breaking
- <item, with commit short hash>

## Added
## Fixed
## Other

## Deploy notes
- Migrations included: yes | no (list files)
- Env vars added: <names only>
- Rollback plan: docs/releases/rollback-<version>.md (required if migrations are included)
```

7. **Check.** If migrations are included, require the rollback file to exist before the release is ready. Stop with `needs-decision` if it does not.

## Gotchas

- Do not invent changelog entries. Each line traces to a commit hash.
- A version bump without a changelog is incomplete. Write both or neither.
- Never tag or push. Print the exact commands the user should run, and stop.
- Do not bump a version that is already tagged. Check the tag list first.

## Finish

```yaml
agent: release-prep
job: release candidate <version>
status: complete | blocked | needs-decision | failed
artifacts:
  - path: docs/releases/<version>.md
    kind: created
  - path: <manifest file>
    kind: updated
findings: []
decisions_owed:
  - confirm major bump to <version>?
next: user
```

Always `next: user`. The user tags, pushes, and deploys. After deploy they run `deploy-verify`.
