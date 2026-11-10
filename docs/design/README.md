# Design registry implementation notes

`_schema.md` is the normative contract. This file records the implementation
choices the contract left open. It is not a surface and is never validated as
one.

## Commands

```
node scripts/design-registry.mjs validate
node scripts/design-registry.mjs load --surface web/homepage
node scripts/design-registry.mjs apply --delta <path>
node scripts/design-registry.mjs index [--write] [--generated-at <iso>]
node scripts/design-registry.mjs drift
node scripts/design-registry.mjs bootstrap
node scripts/design-registry.mjs fingerprint
```

Common options: `--project`, `--design-root`, `--state-root`, `--now`,
`--json`, `--quiet`.

## Section order

The body checksum is computed over a fixed order:
`Intent`, `Current state`, `Known gaps`, the kind-specific sections in the
order shown in `_schema.md` §5.3, then `Change log` last. Files may be written
in any order; validation requires the required sections to exist, and the
canonical body puts them in this order. Trailing whitespace is stripped per
line and line endings are `\n`.

## `last_reviewed_commit` (extension)

The spec's frontmatter has no commit. This implementation adds an optional
`last_reviewed_commit` field: a 40-character lowercase commit SHA. The delta
applier records `git rev-parse HEAD` there when git is available. Code drift
uses `git diff --name-only <last_reviewed_commit>..HEAD -- <matched paths>`;
without the field (or without git) it falls back to comparing matched file
mtimes against `last_reviewed` at `23:59:59Z`.

## Delta actions and idempotency

Only `replace`, `append`, `prepend`, and `remove_line` are accepted. A delta
whose actions leave the canonical body unchanged is a no-op: an
`idempotent: true` delta may be replayed even when its `base_checksum` is
stale, and no version bump or change-log line is added. A stale checksum on a
non-idempotent delta is rejected, journaled as `design_delta_rejected`, and
marks its `task_id` `needs_review`.

## Coverage gate

`_registry.json` holds `{ "bootstrap_complete": false }` after bootstrap.
Overlaps and unclaimed source files are always reported. They fail `drift`
only after a human or architect flips `bootstrap_complete` to `true`.

## Resume fingerprint

`state.env_fingerprint.design_registry` holds `index_sha256`, `surface_count`,
and `status_counts`. `index_sha256` binds the actual `INDEX.md` bytes plus every
surface file, so a body edit is drift even when the table would not change.
`design_registry_files` is the informational per-file map used to name the
changed design file in a `BLOCKED_DRIFT` report. A missing recorded value is a
one-time baseline: boot journals `design_baseline` and records the current
value instead of blocking a run that predates the field.
