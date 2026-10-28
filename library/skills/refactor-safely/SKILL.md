---
name: refactor-safely
version: "1.0.0"
description: Use when the user asks to restructure, rename, extract, or clean up code and explicitly says behavior must not change. Locks current behavior with characterization tests before editing, then changes code in small steps with the tests run after each step. Do not use when behavior is meant to change; that is a feature or a bug fix.
---

# refactor-safely

Change the shape of code without changing what it does. Prove it with tests written before the change.

## Steps

1. **Scope.** Name the files and the goal in one sentence. If the scope spans more than about 10 files, split it and confirm the first slice with the user.
2. **Find the behavior.** Read the code. List its public inputs and outputs, side effects, and error paths.
3. **Characterize.** Write tests that assert current behavior, including odd behavior. Run them. They must pass on unmodified code. If one fails, stop: the behavior is not understood yet.
4. **Refactor in steps.** One transformation per step (rename, extract function, move module). After each step, run the tests and the type check or linter if the project has one.
5. **Stop on red.** If a test fails, revert that step, do not patch the test, and report the step that broke it.
6. **Confirm.** Run the full test command once at the end. Compare the public API surface with the baseline.

## Gotchas

- Do not "fix" the characterization tests to match a refactor. A changed expectation is a behavior change.
- Do not mix a bug fix into a refactor. Note the bug as a finding and route it to `debug`.
- Renames across exports break importers outside the repo. Search for usages in the whole repo first.
- Tests that always pass prove nothing. Break the code on purpose once to confirm the tests catch it.

## Finish

```yaml
agent: refactor-safely
job: refactor <scope>
status: complete | blocked | failed
artifacts:
  - path: <changed source files>
    kind: updated
  - path: <new characterization test files>
    kind: created
findings:
  - id: F1
    severity: medium
    summary: unrelated bug found during refactor
    evidence: <file:line>
decisions_owed: []
next: test
```

Use `next: test` when the suite passes. Use `next: debug` if a finding is a real bug the user wants fixed.
