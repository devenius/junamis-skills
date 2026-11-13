# Publishing `@devenius/junamis-skills` to npm

This is the maintainer runbook for the npmjs release of `@devenius/junamis-skills`. npmjs is the primary public registry; GitHub Packages is the mirror.

**The user runs every publish and deprecate command.** The agent prepares the exact command and the release metadata and stops. None of the registry mutations below (`npm publish`, `npm stage publish`, `npm deprecate`, `npm unpublish`, `npm dist-tag`, `npm owner`, `npm access`) are ever run by the agent. They are gated by [`library/SAFETY.md`](../../library/SAFETY.md) and need a single-use approval that names the exact command.

## Prerequisites

- An npmjs account that owns the `@devenius` scope, with 2FA enabled. Staged publishing requires 2FA for the final approval.
- Node 26 or newer.
- npm 11.15 or newer. Staged publishing (`npm stage publish`) does not exist in older npm. Check with `npm -v`.
- **A dedicated npmjs userconfig.** The local `~/.npmrc` maps `@devenius:registry` to GitHub Packages, which would hijack a publish. Point the npmjs commands at a separate userconfig so the scope mapping does not apply:

  ```bash
  # ~/.config/npmjs/npmrc  (no secrets committed to any repo)
  registry=https://registry.npmjs.org/
  //registry.npmjs.org/:_authToken=${NPM_TOKEN}
  ```

  Then run publish commands with `--userconfig ~/.config/npmjs/npmrc`, or export `NPM_CONFIG_USERCONFIG=~/.config/npmjs/npmrc` for the session. Never commit a token to the repository, the README, or a committed `.npmrc`.

## Current state

- The package is bootstrapped with a placeholder, `1.0.0-placeholder.0`, published under the `placeholder` tag.
- `latest` still points at `0.0.0-stage`, so `npx @devenius/junamis-skills@latest` does not run a working installer yet.
- The release candidate is **`1.1.0`**: `package.json` is `1.1.0`, `CHANGELOG.md` has `## [1.1.0] - 2026-11-13`, and `docs/releases/1.1.0.md` is the release note.
- A GitHub Actions trusted publisher is configured for this repository. **Assumed values:** workflow `publish.yml`, environment `npm-publish`. Confirm these on npmjs.com under the package's **Publishing → Trusted publisher** settings; if the real workflow filename or environment differs, update it there (the file name here is documentation, not a second source of truth).
- The first usable release is **`1.1.0`**. There is no real npm `1.0.0`: the GitHub tag/release `v1.0.0` already exists and is not an npm release.

## The 48-hour validation window

Configure the trusted publisher only when a release is ready. After the trusted publisher is first saved, the first successful publish must happen within 48 hours or the trust configuration expires and must be set up again; do not configure it early. This is the general rule. If the existing trusted publisher has already been validated by a successful publish, the window no longer applies and you can go straight to the tagged release.

## First usable release (`1.1.0`)

1. **Bump and notes (agent).** `release-prep` sets `package.json` to `1.1.0`, adds `## [1.1.0] - 2026-11-13` to `CHANGELOG.md`, and writes `docs/releases/1.1.0.md` as the release note. It produces the release candidate and does not tag.
2. **Merge, then tag (user).** Merge the release pull request and pull `main`, then create and push the tag. The tag and the commit are user actions:

   ```bash
   git switch main && git pull
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. **CI stages npmjs and publishes GitHub Packages.** The `publish.yml` tag workflow runs. Its `publish-github` job publishes the package to GitHub Packages with `GITHUB_TOKEN` and `packages: write`. Its `publish-npm` job uses OIDC (`id-token: write`), the `npm-publish` environment, and `npm stage publish` to stage `1.1.0` to npmjs; staging does not make it public.
4. **Approve on npmjs.com (user).** A maintainer opens the package's **Staged publishing** page on npmjs.com, reviews the staged `1.1.0`, and approves it with 2FA. Approval is what makes `1.1.0` public and moves `latest` to it.
5. **Verify the dist-tag (user).**

   ```bash
   npm view @devenius/junamis-skills dist-tags --registry=https://registry.npmjs.org/
   npx @devenius/junamis-skills@latest status
   ```

   `latest` must now be `1.1.0`. The npmjs path in the README is safe from this point.
6. **Deprecate the placeholder (user).** With `1.1.0` live, deprecate `1.0.0-placeholder.0` so nobody installs it. Use the dedicated npmjs userconfig from [Prerequisites](#prerequisites) so the `@devenius` scope mapping does not redirect the command:

   ```bash
   npm deprecate "@devenius/junamis-skills@1.0.0-placeholder.0" "Placeholder; use 1.1.0 or newer" --userconfig ~/.config/npmjs/npmrc
   ```

   Deprecation does not change a dist-tag; keep `latest` on `1.1.0`.

## Trusted publisher fields

npmjs.com → the package → **Settings → Trusted publisher** (GitHub Actions):

| Field | Value |
|---|---|
| Owner | `devenius` |
| Repository | `junamis-skills` |
| Workflow filename | `publish.yml` |
| Environment | `npm-publish` |
| Allowed action | `npm stage publish` (add `npm publish` only if you also want direct publishing) |

The repository URL in `package.json` (`https://github.com/devenius/junamis-skills.git`) must match this owner and repository, or the OIDC claim check fails.

## Deprecation

Deprecation is preferred over unpublish. A deprecation message must name the reason, the fixed version or range, and the action the user should take.

| Situation | Action | Example command |
|---|---|---|
| Normal release | Publish; move `latest` with the release. | `npm publish` (via CI) |
| Bad release | Publish the fix first, then deprecate the narrowest affected range. | `npm deprecate "@devenius/junamis-skills@<1.1.0" "Broken install; use >=1.1.0"` |
| Bad release and no fix yet | Move `latest` to the last good version as a stopgap, then deprecate. | `npm dist-tag add "@devenius/junamis-skills@<good>" latest` |
| Abandoned or renamed | Deprecate the whole package with a pointer to the successor. Never unpublish. | `npm deprecate "@devenius/junamis-skills" "Superseded by <successor>"` |
| Accidental publish | Unpublish only within npm's 72-hour / no-dependents window and only with explicit user approval; otherwise deprecate. | `npm unpublish "@devenius/junamis-skills@<version>"` |
| Prerelease | Publish under `next`, `beta`, `rc`, or `placeholder`, never `latest`. | `npm publish --tag next` (via CI) |
| Leaked secret | Rotate the secret first. Deprecation and unpublish do not un-leak it. | rotate, then deprecate if needed |

Dist-tag rules: `latest` is the stable release. Prereleases use a non-`latest` tag. Never point `latest` at a prerelease. To inspect tags: `npm dist-tag ls @devenius/junamis-skills`.

## Troubleshooting

- **`E401 Unauthorized`.** The npmjs token is missing, expired, or read from the wrong config. Confirm the dedicated userconfig path and that `NPM_CONFIG_USERCONFIG` (or `--userconfig`) points at it. For CI, the OIDC trusted publisher must match the fields above; no token is needed there.
- **`E404 Not Found` (publish).** Usually the package name/scope is wrong, or the scope's registry mapping redirected the request to GitHub Packages. Check `npm config get @devenius:registry`; if it says `https://npm.pkg.github.com`, use the dedicated userconfig or pass `--registry https://registry.npmjs.org/`.
- **`@devenius:registry` scope mapping.** A line like `@devenius:registry=https://npm.pkg.github.com` in `~/.npmrc` sends every `@devenius` publish to GitHub Packages. The dedicated npmjs userconfig keeps that mapping out of the npmjs publish.
- **`--registry` overrides.** `--registry https://registry.npmjs.org/` on the command overrides the userconfig registry but not a scope mapping; fix the mapping or use the dedicated userconfig.
- **Workflow filename / environment mismatch.** `E404` or `E403` on a tag push often means the trusted publisher's workflow filename or environment does not match the real workflow. Confirm `publish.yml` and `npm-publish` on npmjs.com, and confirm the job declares `environment: npm-publish` and `id-token: write`.
- **Repository URL mismatch.** The trusted publisher checks the OIDC claim against the `repository.url` in `package.json`. Keep it at `https://github.com/devenius/junamis-skills.git`.
- **npm CLI version.** `npm stage publish` needs npm 11.15+. `npm ERR! Unknown command: "stage"` means the runner or shell has an older npm; pin the npm version in CI and check `npm -v` locally.

## Secrets

- Never put a token in the repository, the README, or a committed `.npmrc`.
- The CI publish uses OIDC, not a stored token, for npmjs. GitHub Packages uses the run's `GITHUB_TOKEN`.
- Local maintainer commands read a token only from the dedicated userconfig outside the repository.
