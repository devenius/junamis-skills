---
name: route
version: "1.0.0"
description: Use first on every new user request to decide which path it belongs to (feature, bug, refactor, dependency, migration, release, deploy verification, rollback, incident, security, performance, environment, decision, skill, question), routing to internal and external skills alike. Use when the request is not yet classified. When the first skill is external, the orchestrator must run route-external before dispatch. Do not use to do the work itself; it only decides where the work goes.
---

# route

Decide the path for one request and state it in one line. Do no other work.

## Inputs

- The user request, verbatim.
- `.junamis/handoff.md` if it exists, for the current goal.
- `docs/decisions/` titles, if the directory exists.
- The installed skill inventory: internal skills under `~/.config/junamis/skills/skills/*/SKILL.md` and external skills under the target external skills directory (`~/.agents/skills/*/SKILL.md` for OpenCode, `~/.claude/skills/*/SKILL.md` for Claude Code).

## Paths

| Path | Signals | First skill | Owner agent |
|---|---|---|---|
| environment | "won't run", "setup", "env", "node version" | `env-doctor` | context-keeper |
| decision | "we decided", "record this", "going with X" | `decision-record` | context-keeper |
| tests | "write tests for this change", "cover this with tests", "add a test suite" (after the code exists) | `test` (external) | maintainer |
| tdd | "build this test-first", "red-green", "TDD this feature" (tests come before the code) | `tdd` (external) | orchestrator |
| bug | "broken", "error", "wrong output", "fails" | `debug` (external) | orchestrator |
| refactor | "clean up", "restructure", "no behavior change" | `refactor-safely` | maintainer |
| dependency | "upgrade X", "bump", "CVE in X" | `dependency-upgrade` | maintainer |
| migration | "add column", "change schema", "migrate data" | `db-migrate` | maintainer |
| deploy verification | "check a deployed app", "run post-deploy smoke checks", "verify health after release" | `deploy-verify` | operator |
| rollback | "roll back", "return to the previous release", "restore the previous deployment" | `rollback` | operator |
| feature | "add", "build", "new page", "support X" | `architect` then `develop` (external) | orchestrator |
| nextjs | "next.js", "app router", "server component", "server action" | `nextjs` | nextjs |
| nestjs | "nestjs", "nest module", "guard", "pipe", "interceptor" | `nestjs` | nestjs |
| frontend | "ui", "component", "layout", "form", "table", "modal", "shadcn" | `frontend` | frontend |
| release | "release", "tag", "ship", "deploy" | `release-prep` | operator |
| incident | "prod is down", "users report", "spike", "outage" | `incident-response` | operator |
| security | "is this safe", "audit", "secrets", "auth review" | `security-audit` | reviewer |
| performance | "slow", "bundle size", "latency", "web vitals" | `perf-budget` | reviewer |
| skill | "make a skill", "update a skill", "agent for" | `skill-author` | maintainer |
| grill | "grill me", "stress-test this plan", "challenge this design", "poke holes" | `grill-me` or `grill-with-docs` (external) | orchestrator |
| research | "what's the latest", "how do I use X in v3", "compare X and Y", "is CVE-... affecting us", "docs for" | `research` | researcher |
| question | asks about this repo's code or decisions, no outside info needed, no change requested | none | orchestrator answers directly |

External skills (for example `debug`, `architect`, `develop`, `tdd`, `grill-me`) are installed from the upstream manifest, not from this library. The full list and their owners are in `~/.config/junamis/skills/EXTERNAL.md`. If one is not installed, stop and tell the user. Do not substitute. `route-external` is never a path itself; it is the orchestrator's adapter step for an external first skill.

## Steps

1. **Understand first.** Restate the task in one line: what changes, for whom, and what "done" looks like. Name the expected artifact. If two paths fit, or "done" is unclear, ask one question and wait. Do not guess.
2. Read the request. If it names more than one path, pick the one that must finish first. A bug in a release goes to `incident-response` or `debug`, not `release-prep`.
3. If an installed external skill matches the request and no internal skill does, that external skill is the path. Say that the orchestrator must run `route-external` before dispatch, so the run ends with a HANDOFF block.
4. Write one line: `path: <name> | first: <skill> | reason: <why, under 15 words>`.
5. Update `.junamis/handoff.md` only if the goal changed. Otherwise leave it.

## Gotchas

- "Fix" is a bug, a refactor, or a dependency bump. Check which before routing.
- "Deploy" usually means `release-prep` then a user-run deploy. It is never a direct production action from this library.
- Do not route to a skill because its name matches a word. Route by what must change.
- If the user explicitly names a skill, honor it unless it clearly conflicts with the request. Say so if it does.
- Any request that needs information from outside the repo goes to `research`, even if it is phrased as a question.
- Any request whose work would run a command in the approval gate (`~/.config/junamis/skills/SAFETY.md`) is routed normally. The gate is applied by the owner agent, not by routing.
- Do not ignore external skills. An installed external skill that fits is a valid path even when the table has no row for it.
- `route-external` is the orchestrator's adapter step, not a user path. Route to the external skill itself and let the orchestrator adapt it.

## Finish

```yaml
agent: route
job: classify request
status: complete
artifacts: []
findings: []
decisions_owed: []
next: <first skill from the table>
```

If the request is a question, `next: none`. If it is ambiguous, `status: needs-decision` with the question in `decisions_owed`.
