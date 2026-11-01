# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-31

### Added
- Initial release: `junamis-agents-skills` package with manifest, guide writer, and CLI.
- `pnpm init` and publishable `package.json` (MIT, ESM, Node 26+).
- 24 external skills tracked in `skills-lock.json`.
- CI workflow (`.github/workflows/ci.yml`) running the test suite on Node 26 and a pack dry run.
- Integration tests for `install-library`, `init-config`, and rollback paths.
- `init-config` command with `--scope global|project` to write `opencode.json`.
- Project scope for `install-library` (`--scope project`).
- External install fallback to direct GitHub fetch.
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