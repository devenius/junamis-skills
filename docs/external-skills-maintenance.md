# External Skill Review and Pinning

Use this procedure whenever an external skill changes, its upstream repository changes, or a scanner update requires a re-review. The package installs only the commit and skill tree recorded in `skills-lock.json`.

## Review

1. Select the skill names and upstream repositories in scope. Group skills from the same repository so they share one commit.
2. Compare the candidate commit with the currently locked commit. Review the complete changed files, especially `SKILL.md`, scripts, hooks, and referenced resources. Do not execute upstream skill content as part of the review.
3. Verify the repository license and confirm that each skill path still points to the intended `SKILL.md`.
4. Record the scanner result and any reviewed alerts in `SECURITY.md`. Do not claim a clean scan when the scanner was unavailable or its result was not examined. Keep the approval gate and its accepted-review wording in `library/SAFETY.md`.

## Refresh Pins

For every selected skill, update `ref` to the reviewed 40-character commit SHA and `treeSha` to the Git tree SHA for that skill directory at that exact commit. For a root-level `SKILL.md`, use the repository root tree SHA. Keep all skills from one repository on the same commit unless there is a specific reason to split source groups.

The installer fetches the exact commit, checks the local skill directory tree SHA, and only then invokes the pinned `skillsio` scanner on that local checkout. A missing commit or a tree mismatch must fail before scanner installation. Never substitute a branch name, moving tag, raw-file URL, or direct unscanned install.

## Verify and Record

Run the focused checks first:

```text
pnpm run check:skills-lock
pnpm run check:security
pnpm run check:pins
node --test test/external.test.js test/pinned-source.test.js test/library.test.js
```

`check:pins` needs network access. It fetches every locked source/ref into a temporary checkout and prints any folder tree SHA that does not match `skills-lock.json`. It is deliberately not wired into CI or `release:check`; run it whenever a pin changes or an install reports a tree mismatch.

Then run the repository checks required by `AGENTS.md` and CI. Update `library/EXTERNAL.md` when names, sources, licenses, or ownership references change. Update `SECURITY.md` with the review outcome, the last scan month, and any new scanner findings; update `library/SAFETY.md` only when the approval gate or accepted-review wording changes. Preserve existing lock entries and user changes outside the review scope.

Keep the following behaviors in mind while reviewing:

- Auto-install runs with `--skip-scan` because `-y` cannot bypass the scanner's high/critical prompt. The scanned and reviewed result in `SECURITY.md` is the vetting record, so a new pin needs a fresh manual review even though install does not scan.
- A skill folder may contain an in-tree symlink (for example `CLAUDE.md -> AGENTS.md`). An absolute target, a target that escapes the folder after POSIX normalization, or a gitlink must fail the tree check.

If the scanner package changes, verify the new version's source-ref behavior, scan prompts, decline exit behavior, and overwrite behavior before changing the pinned scanner version.