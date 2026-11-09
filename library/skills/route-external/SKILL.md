---
name: route-external
version: "1.0.0"
description: Use when the orchestrator is about to dispatch an external skill and that skill must report back in this project's HANDOFF format. Reads the installed external SKILL.md, maps its done, gates, and failure modes to our statuses, and writes a reusable adapter under .junamis/adapters/. Do not use to edit, copy, or rewrite upstream skill content, and do not use for internal library skills.
---

# route-external

You are the orchestrator's adapter maker. You take one installed external skill and give it this project's reporting contract without changing the upstream skill.

## Inputs

- The external skill name and its installed `SKILL.md` path.
- The user request, verbatim.
- The matching row in `library/SAFETY.md` and entry in `skills-lock.json`.
- The HANDOFF contract in `~/.config/junamis/skills/HANDOFF.md`.

## Steps

1. **Locate.** Find `<name>/SKILL.md` under `~/.agents/skills/` (OpenCode) or `~/.claude/skills/` (Claude Code). If it is missing, stop with `status: blocked` and name it. Do not install it yourself.
2. **Read only.** Read the external `SKILL.md` and any file it says is required. Do not edit it and do not copy its body into the adapter. Quote at most the short trigger or done line you need.
3. **Extract.** Record in your own words:
   - its definition of done and the evidence it produces;
   - the artifacts it writes;
   - the commands it runs, and which ones are on the `SAFETY.md` gate;
   - the questions it tends to ask and the failures it can report.
4. **Map status.**
   - its done, with evidence present -> `complete`
   - a question only the user can answer -> `needs-decision`
   - a missing tool, dependency, install, or red baseline -> `blocked`
   - it ran and did not reach its done -> `failed`
5. **Write the adapter** to `.junamis/adapters/<name>.md` with:
   - upstream source and pinned ref from `skills-lock.json`, and the installed path;
   - the task in the user's words;
   - the short run brief: read the external `SKILL.md`, follow it, stop at the gates, end with one HANDOFF block;
   - the evidence required before `complete`;
   - the gated commands, each marked "ask the user first; not approved by this adapter";
   - a filled HANDOFF template with `agent: <name> (external)`, `status`, `artifacts`, `findings`, `decisions_owed`, `next: orchestrator`.
6. **Check the adapter.** No copied upstream prose beyond a short quote. Every `next` resolves to a skill, an agent, `user`, or `none`. Every gated command has an approval line.
7. **Return.** Report the adapter path. If the external skill already ends in a HANDOFF-compatible block, write a pass-through adapter that says so and keep the same steps.

## Gotchas

- The adapter is a wrapper. The external skill stays untouched.
- Do not put a gate in the adapter as already approved. Approval belongs to the user in the session.
- Do not adapt an internal library skill. Internal skills already end with a HANDOFF block.
- Do not adapt a skill that is not installed. Stop and tell the user.
- One adapter per external skill. Reuse and refresh it instead of writing a second one.
- Never copy external instructions into `library/`; that is upstream content.

## Finish

```yaml
agent: route-external
job: adapt external skill <name>
status: complete | blocked | needs-decision
artifacts:
  - path: .junamis/adapters/<name>.md
    kind: created | updated
findings: []
decisions_owed: []
next: <the adapted external skill>
```
