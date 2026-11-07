# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `init` now installs everything in one non-interactive run: the guide, `opencode.json` for OpenCode (when missing or with `--force`), the library, and every pinned external skill. Injected dependencies make `init` testable without network access.
- `SECURITY.md` as the recorded scan record for all 18 internal and 24 external skills: kind, source, license, scan status, last review month, and the pinned scanner. It is published, installed as a shared doc, and enforced by `check:security` in CI and `release:check`.
- `status` replaces `doctor` and reports the guide, marker, per-target internal/external skill counts, library manifest validity, config validity, external coverage, and the `SECURITY.md` scan record. It exits 1 only when a detected target's manifest or config is invalid, or project JSON is malformed.

### Security
- Always pass `--skip-scan` to the pinned scanner. `-y` does not bypass its high/critical "Install anyway?" prompt; a real run prompted on four source groups and silently left skills uninstalled while counting them. Install-time scanning is skipped by design, and `SECURITY.md` plus `library/SAFETY.md` is the vetting record.
- After each successful scanner group, verify that every expected `<name>/SKILL.md` exists under the target's global skills directory. Only verified skills count as installed; an already-present skill is skipped; a skill missing after a successful run is a logged failure.
- Allow an in-tree symlink inside a verified skill tree (for example `CLAUDE.md -> AGENTS.md`) while still rejecting absolute targets, targets that escape the skill folder, and gitlinks. This unblocks `agent-rules`.
- Correct the `driftlock` tree SHA to `6c4a9e981e2d8abc0f2bb557b4c84672cb5701a9` and add `check:pins` to re-fetch each locked source/ref and compare the actual tree SHA with the lock.
- Record the observed HIGH/CRITICAL findings for `develop`, `nestjs-best-practices`, `shadcn`, `shadcn-component-discovery`, `skill-creator`, `webapp-testing`, `mcp-builder`, `agent-rules`, `driftlock`, and `agent-browser` as `flagged` in `SECURITY.md`, with the gate in `library/SAFETY.md`.
- Pin the skillsio scanner to the public npm registry with a verified tarball integrity hash and tarball URL, and run it from a neutral working directory with a sanitized environment.
- Reject project library manifests whose managed roots or targets resolve through a symlink outside the project, using real paths rather than lexical containment alone.
- Validate project library manifests before use: absolute paths inside the managed roots, well-formed hashes, no duplicates, and no symlinked targets.
- Reject planned library destinations that resolve through a symlinked root or subdirectory outside the managed roots before writing anything, even when no manifest exists, the manifest is empty, or `--force` is given.
- Treat `ENOTDIR` like `ENOENT` and reject a regular file at a managed root with a clean `managed root is not a directory` error instead of a raw crash.
- Allow a global managed root symlinked to another directory inside the home directory, while still rejecting roots that escape home.
- Change the shipped `opencode.json` bash default from `allow` to `ask`, and deny reads of `.git/config` and `.git/modules/*`.
- Pass `-y` to the pinned scanner so `init` can install non-interactively. The scan is still never skipped, and declined-scan output is still converted to a failure.
- Require the pinned skill path to be a Git tree, rejecting symlinks and gitlinks inside it.
- Verify that the checkout HEAD equals the locked commit after fetching.
- Terminate timed-out child processes by process group and only settle after the child closes.
- Cap captured child output at 64 KiB and keep the tail for diagnostics.
- Remove plaintext HTTP and user-content hosts from the `webfetch` allowlist.
- Pin every GitHub Action to a full commit SHA in all workflows.
- Override the dev-only `minimatch` advisory to a patched version.
- Ignore `.npmrc`, `.env*`, and `.junamis/` in Git.
- Strip ANSI CSI/OSC control sequences from installer output before forwarding it.
- Assert the documented `opencode.json` invariants in the config check.
- Enable pnpm's minimum release age and remove the unused exclusion.
- Remove the unused `computedHash` field from the skill lock.
- Validate project-supplied JSON in `status` and `doctor` and report malformed input without crashing.

### Changed
- Reduce the CLI to `init`, `status`, and `help`. `install-library`, `install-external`, `sync`, `doctor`, and `init-config` were removed; calling one now fails with `unknown command: <cmd>. Use "init" or "status".`
- `init` installs every external skill automatically and treats already-installed skills as skipped, not failed. It exits 1 only when an external install reports a failure.
- Split internal (library) skills from external skills for OpenCode: internal skills install to `~/.config/junamis/skills`, shared docs to `~/.config/junamis/`, and the install manifest to `~/.config/junamis/installed/library-<agent>.json`. External skills stay in `~/.agents/skills`, and `opencode.json` registers both skill roots. Project scope mirrors the internal side under `<project>/.config/junamis/`; other targets keep their single skills directory.
- Remove the ignored `pnpm` field from `package.json`; `pnpm-workspace.yaml` is the single source of truth for overrides.
- Use the platform null device from `node:os` for the scanner's config paths.

### Fixed
- `init --dir <new>` no longer crashes with `ENOENT ... realpath` before planning. The managed-root check falls back to the lexical project path and `writeGuide` creates the project directory before writing, so a dry run prints the full plan without creating it and a real run installs into the new directory.
- `status` is informational for targets that are not installed or detected, and for an absent per-project guide. It exits 1 only for a detected target with an invalid manifest/config, a malformed project marker, or malformed `opencode.json`.

## [1.0.0] - 2026-10-31

### Added
- Initial release: `junamis-agents-skills` package with manifest, guide writer, and CLI.
- `pnpm init` and publishable `package.json` (MIT, ESM, Node 26+).
- 24 external skills tracked in `skills-lock.json`.
- CI workflow (`.github/workflows/ci.yml`) running the test suite on Node 26 and a pack dry run.
- Integration tests for `install-library`, `init-config`, and rollback paths.
- `init-config` command with `--scope global|project` to write `opencode.json`.
- Project scope for `install-library` (`--scope project`).
- External installs through the pinned skillsio scanner; there is no direct GitHub download fallback.
- `release:check` and `check:config` scripts.
- Issue reporting section in README.
- README external skills table with sources and licenses.
- Node 26-native GitHub Actions.
- Custom OpenCode configuration (`opencode.json`) that sets `orchestrator` as the default agent, auto-registers `~/.agents/skills` and library instructions, and defaults unreferenced tools to `ask`.
- `test/release.test.js` validating that `CHANGELOG.md` has an entry and sufficient detail for releases.
- Scoped package name `@devenius/junamis-agents-skills` for GitHub Packages.
- `publishConfig` pointing to the GitHub Packages registry.
- `.github/workflows/publish.yml` to publish on `v*` tag pushes.
- `.github/workflows/release.yml` generating GitHub Releases from `CHANGELOG.md`.

### Changed
- `applyLibraryInstall` writes atomically, rolls back on failure, and removes empty directories on rollback.
- Managed and stale files edited by hand are treated as conflicts.
- `opencode.json` denies access to common secret conventions and allowlists trusted developer docs.
- External skills installed globally to `~/.agents/skills/` (opencode target).
- `skills-lock.json` entries carry a `license` field.
- `AGENTS.md` working rules: release notes come from `CHANGELOG.md`; versioning-release commits must also be tagged.
- Node baseline standardized on v26 across workflows and the `env-doctor` example.

### Fixed
- External installer retry/timeout handling.
- Lint and content-quality test coverage.
- Renamed package to `junamis-agents-skills`.
- Suppressed noisy `git describe` stderr in `test/release.test.js`.