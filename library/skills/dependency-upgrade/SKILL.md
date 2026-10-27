---
name: dependency-upgrade
description: Use to upgrade one dependency to a named version, or to resolve a security advisory for one package. Reads the upstream changelog, lists breaking changes, applies the bump in isolation, and runs the project's tests. Do not use to upgrade several packages at once, to change the package manager, or for transitive pins nobody asked about.
---

# dependency-upgrade

Upgrade exactly one package, prove nothing else changed, and hand the proof to the tests.

## Inputs

- Package name and target version (or "latest stable").
- Reason: feature need, advisory ID, or routine maintenance.

If the target is missing, ask for it. Do not pick "latest" silently for a major version.

## Steps

1. **Baseline.** Run the project's test command and record the result. If it fails before any change, stop with `status: blocked`.
2. **Read the upstream.** Fetch the package's changelog or release notes for every version between current and target. Record breaking changes. Note the source URL.
3. **Check peers.** Read `peerDependencies` of the new version. Report any conflict with installed packages.
4. **Apply.** Change only that package's version constraint. Install with the project's package manager so the lockfile updates.
5. **Diff the lockfile.** Confirm the changed entries are the target package and its own dependencies. Anything else is a finding.
6. **Verify.** Run the test command, then the build command if one exists. Compare with the baseline.
7. **Code impact.** Search the repo for imports and API names listed as breaking. Fix only call sites that the breaking changes require.

## Gotchas

- A major version bump is a decision. If the changelog lists breaking changes, set `status: needs-decision` unless the user already asked for that version.
- Lockfile churn across unrelated packages means the install did more than asked. Revert and report.
- Do not add `overrides` or `resolutions` to force a version unless the user approves. They hide conflicts.
- An advisory fix needs the fixed version confirmed in the advisory, not guessed from the package name.

## Finish

```yaml
agent: dependency-upgrade
job: upgrade <package> to <version>
status: complete | blocked | needs-decision | failed
artifacts:
  - path: package.json
    kind: updated
  - path: <lockfile>
    kind: updated
findings:
  - id: F1
    severity: high
    summary: breaking change <what> affects <file>
    evidence: <changelog url>, <file:line>
decisions_owed:
  - approve major version bump to <version>?
next: test
```

Set `next: test` when the verification passed. Use `next: user` when blocked or when the decision is owed.
