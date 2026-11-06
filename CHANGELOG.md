# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
- Pin the skillsio scanner to the public npm registry with a verified tarball integrity hash and tarball URL, and run it from a neutral working directory with a sanitized environment.
- Reject project library manifests whose managed roots or targets resolve through a symlink outside the project, using real paths rather than lexical containment alone.
- Validate project library manifests before use: absolute paths inside the managed roots, well-formed hashes, no duplicates, and no symlinked targets.
- Reject planned library destinations that resolve through a symlinked root or subdirectory outside the managed roots before writing anything, even when no manifest exists, the manifest is empty, or `--force` is given.
- Treat `ENOTDIR` like `ENOENT` and reject a regular file at a managed root with a clean `managed root is not a directory` error instead of a raw crash.
- Allow a global managed root symlinked to another directory inside the home directory, while still rejecting roots that escape home.
- Change the shipped `opencode.json` bash default from `allow` to `ask`, and deny reads of `.git/config` and `.git/modules/*`.
- Remove `-y` from the generated scanner command and the guide example so the scanner's security prompt is never answered programmatically.
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
- Remove the ignored `pnpm` field from `package.json`; `pnpm-workspace.yaml` is the single source of truth for overrides.
- Use the platform null device from `node:os` for the scanner's config paths.

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