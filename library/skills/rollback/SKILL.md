---
name: rollback
version: "1.0.0"
description: Use to return a deployed release to the previous version. Reads the rollback plan written at release time, lists each step, and runs them only after the user explicitly confirms in this session. Verifies the result afterward. Do not use without a rollback plan; write one with release-prep first, or stop.
---

# rollback

Restore the last good state, with a confirmed plan and a verified result.

## Inputs

- Version to roll back from, and the target version to restore.
- `docs/releases/rollback-<version>.md`. If it is missing, stop with `status: blocked` and route to `release-prep`.

## Steps

1. **Read the plan.** Show the user the steps from the rollback file, in order, and the data-loss note if one exists.
2. **Ask.** Require the user to reply with an explicit confirmation naming the version (for example "roll back 2.4.1"). A general "yes" is not enough. Stop with `status: needs-decision` until you have it.
3. **Check state.** Confirm the target version still exists (tag or artifact) and the current deploy is the version named.
4. **Execute.** Run the steps in order, only after the confirmation in step 2. Each step that deploys, deletes, or changes git history is a gated command: name it to the user before running it (see `~/.junamis/library/SAFETY.md`). Stop at the first failure. Record each step's output.
5. **Migrations.** If the plan reverses a migration, run it only if the plan marks it safe. Otherwise stop and report. Code rollback does not undo schema changes.
6. **Verify.** Run `deploy-verify` against the same base URL. The rollback is not done until it passes.
7. **Record.** Write `docs/releases/rollback-<version>.md` with the steps run, their outputs, and the verification result.

## Gotchas

- A code rollback on a schema that has moved forward can break the old code. Check the expand/contract state first.
- Rolling back a release does not restore data written after it deployed. Say so in the record.
- Never force-push or rewrite history to roll back. Redeploy the older artifact.
- If you are unsure whether a step is reversible, do not run it. Ask.

## Finish

```yaml
agent: rollback
job: roll back <version> to <target>
status: complete | blocked | needs-decision | failed
artifacts:
  - path: docs/releases/rollback-<version>.md
    kind: created
findings: []
decisions_owed:
  - confirm rollback of <version> to <target>?
next: deploy-verify
```

Use `next: deploy-verify` after the rollback runs, so the result is checked. Use `next: user` when the rollback is not executed.
