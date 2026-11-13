# 0020 — npm publication

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** project owner

## Context

`@devenius/junamis-skills` must be installable without relying on a Git checkout. The package was already published to GitHub Packages, but GitHub Packages needs a token and a per-scope `~/.npmrc` mapping, which blocks the simplest path (`npx @devenius/junamis-skills`). npmjs is the registry most users and CI systems reach by default.

Two constraints shape the first publish:

- A GitHub Actions trusted publisher on npmjs requires the package to exist already, so the first publish cannot itself use the OIDC trusted publisher.
- The GitHub tag/release `v1.0.0` already exists and is not an npm release. Reserving npm `1.0.0` for a real release would collide with the existing tag history.

The local `~/.npmrc` maps `@devenius:registry` to GitHub Packages, so an npmjs publish must not inherit that mapping.

## Decision

1. **npmjs is the primary public registry.** `@devenius/junamis-skills` publishes to `https://registry.npmjs.org/`. GitHub Packages remains the mirror, not the primary.
2. **Bootstrap with a staged placeholder.** Seed the package with `npm stage publish` and a placeholder (`1.0.0-placeholder.0`) under the `placeholder` tag. This creates the package so a trusted publisher can be attached. `latest` stays on the pre-existing `0.0.0-stage` placeholder until the first usable release.
3. **First usable release is `1.1.0`.** There is no real npm `1.0.0`, because the GitHub tag `v1.0.0` already exists and is not an npm release.
4. **CI uses `npm stage publish` with OIDC and a human approval.** The `publish.yml` npmjs job uses `id-token: write`, the `npm-publish` environment, and `npm stage publish`. A maintainer approves the staged version on npmjs.com with 2FA. The GitHub Packages job in the same workflow uses `GITHUB_TOKEN` and `packages: write`.
5. **`publishConfig` carries only `access: public`.** No hard-coded registry, so each workflow passes its own registry and the local GitHub Packages mapping cannot hijack a publish.
6. **Deprecation is preferred over unpublish.** Unpublish is limited to npm's 72-hour / no-dependents window with explicit user approval.
7. **The agent never runs registry mutations.** `npm publish`, `npm stage publish`, `npm deprecate`, `npm unpublish`, `npm dist-tag`, `npm owner`, and `npm access` are user actions, gated by `library/SAFETY.md` and single-use approvals. The agent prepares the exact command and stops.

## Consequences

- Users get a token-free install path (`npx @devenius/junamis-skills@latest`) once `1.1.0` is approved. Until then, the README keeps the GitHub direct install as the safe path and states that `latest` is still the placeholder.
- The trusted publisher must be configured only when a release is ready, because the first successful publish must happen within 48 hours of saving it.
- Maintainers must use a dedicated npmjs userconfig (or `--registry`) so the `@devenius:registry` GitHub Packages mapping does not redirect the publish.
- There is no npm `1.0.0`; version history on npmjs starts with the placeholders, then `1.1.0`.
- Every future release needs a human 2FA approval; the CI cannot make a version public on its own.
- Deprecation, not deletion, is the default remedy; unpublish stays an exception gated on explicit approval.
- The runbook lives in [`docs/publishing/npm.md`](../publishing/npm.md), and the project rule is in `AGENTS.md`.
