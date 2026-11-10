# DESIGN.md — Design Registry Contract

**Status:** normative
**Schema version:** 1
**Companion contracts:** `HANDOFF.md` (step output), `RESUME.md` (run persistence), `skills-lock.json`, `library/*`

---

## 1. Purpose

Define a durable, structured, machine-readable registry of **design surfaces** in the project so that:

1. The orchestrator can **load the intended state of any surface into context before routing** a capability that touches it.
2. Every skill that modifies a surface emits a **design delta** that the orchestrator folds into the registry — designs do not rot.
3. **Drift between code and design is detected and escalated**, never silently ignored.
4. A fresh reader (agent or human) can open `docs/design/<kind>/<surface>.md` and answer, unambiguously:
   - *What is actually sitting here right now?*
   - *What needs to be adjusted?*

---

## 2. Core principle

> **The design registry is the orchestrator's persistent domain memory. Code is verified against it, not the reverse.**

This means:
- Before work: the orchestrator loads the relevant registry entries into the skill's context.
- After work: the skill emits a delta; the orchestrator applies it atomically.
- If code changes without a matching delta: **drift**, escalated to `needs_review`.

The registry is not documentation for humans (though humans benefit). It is the **contract the orchestrator reasons over**.

---

## 3. Invariants (MUST rules)

1. **D1 — Single registry root.** All design docs live under `DESIGN_ROOT` (default `docs/design/`).
2. **D2 — One file per surface.** Each file describes exactly one surface (page, endpoint, entity, module, infra unit). No multi-surface files.
3. **D3 — Frontmatter is authoritative metadata.** `surface_id`, `kind`, `status`, `code_paths`, `design_checksum` are read by the orchestrator; the body is read into context.
4. **D4 — Delta, not rewrite.** Skills MUST NOT rewrite a design file wholesale. They emit a `design_delta` (§7) that the orchestrator applies mechanically.
5. **D5 — Checksum discipline.** Every applied delta updates `design_checksum`. The checksum is computed over the canonicalized body (frontmatter excluded).
6. **D6 — Coverage is enforced.** Every code path matched by a registered surface's `code_paths` MUST have exactly one owning surface. Unclaimed code paths are a `coverage_gap`.
7. **D7 — Drift is a correctness event.** Code changed under a surface whose `design_checksum` did not update → `needs_review`. Never a warning.
8. **D8 — INDEX is derived.** `INDEX.md` is regenerated from frontmatter; it is never edited by hand and never read as input to logic.
9. **D9 — Append-only history.** The `## Change log` section is append-only. Older entries are never rewritten.

---

## 4. Directory layout

```
docs/design/
├── _schema.md                    # this document
├── INDEX.md                      # generated
├── web/
│   ├── homepage.md
│   ├── dashboard.md
│   └── settings/profile.md
├── api/
│   ├── get-user.md
│   ├── post-user.md
│   └── auth/login.md
├── data/
│   ├── user-model.md
│   └── audit-log-model.md
├── infra/
│   └── deployment.md
└── cli/
    └── init-command.md
```

**Path convention:** `docs/design/<kind>/<surface-path>.md`, where `<surface-path>` mirrors the domain surface, not necessarily the filesystem. `web/homepage` and `api/get-user` are the canonical examples. `surface_id` equals the path minus `docs/design/` and `.md` (e.g. `web/homepage`).

**Monorepo:** add an optional `app` frontmatter field (`web`, `api`, `admin`, etc.) to disambiguate which workspace owns the surface. `surface_id` remains globally unique across the registry.

---

## 5. File anatomy

### 5.1 Frontmatter (YAML, required)

```yaml
---
surface_id: web/homepage
app: web                         # optional, monorepo workspace
kind: web                        # web | api | data | infra | cli | other
status: active                   # draft | active | deprecated | needs_review
version: 1.3.0                   # design version, bumped on any delta
owner: library/develop           # skill or agent responsible
code_paths:                      # globs relative to repo root
  - apps/web/src/pages/homepage/**
  - apps/web/src/components/Hero/**
depends_on:                      # other surface_ids
  - api/get-user
related_tasks:                   # task_ids from plan.json that touched this
  - T-003
last_reviewed: 2026-11-09
design_checksum: sha256:9a8b...
---
```

`design_checksum` is `sha256` over the canonicalized body (sections in fixed order, trailing whitespace stripped, line endings normalized to `\n`).

### 5.2 Body — required sections (all kinds)

```markdown
## Intent

Why this surface exists. The problem it solves. One paragraph.

## Current state

What is actually sitting here right now. Present tense. This is the section a
fresh reader opens first to understand the surface. No aspirational language.

## Known gaps

Bulleted list of what needs to be adjusted, changed, or is missing.
Each bullet is actionable. Empty list is valid (`- None`) but MUST be explicit.

## Change log

Append-only. One line per delta applied, newest last.

- 2026-11-09 · v1.3.0 · Added pagination params to response · task T-014 · library/develop
- 2026-11-07 · v1.2.0 · Hero CTA implemented · task T-009 · library/develop
```

### 5.3 Body — kind-specific sections

#### `kind: web`

```markdown
## Structure

Component tree and layout. Nesting matters.

- HomePage
  - Hero
    - HeroHeadline
    - HeroCTA
  - FeatureGrid
    - FeatureCard ×3
  - Footer

## Routes

| path | component | auth | notes |
|------|-----------|------|-------|
| `/` | HomePage | public | default landing |

## State & data

| name | source | shape | notes |
|------|--------|-------|-------|
| `user` | api/get-user | `{id, name, email}` | loaded on mount |

## Props & events

| component | props | events |
|-----------|-------|--------|
| Hero | `{headline, cta}` | `onCtaClick` |

## Accessibility

Known a11y requirements, tested or pending.
```

#### `kind: api`

```markdown
## Endpoint

- Method: `GET`
- Path: `/api/users/:id`
- Auth: `bearer`
- Rate limit: `100/min`

## Request

| field | in | type | required | notes |
|-------|----|------|----------|-------|
| `id` | path | `string(uuid)` | yes | user id |

## Response — 200

| field | type | nullable | notes |
|-------|------|----------|-------|
| `id` | `string(uuid)` | no | |
| `email` | `string(email)` | no | |
| `createdAt` | `string(iso8601)` | no | |

## Errors

| status | code | meaning |
|--------|------|---------|
| 404 | `user_not_found` | id valid but unknown |
| 401 | `unauthorized` | missing/invalid token |

## Examples

```json
{ "id": "…", "email": "a@b.c", "createdAt": "2026-11-09T10:00:00Z" }
```
```

#### `kind: data`

```markdown
## Entities

### User

| field | type | constraints | notes |
|-------|------|-------------|-------|
| `id` | uuid | primary key | |
| `email` | text | unique, not null | |

## Indexes

| name | columns | type |
|------|---------|------|
| `users_email_idx` | `email` | btree unique |

## Migrations

| id | applied | description |
|----|---------|-------------|
| `001_init` | yes | initial users table |
```

#### `kind: infra`

```markdown
## Topology

Named resources and their relations.

- `api` (service) → `postgres` (db)
- `api` (service) → `redis` (cache)

## Resources

| name | type | spec | notes |
|------|------|------|-------|
| `api` | container | 2 vCPU, 1 GB | |

## Env & secrets

| name | kind | source |
|------|------|--------|
| `DATABASE_URL` | env | secret `pg-url` |
```

#### `kind: cli`

```markdown
## Command

`tool init [path]`

## Flags

| flag | type | default | notes |
|------|------|---------|-------|
| `--force` | bool | false | |

## Output

Describe stdout/stderr format and exit codes.
```

---

## 6. Status semantics

| status | meaning | may receive deltas? |
|---|---|---|
| `draft` | being designed, not implemented | yes |
| `active` | implemented, tracked | yes |
| `deprecated` | being removed, kept for reference | no (requires status flip first) |
| `needs_review` | drift detected, awaiting resolution | no (requires operator or review skill) |

---

## 7. `design_delta` — the skill output contract

Every skill whose work touches a `code_paths` glob of a registered surface MUST include a `design_delta` in its handoff. Skills that touch no registered surface MUST emit `design_delta: none` with a `rationale` — silence is not accepted.

### 7.1 Shape

```yaml
design_delta:
  surface_id: api/get-user
  operation: update              # create | update | deprecate | none
  base_checksum: sha256:9a8b...  # the checksum the skill read
  sections:
    - section: "Response — 200"
      action: replace
      content: |
        | field | type | nullable | notes |
        |-------|------|----------|-------|
        | `id` | `string(uuid)` | no | |
        | `email` | `string(email)` | no | |
        | `createdAt` | `string(iso8601)` | no | |
        | `updatedAt` | `string(iso8601)` | no | added |
    - section: "Known gaps"
      action: remove_line
      match: "missing updatedAt in response"
    - section: "Change log"
      action: append
      content: "2026-11-09 · v1.4.0 · Added updatedAt to response · task T-014 · library/develop"
  code_paths_touched:
    - apps/api/src/routes/user.ts
  rationale: "Added updatedAt field to satisfy client refresh logic."
  task_id: T-014
  skill: library/develop
  idempotent: true
```

### 7.2 Actions

| action | semantics |
|---|---|
| `replace` | replace the named section's body entirely |
| `append` | append content to the named section |
| `remove_line` | remove the first line matching `match` in the named section |
| `prepend` | prepend content to the named section |

Any other action is a validation failure.

### 7.3 Rules

- `base_checksum` MUST match the current `design_checksum`. If it does not, the delta is **rejected** and the task enters `needs_review` (this is the concurrency guard: two skills cannot silently race on one surface).
- If `operation: create`, `base_checksum` is `null` and `surface_id` MUST NOT already exist.
- If `operation: deprecate`, `sections` is empty; `status` flips to `deprecated`.
- `version` is bumped automatically by the orchestrator on every applied delta (minor bump for content, major for structural change — the delta declares `bump: minor|major`, default `minor`).
- `idempotent: true` means the same delta applied twice produces the same result; `false` means re-application must be rejected (orchestrator enforces via checksum).

---

## 8. Orchestrator integration

### 8.1 Load (before routing)

When `route` resolves a capability, the orchestrator MUST:

1. Determine the target surface(s) from the task's declared `surface_id` or from matching the task's expected `code_paths`.
2. Load the matching design doc(s) into the skill's context, frontmatter stripped, body included.
3. Include the current `design_checksum` in the context so the skill can emit a correct `base_checksum`.

If the task touches no registered surface, the orchestrator passes `design_context: none` — the skill is then required to declare whether it *should* have.

### 8.2 Write (after handoff)

On a validated handoff containing a `design_delta`:

1. Load the target file.
2. Verify `base_checksum` matches (`operation: update`) or surface absent (`operation: create`).
3. Apply section actions in order.
4. Recompute `design_checksum` over the new body.
5. Bump `version`; update `last_reviewed` and `related_tasks`.
6. Validate the resulting file against the kind schema (§5.3).
7. Atomic write (§10).
8. Append a `design_update` event to `journal.ndjson`.
9. Regenerate `INDEX.md`.

On failure at any step: journal `design_delta_rejected`, mark the task `needs_review`, do not write.

### 8.3 Resume integration (extend RESUME.md B4)

The `RESUME.md` boot drift check (B4) is extended with a **design fingerprint**:

```json
"design_registry": {
  "index_sha256": "sha256:...",
  "surface_count": 42,
  "status_counts": { "active": 40, "draft": 1, "deprecated": 1, "needs_review": 0 }
}
```

Stored in `state.env_fingerprint`. On mismatch at boot: `BLOCKED_DRIFT` with the diff, same as the manifest check. This prevents resuming against a design registry the plan was not built against.

### 8.4 The `document` skill is the janitor

The `document` capability (internal override in `library/*`) is the designated consolidator:

- Normalizes prose
- Reconciles `Known gaps` against code reality
- Detects duplicate or overlapping `code_paths` across surfaces
- Flags `coverage_gap` for unclaimed code
- Never introduces new facts — only reorganizes what deltas produced

---

## 9. Drift model

Two independent drift detectors, both escalating to `needs_review`.

### 9.1 Code drift

For each registered surface with `status: active`:

```
changed_files = git diff --name-only <last_reviewed_commit>..HEAD \
                  -- $(resolve code_paths)
if changed_files is non-empty AND design_checksum unchanged since last_reviewed_commit:
    flag: CODE_DRIFT
    surface_id: ...
    files: [...]
```

Fallback when git is unavailable: compare mtime of matched files against `last_reviewed`.

### 9.2 Dependency drift

For each surface, for each `depends_on` entry `S`:
- If `S`'s `version` incremented since this surface's `last_reviewed` → flag `DEPENDENCY_DRIFT`.

### 9.3 Coverage drift

For each registered surface, `code_paths` MUST NOT overlap with another surface's `code_paths`. Overlaps and unmatched-but-should-be-matched code are both `COVERAGE_GAP`.

The `document` skill runs the coverage audit; CI enforces it.

---

## 10. Atomic write protocol

Identical to `RESUME.md` §8:

```
1. write  <path>.tmp
2. fsync  <path>.tmp
3. rename <path>.tmp -> <path>
4. fsync  <parent dir>
```

Journal append after the rename succeeds. Order: journal first, then snapshot (`state.json`), per `RESUME.md` §8 commit pairing.

---

## 11. INDEX.md

Generated. Never edited by hand. Shape:

```markdown
# Design Registry Index

Generated: 2026-11-09T10:42:20Z
Surfaces: 42 · active 40 · draft 1 · deprecated 1 · needs_review 0

| surface_id | kind | app | status | version | last_reviewed | gaps |
|-----------|------|-----|--------|---------|---------------|------|
| web/homepage | web | web | active | 1.3.0 | 2026-11-09 | 2 |
| api/get-user | api | api | active | 1.4.0 | 2026-11-09 | 0 |
```

Regenerated:
- After every applied delta
- On every orchestrator boot (as part of `resume-report.md` generation)
- By the `document` skill after a janitor pass

Deterministic ordering: sort by `surface_id`.

---

## 12. CI tests

**D-T1 — Schema validation.** Every file under `docs/design/` validates against its `kind` schema.

**D-T2 — INDEX determinism.** Regenerate `INDEX.md` from frontmatter; assert byte-equal to committed.

**D-T3 — Delta idempotency.** Apply a `idempotent: true` delta twice; assert result is identical to single application.

**D-T4 — Checksum guard.** Apply a delta with stale `base_checksum`; assert rejection + `needs_review`.

**D-T5 — Code drift.** Modify a file matched by `code_paths` without updating the design; assert `CODE_DRIFT` flag.

**D-T6 — Coverage.** Add a new code file under a directory matched by an existing surface's globs without a design delta; assert `COVERAGE_GAP`.

**D-T7 — Deprecated guard.** Attempt a delta against `status: deprecated`; assert rejection.

**D-T8 — Resume integration.** Mutate `docs/design/` then restart; assert `RESUME.md` B4 produces `BLOCKED_DRIFT` with a design diff.

---

## 13. Acceptance criteria

- [ ] Every code surface in the monorepo is covered by exactly one design doc (`COVERAGE_GAP` count = 0 in CI).
- [ ] `docs/design/web/homepage.md` alone answers "what's on the homepage" and "what needs adjusting" without reading code.
- [ ] `docs/design/api/get-user.md` alone answers "what fields, what types, what errors" without reading code.
- [ ] Every applied delta updates `design_checksum`, `version`, `last_reviewed`, `related_tasks`, and appends to `## Change log`.
- [ ] `INDEX.md` is regenerable and byte-stable (D-T2 green).
- [ ] Code drift on any `active` surface produces `needs_review` (D-T5 green).
- [ ] Resume against a modified registry produces `BLOCKED_DRIFT` (D-T8 green).
- [ ] No skill can silently touch a registered surface without emitting a `design_delta` or an explicit `design_delta: none`.

---

## 14. Non-goals

- This contract does **not** prescribe prose style or length beyond the required sections.
- This contract does **not** replace `HANDOFF.md` or `RESUME.md`; it composes with both.
- This contract does **not** define the override precedence algorithm — only that the design registry is fingerprinted and drift-checked alongside it.
- This contract does **not** persist reasoning, chat history, or skill-internal state. Only design facts.