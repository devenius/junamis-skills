# Security final verification — junamis-agents-skills — 2026-11-06

Scope: the working tree after the remediation described in
`docs/reviews/security-2026-11-06.md`, including the N1–N4 fixes and the later
delta (F4 wording detection, local `git ls-tree` cap, atomic temp cleanup, and
the cancellation false-positive fix). Read-only review: no source, config,
workflow, dependency, or test file was edited. The only file created is this
report. All throwaway reproductions ran outside the repository
(`/tmp/opencode/`).

## Method

- Re-ran the exact N1 reproductions from `security-2026-11-06.md`: a project
  root symlink, a `.git` symlink, and a global managed root outside `$HOME`.
- Re-ran the F2 outside-project cases: symlinked `.junamis`, intermediate
  symlink, final symlink, `..`, and another target's managed root.
- Re-checked every original finding against the current code, tests, config,
  lockfile, workflows, and live registry metadata.
- Exercised the newest delta directly: the six `isSecurityCancellation` cases,
  `runCommand`/`runGit` settle timers and timer cleanup, the local
  `git ls-tree` unlimited cap, `validateLibraryManifest` root expectations,
  `atomicWriteFile` cleanup, `validateConfig` export, and trailing newlines.
- Ran `pnpm test`, `pnpm lint`, `pnpm audit`, `pnpm audit --lockfile-only`,
  `pnpm run release:check`, and every check script.

## Final verification table (F1–F17)

| ID | Status | Verification |
|---|---|---|
| F1 | closed | `src/external.js:29-34` pins the registry, scanner name/version, and tarball integrity; `:36-55` strips `NODE_OPTIONS`, `NODE_PATH`, `COREPACK_*`, npm/pnpm config, `CI`, and `GITHUB_ACTIONS`; `:111` forces the constant registry on the `pnpm dlx` command; `:226-289` spawns with `cwd: tmpdir()` and the sanitized env; `:353-356` verifies the registry metadata before the first install. Live `verifyScannerIntegrity()` returned PASS for `skillsio@1.1.3`. |
| F2 | closed | Manifest validation at `src/library-install.js:167-241` rejects absolute paths outside the managed roots, malformed hashes, duplicate paths, final symlinks, non-regular files, and symlink escapes via `actualPath`. `readManifest` validates before use (`:243-256`), and deletion only consumes validated `previous.files` (`:300-324`). Re-ran all five outside-project cases; every one was rejected and every victim survived. See N5 for a separate write-path gap that is not a manifest-entry bypass. |
| F3 | closed | `opencode.json:669-715` sets `bash["*"]` to `"ask"`; `:141-142` denies `.git/config` and `.git/modules/*`; `:7` keeps the top-level default `"ask"`. `validateConfig` passes with 129 read-deny rules. |
| F4 | closed | `src/external.js:128-145` detects alternate security-cancellation wording (`cancel/decline/block/fail`) with whole-word boundaries; `:195` no longer emits `-y`; `:226-289` inherits stdin; the scanner environment strips `CI`/`GITHUB_ACTIONS`. All six required cases pass, plus the exact phrase and uppercase variants. Residual heuristic note below (not counted). |
| F5 | closed | `src/pinned-source.js:182-209` requires `git cat-file -t <sha>` to return `tree` and rejects `120000` symlinks and `160000` gitlinks anywhere under the verified tree. Tests pass. |
| F6 | closed | `src/pinned-source.js:149-158` verifies `rev-parse HEAD` equals the locked 40-hex commit after checkout. Test passes. |
| F7 | closed | `src/external.js:243-288` and `src/pinned-source.js:81-139` use `detached: true`, process-group `SIGTERM`, `SIGKILL` after `KILL_GRACE_MS`, and settle only on close or the final grace timer. A child that ignored `SIGTERM` exited 124 after 5534 ms with `KILL_GRACE_MS = 5000`. |
| F8 | closed | `src/external.js:23,251-258` caps captured output at 64 KiB (tail retained); `src/pinned-source.js:55,117-129` caps remote output and aborts on overflow. A fake git that emitted 100 KB was rejected in 64 ms with “git output exceeded the 64 KiB capture limit”. The local-tree test (600 files, >64 KiB of `ls-tree`) passes. |
| F9 | closed | `opencode.json:719-1232` contains no `http://` key and no `*.vercel.app` / `*.netlify.app` key; the catch-all remains `"ask"`. `validateConfig` and grep both confirm. |
| F10 | closed | Every `uses:` is a full 40-hex SHA in `ci.yml`, `publish.yml`, and `release.yml`. `git ls-remote` confirms `actions/checkout` = v6.1.0, `actions/setup-node` = v6.5.0, `pnpm/action-setup` = the peeled v5.0.0 commit, and `softprops/action-gh-release` = v2.6.2. |
| F11 | closed | `pnpm-workspace.yaml:2-3` overrides `minimatch` to 11.0.4; `pnpm-lock.yaml:435,760` resolve 11.0.4. `pnpm audit` and `pnpm audit --lockfile-only` both report no known vulnerabilities. |
| F12 | closed | `.gitignore:1-8` ignores `.npmrc`, `.env`, `.env.*` (with `!.env.example`), and `.junamis/`. |
| F13 | closed | `src/external.js:83-97` strips OSC, CSI, two-byte ESC, and remaining C0 controls; `:251-258` applies it to stdout and stderr. Tests pass. |
| F14 | closed | `scripts/check-opencode-config.mjs:9-45` now exports `validateConfig`, requires `permission.bash` to be a non-array object, and rejects `bash: "allow"`, `bash["*"]: "allow"`, and `bash["**"]: "allow"`, plus plaintext HTTP and user-content hosts. `test/config.test.js:36-81` exercises the string and catch-all forms through the CLI. |
| F15 | closed | `pnpm-workspace.yaml:1` sets `minimumReleaseAge: 1440`; the old `minimumReleaseAgeExclude` block is gone. |
| F16 | closed | `skills-lock.json` contains no `computedHash`; grep finds none in `src/`, `scripts/`, or `test/`. `check:skills-lock` passes. |
| F17 | closed | `src/cli.js:101-123` adds `readJsonObject` / `describeLibraryManifest`; `:291-334` reports invalid markers/manifests with exit 1; `:336-398` validates `skills-lock.json` and `opencode.json` shapes. The CLI smoke tests for malformed marker, malformed manifest, and malformed config pass. |

## N1–N4 verification

| ID | Status | Verification |
|---|---|---|
| N1 | closed | `src/library-install.js:186-193` computes the expected real root from the real project/home base and requires the actual managed root to equal it. The three exact reproductions are rejected: `.agents/skills -> <project>` (victim `package.json` survives), `.agents/skills -> <project>/.git` (victim `.git/config` survives), and global `~/.agents/skills` outside home (outside victim survives). All errors are `managed root contains a symlink or escapes its expected location`. |
| N2 | closed | `scripts/check-opencode-config.mjs:25-34` rejects the string `"allow"` form and missing/array forms; `test/config.test.js:36-47` covers them. Direct `validateConfig` runs rejected `"allow"`, `{"*":"allow"}`, `{"**":"allow"}`, `[]`, and a missing `bash` key. |
| N3 | closed | `src/external.js:271-284` adds a `SETTLE_GRACE_MS` fallback after `SIGKILL`; `finish` clears the timeout, kill, and settle timers (`:263-270`). `src/pinned-source.js:98-109` has the same fallback. A detached 15 s descendant returned 124 at 7315 ms with zero active `Timeout` resources; the fake-git equivalent rejected at 7313 ms with zero timers. A 3 s descendant returned at 3143 ms. No hang, no leaked timers. |
| N4 | closed | Planned and stale paths are `lstat`-checked before reading: `src/library-install.js:266-276` treats directories/special files as conflicts; `:307-313` does the same for stale entries; `:216-229` rejects non-regular manifest entries. Both directory-at-planned-path and directory-at-stale-path tests pass. See N6 for the remaining `ENOTDIR` variant. |

## New findings (worst first)

### [medium] N5 — Planned install writes still follow symlinked roots/subdirectories outside the managed roots

Where: `src/library-install.js:243-245` (`readManifest` returns `{ files: [] }`
without validating roots when no manifest exists), `:266-276` (planned paths are
`lstat`-ed but their real destination is never checked), `:343-349` (the writes).

Why it matters: the F2/N1 fix validates the manifest and the managed roots only
inside `validateLibraryManifest`, which is only reached from `readManifest` when
a manifest file exists. A hostile project can therefore avoid the check by
shipping no manifest, or can pass it with `{ "files": [] }` and put a symlink
*inside* a managed root (for example `.agents/skills/route -> /outside`). The
planned library paths are then created through the symlink outside the project.
With `--force`, an existing file at the same fixed library name is overwritten.
This is a containment bypass on the write path; it is not the manifest-entry
deletion vector that N1 closed.

Evidence (throwaway scripts, no repository edits):

- No manifest, `.agents -> <outside>`: `applyLibraryInstall` returned
  `ok: true`, created 30 files, and wrote
  `<outside>/skills/route/SKILL.md`.
- End-to-end CLI: `install-library --agent opencode --scope project --dir
  <project>` with `.agents -> <outside>` and no manifest printed `30 create`
  and wrote `<outside>/skills/route/SKILL.md`.
- Valid empty manifest, `.agents/skills/route -> <outside>`: `ok: true`,
  created 30 files, and wrote `<outside>/SKILL.md`.
- `--force` with a pre-existing `<outside>/SKILL.md` containing
  `user data that must survive`: the victim was overwritten (first line became
  `---`).
- Same root cause: a global install with a symlinked `~/.config` writes through
  it on the first run (no manifest) and then fails validation on the second run
  with `managed root contains a symlink or escapes its expected location`.

Suggested fix: extract the expected-root check from
`validateLibraryManifest` into a helper and call it unconditionally at the
start of `applyLibraryInstall` (and, for fail-fast, `planLibraryInstall`). Then
validate every planned file with `actualPath(f.path)` against the actual
managed roots before any `mkdir`/write, rejecting symlinked final components
and any ancestor that resolves outside the roots. Treat a missing manifest as
“no previous files”, not as “skip all containment checks”.

### [low] N6 — A non-directory at a managed root crashes install with `ENOTDIR`, the remaining N4-class case

Where: `src/library-install.js:138-145` (`lstatOrNull` catches only `ENOENT`),
`:216-223` (manifest `lstat` catches only `ENOENT`), `:266-276` (planned
`lstat`).

Why it matters: N4 fixed the directory-at-a-path `EISDIR` case, but a regular
file placed at a managed root (for example `.agents/skills`) still makes every
path below it fail with a raw `ENOTDIR` from `lstat` instead of a clean
conflict/rejection. A project-controlled file can therefore make
`install-library` throw instead of reporting a conflict.

Evidence:

- Manifest entry under `.agents/skills` when `.agents/skills` is a regular
  file: `THREW ENOTDIR: not a directory, lstat '.../.agents/skills/x'`.
- Planned path under the same file: `THREW ENOTDIR: not a directory,
  lstat '.../.agents/skills/db-migrate/SKILL.md'`.

Suggested fix: treat `ENOTDIR` like `ENOENT` in `lstatOrNull`, `realpathOrNull`,
and the manifest `lstat` block, and explicitly `lstat` each managed root:
accept absent or a directory, and reject any other existing type with a clean
“managed root is not a directory” diagnostic.

## Regression checks on the newest delta

| Check | Result |
|---|---|
| `isSecurityCancellation` six required cases | PASS: exact phrase, “Security scan blocked by policy”, and “security check fails” return true; “security scan passed”, “No security issues found”, and “Security update available; no failures” return false. Uppercase and alternate forms also pass. |
| `runCommand` settle timer | PASS: detached 15 s descendant returned 124 at 7315 ms, zero active `Timeout` resources. |
| `runGit` settle timer | PASS: fake git with a detached 15 s descendant rejected as “git operation timed out” at 7313 ms, zero active `Timeout` resources. |
| SIGKILL escalation | PASS: a child ignoring `SIGTERM` returned 124 at 5534 ms with `KILL_GRACE_MS = 5000`. |
| Local `git ls-tree` cap | PASS: `maxBytes: 0` is used for `rev-parse`, `cat-file`, and `ls-tree`; the 600-file local-tree test passes. Remote commands still use the 64 KiB cap. |
| `validateLibraryManifest` global expected root | PASS: global roots outside `$HOME` are rejected; normal global install still resolves. Compatibility note: any symlinked component under home (for example `~/.config`) is now rejected on the second run, which is the intended fail-closed behavior but can break dotfile setups. |
| `atomicWriteFile` cleanup | PASS: forcing a `rename` failure left no `*.tmp` file in the target directory. |
| `validateConfig` export | PASS: the function is exported and importable without running the CLI. |
| Trailing newlines | PASS: every listed `src/`, `scripts/`, and `test/*.test.js` file ends with a newline. |

Informational residuals (not counted):

- F4 detection is still a best-effort English heuristic. It treats
  “security … no failure” (singular) as a cancellation (fail-closed), and it
  does not recognize “aborted”, “rejected”, or “skipped” wording. The primary
  control is now the removal of `-y` plus inherited stdin, so this is a
  defense-in-depth limitation, not the original exact-string bypass.
- F10 still grants `contents: write` workflow-wide in `release.yml:14-15`; the
  action pins themselves are correct. This was a pre-existing suggestion, not
  a regression.
- F1 still uses the shared `tmpdir()` as the scanner `cwd`; the prior residual
  note applies. No new project-controlled path selects the scanner.
- F13 still does not strip 8-bit C1 controls; terminal-dependent and unchanged.

## Commands run

| Command | Result |
|---|---|
| `pnpm test` | 127 tests, 127 pass, 0 fail, exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm audit` | No known vulnerabilities found, exit 0 |
| `pnpm audit --lockfile-only` | No known vulnerabilities found, exit 0 |
| `pnpm run release:check` | `release check passed for 1.0.0`, exit 0 |
| `pnpm run check:config` | `✔ opencode.json valid`, exit 0 |
| `pnpm run check:skills-lock` | `skills lock valid: 24 pinned skills across 10 source commits`, exit 0 |
| `pnpm run check:pack` | `package contents valid: 49 files, 213942 unpacked bytes`, exit 0 |
| `pnpm run check:yaml` | `yaml check passed (4 files)`, exit 0 |
| `git diff --check` | exit 0 |

## Secrets and authorization

Grep for private-key headers (`BEGIN … PRIVATE KEY`) and GitHub token prefixes
(`gh[pousr]_…`) found no matches in the tree. The existing placeholder
`YOUR_GITHUB_TOKEN` in `.npmrc.example` / `README.md` is unchanged. This package
is CLI-only, so there is no HTTP authorization surface; the equivalent control
is the managed-root containment covered by F2/N1/N5.

## Counts

| Category | Closed | Partial | Open |
|---|---:|---:|---:|
| Original findings F1–F17 | 17 | 0 | 0 |
| New findings N1–N4 | 4 | 0 | 0 |
| New findings N5–N6 | 0 | 0 | 2 |
| **Total tracked** | **21** | **0** | **2** |

New-issue severity counts: critical 0, high 0, medium 1 (N5), low 1 (N6).

**Verdict:** All 17 original findings and N1–N4 are closed and the reported
attacks no longer reproduce; two new residuals remain in the library install
write path—N5 (medium, managed-root escape through planned symlinked paths) and
N6 (low, `ENOTDIR` crash on a non-directory managed root)—so the tree is not
fully clean yet.

```yaml
agent: reviewer
job: Read-only final verification of F1-F17 and N1-N4, plus the newest remediation delta
status: complete
artifacts:
  - path: docs/reviews/security-2026-11-06-final.md
    kind: created
findings:
  - id: N5
    severity: medium
    summary: Planned install writes still follow symlinked managed roots or subdirectories outside the managed roots, and --force can overwrite an existing fixed-name file.
    evidence: src/library-install.js:243-245, :266-276, :343-349; throwaway install and CLI wrote 30 files outside the project and overwrote an outside SKILL.md with --force.
  - id: N1
    severity: medium
    summary: Fixed and verified; all three symlinked-root deletions are rejected and the victims survive.
    evidence: src/library-install.js:186-193; reproduction output rejected with managed-root error.
  - id: N6
    severity: low
    summary: A regular file at a managed root still crashes install-library with ENOTDIR instead of a clean conflict.
    evidence: src/library-install.js:138-145, :216-223, :266-276; lstat threw ENOTDIR for both a manifest entry and a planned path.
  - id: F4
    severity: low
    summary: Closed for the reported bypass; the cancellation detector remains a best-effort English heuristic with fail-closed false positives and some unrecognized wording.
    evidence: src/external.js:128-145; six required cases pass.
  - id: N3
    severity: low
    summary: Fixed and verified; no hang and no leaked timers remain.
    evidence: src/external.js:263-284, src/pinned-source.js:98-109; 7315 ms / 7313 ms settle with zero active timers.
decisions_owed: []
next: user
```
