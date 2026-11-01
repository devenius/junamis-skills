---
name: security-audit
version: "1.0.0"
description: Use to review a diff, a branch, or the whole repo for security problems: committed secrets, vulnerable dependencies, missing authorization on endpoints, unsafe input handling, and risky configuration. Read-only. Writes findings to docs/reviews/security-<date>.md, worst first. Do not use to fix code or to test a live system with attack traffic.
---

# security-audit

Find security defects and prove each one with a file and line. Change no code.

## Scope

Ask which scope if not given: `diff <base>..<head>`, a path, or the whole repo. Default to the diff against the default branch.

## Checks

1. **Secrets.** Scan the scope for high-entropy strings, private key headers, and common token prefixes. Scan git history of the scope too if the user asks. Report the location, never the value.
2. **Dependencies.** Run the project's audit command (`pnpm audit`, `npm audit`, or equivalent) and record advisories by severity. Do not install fixes.
3. **Authorization.** For each route or handler in scope, confirm an authentication check and an ownership check where data is per-user. Flag any handler with neither.
4. **Input.** Flag string-built SQL, shell commands with interpolated input, `eval`, unsafe deserialization, and HTML rendered from user input without escaping.
5. **Config.** Flag `CORS *` with credentials, debug flags enabled by default, cookies without `HttpOnly`, `Secure`, or `SameSite`, and TLS verification disabled.
6. **Logging.** Flag logs that include passwords, tokens, or full request bodies from auth routes.

## Output

`docs/reviews/security-<YYYY-MM-DD>.md`, one section per finding:

```markdown
## [critical] <title>
Where: <file:line>
Why it matters: <one sentence>
Evidence: <the line or command output, with secrets redacted>
Suggested fix: <one sentence, not applied>
```

End the file with counts by severity.

## Gotchas

- A finding without a file and line is not a finding. Drop it or mark it unverified.
- Do not mark something "safe" because a framework usually handles it. Confirm in this code.
- Do not print a secret to prove it exists. Print its file, line, and type.
- Do not run exploits or send attack payloads at any running service.

## Finish

```yaml
agent: security-audit
job: security review of <scope>
status: complete | failed
artifacts:
  - path: docs/reviews/security-<YYYY-MM-DD>.md
    kind: created
findings:
  - id: F1
    severity: critical
    summary: <title>
    evidence: <file:line>
decisions_owed: []
next: user
```

List at most five findings in the handoff block. The full list is in the file. Use `next: maintainer` only if the user asks for fixes.
