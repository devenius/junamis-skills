# 0001. Orchestrator persistence and resume

**Date**: 2026-11-09
**Status**: Accepted
**Shape**: Directory spec (`index.md` plus `rationale.md`). This is a foundational decision with a build spec and a separate decision record.

## Summary

Make the orchestrator resumable. Every session starts by rehydrating execution state from disk, not from model memory. A small Node state engine under `src/orchestrator/` keeps an append only journal, derives a snapshot from it, holds a single writer lease, checks the manifest and library fingerprints, and writes a resume report that the orchestrator hands to `route`. Every library skill declares whether a retry is safe with `idempotent: true | false`, and the engine escalates an interrupted step that is not idempotent instead of guessing. The contract's section 16 acceptance criteria are the requirements, and the tests T1 to T7 prove them.

## Requirements

**User stories**:
- As an operator, I want a fresh session to resume exactly where the last one stopped, so I do not repeat work or re explain the task.
- As the orchestrator, I want a durable cursor and a resume report on disk, so I route from state instead of memory.
- As a skill author, I want one clear `idempotent` field in frontmatter, so the engine knows whether a retry is safe.
- As a maintainer, I want crash, replay, drift, and lease behavior proven by tests, so a library or manifest change cannot silently dispatch the wrong skill.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: Every orchestrator session runs `boot` before `route` or any skill dispatch, with no bypass flag. `boot` exits 0 only for `NEW_RUN`, `RESUMING`, or `COMPLETE`; it exits 2 for `lease_held`, 3 for `BLOCKED_DRIFT`, and 4 for `HALT_CORRUPT`. On a non zero exit the orchestrator stops, reports the report path or the halt line, and dispatches nothing.
- **AC-2**: Killing the engine at any step boundary loses no completed step and never duplicates a side effect of a task declared `idempotent: false`. A crash after `step_start` and before `step_end` retries a true task with `attempt + 1`; it marks a false task `needs_review` and does not retry it.
- **AC-3**: Replaying `journal.ndjson` into an empty state reconstructs `plan.json`, `state.json`, and every `tasks/<task_id>/task.json` with the same logical content as the snapshot from the uninterrupted run (timestamps, session ids, run ids, and event hashes excluded).
- **AC-4**: Adding a skill to `skills-lock.json` and booting produces `Status: BLOCKED_DRIFT`, exit 3, a `## Drift` section naming the old and new `skills_lock_sha256`, and zero new `step_start` events.
- **AC-5**: Changing a file covered by `library_overrides_sha256` and booting produces `Status: BLOCKED_DRIFT`, exit 3, a `## Drift` section naming the changed path with old and new hashes, and zero new `step_start` events.
- **AC-6**: A second session booting against a state root with a live lease exits 2 with `HALT: lease_held` and the owner session id, writes no state, plan, task, or journal file, and leaves the first lease intact. A stale lease is taken over and journals `lease_taken_over`.
- **AC-7**: `resume-report.md` alone states the run, status, cursor task and step, next action, a task table with attempts, resolved skill, source, and owner, the reconciliation counts, the environment fingerprint match, the last 10 events, and on drift the exact changed paths. A fresh reader can tell what runs next without reading `state.json` or the journal.
- **AC-8**: `STATE.md` is regenerated on every boot and after every checkpoint, and the engine never reads it as input. Corrupting `STATE.md` does not change the boot result.
- **AC-9**: Every `library/skills/*/SKILL.md` declares `idempotent: true` or `idempotent: false`. The engine records the value in the plan, rechecks it for an internal skill at `start`, and honors it on boot and `end`. A missing value fails `pnpm test` and fails `plan set` for an internal skill. An external skill that does not declare it is recorded as `false`.
- **AC-10**: With `state.json` truncated mid object and a partial final journal line, boot recovers from the last checkpoint plus the retained journal, truncates the partial line, appends `journal_truncated`, writes a valid `state.json`, and reports the truncation. With no checkpoint, it replays from sequence 0.
- **AC-11**: Every mutation of `state.json`, `plan.json`, and `task.json` uses a temporary file, fsync, rename, and parent directory fsync. Every journal append is one complete line, opened append only, and fsynced. The journal event is durable before the snapshot write.
- **AC-12**: All persistence lives under one state root. The default is `<project>/.orchestrator/`. The root is not inside the operating system temp directory, is not the filesystem root, and is created with owner only permissions. `.orchestrator/` is in `.gitignore`.
- **AC-13**: The state engine uses only Node 26 built in modules and adds no runtime dependency. The source entry is `scripts/orchestrator-state.mjs` with the commands, arguments, exit codes, and stdout contract in this spec. `package.json` exposes it as `junamis-orchestrator`.
- **AC-14**: On `Status: RESUMING`, `route` starts from the cursor task and the recorded `resolved_skill`, `resolution_source`, and `owner`. It does not rescan the user request or resolve capability to skill again when the fingerprint matches. On `NEW_RUN` it classifies normally.

## Decision

**Chosen option**: Option 2: journal first state engine with a derived snapshot and a small command line interface.

Build a state engine under `src/orchestrator/`, expose it through `scripts/orchestrator-state.mjs` and the `junamis-orchestrator` bin, and make boot a mandatory first step of the orchestrator. The normative contract is `library/RESUME.md`. Every skill declares `idempotent`, and the engine refuses to guess after an interrupted step. This is first party Node code with no community skill dependency and no new package.

### 1. Contract placement

`library/RESUME.md` becomes the normative contract. Copy `.junamis/RESUME-contract.md` into it, set `Status: normative` and `Schema version: 1`, and keep the existing headings so the acceptance criteria map one to one.

It references these existing documents, and takes only the named concern from each:

| Document | What `RESUME.md` takes from it |
|---|---|
| `library/HANDOFF.md` | The step output block, the status values, the artifact rule, and handoff schema version 1. |
| `library/SAFETY.md` | The approval gate. The state engine never runs a gated command and never bypasses the gate. |
| `library/EXTERNAL.md` | The external skill list, the `route-external` adapter rule, and the `manifest` resolution source. |
| `AGENTS.md` | The orchestrator is the only entry point, and no skill or specialist is dispatched directly. |
| `SECURITY.md` | The pin record behind `skills-lock.json`, which the fingerprint covers. |
| `library/agents/orchestrator.md` | The dispatch loop that now starts with boot. |
| `library/skills/route/SKILL.md` | The path table that now accepts the resume report and the cursor. |

Add a final section to `library/RESUME.md` titled `## Reference implementation (not normative)`. It names the state engine path, the CLI, the default state root, and the command list. The normative body stays implementation neutral.

Add `RESUME.md` to `SHARED_DOCS` in `src/library-install.js`, so `init` installs it at `~/.config/junamis/skills/RESUME.md` next to `HANDOFF.md`, `SAFETY.md`, `EXTERNAL.md`, and `SECURITY.md`. `.junamis/RESUME-contract.md` stays the untracked input and is never the shipped source of truth.

### 2. State engine location and module layout

Use `src/orchestrator/` with small ESM modules. No new dependency. `js-yaml` stays a dev dependency for `scripts/check-yaml.js` only. The handoff validator is a small strict parser, because a runtime YAML dependency would break the no new dependency rule.

| Module | Responsibility |
|---|---|
| `src/orchestrator/fsx.js` | Atomic file write (temp, fsync, rename, directory fsync), single line append, JSON read with repair, tree creation, path containment. |
| `src/orchestrator/hash.js` | SHA 256 helpers, canonical JSON, event hash, checkpoint checksum, plan checksum, inputs hash. |
| `src/orchestrator/time.js` | Clock injection and ISO 8601 UTC timestamps. |
| `src/orchestrator/journal.js` | Append, read, hash chain verification, partial tail truncation, replay. |
| `src/orchestrator/state.js` | Derive and write `state.json`, rebuild `task.json`, task summary, cursor selection. |
| `src/orchestrator/plan.js` | Plan validation, dependency order, idempotency check, initial set and explicit replace. |
| `src/orchestrator/lease.js` | Acquire, heartbeat, release, status, TTL, stale takeover. |
| `src/orchestrator/drift.js` | Compute fingerprints, compare to the recorded values, produce the drift diff. |
| `src/orchestrator/compaction.js` | Checkpoint snapshot, journal truncation, recovery from the last checkpoint. |
| `src/orchestrator/report.js` | Write `resume-report.md` and `STATE.md`. |
| `src/orchestrator/boot.js` | Run B1 to B8 in order. |
| `src/orchestrator/handoff.js` | Strict HANDOFF block parser and artifact existence check. |
| `src/orchestrator/commands.js` | Implement each command against the modules above. |
| `src/orchestrator/cli.js` | Parse arguments, dispatch, map errors to exit codes, render stdout. |
| `src/orchestrator/errors.js` | Typed errors and the exit code table. |
| `src/orchestrator/test-hooks.js` | Crash injection, active only when `ORCH_TEST_MODE=1`. |
| `scripts/orchestrator-state.mjs` | Thin entry with `#!/usr/bin/env node` that imports `run` from `src/orchestrator/cli.js`. |
| `package.json` bin | `"junamis-orchestrator": "scripts/orchestrator-state.mjs"`, and `scripts/orchestrator-state.mjs` added to `files`. |

The installed command is `junamis-orchestrator`. The source entry in a package checkout is `node scripts/orchestrator-state.mjs`. Both call the same `run` function. The orchestrator prompt names `junamis-orchestrator`; the tests call the source entry so they do not depend on a global bin.

### 3. CLI contract

Common options, accepted by every command:

| Option | Meaning | Default |
|---|---|---|
| `--project <dir>` | Project root, used to resolve `library/`, `skills-lock.json`, and the default state root. | `ORCH_PROJECT_ROOT`, else `process.cwd()` |
| `--state-root <dir>` | State root. Relative paths resolve against `--project`; a leading `~` expands to the home directory. | `ORCH_STATE_ROOT`, else `<project>/.orchestrator` |
| `--session <id>` | Session id. Must match `^s-[A-Za-z0-9._-]+$`. | `ORCH_SESSION_ID`, else `s-` plus 8 hex characters |
| `--library-root <dir>` | Directory that contains `skills/` and `agents/`. | `ORCH_LIBRARY_ROOT`, else `<project>/library`, else the installed config root |
| `--manifest <path>` | `skills-lock.json` path. | `ORCH_MANIFEST`, else `<project>/skills-lock.json`, else `<config-root>/skills-lock.json` |
| `--json` | Emit exactly one JSON object on stdout and nothing else. | off |
| `--quiet` | Suppress human lines. | off |
| `--help` | Print usage. | |

Commands:

| Command | Arguments | What it does | Exit codes |
|---|---|---|---|
| `boot` | common | Resolve the root, acquire the lease, load and verify, check drift, reconcile in flight work, validate handoffs, write `resume-report.md` and `STATE.md`. | 0 `NEW_RUN` or `RESUMING` or `COMPLETE`; 2 `lease_held`; 3 drift; 4 corrupt; 1 usage or I/O error |
| `plan set` | `--file <plan.json>`, optional `--replace` | Validate a plan, compute its checksum and each `inputs_hash`, verify the current fingerprints, record it, and journal `plan_updated` (the first boot journals `plan_created` for the empty plan). Initial set is allowed only when the current plan has zero tasks. `--replace` preserves every task whose status is `done` and rejects an identity change for it. For an internal skill, the plan's `idempotent` must match the skill frontmatter. | 0; 1 invalid plan; 2 lease; 3 drift; 5 identity change or idempotency mismatch |
| `plan show` | common | Print the plan and checksum. Read only. | 0; 4 corrupt |
| `start` | `--task <task_id>` | Verify dependencies, recheck the internal skill's `idempotent`, increment `attempt`, set the task `in_progress`, write `task.json`, journal `step_start`. Returns the derived `step_id`. A frontmatter mismatch journals `drift_detected` and writes a `BLOCKED_DRIFT` report. | 0; 2 lease lost; 3 drift; 4 corrupt; 5 invalid transition |
| `end` | `--task <task_id> --step <step_id> --handoff <path>` for a valid handoff, or `--task <task_id> --step <step_id> --status failed --reason <text>` when a handoff is missing | With a handoff: parse it, check every artifact exists, journal `step_end`, fold outputs into `task.json`, and set `done` or `failed`. A `needs-decision` handoff journals `step_end`, then an `escalation` with `reason: user_decision`, and sets `needs_review` with the questions. Without a handoff, `--status failed` records the failure and a reason. | 0 when the step is recorded; 2 lease; 3 drift; 4 corrupt; 5 invalid handoff or invalid transition |
| `resolve` | `--task <task_id> --decision <text>` | Journal a `resolution` event, clear `needs_review`, set the task `pending`, and record the user's answer in `task.json`. | 0; 2 lease; 5 task is not `needs_review` |
| `status` | common | Read only snapshot of the run, cursor, task table, lease, drift, last checkpoint, journal head, and report path. | 0; 4 corrupt |
| `checkpoint` | common | Replay to the current sequence, write `checkpoints/<seq>.snapshot`, journal `checkpoint_written`, truncate the journal to the retained tail, regenerate `STATE.md`. | 0; 2 lease; 4 corrupt |
| `lease acquire` | common | Acquire, reclaim a dead same session lease, or take over a stale lease. | 0; 2 live lease held |
| `lease heartbeat` | common | Renew `heartbeat_at` and extend by the current TTL. | 0; 2 lease lost |
| `lease release` | common | Remove the caller's lease file and journal `lease_released`. | 0; 2 not the owner |
| `lease status` | common | Print every lease with its owner, heartbeat, TTL, and live or stale state. Read only. | 0 |
| `finish` | common | Require every task `done` (an empty task set is allowed), journal `run_complete`, write a `COMPLETE` report, regenerate `STATE.md`, release the lease. | 0; 2 lease; 5 tasks not done |

Exit codes are fixed: `0` success, `1` usage or unexpected I/O, `2` lease held or lost, `3` drift, `4` corrupt state, `5` invalid transition or invalid handoff. A halt never prints a stack trace.

`--handoff` resolves against the state root and must stay inside it. The orchestrator writes the returned block to `tasks/<task_id>/handoffs/<skill>-<attempt>.yaml` and passes that relative path. Artifact paths inside the handoff are project relative and must stay inside the project root. `status` is read only; it reports `drift: none` or `drift: detected` and exits 0 in both cases, and exits 4 only when the state cannot be read.

Every writing command renews the lease heartbeat. `start` sets `ttl_seconds` to `ORCH_STEP_TTL_SECONDS` (default 900) so a long skill cannot be taken over in the middle of a step. `checkpoint` and `lease heartbeat` keep the current TTL. `boot` and `end` reset it to `ORCH_LEASE_TTL_SECONDS` (default 60) when no step is active. A writing command that finds its lease missing or owned by another session journals `lease_lost` and exits 2.

The engine also checkpoints automatically when the journal reaches 200 events since the last checkpoint or 5 MB, whichever comes first. `checkpoint` can be called explicitly at any time.

All snapshot, report, `STATE.md`, lease, and checkpoint writes use the same temporary file, fsync, rename, and directory fsync protocol. Journal truncation writes a replacement file the same way. On a platform that rejects a directory fsync, ignore only `EPERM` and `EINVAL` for the directory handle; never ignore a file fsync.

Stdout contract:

- Human mode is one `key: value` per line. Keys are stable. `boot` ends with `status: <STATUS>` and `report: <absolute path>`. `start` prints `task`, `step`, `attempt`, `idempotent`, and `status: started`. `end` prints `task`, `step`, `status`, `handoff`, and `next`. Errors go to stderr as `error: <reason>: <detail>`. A halt prints `halt: <reason>` and, when a report was written, `report: <path>`.
- `--json` emits one object with these keys: `ok`, `command`, `status`, `exitCode`, `runId`, `sessionId`, `projectRoot`, `stateRoot`, `reportPath`, `cursor`, `tasksSummary`, `drift`, `lease`, `error`. No other stdout is written.
- The engine never prints journal contents, handoff contents, or artifact contents. It prints counts and paths only.

Boot sequence, exactly B1 to B8:

1. **B1 resolve.** Resolve the project root, library root, manifest path, and state root. Reject a state root inside the operating system temp directory (unless `ORCH_TEST_ALLOW_TMP=1`), the filesystem root, or a path whose real location escapes to one of those. If `journal.ndjson` does not exist and no state files exist, initialize a new run with an empty plan, write `<state-root>/.gitignore` containing `*`, and journal `run_start` and `plan_created`. If the journal exists, it is an existing run; go to B3 even when `state.json` is missing.
2. **B2 lease.** Acquire the lease. If a live lease belongs to a different session, print `HALT: lease_held` and exit 2 without writing anything. If the only live lease has the same session id, the same host, and a pid that is not alive, reclaim it and journal `lease_reacquired`; this is the restart path after a crash. If the pid is alive or the host differs, halt. If a stale lease exists, take it over and journal `lease_taken_over`. If none exists, create it and journal `lease_acquired`.
3. **B3 load and verify.** Parse `state.json` and `plan.json` when present. Check `schema_version`, the plan checksum, and the journal hash chain from the last checkpoint. A plan checksum mismatch is repaired by replay when a `plan_updated` event explains it; otherwise it is `HALT_CORRUPT`. On a missing or torn snapshot, reconstruct from the checkpoint and retained journal. If reconstruction fails, write a best effort `HALT_CORRUPT` report and exit 4.
4. **B4 drift.** Compute `skills_lock_sha256` and `library_overrides_sha256`. Compare them with `state.env_fingerprint`. On a mismatch, journal `drift_detected` with the diff, set the run to `needs_review`, write a `BLOCKED_DRIFT` report with a `## Drift` section, regenerate `STATE.md`, release the lease, and exit 3. Dispatch nothing.
5. **B5 reconcile.** For every task `in_progress`, read `current_step.idempotent`. A true task resets to `pending` with the attempt kept and incremented on the next start, and journals `task_status`. A false task becomes `needs_review` and journals `escalation` with `reason: interrupted_non_idempotent`.
6. **B6 handoffs.** Parse every `tasks/<task_id>/handoffs/*.yaml`. A malformed handoff sets its task `needs_review`, journals `escalation` with `reason: invalid_handoff`, and keeps the file in place. It is never silently dropped.
7. **B7 report.** Write `resume-report.md` in the section 12 format and regenerate `STATE.md`. Add an `owner` column to the task table so the report names the agent to dispatch. `COMPLETE` is an added status for a run with every task done; the contract's `NEW_RUN`, `RESUMING`, `BLOCKED_DRIFT`, and `HALT_CORRUPT` keep their meaning.
8. **B8 cursor.** Set `state.cursor` to the first task in plan dependency order whose status is `pending` or `in_progress` and whose dependencies are `done`. If every task is `done`, set the status to `COMPLETE`. If there are no tasks, leave the cursor null and the status `NEW_RUN`.

The first run has no task graph yet because boot mandatory precedes route. Resolve the ordering tension with a bootstrap plan: after `route` returns the first skill, the orchestrator writes a one task plan for that skill and calls `plan set`. When the first skill produces the full graph (for example `architect` produces the develop tasks), the orchestrator calls `plan set --replace`. The engine preserves any `done` task and rejects a replacement that changes its `resolved_skill`, `resolution_source`, `owner`, or `idempotent`.

### 4. State root

The default is `<project>/.orchestrator/`. Resolution order is `--state-root`, then `ORCH_STATE_ROOT`, then the default. A relative value resolves against the project root. A leading `~` expands to the home directory.

The root must be persistent and host local. Reject it when its real path is the operating system temp directory, inside that directory, or the filesystem root. Resolve the deepest existing ancestor with `realpath` before the check, so a symlink cannot hide a temp location. Tests set `ORCH_TEST_ALLOW_TMP=1` and pass a temporary root explicitly. The guard is off in production and has no bypass flag.

Create the full tree from the contract: `STATE.md`, `state.json`, `plan.json`, `journal.ndjson`, `checkpoints/`, `tasks/<task_id>/{task.json,handoffs/,artifacts/}`, `locks/`, and `resume-report.md`. Directories use mode `0700`; files use mode `0600`. On a platform that ignores modes, do not fail. Write `<state-root>/.gitignore` containing `*` on first run, so the state root ignores itself in any project without editing the project's own `.gitignore`.

Add `.orchestrator/` to this repository's `.gitignore` as well. The state root is not committed. It is not installed into the package config root and it is never written by a specialist agent outside `tasks/<task_id>/`.

### 5. Fingerprints

`skills_lock_sha256` is the SHA 256 of the bytes of the manifest file, written as `sha256:<64 lowercase hex>`. The manifest path resolves as `--manifest`, then `ORCH_MANIFEST`, then `<project>/skills-lock.json`, then `<config-root>/skills-lock.json`. If no manifest exists, the value is `null` and the report says `not present`.

`library_overrides_sha256` covers exactly these files under the library root:

- `skills/<name>/SKILL.md` for every direct child directory of `skills/`
- `agents/<name>.md` for every direct child file of `agents/`

Build a canonical byte stream in byte order of the forward slash relative path. For each file append `utf8(relativePath)`, a zero byte, the file bytes, and a zero byte. Hash the stream with SHA 256 and write `sha256:<64 lowercase hex>`. This covers path and content, so a rename and an edit both change the digest. A nested file inside a skill folder does not change the digest, because it does not change the capability to skill resolution. The library root resolves as `--library-root`, then `ORCH_LIBRARY_ROOT`, then `<project>/library`, then the installed config root (`~/.config/junamis/skills`) when it contains `skills/` and `agents/`. If the library root or the manifest is absent, its hash is `null`; the report says `not present`, and a later appearance is drift.

The plan checksum is `sha256:` over the canonical JSON of the `tasks` array, with object keys sorted and no whitespace. Each task `inputs_hash` is `sha256:` over the canonical JSON of `{capability, depends_on, resolved_skill, resolution_source, owner, adapter, idempotent}`. The engine computes both; it never trusts a checksum supplied in the input plan.

The state records the full `env_fingerprint`: `skills_lock_sha256`, `library_overrides_sha256`, `orchestrator_version` (the package version), `handoff_schema_version` (1), plus the informational `library_root` and `manifest_path`. Only the two hashes are drift gates. A version change is reported and does not block.

Plan time is the first non empty `plan set`. Boot records the fingerprint in `run_start` and `plan_created`. Every `plan set`, initial or replace, verifies the current fingerprints against the recorded value and exits 3 on a mismatch. On a match it records the fingerprint in `plan.json` and `state.json` and journals it in `plan_updated`.

### 6. Idempotency declarations

Add `idempotent: true | false` to every library skill's frontmatter, after `version`. The proposed values:

| Skill | `idempotent` | Reason |
|---|---|---|
| `db-migrate` | `false` | Creates migration files and rehearses data changes; a retry can duplicate a migration or apply it twice. |
| `decision-record` | `false` | Allocates the next ADR number; a retry after a partial write can create a second record. |
| `dependency-upgrade` | `false` | Edits the manifest and lockfile and runs an install; a retry can half apply or double apply. |
| `deploy-verify` | `true` | Sends GET requests only and overwrites one dated report. |
| `env-doctor` | `true` | Runs read only checks and overwrites one report. |
| `frontend` | `false` | Writes UI code and can run installs; the state after a partial edit is unknown. |
| `handoff` | `true` | Overwrites one session file from the current state. |
| `incident-response` | `false` | May run mitigation commands; a retry can repeat a live action. |
| `nestjs` | `false` | Writes application code. |
| `nextjs` | `false` | Writes application code. |
| `perf-budget` | `true` | Measures and overwrites one dated report; no mutation. |
| `refactor-safely` | `false` | Edits code across several steps. |
| `release-prep` | `false` | Couples a version bump and release notes in two files; a partial run can leave them out of step. |
| `research` | `true` | Reads the web and overwrites one dated summary. |
| `rollback` | `false` | Runs rollback steps; a retry can repeat a destructive action. |
| `route` | `true` | Read only classification. |
| `route-external` | `true` | Overwrites one deterministic adapter file. |
| `security-audit` | `true` | Read only review; overwrites one dated report. |
| `skill-author` | `false` | Creates or updates a skill folder; a retry can duplicate or conflict. |

The risky calls, in plain words:

- `decision-record` is false because the next number is computed from the directory. If the process dies after creating `0007`, a retry sees `0007` and writes `0008`. A duplicated decision record is worse than a review pause.
- `release-prep` is false because it changes the manifest version and writes release notes. If it dies between the two, a retry can produce a version and notes that disagree. A release is the wrong place to guess.
- `route-external` is true only because it writes one adapter file by overwrite. If the adapter ever becomes a multi file write, flip it to false.
- `perf-budget` and `security-audit` are true because their output path is date based and overwritten. If either is changed to append, flip it to false.
- `deploy-verify` is true because it is GET only. A later POST probe makes it false.

External skills are not ours to edit. The `route-external` adapter records an `idempotent` value in the adapter and in the plan. If the upstream skill does not declare one, record `false` and add a finding; do not guess `true`. The library test validates every library skill; the external adapter is the gate for external ones.

### 7. Orchestrator prompt changes

Update `library/agents/orchestrator.md` with a new `## Persistence` section before `## Understand the request first`, and update `## Loop` to match.

- Every session, before reading `.junamis/handoff.md` and before `route`, run `junamis-orchestrator boot --project <cwd> --session <new id>` and read `<state-root>/resume-report.md` in full. If boot exits 2, 3, or 4, stop and report the halt line and the report path. If the report's next action says stop, needs review, or a user decision, stop and report it. Do not route, discover, or dispatch in those cases.
- On `NEW_RUN`, continue the normal request. After `route` names the first skill, write a one task bootstrap plan for that skill and call `plan set`. When a skill produces the full task graph (for example `architect` produces `develop` and later tasks), call `plan set --replace`.
- On `RESUMING`, use the report's cursor task and step. Do not rescan the request. Pass the report to `route`. Dispatch the recorded `resolved_skill` to the recorded `owner`, and do not resolve capability to skill again when the fingerprint matches.
- On `COMPLETE`, report and stop.
- Before every dispatch, call `start --task <task_id>`. Read the returned `step_id` and `attempt`. If it exits 5, stop and report.
- Dispatch exactly one skill with the brief. When it returns a HANDOFF block, write the block verbatim to `<state-root>/tasks/<task_id>/handoffs/<skill>-<attempt>.yaml`, then call `end --task <task_id> --step <step_id> --handoff <that path>`. The specialist never writes `state.json`, `plan.json`, or `journal.ndjson`.
- `end` validates the handoff and the artifacts. If it exits 5, the task is `needs_review`; stop and report. If the handoff is `needs-decision`, ask the user every `decisions_owed` question. When the user answers, call `resolve --task <task_id> --decision "<answer>"` and continue.
- At the end, call `checkpoint`. If every task is done, call `finish`; otherwise call `lease release` so the next session can resume. Then run the `handoff` skill and write the suggested commit.
- Never resolve a skill again on a matching fingerprint. The plan's `resolved_skill`, `resolution_source`, `owner`, and `idempotent` are the record.

### 8. Route changes

Update `library/skills/route/SKILL.md`.

- Add the resume report to `## Inputs` as the first input. If it is missing, return `status: blocked` and tell the orchestrator to run boot.
- Add a `resume` row to `## Paths`: signals "session restarted", "continue", "pick up", or a report with `Status: RESUMING`; first skill is the recorded skill; owner is the recorded owner.
- Add a `## Resume` section. When `Status: RESUMING`, start from the cursor task and the recorded `resolved_skill`, `resolution_source`, and `owner`. Do not rescan the user request. When `Status: NEW_RUN`, classify normally. When `Status: COMPLETE`, return `next: none`. When `Status: BLOCKED_DRIFT` or `HALT_CORRUPT`, return `status: blocked` with the report path.
- Use the recorded capability to skill resolution. Do not resolve again when the report says the fingerprint matches. The plan's resolution is part of its checksum.
- The Finish block's `next` is the recorded skill on resume, or the normal first skill on a new run.

### 9. HANDOFF changes

Update `library/HANDOFF.md`.

- Add a first line: `This file defines the step output block. Execution state and resume behavior are in RESUME.md.`
- Add a `## Schema version` section: version 1, the existing fields are the whole schema, and a field change requires a version bump and a matching state engine change. Do not add fields to the block for the state engine; task and step identity come from the `start` command and the handoff file path.
- Add an `## Idempotency` section: every skill declares `idempotent: true | false` in frontmatter. The orchestrator records it in the plan and the engine honors it on boot and `end`.
- Add a `## Persisting a handoff` section: the orchestrator writes the returned block to `<state-root>/tasks/<task_id>/handoffs/<skill>-<attempt>.yaml` and calls `end`. The state engine validates it. A malformed block sets the task `needs_review` and is kept, never dropped.
- Add a `## Task status mapping` section: `complete` maps to `done` after artifact checks, `failed` and `blocked` map to `failed`, and `needs-decision` maps to `needs_review` until the user answers and the orchestrator calls `resolve`.
- Keep the `## Suggested commit` section and its orchestrator only rule unchanged.
- Add a note under `## Artifact locations`: execution state lives under `<project>/.orchestrator/` (gitignored) and follows `RESUME.md`.

### 10. Test plan T1 to T7

Tests use the Node test runner, temporary state roots, and a copied fixture project. They never write to the repository and never touch the network.

Fixture project at `test/fixtures/orchestrator/project/`:

- `skills-lock.json` with one fixture lock entry.
- `library/agents/orchestrator.md`, `library/skills/route/SKILL.md`, `library/skills/develop/SKILL.md`, and `library/skills/release-prep/SKILL.md`, with `idempotent: true`, `true`, and `false` as noted.
- `plan.json` with three tasks: `T-001` route (`idempotent: true`, no dependency), `T-002` develop (`idempotent: true`, depends on `T-001`), `T-003` release-prep (`idempotent: false`, depends on `T-002`). Every task records `resolved_skill`, `resolution_source: internal_override`, `owner: orchestrator`, and `adapter: null`.
- `handoffs/T-001.yaml`, `T-002.yaml`, and `T-003.yaml`, each a valid HANDOFF block with `status: complete` and one artifact.
- `artifacts/T-001.md`, `T-002.md`, and `T-003.md`.

The reference run used by T1 and T2:

1. Copy the fixture project to a temporary project directory.
2. Set `ORCH_STATE_ROOT` to a temporary state directory and `ORCH_TEST_ALLOW_TMP=1`.
3. `boot` (expect `NEW_RUN`).
4. `plan set --file plan.json`.
5. `start T-001`, then `end T-001` with `handoffs/T-001.yaml`.
6. `start T-002`, then `end T-002` with `handoffs/T-002.yaml`.
7. `start T-003`, then `end T-003` with `handoffs/T-003.yaml`.
8. `status` (expect every task `done`).
9. `checkpoint`, then `finish` (expect `COMPLETE`).

The normalized result is the comparison target for T1 and T2: `state.json`, `plan.json`, each `task.json`, each handoff file, `resume-report.md`, and `STATE.md`, with timestamps, session ids, run ids, and event hashes replaced by fixed placeholders. For T1, compare the project artifacts byte for byte, the task statuses, the cursor, the plan checksum, and each task's `outputs`; attempt counts and handoff file names may differ after an expected retry and are not compared. For the report, compare the Status, Cursor, Tasks, and Environment fingerprint sections; the Recent events and Reconciliation sections are allowed to record the crash and are not compared. For T2, compare the full logical state because the replay must reproduce the attempts as well.

Test files and coverage:

| Test | File | What it proves |
|---|---|---|
| T1 crash injection | `test/orchestrator-t1-crash.test.js` | For each crash point, kill the child, boot again, finish the run, and compare the normalized result to the reference run. Crash points: after lease, after plan journal, after `step_start` journal, after the task snapshot, before `step_end` journal, after `step_end` journal, after the task snapshot on end, after checkpoint snapshot, and before journal truncation. A not idempotent task killed after its artifact but before `step_end` becomes `needs_review`. |
| T2 replay determinism | `test/orchestrator-t2-replay.test.js` | Copy `journal.ndjson` and `checkpoints/` into a fresh state root, boot, and compare the reconstructed `plan.json`, `state.json`, and every `task.json` to the reference run. Also assert the hash chain verifies. Repeat with a run that has no checkpoint, so the full journal replays from sequence 0. |
| T3 manifest drift | `test/orchestrator-t3-drift.test.js` | Add a skill to the fixture `skills-lock.json`, boot, expect exit 3, `BLOCKED_DRIFT`, a `## Drift` section with old and new `skills_lock_sha256`, and no new `step_start`. |
| T4 override drift | `test/orchestrator-t4-drift.test.js` | Change `library/agents/orchestrator.md`, boot, expect exit 3, `BLOCKED_DRIFT`, the changed path in `## Drift` with old and new `library_overrides_sha256`, and no new `step_start`. |
| T5 lease safety | `test/orchestrator-t5-lease.test.js` | Session A boots and holds the lease. Session B boots immediately, exits 2 with `HALT: lease_held`, writes no state, plan, task, or journal file, and leaves A's lease intact. Age A's heartbeat past the TTL, boot B, expect `lease_taken_over` and B's owner. |
| T6 not idempotent escalation | `test/orchestrator-t6-escalation.test.js` | Start `T-003`, create its artifact, kill before `step_end`, boot, expect `needs_review`, `escalation` with `reason: interrupted_non_idempotent`, and no retry. The same crash on `T-002` resets to `pending` and a retry completes. |
| T7 torn write recovery | `test/orchestrator-t7-torn-write.test.js` | Run to a checkpoint. Truncate `state.json` to half an object and append a partial journal line. Boot, expect `journal_truncated`, a valid `state.json`, correct task statuses, and the partial line removed. Repeat with no checkpoint to prove replay from sequence 0. |

Crash injection: `src/orchestrator/test-hooks.js` checks `ORCH_TEST_MODE=1` and `ORCH_TEST_CRASH_AT=<point>`. At a matching point it calls `process.kill(process.pid, "SIGKILL")`. The test spawns the CLI as a child process, sets both variables, and asserts the child died with `signal: SIGKILL`. The hook is inert without `ORCH_TEST_MODE=1` and must not be reachable from a normal command path. T1, T6, and T7 reuse the same session id, so the restart reclaims the dead same session lease; T5 uses two different session ids to prove the live lease halt.

Two session tests disable any background behavior. The lease is renewed by `boot`, `start`, `end`, `checkpoint`, and `lease heartbeat`. `start` raises the lease `ttl_seconds` to `ORCH_STEP_TTL_SECONDS` (default 900) so a long skill cannot be taken over mid step; `end` and `boot` reset it to `ORCH_LEASE_TTL_SECONDS` (default 60). A crash restart uses the same session id and reclaims the dead same session lease. A different session id halts while the lease is live and takes over only when it is stale.

### 11. Repository changes

| File | Change |
|---|---|
| `library/RESUME.md` | New normative contract, copied from `.junamis/RESUME-contract.md`, with the reference implementation section. |
| `src/library-install.js` | Add `RESUME.md` to `SHARED_DOCS`. Add a `SHARED_DATA` list with `skills-lock.json`, sourced from the package root like `SECURITY.md`, and install it at the config root so the installed engine can fingerprint the manifest. Update the exported constants and tests. |
| `package.json` | Add `"junamis-orchestrator": "scripts/orchestrator-state.mjs"` to `bin`; add `"scripts/orchestrator-state.mjs"` to `files`. No new dependency. |
| `.gitignore` | Add `.orchestrator/`. |
| `scripts/check-pack.mjs` | Add `library/RESUME.md`, `src/orchestrator/cli.js`, and `scripts/orchestrator-state.mjs` to `REQUIRED_FILES`. |
| `test/library.test.js` | Assert `library/RESUME.md` exists, every skill has a valid `idempotent` frontmatter value, and `HANDOFF.md` references `RESUME.md` and schema version 1. |
| `test/library-install.test.js` | Assert `RESUME.md` and the installed `skills-lock.json` are planned and installed under the config root. |
| `test/cli-smoke.test.js` | Assert `junamis-orchestrator` help works and a fresh temp root boot reports `NEW_RUN`. |
| `src/guide.js` | Add `RESUME.md` and the `.orchestrator/` state root to the installed guide, and mention that boot runs before route. |
| `README.md` | Add a `## Persistence and resume` section, the new CLI, the `.orchestrator/` state root, `RESUME.md` in the shared docs list, and the `idempotent` rule. |
| `AGENTS.md` | Add `## Orchestrator state` with the boot rule, the state root, the contract, the idempotent rule, the module and CLI paths, the no dependency rule, and the T1 to T7 requirement. State that the installer CLI keeps `init`, `status`, and `help`, and the state engine is a separate `junamis-orchestrator` bin. Update `## Working rules`. |
| `junamis-skills.yml` | Update `Architecture`, `Features` (new `Persistence` block), `Library.SharedDocs`, `InstalledPaths`, `Utilities`, `Decisions` (new `0016`), `Validation` (actual test count), and `Limitations`. |
| `CHANGELOG.md` | Add the new contract, engine, CLI, idempotent frontmatter, and tests under `Added`; the boot and route behavior, handoff contract, and `.gitignore` under `Changed`; the local state root, lease, and no new dependency note under `Security`. |

No change to `scripts/check-security.mjs`, `scripts/check-skills-lock.mjs`, `scripts/check-yaml.js`, `scripts/check-opencode-config.mjs`, `scripts/check-skills-sync.mjs`, `scripts/release-check.mjs`, `SECURITY.md`, `library/SAFETY.md`, or `opencode.json`. `RESUME.md` is a document, not a skill, so the security record does not gain a row. The engine reads no secrets and makes no network call.

### 12. Build order

Build in the five vertical slices in `## Build plan`: state engine and journal, boot and lease and drift, orchestrator and route and handoff wiring, idempotent frontmatter, then T1 to T7 and the repository gates. Do not build the CLI and the prompt in one pass, because the prompt cannot be verified until boot and route exist.

## Feature design

**Data model sketch**:

The state root is the persistence layer. The entities are files, not database rows.

| Entity | File | Key fields |
|---|---|---|
| Run | `state.json`, `journal.ndjson` | `schema_version`, `run_id`, `created_at`, `updated_at`, `run_status`, `cursor`, `plan`, `env_fingerprint`, `tasks_summary`, `journal_head`, `last_checkpoint` |
| Plan | `plan.json` | `schema_version`, `run_id`, `created_at`, `env_fingerprint`, `capabilities`, `tasks`, `checksum` |
| Task | `tasks/<task_id>/task.json` | `schema_version`, `task_id`, `capability`, `status`, `resolved_skill`, `resolution_source`, `owner`, `current_step`, `inputs_hash`, `outputs`, `updated_at` |
| Journal event | `journal.ndjson` | `seq`, `ts`, `type`, `run_id`, `session_id`, `prev_hash`, `hash`, plus event fields |
| Lease | `locks/session-<session_id>.json` | `session_id`, `pid`, `host`, `started_at`, `heartbeat_at`, `ttl_seconds` |
| Checkpoint | `checkpoints/<seq>.snapshot` | `schema_version`, `run_id`, `seq`, `journal_head`, `state`, `plan`, `tasks`, `checksum` |
| Resume report | `resume-report.md` | The section 12 format, regenerated on every boot. |
| State mirror | `STATE.md` | A view, regenerated on boot and checkpoint, never read. |

**State transitions**:

Task state machine: `pending` becomes `in_progress` on `start`; `in_progress` becomes `done`, `failed`, or `needs_review` on `end`; `failed` becomes `in_progress` on an explicit retry; `needs_review` becomes `pending` only on `resolve`; `pending` with unmet dependencies is blocked and is not a separate state.

Lease state: absent, live, or stale. Boot acquires or takes over. A live lease held by another session halts with exit 2. A stale lease is taken over and journals `lease_taken_over`.

Run status: `NEW_RUN`, `RESUMING`, `BLOCKED_DRIFT`, `HALT_CORRUPT`, `COMPLETE`.

**API surface** (the command line interface; full detail is in the Decision):

| Command | Key inputs | Key outputs | Writer | Key errors |
|---|---|---|---|---|
| `boot` | project, state root, session | `resume-report.md`, `STATE.md`, lease | yes | 2 lease held, 3 drift, 4 corrupt |
| `plan set` | plan file, replace flag | plan checksum, journal event | yes | 1 invalid plan, 5 done task changed |
| `start` | task id | step id, attempt, idempotent | yes | 5 invalid transition |
| `end` | task id, step id, handoff path | task status, next | yes | 5 invalid handoff |
| `resolve` | task id, decision text | task pending | yes | 5 task not in review |
| `status` | project, state root | snapshot | no | 4 corrupt |
| `checkpoint` | project, state root | snapshot, truncated journal | yes | 4 corrupt |
| `lease` | acquire, heartbeat, release, status | lease file or view | yes or no | 2 lost or held |
| `finish` | project, state root | `run_complete`, `COMPLETE` report | yes | 5 tasks not done |

**Value sourcing** (every value an acceptance criterion needs, and where it comes from):

| Action | Value produced or displayed | Source |
|---|---|---|
| `boot` | run status | State root empty, journal replay result, fingerprint comparison, task summary |
| `boot` | cursor task | `plan.json` dependency order plus `task.json` statuses |
| `boot` | next action | Task status plus `idempotent` from the plan |
| `boot` | lease owner and TTL | `locks/session-*.json` |
| `boot` | drift diff | Recorded `env_fingerprint` versus current fingerprint |
| `boot` | report status | The boot decision above |
| `plan set` | plan checksum | Canonical JSON of the `tasks` array |
| `plan set` | task `inputs_hash` | Canonical JSON of the task identity fields |
| `plan set` | `idempotent` | Skill frontmatter for an internal skill; adapter record for an external skill; default `false` when absent |
| `plan set` | `resolved_skill`, `resolution_source`, `owner`, `adapter` | The plan input produced by `route` and `route-external` |
| `start` | `step_id` | `<task_id>/<capability>/attempt-<n>` from the plan and `task.json` |
| `start` | `attempt` | Prior attempt plus one |
| `end` | artifact exists | File system check at the project relative path |
| `end` | task status | Handoff status mapping plus artifact check |
| `resolve` | task pending | The user's answer recorded as a `resolution` event |
| fingerprints | `skills_lock_sha256` | Bytes of the resolved manifest file |
| fingerprints | `library_overrides_sha256` | Sorted path plus content over the library override files |
| journal | `seq`, `hash`, `prev_hash` | Prior journal head plus the canonical event body |
| journal | `checkpoint seq` | Replay to the current sequence |
| report | recent events | Last 10 journal entries |
| report | environment match | Two fingerprint comparisons |
| `STATE.md` | all view values | The same state and plan data, never as input |

**Key invariants**:

- I1 single state root. I2 journal is truth. I3 boot before route. I4 atomic commits. I5 idempotent or escalated. I6 no blind resume on drift. I7 single writer. I8 append only journal.
- A task is `done` only after one validated handoff and every declared artifact exists.
- A journal event is durable before the snapshot write. A snapshot failure is repaired by replay.
- A state root is never inside the operating system temp directory and never read from `STATE.md`.
- A `done` task's identity cannot change during a plan replace.
- A handoff artifact path is project relative, has no `..`, and never resolves outside the project root.

**Security model**:

The state root is host local and trusted. It is not a secret store and must not contain credentials. The engine reads only the manifest, the library frontmatter, the plan input, the handoff blocks, and its own state root. It never reads `.env`, never prints artifact contents, and makes no network call. Directories use `0700` and files use `0600`. Task ids match `^[A-Za-z0-9._-]+$` and are not `.` or `..`. Handoff artifact paths are project relative, reject absolute paths and `..`, and are checked with `realpath` containment. The lease is advisory on a trusted host; it prevents two cooperating sessions, not a hostile local process. A malformed handoff is quarantined as `needs_review`, never executed. Drift is a correctness gate, not a warning. The approval gate in `SAFETY.md` still applies to every command a dispatched skill runs; the state engine never runs a gated command itself.

**Configuration required**:

- `ORCH_STATE_ROOT`: state root override, default `<project>/.orchestrator`.
- `ORCH_PROJECT_ROOT`: project root override, default the current directory.
- `ORCH_SESSION_ID`: session id override.
- `ORCH_LIBRARY_ROOT`: library root override for an installed layout.
- `ORCH_MANIFEST`: manifest path override for an installed layout.
- `ORCH_LEASE_TTL_SECONDS`: base lease TTL, default 60.
- `ORCH_STEP_TTL_SECONDS`: step lease TTL, default 900.
- `ORCH_TEST_ALLOW_TMP`: test only, allows a temporary state root.
- `ORCH_TEST_MODE` and `ORCH_TEST_CRASH_AT`: test only, enables crash injection.

**Critical test scenarios**:

- Happy path: reference run from boot to finish, all three tasks done, checkpoint written, report `COMPLETE`, every artifact present. Verifies AC-1, AC-7, AC-11.
- Crash after side effect before `step_end`: T-003 is not idempotent, so boot reports `needs_review` and does not retry; T-002 on the same crash retries. Verifies AC-2, AC-9.
- Manifest and override drift: T3 and T4 each boot to `BLOCKED_DRIFT` with the correct diff and zero dispatches. Verifies AC-4, AC-5.
- Two sessions: T5 halts the second with `lease_held` and later takes over a stale lease. Verifies AC-6.
- Torn write: T7 truncates `state.json` and the journal tail, boots, and recovers with `journal_truncated`. Verifies AC-10.
- Resume: after a clean stop, boot reports `RESUMING` with the cursor and `route` starts there with the recorded skill. Verifies AC-7, AC-14.
- Handoff containment: an artifact path with `..` or an absolute path is rejected into `needs_review` and writes nothing outside the project. Verifies AC-9 and the security model.
- View independence: corrupt `STATE.md`, boot, and the result is unchanged while `STATE.md` is regenerated. Verifies AC-8.

## Build plan

1. **Slice 1: State engine core and journal.** Create `src/orchestrator/` with `fsx.js`, `hash.js`, `time.js`, `journal.js`, `state.js`, `plan.js`, `errors.js`, `cli.js`, `test-hooks.js`, and `scripts/orchestrator-state.mjs`. Implement atomic writes, the journal hash chain, replay, `state.json`, `plan.json`, initial and replace plan validation, `status`, and the CLI parser and exit codes. Add the `junamis-orchestrator` bin and `files` entry, and `.orchestrator/` to `.gitignore`. Add unit tests for the hash chain, the atomic write, plan validation, and replay. Satisfies **AC-3**, **AC-11**, **AC-12**, **AC-13**.
2. **Slice 2: Boot, lease, drift, report, and checkpoint.** Add `lease.js`, `drift.js`, `compaction.js`, `report.js`, and `boot.js`. Implement B1 to B8, the live and stale lease rules, the two fingerprints, `BLOCKED_DRIFT`, `HALT_CORRUPT`, `resume-report.md`, `STATE.md`, `checkpoint`, and `finish`. Add unit tests for lease hold and takeover, fingerprint stability, each boot status, report sufficiency, and view regeneration. Satisfies **AC-1**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-12**.
3. **Slice 3: Orchestrator, route, and HANDOFF wiring.** Add `library/RESUME.md` and the reference implementation section. Add `RESUME.md` to `SHARED_DOCS`, add a `SHARED_DATA` list with `skills-lock.json`, and install both at the config root. Update `library/agents/orchestrator.md` with the persistence section, the bootstrap plan, the start and end calls, the resolve call, and the rule to use the recorded resolution. Update `library/skills/route/SKILL.md` with the resume input, the resume path, and the recorded resolution. Update `library/HANDOFF.md` with the RESUME reference, schema version 1, the idempotent rule, the handoff persistence rule, and the status mapping. Add a test that `plan set` refuses to change a done task and that a resume report drives route to the recorded skill. Satisfies **AC-1**, **AC-7**, **AC-9**, **AC-14**.
4. **Slice 4: Idempotency frontmatter.** Add `idempotent: true | false` to every one of the 19 library skills using the table in the Decision. Add the `test/library.test.js` check that every skill declares a valid value. Update `test/library-install.test.js` for `RESUME.md` and the installed manifest. Satisfies **AC-9**.
5. **Slice 5: T1 to T7 and repository gates.** Add `test/helpers/orchestrator.js` and `test/fixtures/orchestrator/project/` with the three task reference fixture. Add the T1 to T7 test files, the crash hooks, the drift mutations, the two session lease test, and the torn write recovery. Update `scripts/check-pack.mjs`, `README.md`, `AGENTS.md`, `junamis-skills.yml`, and `CHANGELOG.md`. Run `pnpm test`, `pnpm run check:security`, `pnpm run check:pack`, and `pnpm run check:yaml`, and update the test count in `junamis-skills.yml` to the actual total. Satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-9**, **AC-10**, **AC-11**, **AC-14**.

## Implementation status

Slices 1 to 5 are implemented. The state engine under `src/orchestrator/` and the normative `library/RESUME.md` are in place, all 19 library skills declare `idempotent`, and T1 to T7 plus the repository gates pass at the current test count (234 tests).

## Consequences

**Positive**:
- A fresh session resumes from disk with a cursor and a report, so it does not repeat work.
- The journal is an audit trail and makes a torn snapshot recoverable.
- Manifest and library drift block dispatch before the wrong skill can run.
- The lease stops two cooperating sessions from writing the same state root.
- Every skill now says whether a retry is safe, and a not idempotent interruption goes to a human instead of duplicating a side effect.
- T1 to T7 turn the contract's claims into executable checks.

**Negative / tradeoffs**:
- A crash in a not idempotent step waits for a human. That is intentional, but it costs time.
- The journal grows and must be compacted; compaction adds a truncation path that needs its own recovery test.
- The lease TTL is a compromise. A short TTL risks a mid step takeover; a long step TTL delays recovery after a crash. `ORCH_STEP_TTL_SECONDS` makes the tradeoff explicit.
- The handoff validator is a small custom parser, because a runtime YAML dependency is not allowed. It accepts only the documented block and rejects anchors and multi document input.
- The state root is host local. Resume does not work across machines, and the lease does not coordinate across hosts.
- The orchestrator prompt gets longer, and the bootstrap plan adds one command before the first dispatch.

**Neutral**:
- `.orchestrator/` is gitignored, so the audit trail is local and not part of a commit.
- `RESUME.md` joins the installed shared docs.
- `skills-lock.json` is copied to the config root so the installed engine can fingerprint it.
- The package gains a second bin, `junamis-orchestrator`.
- The project's test count grows; `junamis-skills.yml` records the real number after the build.

## Follow-up

- [ ] Decide whether a future contract should support a shared or remote state root. The current contract assumes a host local root, so this spec does not design one.
- [ ] Add a state schema migration path when `schema_version` moves past 1. The current engine rejects a different version with `HALT_CORRUPT`.
- [ ] Review the not idempotent skills after the first real resume. If `decision-record` learns to reuse an identical draft, it can move to `true`.
- [ ] Add a short drift recovery note to the resume report after the first real drift event, if the diff alone is not enough for the review skill.
- [ ] Keep `RESUME.md` and `HANDOFF.md` in step. A handoff schema change must update both and the state engine's `handoff_schema_version`.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
