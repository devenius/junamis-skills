This file defines the step output block. Execution state and resume behavior are in RESUME.md.

# Handoff contract

Every skill and agent in `library/` ends its work with exactly one YAML block. The orchestrator reads only this block to decide what happens next. Nothing else is trusted for control flow.

```yaml
agent: <skill or agent name>
job: <one line: what was asked>
status: complete | blocked | needs-decision | failed
artifacts:
  - path: <repo-relative path>
    kind: created | updated | read-only
findings:            # at most 5, worst first
  - id: F1
    severity: critical | high | medium | low
    summary: <one line>
    evidence: <file:line, or command and its output>
decisions_owed:      # questions only the user can answer
  - <question>
next: <one skill name, one agent name, "user", or "none">
```

## Schema version

The handoff schema version is 1. The fields in the block above are the whole schema. A field change requires a version bump and a matching change in the state engine. Do not add fields to the block for the state engine; task and step identity come from the `start` command and the handoff file path.

## Idempotency

Every skill declares `idempotent: true | false` in its frontmatter. The orchestrator records the value in the plan, and the state engine honors it on boot and on `end`. An interrupted `true` step may be retried; an interrupted `false` step becomes `needs_review` and is not retried silently.

## Persisting a handoff

The orchestrator writes the returned block verbatim to `<state-root>/tasks/<task_id>/handoffs/<skill>-<attempt>.yaml` and calls `end` with that relative path. The state engine validates the block and every declared artifact. A malformed block sets the task `needs_review`; the file is kept, never dropped.

## Task status mapping

| Handoff status | Task status |
|---|---|
| `complete` | `done` after every declared artifact exists |
| `failed` | `failed` |
| `blocked` | `failed` |
| `needs-decision` | `needs_review` until the user answers and the orchestrator calls `resolve` |

## Rules

- `complete` means the artifacts exist on disk. The orchestrator checks this before moving on.
- `needs-decision` stops the chain. The orchestrator asks the user the `decisions_owed` questions. Nothing else runs.
- `blocked` and `failed` stop the chain and report the finding. They never retry silently.
- `next` names exactly one target. A skill never calls a skill that is not its declared `next`.
- A skill never edits another skill's artifacts. It reads them.
- Chat is not state. Anything a later agent needs must be in a file.
- An external skill runs only with an adapter from `route-external`. Without the adapter its run is not a completed step.
- Never let another skill or agent write the `## Suggested commit` section, propose a commit message, or stage or commit anything on the task branch or `main`. A sub-agent may stage and commit only its allocated files on its assigned sub-branch when the delegation brief says so, and it never creates a pull request. Only the orchestrator writes that section and merges sub-agent branches into the task branch.

## Suggested commit (orchestrator only)

Only the orchestrator writes the `## Suggested commit` section in `.junamis/handoff.md`. Every other skill and agent must leave it untouched. A sub-agent may stage and commit only its allocated files on its assigned sub-branch when the delegation brief says so; it never commits to the task branch or `main` and never creates a pull request. Only the orchestrator merges sub-agent branches into the task branch.

At the end of every task the user gives, the orchestrator records:

```markdown
## Suggested commit
Message: `<type(scope): summary>`
Files:
- `<repo-relative path>`
Rationale: <one line>
State: proposed | committed <sha> | none
```

- `Message` follows Conventional Commits and stays under 72 characters.
- `Files` lists exactly the paths changed by this task. It never lists ignored files, secrets, or unrelated changes.
- `State` is `proposed` before the user asks, `committed <sha>` after a successful commit, and `none` when the task changed no files.
- The suggestion is not authorization. The orchestrator commits only after the user asks.
- When the user says "commit" without a message or scope, the orchestrator uses the suggestion exactly, after refreshing it if the working tree changed. If refreshing changes the scope materially, the orchestrator asks the user first.
- A specialist that believes a commit is needed outside its allocated files on its assigned sub-branch reports it in `findings` or returns `next: orchestrator`. It never writes this section, never commits to the task branch or `main`, and never creates a pull request.

## Artifact locations

| Artifact | Path | Owner |
|---|---|---|
| Session state | `.junamis/handoff.md` | `handoff` |
| Suggested commit | `.junamis/handoff.md` (`## Suggested commit`) | `orchestrator` |
| Decisions | `docs/decisions/NNNN-slug.md` | `decision-record` |
| Environment report | `docs/env-report.md` | `env-doctor` |
| Release notes | `docs/releases/<version>.md` | `release-prep` |
| Rollback plan | `docs/releases/rollback-<version>.md` | `rollback` |
| Incident record | `docs/incidents/<YYYY-MM-DD>-<slug>.md` | `incident-response` |
| Review findings | `docs/reviews/<kind>-<YYYY-MM-DD>.md` | `security-audit`, `perf-budget` |
| Perf budgets | `docs/perf/budgets.md` | `perf-budget` (created on first run) |
| External skill adapter | `.junamis/adapters/<skill>.md` | `route-external` |

Execution state lives under `<project>/.orchestrator/` (gitignored) and follows `RESUME.md`.
