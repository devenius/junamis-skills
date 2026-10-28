---
name: deploy-verify
version: "1.0.0"
description: Use after the user has deployed, to confirm the live or staging environment is healthy. Probes health and readiness endpoints with GET requests only, runs the smoke checks listed in the release notes, and reports pass or fail with evidence. Do not use to deploy, to send write requests, or to log in with real user credentials.
---

# deploy-verify

Confirm the deploy is alive and the critical paths respond. Read only.

## Inputs

- Base URL of the environment (ask if not given).
- The release notes file, `docs/releases/<version>.md`, for the version being verified.

## Steps

1. **Health.** `GET <base>/health` (or the endpoint the project documents). Expect 200 within 2 seconds.
2. **Readiness.** `GET <base>/ready` if it exists. Expect 200. A 200 on health with a failing ready means the dependencies are down: report it as a finding.
3. **Version.** If the health response includes a version or commit, compare with the release. A mismatch means the old version is still serving: fail.
4. **Smoke.** Read the smoke list from the release notes. For each path, send a GET and record the status code. Do not send POST, PUT, PATCH, or DELETE.
5. **Errors.** Sample the error rate from logs or the platform if the user has given access. Otherwise say it was not checked.
6. **Decide.** All checks pass: `complete`. Any critical path fails: `failed`, and set `next: rollback`.

## Gotchas

- Health returning 200 does not prove the app works. Check at least one real path.
- Do not follow redirects into a login page and call that a pass. Report the redirect.
- A preview URL is not production. Name which environment was checked.
- Do not retry a failing POST to "see if it works now". This skill never writes.

## Finish

```yaml
agent: deploy-verify
job: verify <version> at <base>
status: complete | failed
artifacts:
  - path: docs/releases/<version>.md
    kind: read-only
findings:
  - id: F1
    severity: critical
    summary: GET /checkout returns 500
    evidence: "<timestamp> GET /checkout -> 500"
decisions_owed: []
next: rollback
```

Set `next: none` on success. Set `next: rollback` only on a critical failure, and the orchestrator will still ask the user before rolling back.
