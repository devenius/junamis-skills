# RECONCILE.md — Work Queue Contract

**Status:** normative
**Schema version:** 1
**Companion contracts:** `HANDOFF.md` (step output), `RESUME.md` (run persistence), `DESIGN.md` (design registry), `skills-lock.json`, `library/*`

---

## 1. Purpose

Define the **work queue generator** — the capability that decides *what to do next*.

`RESUME.md` answers "where did the run stop". `DESIGN.md` answers "what should be true". The journal answers "what is true". **`RECONCILE` computes the gap and turns it into a prioritized, dependency-safe work queue** that `route` dispatches from.

Without `RECONCILE`, the orchestrator is a very good executor with a static plan. With it, the orchestrator is a controller that converges the project toward the design registry on every session.

---

## 2. Core principle

> **The next action is derived, not remembered.**

The orchestrator MUST NOT replay a plan blindly. On every reconcile pass it MUST re-read the current state from the durable artifacts (journal + design registry + plan + fingerprints), run detectors, and emit a fresh queue. A queue is valid only for the state it was built against; it is invalidated by any `step_end`, `drift_detected`, or `design_delta_rejected` event.

---

## 3. Invariants (MUST rules)

1. **R1 — Queue is derived.** `work-queue.json` is never hand-edited and never read as input on the next pass. Each pass rebuilds it.
2. **R2 — Deterministic scoring.** Priority is computed by a fixed function over `(reason, severity, plan_position)`. No model reasoning influences priority. Any deviation MUST be journaled as `priority_override` with a `rationale` string.
3. **R3 — Drift blocks the queue.** When `RESUME.md` reports `Status: BLOCKED_DRIFT` or `HALT_CORRUPT`, `RECONCILE` MUST NOT emit a queue. It emits a `needs_review` work item only.
4. **R4 — Shadow safety.** A candidate whose `resolved_skill` is shadowed by an internal override MUST NOT be emitted as executable. If the override fingerprint is stale, emit `shadow_conflict` as `needs_review` instead.
5. **R5 — No self-prioritization.** A skill's own emitted estimate or priority is advisory only. The scoring function is the sole authority.
6. **R6 — Dependency closure.** A candidate is emitted as `ready` only if all its `depends_on` (plan) and `design.depends_on` prerequisites are `done` or absent. Blocked candidates emit as `blocked` with the blocking surface/task id.
7. **R7 — Provenance is preserved.** Every candidate carries the detector(s) that produced it and the journal seq at which they fired. Two detectors on the same target produce one candidate with two provenance entries, not two candidates.
8. **R8 — Reconcile is cheap.** A pass MUST NOT invoke a model. It is file reads, comparisons, and arithmetic. Model calls happen only when `route` dispatches the head.
9. **R9 — Queue is ephemeral.** `work-queue.json` lives under `$ORCH_STATE_ROOT`, not in the design registry or the plan. It is not committed to the repo.
10. **R10 — Empty queue is a state, not a bug.** A `no_work` status is valid and MUST be reported explicitly with the reason (all done, all blocked, needs_review only).

---

## 4. When `RECONCILE` runs

`RECONCILE` is a **capability**, not just a boot step. It MUST run at all four points:

| Trigger | Reason |
|---|---|
| **Boot** (`RESUME.md` B7.5, between resume report and `route`) | Establish the initial queue from durable state |
| **After every `step_end`** | The last step unlocked, broke, or drifted something |
| **After every `drift_detected` or `design_delta_rejected`** | Re-prioritize immediately; the queue built against the old state is stale |
| **Periodic tick** (every `N = 10` `step_end` events, configurable) | Catch slow-burn signals like `stale_surface` |

A pass is skipped (not run) when `Status: BLOCKED_DRIFT` or `HALT_CORRUPT` per R3.

---

## 5. Inputs

All inputs are already produced by the companion contracts:

| Input | Source | Used for |
|---|---|---|
| `state.json` | `RESUME.md` §5.1 | Cursor, env fingerprint, task summary |
| `journal.ndjson` | `RESUME.md` §5.3 | Recent failures, escalations, drift events |
| `plan.json` | `RESUME.md` §5.2 | Pending / blocked / done tasks, dependency graph |
| `tasks/<id>/task.json` | `RESUME.md` §5.4 | Per-task status, current step, retries |
| `tasks/<id>/handoffs/*.yaml` | `HANDOFF.md` | Step outcomes |
| `docs/design/` | `DESIGN.md` §4 | Surface status, drift flags, coverage |
| `docs/design/INDEX.md` | `DESIGN.md` §11 | Surface list, gap counts |
| Override/manifest fingerprint | `RESUME.md` §5.1, `state.env_fingerprint` | Shadow safety |

No input is optional. A missing input is a validation failure (`HALT: missing_input`) — never a silent default.

---

## 6. Detectors

Each detector is a pure function over the inputs; it emits zero or more `candidate` objects (§7). Detectors MUST be deterministic for a given input snapshot.

### 6.1 Required detectors (MVP)

| id | Reads | Emits | Capability | Severity |
|---|---|---|---|---|
| `plan_pending` | `plan.json`, `task.json` | Next unblocked `pending` plan task | from plan | from plan |
| `code_drift` | `docs/design/*`, git or mtime | Surface with `CODE_DRIFT` | `document` | high |
| `failed_step` | `journal`, `task.json` | Task whose last step was `failed` | same as last | high |

### 6.2 Extended detectors (add after MVP)

| id | Reads | Emits | Capability | Severity |
|---|---|---|---|---|
| `coverage_gap` | `docs/design/*` | Unclaimed code path | `document` | medium |
| `dependency_drift` | `docs/design/*` | Surface whose `depends_on` bumped | `develop` or `check` | medium |
| `needs_review` | `design`, `task.json` | Item in `needs_review` | `audit` or operator | p0 gate |
| `stale_surface` | `docs/design/*`, git mtime | `active` surface untouched for N days | `check` | low |
| `shadow_conflict` | override map, `route` table | Skill shadowed but still routed | `needs_review` | p0 gate |

Detectors are registered in a manifest (§8) so the orchestrator can enable/disable them without code changes.

---

## 7. Candidate schema

```yaml
candidate:
  candidate_id: "cand-20261109-0001"     # stable hash of (surface_id | task_id, reason)
  capability: develop                     # one of: scope|architect|develop|test|check|document|audit|sync|needs_review
  target:
    kind: surface                         # surface | task | repo
    id: api/get-user                      # surface_id or task_id
  reason: code_drift                      # detector id (primary)
  priority: p2                            # p0..p3, computed (§9)
  severity: high                          # low | medium | high | critical
  effort: unknown                         # unknown | small | medium | large (advisory)
  ready: true                             # false if blocked
  blocked_by: []                          # list of task_id or surface_id
  resolved_skill: library/develop         # from override map or manifest
  resolution_source: internal_override    # internal_override | manifest | needs_review
  provenance:
    - { detector: code_drift, at_seq: 137, at_ts: "2026-11-09T10:42:13Z" }
  rationale: "api/get-user code changed but design_checksum unchanged since last_reviewed"
```

Rules:
- `candidate_id` MUST be stable across passes for the same `(target.id, reason)`. Two passes on unchanged state produce the same id.
- `resolved_skill` is resolved via the same precedence rule as `route` (internal > manifest). `RECONCILE` does **not** dispatch — it resolves only to enable R4 shadow checks.
- If `resolution_source: needs_review`, the candidate is emitted but its `ready` flag is forced `false` and `reason` becomes `shadow_conflict`.

---

## 8. Detector manifest

`$ORCH_STATE_ROOT/reconcile/detectors.yaml` — declares which detectors are active.

```yaml
schema_version: 1
detectors:
  - id: plan_pending
    enabled: true
    order: 10
  - id: code_drift
    enabled: true
    order: 20
    params:
      use_git: true
      fallback_mtime: true
  - id: failed_step
    enabled: true
    order: 30
    params:
      max_retries: 3
  - id: coverage_gap
    enabled: false
    order: 40
  - id: shadow_conflict
    enabled: true
    order: 5
```

`order` breaks ties in the scoring function (§9) when `reason` alone is insufficient. Lower order = evaluated earlier.

---

## 9. Scoring function (fixed, deterministic)

Priority is computed from a small lookup table, not inferred.

### 9.1 Severity → base

| severity | base |
|---|---|
| critical | 0 |
| high | 1 |
| medium | 2 |
| low | 3 |

### 9.2 Reason weight (tie-breaker)

```yaml
# Lower = higher priority within the same severity
reason_weight:
  shadow_conflict: 0
  needs_review: 1
  failed_step: 2
  code_drift: 3
  coverage_gap: 4
  dependency_drift: 5
  plan_pending: 6
  stale_surface: 7
```

### 9.3 Plan position

For `plan_pending` candidates, the task's index in the topologically-sorted `plan.json` is added as a fractional component `+ index / 10000`. This preserves plan order within `plan_pending` while never overriding a different reason.

### 9.4 Priority bucket

```python
score = base(severity) * 100 + reason_weight(reason) + plan_position_frac
if score < 100:   priority = "p0"      # critical always
elif score < 200: priority = "p1"
elif score < 300: priority = "p2"
else:             priority = "p3"
```

The scoring function is defined **here** and MUST NOT be reimplemented per detector. Adding a reason requires adding a `reason_weight` entry; unknown reasons MUST be treated as weight `100` (lowest) and journaled as `unknown_reason` so they can be triaged.

### 9.5 Overrides

An override MUST be a journal event, not a silent mutation:

```json
{"type":"priority_override","candidate_id":"cand-...","from":"p2","to":"p0","rationale":"blocks release","by":"operator","ts":"..."}
```

Override entries are read on each pass and applied after scoring. No override is valid unless it names a `rationale`.

---

## 10. Queue construction algorithm

Executable, deterministic. Run in this exact order.

```
INPUT:  state, journal, plan, tasks, design, detectors, overrides
OUTPUT: work-queue.json, reconcile-report.md

1. GUARD.
   If state.status in {BLOCKED_DRIFT, HALT_CORRUPT}: emit queue with
   one needs_review item carrying the drift diff; STOP.

2. RUN DETECTORS.
   For each enabled detector in `detectors.yaml` (ordered by `order`):
     candidates += detector.run(inputs)

3. DEDUPE.
   Group candidates by (target.kind, target.id). Merge provenance lists.
   Primary reason = the one with the lowest reason_weight. Secondary reasons
   are preserved in provenance.

4. RESOLVE SKILLS.
   For each candidate: resolved_skill, resolution_source = resolve(capability).
   If shadowed and fingerprint is stale (RESUME.md B4 would have failed):
     reason = shadow_conflict, ready = false, resolution_source = needs_review.

5. DEPENDENCY CHECK.
   For each candidate:
     blockers = plan_task.depends_on (unresolved) ∪ design.depends_on (not done)
     ready = (blockers is empty)
     blocked_by = blockers

6. SCORE.
   priority = score(candidate) per §9.
   Apply operator overrides from journal.

7. SORT.
   Primary sort:   priority ascending (p0 first)
   Secondary sort: ready descending (ready before blocked)
   Tertiary sort:  plan_position ascending (for plan_pending)
   Final tiebreak: candidate_id ascending (deterministic)

8. EMIT.
   Write work-queue.json (schema §11).
   Write reconcile-report.md (format §12).
   Journal one `reconcile_pass` event with:
     { pass_id, input_fingerprint, candidate_count, ready_count, head_candidate_id }

9. HANDOFF.
   If queue is empty:  state.reconcile = "no_work"  (R10)
   Else:               state.reconcile = "ready"
   Return head to `route`. If head is `ready: false`, `route` MUST NOT
   dispatch — it MUST escalate (§13).
```

---

## 11. `work-queue.json` schema

Stored at `$ORCH_STATE_ROOT/work-queue.json`. Regenerated on every pass; not committed.

```json
{
  "schema_version": 1,
  "pass_id": "rec-20261109-0003",
  "generated_at": "2026-11-09T10:42:20Z",
  "input_fingerprint": {
    "journal_head_seq": 137,
    "plan_checksum": "sha256:ab12...",
    "design_index_sha256": "sha256:cd34...",
    "env_fingerprint": { "skills_lock_sha256": "...", "library_overrides_sha256": "..." }
  },
  "status": "ready",              // ready | no_work | blocked_drift
  "summary": {
    "total": 4,
    "ready": 2,
    "blocked": 1,
    "needs_review": 1,
    "by_priority": { "p0": 0, "p1": 1, "p2": 2, "p3": 1 }
  },
  "queue": [ /* candidate objects, sorted per §10 */ ]
}
```

`input_fingerprint` MUST be recorded so a later pass can detect whether its queue was built against the current state (`input_fingerprint` mismatch = stale queue).

---

## 12. `reconcile-report.md` format

Human-readable companion, rewritten on each pass. Minimum content:

```markdown
# Reconcile Report

- Pass: rec-20261109-0003
- Generated: 2026-11-09T10:42:20Z
- Status: ready
- Input fingerprint: journal@137 · plan sha256:ab12… · design sha256:cd34…

## Head

- Candidate: cand-20261109-0001
- Capability: develop → library/develop (internal_override)
- Target: api/get-user
- Reason: code_drift (provenance: code_drift@137)
- Priority: p2 · severity: high · ready: true

## Queue

| # | priority | ready | capability | target | reason | skill |
|---|----------|-------|-----------|--------|--------|-------|
| 1 | p2 | yes | develop | api/get-user | code_drift | library/develop |
| 2 | p2 | yes | test | api/get-user | plan_pending | library/test |
| 3 | p2 | no | develop | web/homepage | plan_pending | library/develop |
| 4 | p0 | no | needs_review | surface:api/get-user | shadow_conflict | needs_review |

## Blocked

- #3 blocked_by: [api/get-user] (design dependency)
- #4 requires operator resolution (shadow_conflict)

## Detector status

| detector | enabled | fired | candidates |
|----------|---------|-------|------------|
| shadow_conflict | yes | 1 | 1 |
| code_drift | yes | 1 | 1 |
| plan_pending | yes | 2 | 2 |
```

If `Status: blocked_drift`, the report MUST include a `## Drift` section identical to `resume-report.md`'s `## Drift` section so a reader has the diff in one place.

---

## 13. Escalation rules

`RECONCILE` emits; `route` acts. The following are the only valid `route` responses to a queue:

| Head state | `route` action |
|---|---|
| `ready: true`, `resolution_source` internal_override or manifest | dispatch skill, journal `step_start` |
| `ready: true`, `resolution_source: needs_review` | **do not dispatch** — journal `escalation` reason `shadow_conflict`, emit to operator |
| `ready: false`, `blocked_by` non-empty | **do not dispatch** — journal `queue_blocked` and wait for the blocker to resolve (next `step_end` will re-reconcile) |
| `status: no_work` | journal `run_complete`; stop unless plan has pending items that are all blocked (then emit `run_stalled` with the blocking set) |
| `status: blocked_drift` | journal `escalation` reason `drift`; stop |

`route` MUST NOT skip past the head to dispatch a later candidate. Doing so breaks R7 (provenance) and R3 (drift) — the queue is only sound in order.

---

## 14. Integration points

### 14.1 With `RESUME.md`

Add a new boot step **B7.5** between B7 (resume report) and B8 (hand to `route`):

```
B7.5 — RECONCILE pass.
  If resume Status in {BLOCKED_DRIFT, HALT_CORRUPT}:
    write work-queue.json with status blocked_drift; continue to B8.
  Else:
    run §10 algorithm; write work-queue.json + reconcile-report.md.
  Journal `reconcile_pass`. Continue to B8.
```

B8 passes `work-queue.json` (not a raw signal) to `route`.

The `input_fingerprint` in `work-queue.json` becomes the third fingerprint checked by B4 on the next boot (alongside `skills_lock_sha256`, `library_overrides_sha256`, `design_registry`). A mismatch means the previous queue is stale — regenerate, do not reuse.

### 14.2 With `DESIGN.md`

`RECONCILE` reads the design registry; it **never writes to it**. Design facts flow into the queue via detectors, and back out via `design_delta` from skills (handled by `DESIGN.md` §8). The two are read-only on each other's side of the boundary.

Add `design_registry.index_sha256` to `input_fingerprint` so a stale queue after design drift is detectable.

### 14.3 With `HANDOFF.md`

Every `step_end` event triggers a reconcile pass (§4). The handoff's `status` field feeds `failed_step` and `plan_pending` detectors. Malformed handoffs (§`RESUME.md` B6) emit `needs_review` candidates with `reason: invalid_handoff` (add this to §9.2 weights at weight `1`).

### 14.4 With `skills-lock.json` and `library/*`

`RECONCILE` resolves `capability → skill` using the same precedence as `route`. It reads the override map, not the manifest directly, so shadowed entries are already excluded. The `shadow_conflict` detector exists only to catch cases where a candidate's capability has **no** internal override and the manifest entry was removed (a hole in coverage).

---

## 15. Journal events (additions to `RESUME.md` §5.3)

New event types emitted by `RECONCILE`:

| type | fields |
|---|---|
| `reconcile_pass` | `pass_id`, `input_fingerprint`, `candidate_count`, `ready_count`, `head_candidate_id`, `status` |
| `priority_override` | `candidate_id`, `from`, `to`, `rationale`, `by` |
| `queue_blocked` | `candidate_id`, `blocked_by` |
| `queue_stale` | `pass_id`, `mismatched_field` |
| `unknown_reason` | `reason`, `detector` |
| `run_stalled` | `blocking_set` (list of task/surface ids) |

`reconcile_pass` MUST be emitted even when the queue is empty, so replay can reconstruct queue history.

---

## 16. CI tests

**R-T1 — Determinism.** Two passes on the same input snapshot produce byte-equal `work-queue.json`.

**R-T2 — Stable ids.** Adding an unrelated candidate does not change the `candidate_id` of existing candidates.

**R-T3 — Scoring.** Fixture set of `(reason, severity, plan_position)` → expected `priority`. Covers §9.2 table and §9.4 bucket boundaries.

**R-T4 — Drift guard.** `RESUME.md` `BLOCKED_DRIFT` → `RECONCILE` emits `status: blocked_drift` and no dispatchable candidates.

**R-T5 — Shadow safety.** A candidate whose `resolved_skill` is shadowed is emitted as `needs_review`, not dispatchable (R4).

**R-T6 — Dependency closure.** A candidate with an unmet `depends_on` is `ready: false` with the correct `blocked_by` (R6).

**R-T7 — Dedup.** Same target from two detectors → one candidate with two provenance entries (R7).

**R-T8 — Reconcile on `step_end`.** A `step_end` event triggers exactly one `reconcile_pass` (not zero, not two).

**R-T9 — Empty queue.** All tasks done → `status: no_work` and `run_complete` journaled (R10).

**R-T10 — Stalled queue.** All plan items blocked by design items in `needs_review` → `run_stalled` with the blocking set.

**R-T11 — Resume integration.** Crash after `step_end` before next reconcile → on boot, B7.5 produces the same head candidate as the uninterrupted run.

**R-T12 — Priority override audit.** An operator override without `rationale` is rejected and journaled `priority_override_rejected`.

---

## 17. MVP cut (ship this first)

If you want to land `RECONCILE` incrementally, the smallest version that delivers value:

1. **Detectors:** `plan_pending`, `code_drift`, `failed_step` only.
2. **Scoring:** §9 with the three reason weights; no `plan_position_frac` (sort `plan_pending` by original plan order instead).
3. **Triggers:** boot (B7.5) and after every `step_end`. No periodic tick.
4. **Queue:** `work-queue.json` with `ready`/`blocked`; no `needs_review` escalation yet (still emit `shadow_conflict` if it fires, but wire it to a plain log line until §13 lands).
5. **Tests:** R-T1, R-T3, R-T8, R-T11.

That's roughly a day of work and it immediately makes the orchestrator **convergent**. Add `coverage_gap`, `dependency_drift`, `shadow_conflict`, `stale_surface`, and the periodic tick in a second pass — each is independently shippable, and each adds a specific class of correctness without changing the algorithm.

---

## 18. Acceptance criteria

- [ ] Every dispatch by `route` originates from a candidate in the current `work-queue.json` (R1, §13).
- [ ] Two passes on the same input produce byte-equal queues (R-T1).
- [ ] A `step_end`, `drift_detected`, or `design_delta_rejected` event triggers a fresh pass (§4).
- [ ] `Status: BLOCKED_DRIFT` produces `status: blocked_drift` and zero dispatchable candidates (R-T4).
- [ ] Shadowed skills are never dispatchable via the queue (R-T5).
- [ ] `route` never skips past the head (§13).
- [ ] An empty queue is `status: no_work` with `run_complete` journaled, not silently nothing (R10).
- [ ] Every priority override carries a `rationale` and is journaled (R2, R-T12).
- [ ] Reconcile passes do not invoke any model (R8) — verified by inspection of the pass code path.
- [ ] Crash after `step_end` before reconcile still produces the correct next head on boot (R-T11).

---

## 19. Non-goals

- `RECONCILE` does **not** execute skills. That is `route`'s job.
- `RECONCILE` does **not** write to `docs/design/`. Only `design_delta` does.
- `RECONCILE` does **not** rewrite `plan.json`. Plan changes are a `scope`/`architect` capability outcome, emitted via `HANDOFF.md`.
- `RECONCILE` does **not** schedule parallel dispatch. The queue is linear; parallelism is a `route` concern if it is added later.
- `RECONCILE` does **not** decide retry policy. `RESUME.md` §9 remains authoritative; `RECONCILE` only surfaces the retry as a candidate.
- `RECONCILE` does **not** infer new capabilities. Capabilities are declared by the plan or by the override map.

---

## 20. The convergence loop (why this contract closes the architecture)

```
DESIGN.md   → "what should be true"
journal     → "what is true"
RECONCILE   → gap → prioritized queue
route       → dispatch head
skill       → execute
HANDOFF     → delta
DESIGN.md   → updated truth
RESUME.md   → durable record
           └→ next reconcile pass
```

The four contracts compose into a loop. `RECONCILE` is the scheduler that turns passive records into active work. Without it, the other three are a filing cabinet. With it, the orchestrator converges the project toward its design registry on every session — which is the actual requirement behind "the orchestrator controls all sub-agents without me managing them."