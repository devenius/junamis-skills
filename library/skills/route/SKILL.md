---
name: route
version: "1.0.0"
description: Use first on every new user request to decide which path it belongs to (feature, bug, refactor, dependency, migration, release, incident, security, performance, environment, decision, skill, question). Use when the request is not yet classified. Do not use to do the work itself; it only decides where the work goes.
---

# route

Decide the path for one request and state it in one line. Do no other work.

## Inputs

- The user request, verbatim.
- `.junamis/handoff.md` if it exists, for the current goal.
- `docs/decisions/` titles, if the directory exists.

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

External skills (`debug`, `architect`, `develop`) are installed from the upstream manifest, not from this library. If one is not installed, stop and tell the user. Do not substitute.

## Steps

1. Read the request. If it names more than one path, pick the one that must finish first. A bug in a release goes to `incident-response` or `debug`, not `release-prep`.
2. If the request could be two paths, ask one question with the two options. Do not guess.
3. Write one line: `path: <name> | first: <skill> | reason: <why, under 15 words>`.
4. Update `.junamis/handoff.md` only if the goal changed. Otherwise leave it.

## Gotchas

- "Fix" is a bug, a refactor, or a dependency bump. Check which before routing.
- "Deploy" usually means `release-prep` then a user-run deploy. It is never a direct production action from this library.
- Do not route to a skill because its name matches a word. Route by what must change.
- If the user explicitly names a skill, honor it unless it clearly conflicts with the request. Say so if it does.
- Any request that needs information from outside the repo goes to `research`, even if it is phrased as a question.
- Any request whose work would run a command in the approval gate (`library/SAFETY.md`) is routed normally. The gate is applied by the owner agent, not by routing.

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
