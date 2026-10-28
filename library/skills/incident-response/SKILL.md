---
name: incident-response
version: "1.0.0"
description: Use when production is failing right now: outage, error spike, users reporting breakage, data looks wrong in live. Orders the work as stabilize first, then gather evidence read-only, then hypothesize, then record the incident. Do not use for a bug in development or staging; that is debug. Do not change production data from this skill.
---

# incident-response

Stop the bleeding first. Understand it second. Write it down throughout.

## Order (do not reorder)

1. **Stabilize.** Ask what mitigations exist: feature flag, rollback, traffic shift, disabling a job. Recommend the smallest one that stops user harm. Do not execute it yourself. Routing to `rollback` requires user confirmation.
2. **Timeline.** Establish when it started, what changed just before (deploys, config, migrations, dependency bumps), and the first symptom. Use `git log` and the release notes.
3. **Evidence.** Read logs, error reports, and metrics the user provides. Read-only. Quote the lines you rely on with timestamps.
4. **Hypotheses.** List at most three causes, each with the evidence for and against. Rank them.
5. **Confirm.** Pick the top hypothesis only if evidence confirms it. Otherwise state what data would confirm it and ask for it.
6. **Record.** Write `docs/incidents/<YYYY-MM-DD>-<slug>.md`:

```markdown
# <Title>

Status: open | mitigated | resolved
Started: <time>   Detected: <time>   Mitigated: <time or pending>

## Impact
Who was affected and how.

## Timeline
- <time>: <event, with source>

## Evidence
- <quoted line, source, time>

## Hypotheses
1. <cause>: for <...>, against <...>

## Mitigation and next steps
```

## Gotchas

- Do not guess a root cause in the first reply. Ask for the logs.
- Do not run a fix against production without the user's explicit go-ahead in this session.
- Do not edit or delete production records to "clean up" a symptom. Record it.
- A rollback that does not fix the symptom means the cause is not the release. Say so.
- Keep secrets, tokens, and customer data out of the incident record. Redact.

## Finish

```yaml
agent: incident-response
job: triage <incident>
status: complete | needs-decision | blocked
artifacts:
  - path: docs/incidents/<YYYY-MM-DD>-<slug>.md
    kind: created
findings:
  - id: F1
    severity: critical
    summary: <most likely cause, with confidence>
    evidence: <log line, timestamp>
decisions_owed:
  - approve mitigation: <action>?
next: user
```

Use `next: debug` only when the evidence points to a code defect and the user has approved a fix path. Otherwise `next: user`.
