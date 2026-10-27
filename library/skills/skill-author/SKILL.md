---
name: skill-author
description: Use to create or update a skill inside library/skills/ so it meets the Agent Skills format, has a routing-rule description, and triggers on the right prompts. Checks for overlap with existing library skills first and runs the library test. Do not use to edit external skills from the upstream manifest; those are not ours to change.
---

# skill-author

Write one skill, in the library, that a fresh agent can run without asking questions.

## Rules the skill must meet

- Folder name, `name` field, and parent folder are the same, lowercase, hyphenated.
- `description` says when to use it and when not to, in one line. Under 1024 characters.
- Body under 500 lines. Put long reference material in `references/` and say when to load each file.
- Ends with a `Finish` section containing the HANDOFF block from `library/HANDOFF.md`.
- Every `next` value names a skill, an agent, `user`, or `none`.
- Says what it does not do.

## Steps

1. **Overlap check.** List `library/skills/`. If an existing skill covers the same trigger, stop and propose extending it instead.
2. **Trigger check.** Write five prompts that should trigger the skill and five that should not. Confirm each negative belongs to another skill or to none. Put the prompts in the reply, not in a file.
3. **Draft.** Write `library/skills/<name>/SKILL.md` with these sections: frontmatter, inputs, steps, gotchas, finish.
4. **Assign.** Add the skill to exactly one agent's `skills:` list in `library/agents/`. If no agent fits, propose one. Do not create an agent without asking.
5. **Test.** Run `pnpm test`. Fix every failure before reporting done.

## Gotchas

- A description that summarizes ("handles databases") never triggers. Describe the situation the user is in.
- Do not explain what the agent already knows. Keep what is specific to this project.
- A skill that does two jobs should be two skills. Split on context boundary.
- Do not put external skill content into the library. Write original instructions.

## Finish

```yaml
agent: skill-author
job: create or update <name>
status: complete | blocked | needs-decision
artifacts:
  - path: library/skills/<name>/SKILL.md
    kind: created | updated
findings: []
decisions_owed:
  - which agent owns <name>?
next: none
```
