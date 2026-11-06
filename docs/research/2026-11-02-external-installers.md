# External installer pinning and scanner behavior

Asked: 2026-11-02   Version context: `skillsio` 1.1.3; Vercel `skills` documentation on its current main branch.

## Answer

Package-managed external installs use the pinned `skillsio` scanner, with a package-owned layer that checks out each source at a locked commit and verifies each skill folder's Git tree SHA before asking the scanner to install from the local checkout. The `skillsio` package itself does not provide immutable SHA pinning: its source parser accepts refs from GitHub tree URLs, but its clone implementation passes the ref to `git clone --branch`. In `skillsio` 1.1.3, declining a scan prints `Installation cancelled due to security concerns` and exits with status zero; the package wrapper translates that signal into a non-retryable failure.

## Evidence

- The `skillsio` registry page identifies version 1.1.3 and documents local scanning, high or critical confirmation, and `--skip-scan`: [skillsio on npm](https://www.npmjs.com/package/skillsio), published 8 months before this review.
- The scanner result handler confirms high and critical findings prompt, and a decline returns false: [skillsio scanner-ui.ts](https://github.com/alonw0/secure-skills/blob/main/src/scanner-ui.ts), repository version 1.1.3.
- The installer calls the scanner, then exits zero after a declined scan: [skillsio add.ts](https://github.com/alonw0/secure-skills/blob/main/src/add.ts), repository version 1.1.3.
- The upstream CLI documents its `add` command and a separate experimental frozen-lockfile restore that checks content hashes: [Vercel skills CLI commands](https://github.com/vercel-labs/skills/blob/main/docs/commands.md), updated 4 days before this review.
- `skillsio` parses a GitHub tree URL's ref, then passes it to `simple-git` as `--branch <ref>`: [skillsio source parser](https://github.com/alonw0/secure-skills/blob/main/src/source-parser.ts) and [clone implementation](https://github.com/alonw0/secure-skills/blob/main/src/git.ts), repository version 1.1.3.
- Git documents `--branch` as a branch or tag selector, while arbitrary commit revisions require the distinct `--revision` option: [git-clone manual](https://git-scm.com/docs/git-clone), Git 2.54.0.
- The package lock now records one commit SHA per source group and a Git tree SHA per skill directory. These were queried from GitHub's public API at the last source commit on or before the package's 2026-10-27 safety review date.

## Unverified

- GitHub's Git endpoint must permit fetching a reachable commit by SHA for the local prefetch to work. A fetch failure is terminal and does not fall back to a branch or tag.
- The lock's historical commits were selected by the GitHub API's `until` query and folder SHAs were read from those commit trees; no full `skillsio` install was run against every source.
- The pinned `skillsio` clone implementation cannot be assumed to install a bare commit SHA; its `--branch` call may reject it. A package-managed prefetch at an exact commit followed by a local scanned install would need to be designed and tested.
- The cancellation text is an implementation detail. The package pins the scanner version and tests this exact output, but upgrading that version requires rechecking the behavior.
- This research did not verify that all remote skills in the manifest can be represented in Vercel's experimental lock format while retaining the local scan gate.

## Not checked

- No external installer or remote checkout was run, and no skills were installed. The local verification and installer routing are covered by unit tests instead.
