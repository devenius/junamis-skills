---
surface_id: other/scripts-check-opencode-config
kind: other
status: draft
version: 0.1.0
owner: library/document
code_paths:
  - "scripts/check-opencode-config.mjs"
depends_on: []
related_tasks: []
last_reviewed: 2026-11-10
design_checksum: sha256:75cb7a0c861098f19c6b9c14a0893babb58dcf04afd1773c4dee9110c029a457
last_reviewed_commit: 2c5c3d607fbba992c77a5cff83daf7113dd41cf1
---

## Intent

Draft surface for `scripts/check-opencode-config.mjs`. Bootstrap could observe only that this file exists
and that it is part of the source tree, so the intent is intentionally unstated.

## Current state

The file exists at `scripts/check-opencode-config.mjs`. Its behavior has not been reviewed and no
caller or data flow is documented yet.

## Known gaps

- Describe the intent and current behavior of `scripts/check-opencode-config.mjs`.
- Confirm this file belongs to exactly one surface and assign an owner.

## Change log

- 2026-11-10 · v0.1.0 · Created draft surface · bootstrap · library/document
