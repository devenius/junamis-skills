# RESUME.md — Orchestrator Persistence & Resume Contract

**Status:** normative
**Schema version:** 1
**Companion contracts:** `HANDOFF.md` (step output format), `skills-lock.json` (manifest), `library/*` (internal overrides)

---

## 1. Purpose

Define how the orchestrator persists execution state so that **any new session can resume exactly where the previous one stopped**, without operator intervention.

This contract is **executable**: an orchestrator that implements it MUST be able to be killed at any instruction boundary and, on restart, produce a resume report and continue without duplicating side effects or skipping work.

---

## 2. Core principle

> **The orchestrator MUST NOT "remember". It MUST rehydrate.**

Model context is ephemeral and unreliable. The filesystem is the only durable memory. Every fact needed to resume MUST be derivable from the state root by replay. Nothing that matters MAY live only in a prompt, a conversation, or a sub-agent's memory.

---

## 3. Invariants (MUST rules)

1. **I1 — Single state root.** All persistence lives under `ORCH_STATE_ROOT` (default `.orchestrator/`). Nothing important is written elsewhere.
2. **I2 — Journal is truth.** `journal.ndjson` is the authoritative record. `state.json` is a derived snapshot. If they disagree, replay wins.
3. **I3 — Boot before route.** The `resume` boot sequence (§6) MUST complete before `route` or any skill dispatch. It is not skippable, not conditional, not optimizable away.
4. **I4 — Atomic commits.** Every state transition is one atomic file replace plus one journal append. No partial writes are observable.
5. **I5 — Idempotent or escalated.** A step interrupted mid-flight is retried only if it declares `idempotent: true`; otherwise it escalates to `needs_review`. Never guess.
6. **I6 — No blind resume on drift.** If the manifest hash or the override-map hash differs from the value recorded at plan time, the run enters `needs_review` and MUST NOT continue silently.
7. **I7 — Single writer.** Only the lease holder writes `state.json`, `plan.json`, and `journal.ndjson`. Sub-agents write only under `tasks/<task_id>/`.
8. **I8 — Append-only journal.** Journal entries are never edited or deleted. Compaction (§11) folds them into a checkpoint; it does not mutate them.

---

## 4. State root layout

```
$ORCH_STATE_ROOT/
├── STATE.md                      # generated, human-readable mirror (never read for logic)
├── state.json                    # derived cursor snapshot
├── plan.json                     # task graph
├── journal.ndjson                # append-only event log (SOURCE OF TRUTH)
├── checkpoints/
│   └── <seq-zero-padded>.snapshot
├── tasks/<task_id>/
│   ├── task.json
│   ├── handoffs/*.yaml           # emitted per HANDOFF.md
│   └── artifacts/
├── locks/
│   └── session-<session_id>.json
└── resume-report.md              # regenerated on every boot
```

`ORCH_STATE_ROOT` MUST be a persistent, host-local path. It MUST NOT be inside a temp dir, a container's ephemeral layer, or anything cleared between sessions.

---

## 5. File schemas

### 5.1 `state.json`

```json
{
  "schema_version": 1,
  "run_id": "run-20261109-001",
  "created_at": "2026-11-09T10:00:00Z",
  "updated_at": "2026-11-09T10:42:13Z",
  "cursor": {
    "task_id": "T-003",
    "step_id": "T-003/develop/attempt-2",
    "attempt": 2
  },
  "plan": { "path": "plan.json", "checksum": "sha256:ab12..." },
  "env_fingerprint": {
    "skills_lock_sha256": "sha256:cd34...",
    "library_overrides_sha256": "sha256:ef56...",
    "orchestrator_version": "0.4.1",
    "handoff_schema_version": 1
  },
  "tasks_summary": {
    "pending": 3, "in_progress": 1, "done": 5,
    "failed": 0, "needs_review": 0
  },
  "journal_head": { "seq": 137, "event_hash": "sha256:78ab..." },
  "last_checkpoint": "checkpoints/000120.snapshot"
}
```

### 5.2 `plan.json`

```json
{
  "schema_version": 1,
  "run_id": "run-20261109-001",
  "created_at": "2026-11-09T10:00:00Z",
  "capabilities": ["scope", "architect", "develop", "test", "check", "document"],
  "tasks": [
    {
      "task_id": "T-001",
      "capability": "scope",
      "depends_on": [],
      "resolved_skill": "library/scope",
      "resolution_source": "internal_override",
      "idempotent": true,
      "inputs_hash": "sha256:11aa..."
    }
  ],
  "checksum": "sha256:ab12..."
}
```

`checksum` is computed over the canonicalized `tasks` array. It is re-verified at every boot.

### 5.3 `journal.ndjson` (one JSON object per line)

```json
{"seq":136,"ts":"2026-11-09T10:41:58Z","type":"step_start","task_id":"T-003","step_id":"T-003/develop/attempt-2","attempt":2,"session_id":"s-7f3a","prev_hash":"sha256:..."}
{"seq":137,"ts":"2026-11-09T10:42:13Z","type":"step_end","task_id":"T-003","step_id":"T-003/develop/attempt-2","status":"done","handoff":"tasks/T-003/handoffs/develop-2.yaml","prev_hash":"sha256:..."}
```

**Event types (minimum):**
`run_start`, `run_resume`, `lease_acquired`, `lease_taken_over`, `plan_created`, `step_start`, `step_end`, `task_status`, `drift_detected`, `reconcile_pass`, `queue_blocked`, `queue_stale`, `unknown_reason`, `run_stalled`, `priority_override`, `priority_override_rejected`, `checkpoint_written`, `escalation`, `run_complete`.

**Hash chaining:** each event carries `prev_hash` = hash of the previous event line. This makes truncation and tampering detectable during replay.

### 5.4 `tasks/<task_id>/task.json`

```json
{
  "schema_version": 1,
  "task_id": "T-003",
  "capability": "develop",
  "status": "in_progress",
  "resolved_skill": "library/develop",
  "resolution_source": "internal_override",
  "current_step": {
    "step_id": "T-003/develop/attempt-2",
    "skill": "library/develop",
    "attempt": 2,
    "idempotent": true,
    "started_at": "2026-11-09T10:41:58Z",
    "session_id": "s-7f3a"
  },
  "inputs_hash": "sha256:11aa...",
  "outputs": ["tasks/T-003/artifacts/plan.md"],
  "updated_at": "2026-11-09T10:41:58Z"
}
```

### 5.5 `locks/session-<session_id>.json`

```json
{
  "session_id": "s-7f3a",
  "pid": 4821,
  "host": "dev-box",
  "started_at": "2026-11-09T10:40:02Z",
  "heartbeat_at": "2026-11-09T10:42:10Z",
  "ttl_seconds": 60
}
```

### 5.6 `STATE.md`

Generated on every boot and after every compaction. Contents: run id, current cursor, task summary table, last 10 journal events, drift status. **It is a view, never an input.** The orchestrator MUST NOT parse it for logic.

---

## 6. Boot sequence (executable, non-skippable)

Run these in order at the start of **every** session, before any routing decision.

**B1 — Resolve state root.**
Read `ORCH_STATE_ROOT`. If absent, initialize a new run (§6a) and jump to B7.

**B2 — Acquire lease.**
- Scan `locks/`. For each lease, compute `now - heartbeat_at`.
- If a lease is within `ttl_seconds`: **abort** with `HALT: lease_held` and the owning session id. Do not proceed.
- If all leases are stale: acquire the newest one (reuse `session_id` slot), journal `lease_taken_over`, continue.
- If no lease exists: create `locks/session-<new>.json`, journal `lease_acquired`.
- Start the heartbeat writer (every `ttl/3`).

**B3 — Load and verify.**
- Parse `state.json`, `plan.json`.
- Assert `schema_version` matches the running orchestrator's supported version.
- Recompute `plan.checksum` and compare.
- Verify `journal.ndjson` hash chain from the last checkpoint forward.
- **On any failure:** attempt recovery by replaying from `last_checkpoint` (§11). If replay also fails, `HALT: corrupt_state`.

**B4 — Reconcile environment (drift check).**
- Compute `skills_lock_sha256` from `skills-lock.json`.
- Compute `library_overrides_sha256` from the resolved override map in `library/*`.
- Compute `design_registry` (`index_sha256`, `surface_count`, `status_counts`) from `docs/design/`, covering `INDEX.md` and every surface file.
- Compare all three against `state.env_fingerprint`.
- **On a missing recorded design fingerprint:** journal `design_baseline` and record the current value once. Do not block a run that predates the field.
- **On mismatch:** journal `drift_detected` with the diff, set run status to `needs_review`, write `resume-report.md` (status = `BLOCKED_DRIFT`), and **stop**. Do not dispatch any skill. Emit the exact diff, including the changed design files, so the operator (or a review skill) can decide.

**B5 — Reconcile in-flight work.**
For every task with `status == "in_progress"`:
- Read `current_step`.
- If `idempotent == true`: mark for **retry** (reset to `pending`, keep `attempt` counter, increment on next start).
- If `idempotent == false`: mark `needs_review`, journal `escalation` with reason `interrupted_non_idempotent`.
- Journal one `task_status` event per reconciled task.

**B6 — Load external handoffs.**
For each `tasks/<id>/handoffs/*.yaml`, validate against `HANDOFF.md`. Reject malformed handoffs into `needs_review`; do not silently drop them.

**B7 — Emit `resume-report.md`** (§12).

**B7.5 — RECONCILE pass.**
- If resume Status is `BLOCKED_DRIFT` or `HALT_CORRUPT`: write `$ORCH_STATE_ROOT/work-queue.json` with `status: blocked_drift` and one non-dispatchable `needs_review` item carrying the drift diff. Do not run detectors. Journal `reconcile_pass`.
- Otherwise run the RECONCILE pass: read `$ORCH_STATE_ROOT/reconcile/detectors.yaml`, run the enabled detectors, and write `work-queue.json` plus `reconcile-report.md`. Journal `reconcile_pass`, including an empty queue.
- Set `state.reconcile` to `ready` or `no_work` (or `blocked_drift`). Do not rewrite `plan.json`.

**B8 — Hand control to `route`.**
Pass `$ORCH_STATE_ROOT/work-queue.json` (not raw signals) as starting context. Set `state.cursor` to the first task in the order: `pending`/`in_progress` (retryable) tasks in `plan.json` dependency order.

### 6a. First-run initialization

When `ORCH_STATE_ROOT` is empty:
1. `mkdir -p` the full tree.
2. Write `plan.json` (from the task graph produced by `scope`/`architect`).
3. Write initial `state.json` with `cursor = null`, `journal_head.seq = 0`.
4. Append `run_start` and `plan_created` to `journal.ndjson`.
5. Continue to B7.

---

## 7. Task state machine

```
pending ──► in_progress ──► done
   │              │
   │              ├──► failed ──► (retry policy) ──► in_progress
   │              │
   │              └──► needs_review ──► pending (after resolution)
   │
   └──► (blocked by depends_on)
```

Rules:
- Only the orchestrator transitions `pending → in_progress`.
- Only the skill's emitted handoff (validated against `HANDOFF.md`) transitions `in_progress → done | failed`.
- `needs_review` is terminal until an explicit resolution event is journaled.
- A task MAY NOT be marked `done` without at least one validated handoff and its declared artifacts present on disk.

---

## 8. Atomic write protocol

Every mutation of `state.json`, `plan.json`, or any `task.json` MUST follow:

```
1. write  <path>.tmp
2. fsync  <path>.tmp
3. rename <path>.tmp -> <path>
4. fsync  <parent dir>
```

Journal appends MUST be: `open(O_APPEND) → write(one complete line) → fsync`. Never split an event across writes. A trailing partial line on boot is truncated to the last valid newline and logged as `journal_truncated`.

**Commit pairing:** a state transition is only durable once *both* the journal event and the snapshot write succeed. Order: journal first, then snapshot. If the snapshot fails, replay from the journal on next boot will reconstruct it.

---

## 9. Idempotency & crash semantics

Every skill MUST declare `idempotent: true | false` in its frontmatter.

| Crash point | `idempotent: true` | `idempotent: false` |
|---|---|---|
| Before `step_start` journaled | retry, attempt unchanged | retry, attempt unchanged |
| After `step_start`, before side effect | retry, attempt + 1 | retry, attempt + 1 |
| After side effect, before `step_end` | retry, attempt + 1 | **escalate → needs_review** |
| After `step_end` journaled | already done, skip | already done, skip |

The orchestrator MUST record `step_start` **before** invoking the skill, and `step_end` **after** the handoff validates. A step with `step_start` and no `step_end` is the sole signal that the side-effect state is unknown.

---

## 10. Lease & concurrency

- Lease TTL default: **60s**; heartbeat every **20s**.
- Heartbeat write uses the same atomic replace protocol.
- A session that loses its lease file (deleted or overwritten by another `session_id`) MUST abort at the next step boundary and journal `lease_lost`.
- Sub-agents MUST NOT acquire leases or write outside `tasks/<their_task_id>/`. If a sub-agent needs to persist across sessions, it does so through its own handoff + artifacts, and the orchestrator folds them in.

---

## 11. Compaction

Trigger: every **N = 200** journal events, or when `journal.ndjson` exceeds 5 MB, whichever comes first.

Procedure:
1. Replay journal to current seq, build full in-memory state.
2. Write `checkpoints/<seq>.snapshot` atomically (serialized `state.json` + per-task `task.json` + `plan.json`).
3. Journal `checkpoint_written` with `{seq, path, hash}`.
4. Truncate `journal.ndjson` to entries after `seq`, preserving the hash chain head (`prev_hash` of the first retained event points at the checkpoint hash).

Recovery from a snapshot: load `checkpoints/<last>.snapshot`, then replay retained journal entries forward, verifying `prev_hash` at each step.

---

## 12. `resume-report.md` format

Generated at B7 and overwritten on every boot. Minimum content:

```markdown
# Resume Report

- Run: run-20261109-001
- Generated: 2026-11-09T10:42:20Z
- Session: s-7f3a
- Status: RESUMING | BLOCKED_DRIFT | HALT_CORRUPT | NEW_RUN

## Cursor
- Task: T-003 (develop) — in_progress, attempt 2
- Next action: retry (idempotent)

## Tasks
| id | capability | status | attempts | resolved skill | source |
|----|-----------|--------|----------|----------------|--------|
| T-001 | scope | done | 1 | library/scope | internal |
| T-002 | architect | done | 1 | library/architect | internal |
| T-003 | develop | in_progress | 2 | library/develop | internal |

## Reconciliation
- Interrupted tasks reconciled: 1 (T-003 → retry)
- Escalated to needs_review: 0
- Malformed handoffs: 0

## Environment fingerprint
- skills-lock.json: sha256:cd34… (matches recorded)
- library overrides: sha256:ef56… (matches recorded)

## Recent events
(last 10 journal entries, one per line)
```

If `Status: BLOCKED_DRIFT`, the report MUST include a `## Drift` section listing exactly which files changed and the old/new hashes, so a review skill can act on it without re-deriving the diff.

---

## 13. Drift handling

| Drift | Action |
|---|---|
| `skills-lock.json` changed | `needs_review`; diff added skills / removed skills / version bumps |
| `library/*` override set changed | `needs_review`; diff added / removed / re-targeted overrides |
| Both unchanged | proceed normally |
| `plan.json` checksum mismatch | `HALT: corrupt_state` unless a journal event explains the change |

Rationale: resuming a plan built against an older override set is how the orchestrator ends up dispatching a shadowed external skill. Treat drift as a correctness event, not a warning.

---

## 14. Integration with `route` and `HANDOFF.md`

- `route` receives the resume report and MUST start from `state.cursor`, not from a fresh signal scan, when `Status: RESUMING`.
- Routing resolves **capability → skill** using the recorded `resolution_source` (`internal_override` | `manifest`). It MUST NOT re-resolve on resume if the fingerprint matches, because the resolution is part of the plan's checksum.
- Every dispatched skill MUST produce a handoff conforming to `HANDOFF.md`. Handoffs that fail validation are moved to `needs_review` and journaled; they are never silently discarded.
- The orchestrator folds validated handoffs into `task.json` and the journal. Sub-agents never touch `state.json`.

---

## 15. CI tests

**T1 — Crash injection.**
For each step boundary in a reference run: kill the process, restart, assert the resume report and final artifacts are identical to the uninterrupted run.

**T2 — Replay determinism.**
Replay `journal.ndjson` from an empty state and assert the reconstructed `state.json` is semantically equal to the snapshot.

**T3 — Drift refusal.**
Mutate `skills-lock.json` (add a skill), restart, assert `Status: BLOCKED_DRIFT` and that zero skills were dispatched.

**T4 — Override drift.**
Mutate `library/*` (re-target an override), restart, assert `BLOCKED_DRIFT` with a correct diff.

**T5 — Lease safety.**
Start two sessions against one state root; assert the second halts with `lease_held` and does not write.

**T6 — Non-idempotent escalation.**
Simulate a kill after side effect but before `step_end` on a `idempotent: false` skill; assert `needs_review`, not retry.

**T7 — Torn write recovery.**
Truncate `state.json` to half a JSON object and append a partial journal line; assert boot recovers from the last checkpoint and reports `journal_truncated`.

---

## 16. Acceptance criteria

The implementation is complete when **all** of the following hold:

- [ ] B1–B8 run before any routing on every session, with no bypass flag.
- [ ] Killing the orchestrator at any step boundary never loses progress and never duplicates a non-idempotent side effect.
- [ ] `journal.ndjson` replay reconstructs `state.json` exactly (T2 green).
- [ ] Manifest or override drift produces `BLOCKED_DRIFT` and zero dispatches (T3, T4 green).
- [ ] A second concurrent session cannot write to the state root (T5 green).
- [ ] `resume-report.md` is sufficient, on its own, for a fresh reader to know exactly what happens next.
- [ ] `STATE.md` is regenerated on every boot and never read as input.
- [ ] Every skill declares `idempotent`, and the orchestrator honors it per §9.

---

## 17. Non-goals

- This contract does **not** persist model context, prompt history, or reasoning traces. Only execution state.
- This contract does **not** define sandboxing, filesystem isolation, or process confinement. It assumes a trusted host-local state root.
- This contract does **not** replace `HANDOFF.md`; it consumes it.
- This contract does **not** define the override precedence algorithm itself — only that its hash is fingerprinted and drift-checked.

---

## Reference implementation (not normative)

This section names the reference implementation. It is not part of the normative contract above.

- State engine: `src/orchestrator/`.
- CLI source entry: `scripts/orchestrator-state.mjs`.
- Installed command: `junamis-orchestrator`.
- Default state root: `<project>/.orchestrator/`; `ORCH_STATE_ROOT` overrides it.
- Commands: `boot`, `plan set`, `plan show`, `start`, `end`, `resolve`, `status`, `checkpoint`, `lease acquire|heartbeat|release|status`, and `finish`.
- Exit codes: `0` success, `1` usage or I/O, `2` lease held or lost, `3` drift, `4` corrupt state, and `5` invalid transition or handoff.

