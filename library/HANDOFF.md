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

## Rules

- `complete` means the artifacts exist on disk. The orchestrator checks this before moving on.
- `needs-decision` stops the chain. The orchestrator asks the user the `decisions_owed` questions. Nothing else runs.
- `blocked` and `failed` stop the chain and report the finding. They never retry silently.
- `next` names exactly one target. A skill never calls a skill that is not its declared `next`.
- A skill never edits another skill's artifacts. It reads them.
- Chat is not state. Anything a later agent needs must be in a file.

## Artifact locations

| Artifact | Path | Owner |
|---|---|---|
| Session state | `.junamis/handoff.md` | `handoff` |
| Decisions | `docs/decisions/NNNN-slug.md` | `decision-record` |
| Environment report | `docs/env-report.md` | `env-doctor` |
| Release notes | `docs/releases/<version>.md` | `release-prep` |
| Rollback plan | `docs/releases/rollback-<version>.md` | `rollback` |
| Incident record | `docs/incidents/<YYYY-MM-DD>-<slug>.md` | `incident-response` |
| Review findings | `docs/reviews/<kind>-<YYYY-MM-DD>.md` | `security-audit`, `perf-budget` |
| Perf budgets | `docs/perf/budgets.md` | `perf-budget` (created on first run) |
