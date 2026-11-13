---
surface_id: cli/overview
kind: cli
status: draft
version: 0.2.0
owner: library/document
code_paths:
  - "src/**"
  - "bin/**"
  - "scripts/**"
depends_on: []
related_tasks: []
last_reviewed: 2026-11-13
design_checksum: sha256:1141b4c48a4647db14671dc81d99bcb358b9f4faa9dd4361a03ff10a34c0450a
last_reviewed_commit: a835e1fdf81d3222df566cc8c659ef8fe066616f
---

## Intent

Describe the cli surface for this project. This draft is the overview that later page, endpoint, entity, or resource surfaces will split from.

## Current state

Draft overview created by the design registry bootstrap for this project. It covers `src/**`, `bin/**`, `scripts/**`. No behavior has been reviewed yet.

The CLI now colorizes its user-facing `init` and `status` output through `src/color.ts`: cyan headers, green success lines, yellow warnings, red errors, and gray paths/secondary details. Color auto-disables when stdout is not a TTY, when `NO_COLOR` is set, or when `TERM=dumb`, so captured output and CI logs stay plain.

A read-only publish checklist lives at `src/scripts/publish-npm.ts` with the thin launcher `scripts/publish-npm.mjs` (`pnpm publish:npm`). It validates the package metadata and prints the exact `npm stage publish` command. It never runs a registry mutation; publishing happens in `.github/workflows/publish.yml` or by the user.

## Known gaps

- Split page, endpoint, entity, or resource surfaces out of this overview as work begins.
- Confirm the surface boundary and owner.

## Command

`<tool> [args]`

## Flags

| flag | type | default | notes |
|------|------|---------|-------|
| (none yet) | | | |

## Output

Describe stdout/stderr format and exit codes.

## Change log

- 2026-11-10 · v0.1.0 · Created draft overview · bootstrap · library/document
- 2026-11-13 · v0.2.0 · Documented the colorized CLI and the read-only publish checker · document · library/document
