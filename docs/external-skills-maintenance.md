# External Skill Review and Pinning

Use this procedure whenever an external skill changes, its upstream repository changes, or a scanner update requires a re-review. The package installs only the commit and skill tree recorded in `skills-lock.json`.

## Review

1. Select the skill names and upstream repositories in scope. Group skills from the same repository so they share one commit.
2. Compare the candidate commit with the currently locked commit. Review the complete changed files, especially `SKILL.md`, scripts, hooks, and referenced resources. Do not execute upstream skill content as part of the review.
3. Verify the repository license and confirm that each skill path still points to the intended `SKILL.md`.
4. Record the scanner result and any reviewed alerts in `library/SAFETY.md`. Do not claim a clean scan when the scanner was unavailable or its result was not examined.

## Refresh Pins

For every selected skill, update `ref` to the reviewed 40-character commit SHA and `treeSha` to the Git tree SHA for that skill directory at that exact commit. For a root-level `SKILL.md`, use the repository root tree SHA. Keep all skills from one repository on the same commit unless there is a specific reason to split source groups.

The installer fetches the exact commit, checks the local skill directory tree SHA, and only then invokes the pinned `skillsio` scanner on that local checkout. A missing commit or a tree mismatch must fail before scanner installation. Never substitute a branch name, moving tag, raw-file URL, or direct unscanned install.

## Verify and Record

Run the focused checks first:

```text
pnpm run check:skills-lock
node --test test/external.test.js test/pinned-source.test.js test/library.test.js
```

Then run the repository checks required by `AGENTS.md` and CI. Update `library/EXTERNAL.md` when names, sources, licenses, or ownership references change. Update `library/SAFETY.md` with the review outcome and any new scanner findings. Preserve existing lock entries and user changes outside the review scope.

If the scanner package changes, verify the new version's source-ref behavior, scan prompts, decline exit behavior, and overwrite behavior before changing the pinned scanner version.