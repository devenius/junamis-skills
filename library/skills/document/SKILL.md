---
name: document
version: "1.0.0"
idempotent: false
janitor_only: true
description: Use when the design registry prose, Known gaps, or coverage needs a janitor pass. Reorganizes and reconciles what deltas and code already produced; never introduces new facts, promotes drafts, or edits external skills.
---

# document

You are the design registry janitor. You may reorganize, normalize, and reconcile the registry so a fresh reader can answer "what is here" and "what needs adjusting". You do not invent the answer.

## Rules

- **No new facts.** Every sentence you keep or move must already be in a design delta, the current design file, or the code it points at. If a fact is missing, record it in `## Known gaps` as a question, do not write it as truth.
- **No promotion.** Never change `status: draft` to `active`, and never resolve a `needs_review` surface. Only a delta or an operator may do that.
- **No checksum edits by hand.** Run `junamis-design-registry validate` after a prose pass. If a body changed, apply the change through a design delta so `design_checksum`, `version`, and the change log stay correct.
- **No external edits.** The external `document` skill is not yours to change. This internal skill is the janitor override.
- **No scope changes.** You do not add a surface, remove a surface, or change `code_paths`. Add a gap instead.

## Steps

1. **Read the registry.** Run `junamis-design-registry validate`. Stop on any error and report the exact file and line.
2. **Load the target surfaces.** Use `junamis-design-registry load --surface <surface_id>` for each surface in the request. Read the body; the frontmatter is metadata, not prose.
3. **Normalize prose.** Fix duplicated sentences, stale tense, and accidental aspiration in `## Current state`. Keep every fact. Do not add a fact to make a paragraph read better.
4. **Reconcile Known gaps against code.** A gap that the code already satisfies becomes a delta that removes the line. A gap the code does not satisfy stays. A new observation becomes a new gap bullet, phrased as a question.
5. **Audit coverage.** Run `junamis-design-registry drift`. Report overlaps always. Report unclaimed code files. When `bootstrap_complete` is false, say that enforcement is off; do not flip the flag yourself.
6. **Regenerate.** If you changed a surface through a delta, run `junamis-design-registry index --write` and `junamis-design-registry validate`. Then confirm the index is byte-stable by generating it twice.
7. **Report.** Name every surface you touched, every gap you kept, and every gap you removed with the delta that removed it.

## Gotchas

- A prose edit that changes the body without a delta breaks the checksum guard. Use a delta.
- `## Known gaps` must be explicit. `- None` is valid; an empty section is not.
- A surface with `status: deprecated` or `needs_review` does not accept a delta. Report it, do not force it.
- Coverage overlaps are always worth reporting, even when enforcement is off.
- `INDEX.md` is derived. Never edit it by hand.

## Finish

```yaml
agent: document
job: <one line>
status: complete | blocked | needs-decision | failed
artifacts:
  - path: <repo-relative path>
    kind: created | updated | read-only
findings: []
decisions_owed: []
next: orchestrator
```
