---
surface_id: other/scripts-release-check
kind: other
status: draft
version: 0.1.0
owner: library/document
code_paths:
  - "scripts/release-check.mjs"
depends_on: []
related_tasks: []
last_reviewed: 2026-11-10
design_checksum: sha256:fa1cb59241f05eaa7dabbc1be6332e7a8b83b17019e22a3336127a1ea2db5a0c
last_reviewed_commit: 2c5c3d607fbba992c77a5cff83daf7113dd41cf1
---

## Intent

Draft surface for `scripts/release-check.mjs`. Bootstrap could observe only that this file exists
and that it is part of the source tree, so the intent is intentionally unstated.

## Current state

The file exists at `scripts/release-check.mjs`. Its behavior has not been reviewed and no
caller or data flow is documented yet.

## Known gaps

- Describe the intent and current behavior of `scripts/release-check.mjs`.
- Confirm this file belongs to exactly one surface and assign an owner.

## Change log

- 2026-11-10 · v0.1.0 · Created draft surface · bootstrap · library/document
