# 0003. Install external skills globally; project copies are verification only

Status: Accepted
Date: 2026-10-27
Supersedes: none

## Context
The project-local install in `.agents/skills/` was a workaround. The user wants global by default, so skills can be shared across projects. Global install with `skillsio -g --agent opencode` writes to `~/.agents/skills/`, not `~/.config/opencode/skills/` as the earlier target assumed.

## Decision
- All 24 external skills in `skills-lock.json` are installed globally to `~/.agents/skills/`.
- The OpenCode target in `src/targets/opencode.js` resolves to `~/.agents/skills`.
- `scripts/check-skills-sync.mjs` verifies the global directory.
- Untracked skills in the global directory (the user's own `find-skills`, `nestjs-*`, and frontend skills) are reported as warnings, not failures. They are not managed by this manifest.
- Removing the project-local `.agents/skills/` copies needed the user's approval. Approved and done on 2026-10-27; the folder and `src/postinstall.js` were deleted.

## Consequences
- Before install, the global directory was checked for clashes against the 24 names. Only `driftlock` clashed, and that was the copy installed in this step.
- All 24 global `SKILL.md` files were compared with the scanned project copies: 0 mismatches.
- Editing this repo does not change installed skills. Reinstall to update.
- The `postinstall` hook was removed. `junamis-skills init` is the only way to write the guide.

## Related changes in the same step
- `postinstall` removed from `package.json`. Its tests were removed. `src/postinstall.js` was deleted after approval on 2026-10-27.
- `tdd` and `test` routing rules added to `route` and the orchestrator table.
- `verify-commands.sh` restricted to user-named requests, in a throwaway worktree.
