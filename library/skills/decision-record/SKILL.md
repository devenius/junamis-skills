---
name: decision-record
description: Use when the user makes a decision that should bind future work ("we're using X", "never do Y here", "going with Z"), or before acting on a request that may conflict with an earlier decision. Writes ADR-style records to docs/decisions/ and flags conflicts instead of silently overriding them. Do not use for open questions or for suggestions the user has not accepted.
---

# decision-record

Turn a user's decision into a durable record, and check new requests against the records that already exist.

## Mode A: record a decision

Use when the user states a decision.

1. Confirm the decision in one sentence and ask nothing else unless the wording is ambiguous.
2. Find the next number: highest `NNNN` in `docs/decisions/` plus one, starting at `0001`.
3. Write `docs/decisions/NNNN-slug.md`:

```markdown
# NNNN. <Title in imperative form>

Status: Accepted
Date: <YYYY-MM-DD>
Supersedes: none

## Context
Why this came up. Two to four sentences.

## Decision
The decision, in one or two sentences, stated plainly.

## Consequences
What this makes easier, what it makes harder, what it rules out.
```

4. Report the file path and the one-line decision.

## Mode B: check a request against decisions

Use before any skill that changes code or config.

1. List titles in `docs/decisions/` with `Status: Accepted`.
2. If a request contradicts one, stop. Report the record number, the conflict, and the two options: follow the record, or record a superseding decision.
3. If the user chooses to supersede, write a new record with `Supersedes: NNNN`. Change the old record's status to `Superseded by NNNN`. Do not edit its body.
4. If the request is merely different and does not contradict, proceed and mention the related record.

## Gotchas

- Record only decisions the user made. A suggestion from an agent is `Status: Proposed` until the user accepts it, and it does not bind work.
- Never rewrite a decision's body. History is the point.
- One decision per file. If a message holds three decisions, write three files.
- If `docs/decisions/` does not exist, create it. Do not ask.

## Finish

```yaml
agent: decision-record
job: record or check decision
status: complete | needs-decision
artifacts:
  - path: docs/decisions/NNNN-slug.md
    kind: created
findings:
  - id: F1
    severity: high
    summary: request conflicts with decision NNNN
    evidence: docs/decisions/NNNN-slug.md
decisions_owed:
  - follow NNNN, or supersede it?
next: user
```

Omit `findings` and set `next` to the calling skill when there is no conflict.
