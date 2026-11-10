---
surface_id: other/scripts-check-security
kind: other
status: draft
version: 0.1.0
owner: library/document
code_paths:
  - "scripts/check-security.mjs"
depends_on: []
related_tasks: []
last_reviewed: 2026-11-10
design_checksum: sha256:07093fd904bcf0cab4e46a63c4458653bf99cf6e384697f7995174c37be00f30
last_reviewed_commit: 2c5c3d607fbba992c77a5cff83daf7113dd41cf1
---

## Intent

Draft surface for `scripts/check-security.mjs`. Bootstrap could observe only that this file exists
and that it is part of the source tree, so the intent is intentionally unstated.

## Current state

The file exists at `scripts/check-security.mjs`. Its behavior has not been reviewed and no
caller or data flow is documented yet.

## Known gaps

- Describe the intent and current behavior of `scripts/check-security.mjs`.
- Confirm this file belongs to exactly one surface and assign an owner.

## Change log

- 2026-11-10 · v0.1.0 · Created draft surface · bootstrap · library/document
