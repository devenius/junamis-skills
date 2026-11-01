---
name: handoff
version: "1.0.0"
description: Use to save the current session state to .junamis/handoff.md at the end of work, or to read it at the start of a session so work resumes without re-explaining. Use when the user says "save where we are", "pick up", "continue", or when a session is ending. Do not use for per-step status; that is the HANDOFF block every skill ends with.
---

# handoff

Keep one short file that lets a fresh agent continue. The file is the memory. The chat is not.

## Write (end of session)

Overwrite `.junamis/handoff.md` with exactly these sections, in this order:

```markdown
# Handoff

Updated: <YYYY-MM-DD HH:MM>

## Goal
One sentence.

## Current state
What is done, in three bullets at most. Name the files that changed.

## Decisions in force
Links to docs/decisions/ entries that govern this work. "None" if none.

## Open questions
Questions only the user can answer. "None" if none.

## Next step
One concrete action, with the skill that does it.

## Do not
Things a fresh agent would otherwise repeat or break. "Nothing recorded" if none.
```

## Read (start of session)

1. Read `.junamis/handoff.md`. If it is missing, say so and run `route` on the user's request.
2. Reply with at most five lines: goal, state, next step, open questions.
3. Check each path named in "Current state" still exists. Report any that do not.
4. Continue from "Next step" only after the user confirms, or when the user's request matches it.

## Gotchas

- Keep it under 60 lines. A handoff that needs scrolling is a transcript, not a handoff.
- Never paste secrets, tokens, or env values. Name the variable, not the value.
- Do not record what was tried and failed unless it will stop the next agent. Put that under "Do not".
- Overwrite, do not append. Old state is in git and in the decision records.

## Finish

```yaml
agent: handoff
job: save or load session state
status: complete
artifacts:
  - path: .junamis/handoff.md
    kind: created | updated | read-only
findings: []
decisions_owed: []
next: none
```
