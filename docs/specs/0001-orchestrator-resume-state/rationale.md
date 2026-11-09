# Rationale for 0001. Orchestrator persistence and resume

## Context

The orchestrator currently keeps its working memory in the conversation and in `.junamis/handoff.md`. That file is a short human handoff, not an execution log. A new session can read the goal and the next step, but it cannot prove which step started, which step finished, which artifacts exist, or whether a skill was interrupted after its side effect. The result is the failure mode the contract names: a session either redoes work or skips work it cannot see.

The normative contract at `.junamis/RESUME-contract.md` makes the filesystem the only durable memory and requires a new session to rehydrate every fact from a state root. It sets eight invariants: one state root, the journal is truth, boot before route, atomic commits, idempotent or escalated, no blind resume on drift, a single writer, and an append only journal. It then defines the file schemas, the boot sequence, the task state machine, the write protocol, the lease, compaction, the resume report, drift handling, and seven CI tests. Section 16 is the acceptance test. This spec turns that contract into a buildable feature for this repository.

The repository adds its own forces. It is an ESM package on Node 26 with a strict no new dependency rule. It ships an installer that copies the library into a global config root, so the contract and the state engine must be installable too. It has an existing test runner with no external harness, a single `pnpm test` gate, and a changelog rule. Its orchestrator is a prompt, not a long running process, so the state engine has to be a command line tool that an agent can call at step boundaries. Its skills are prose with frontmatter, so the only durable place to declare retry safety is that frontmatter.

> Premise note: The contract says the first boot writes `plan.json` from the task graph produced by `scope` or `architect`, but it also says boot must run before `route`. On a first run the task graph does not exist yet. This spec resolves the ordering tension with a one task bootstrap plan that is replaced after the first skill produces the full graph. Every dispatch still has a task, a start event, and an end event. The contract's goal, boot before any routing, is preserved.

> Premise note: The contract says every skill declares `idempotent`. External skills are upstream content and this project does not edit them. This spec records the value in the `route-external` adapter and treats a missing external value as `false`. The library test enforces the field on every library skill, which is the set this project owns.

If this decision is not made, the orchestrator keeps resuming from prose. A crash after a file edit can be retried into a duplicate migration or a second release note. A manifest change can silently dispatch an external skill that the plan never resolved. Two sessions can write the same handoff file at once. The cost is not theoretical; it is the exact class of error the contract was written to stop.

## Options considered

### Option 1: Snapshot only JSON state

Keep one `state.json` and one `task.json` per task, write them atomically, and treat the latest snapshot as the truth. Boot reads the snapshot and continues.

**Pros**:
- The smallest implementation. One file format, one write path, no replay engine.
- Easy to inspect and easy to edit by hand during an incident.
- No compaction, no hash chain, and no journal truncation path.

**Cons**:
- A crash between the side effect and the snapshot write loses the fact that the step started. The next session cannot tell an interrupted step from a step that never ran.
- No audit trail, so tampering and truncation are invisible.
- The contract's replay test and its journal is truth invariant cannot be met.
- Hand editing becomes the recovery mechanism, which is exactly the kind of guess the contract forbids.

### Option 2: Journal first state engine with a derived snapshot and a small CLI

Append every event to `journal.ndjson` with a hash chain. Derive `state.json`, `plan.json`, and each `task.json` from replay plus checkpoints. Expose the engine as a small command line tool so the orchestrator can call it at every step boundary.

**Pros**:
- A crash is recoverable from the journal. A torn snapshot is a cache miss, not a lost run.
- The hash chain makes truncation and tampering detectable, and the event log is a real audit trail.
- The CLI gives the prompt a stable contract: commands, exit codes, and a report path. It is testable without a live agent.
- It matches every invariant in the contract and maps one to one to T1 to T7.
- It needs no database and no new dependency. JSON and NDJSON are inspectable with the tools the repository already has.

**Cons**:
- More moving parts than a snapshot: append, replay, hash chain, checkpoint, truncation, and recovery.
- Compaction has to be designed carefully, because truncation is the one place where an append only journal is rewritten.
- The journal grows until compaction, and a long run produces many events.
- The CLI is another surface to keep compatible with the prompt and the tests.

### Option 3: Embedded database state store

Put runs, tasks, and events in a local SQLite database, with transactions and indexes. Boot queries the current state.

**Pros**:
- Transactions and constraints give strong guarantees with little application code.
- Queries for task summaries, cursors, and recent events are simple.
- A single file is easy to back up, and the database engine handles crash recovery.

**Cons**:
- It adds a runtime dependency or a native module, which the repository's no new dependency rule forbids.
- The contract says the filesystem is the memory and describes JSON and NDJSON files. A binary database breaks the inspectability the contract assumes.
- The orchestrator's subagents and tests would need a database client, widening the surface well beyond the problem.
- The operational cost is higher for a single host local state root that one session writes at a time.

## Rationale

Option 2 is the only option that satisfies the contract without breaking a repository constraint. The contract's core claim is that a session can be killed at any instruction boundary and resume without duplicating or skipping work. A snapshot cannot prove that claim, because the snapshot write is the very thing a crash interrupts. A journal can, because the event that says a step started is durable before the side effect and the event that says it ended is durable after the handoff validates. The snapshot then becomes a speed cache that replay can always rebuild. That is the right shape for an agent that runs as a sequence of short command line calls.

The command line interface is not decoration. The orchestrator is a language model with a file tool and a shell tool. It cannot hold a long lived writer, and it cannot be trusted to remember a state transition between two messages. A command boundary gives it a deterministic action, a fixed exit code, and a report it can read. It also gives the test suite a way to inject a crash at a known point and to assert the exact result. The alternative, a library the prompt imports in its head, has no crash point and no exit code.

The hash scope is deliberately narrow. `library_overrides_sha256` covers the two files that define resolution: every `skills/<name>/SKILL.md` and every `agents/<name>.md`. Hashing every nested file would turn a typo in a reference document into a drift block. Hashing nothing would let a skill's description or workflow change under a plan that already resolved it. The chosen set is the smallest set that changes capability to skill resolution. `skills_lock_sha256` is the raw manifest hash, because the manifest is the external resolution map and its bytes are the honest record. The plan checksum and the task inputs hash cover the rest of the plan's identity.

The idempotency values follow one rule: a retry is safe only when the skill converges to the same end state without a second side effect. Read only skills and single file overwrites are true. Code writers, migration writers, release work, rollback, incident mitigation, and numbered record writers are false. The risky calls are called out in the spec. `decision-record` is false because its next number depends on what is already on disk. `release-prep` is false because a version bump and release notes are a two file transaction. `route-external` is true only because it writes one adapter by overwrite, and the spec says to flip it if that changes. This is conservative on purpose. A false value costs a review pause. A wrong true value costs a duplicated side effect, which is the failure the whole contract exists to prevent.

The state root guard is a small but load bearing choice. A temp directory is cleared between sessions, so a state root there would look correct in one session and vanish in the next. The engine resolves the deepest existing ancestor with `realpath` and rejects a temp location before it writes anything. Tests need a temporary root, so they set `ORCH_TEST_ALLOW_TMP=1`. Production has no bypass flag. The same reasoning drives the `0700` and `0600` modes and the handoff path containment: the state root is trusted, but it is still a file tree that an agent writes, so it should be owner only and it should not be able to point a write outside the project.

The bootstrap plan is the one place this spec interprets the contract. Boot must run before route, but the task graph is produced by the first routed skill. Waiting for the graph would violate boot before route. Dispatching without a task would violate the start and end discipline. A one task plan for the first skill, later replaced by the full graph, keeps both rules. The engine's `plan set --replace` preserves every done task's identity, so the replacement cannot rewrite history.

The lease TTL is a visible tradeoff rather than a hidden one. A 60 second base TTL detects a dead idle session quickly. A step can legitimately run longer than 60 seconds, so `start` extends the lease to a step TTL of 900 seconds and `end` resets it. A second session cannot take over mid step, and a crashed step waits up to the step TTL before another session takes over. Both values are configurable, and the spec names them so the operator can tune the recovery delay against the risk of a false takeover.

Finally, the handoff parser is custom because the alternative is worse. Moving `js-yaml` from a dev dependency to a runtime dependency would break the no new dependency rule and widen the install footprint for one small block. The documented handoff block is a constrained subset: scalars, one list of artifact objects, one list of finding objects, and one list of decision questions. A strict parser for that subset is smaller than the dependency, rejects anchors and multi document input, and fails closed into `needs_review`. The validator is part of the correctness boundary, not a convenience.
