# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `junamis-skills init --with-external` and `junamis-skills install-external` to install every skill in `skills-lock.json` using skillsio, printing all security scan alerts.
- `library/` with 15 owned skills and 6 agents (orchestrator, context-keeper, maintainer, operator, reviewer, researcher), validated by `pnpm test`.
- `library/HANDOFF.md` handoff contract and `library/SAFETY.md` approval gate.
- `library/EXTERNAL.md` listing external skills referenced by the library.
- `docs/decisions/0001`, `0002`, `0003` recording adoption and install decisions.
- `src/targets/` with opencode and claude targets.
- `scripts/check-skills-sync.mjs` (colorful, verbose, 5 steps).
- `scripts/install-external-skills.mjs` preconfigured installer.
- `test/targets.test.js`, `test/guide.test.js`.
- `README.md`, `LICENSE`, `CLAUDE.md`, `.gitignore`.

### Changed
- `src/guide.js` now renders an explanatory agent-structure section, install commands, and CLI shortcuts.
- External skills installed globally to `~/.agents/skills/` (opencode target).
- `skills-lock.json` entries now carry a `license` field. Unknown licenses block publishing.

### Removed
- Old `.agents/` and `.opencode/` agent layers (moved to `toberemoved/`, then deleted).
- `src/postinstall.js` and its tests (npm 11/pnpm block install scripts).
- 9 `vercel-labs/agent-skills` entries (no repo-level license).
- `audit` and `sync` (JavaScript Mastery Pro) replaced by `agent-rules` and `driftlock`.

### Security
- Re-scanned all candidate skills before install. No malicious code found.
- `library/SAFETY.md` gates all destructive commands; scanner overrides documented.
- `verify-commands.sh` restricted to user-named requests in a throwaway worktree.

## [1.0.0] - 2026-10-27

### Added
- Initial release: `junamis-skills` package with manifest, guide writer, and CLI.
- `pnpm init` and publishable `package.json` (MIT, ESM, Node 20+).
- 24 external skills tracked in `skills-lock.json`.
EOF
echo "created"