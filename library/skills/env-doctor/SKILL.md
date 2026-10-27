---
name: env-doctor
description: Use when the project will not install, build, or run locally, or before starting work on an unfamiliar machine. Checks runtime and package-manager versions against the project's declared requirements, lockfile presence, and which environment variable names the code needs. Writes docs/env-report.md. Do not use to install software or to set secret values.
---

# env-doctor

Diagnose the local environment and report what is wrong, with the exact fix command. Change nothing.

## Checks

Run each check. Record pass, fail, or unknown with evidence.

1. **Runtime.** Read `engines` in `package.json` (or `.nvmrc`, `.tool-versions`). Compare with `node --version`. Fail if the installed major is below the minimum.
2. **Package manager.** Read `packageManager` in `package.json`. Compare with the tool actually on PATH. Fail on mismatch.
3. **Lockfile.** Exactly one lockfile should exist for the declared manager. Fail if zero, or if more than one.
4. **Env names.** Find env var names the code reads (`process.env.NAME`, `import.meta.env.NAME`, or the project's config loader). Compare with `.env.example`. Report names missing from the example. Never print values, and never open `.env` for reading values.
5. **Services.** Only check services the user has named or the project config declares. Report reachability as pass or fail. Do not start services.
6. **Scripts.** Confirm the scripts the project's docs name (`dev`, `build`, `test`) exist in `package.json`.

## Output

Write `docs/env-report.md`:

```markdown
# Environment report

Checked: <YYYY-MM-DD HH:MM>

| Check | Result | Evidence |
|---|---|---|
| Runtime | pass | node 22.4.0 >= 20 |

## Fixes
- <exact command for each failure>
```

## Gotchas

- Read `engines` before you decide a version is wrong. Projects pin different minimums.
- `.env` contains secrets. Compare names only, using `grep -o` on keys or the example file.
- Do not install, upgrade, or switch versions. Print the command and let the user run it.
- A missing `.env.example` is a finding. A missing `.env` is not, unless the code requires it at startup.

## Finish

```yaml
agent: env-doctor
job: environment check
status: complete | failed
artifacts:
  - path: docs/env-report.md
    kind: created
findings:
  - id: F1
    severity: high
    summary: <failing check>
    evidence: <command and output>
decisions_owed: []
next: user
```

Use `status: failed` when a check that blocks running fails. Set `next` to the originating skill when every check passes.
