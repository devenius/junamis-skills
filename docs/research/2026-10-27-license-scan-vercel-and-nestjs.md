# License and security re-scan: vercel-labs and Kadajett skills

Scanned: 2026-10-27. Repos cloned fresh at `vercel-labs/agent-skills@6ec2693` (446 files) and `Kadajett/agent-nestjs-skills@3986e0c` (54 files). Full file scan for exec, network, deletion, privilege, credentials, install hooks, obfuscation, and prompt injection. No malicious code found in either repo.

## Verdict per skill

### vercel-labs/agent-skills (9 skills, no repo-level LICENSE)

The repo has no LICENSE file. All 9 skills are legally all-rights-reserved unless the author adds a license.

| Skill | Dangerous commands found | Already in SAFETY.md? | Safe to install? |
|---|---|---|---|
| deploy-to-vercel | `npm install -g vercel`, `vercel deploy --prod -y`, `git push`, `resources/deploy.sh` runs `rm -rf` on its own temp dir, `curl -X POST` to upload a tarball | Yes | Yes, if gated |
| vercel-cli-with-tokens | `npm install -g vercel`, `vercel deploy --prod -y`, `vercel env rm -y`, `git push`, Stripe plan changes | Yes | Yes, if gated |
| vercel-optimize | `execFile` running `vercel` CLI read commands (metrics, usage, contract, api, whoami). Install hints in messages only | Yes | Yes, read-only |
| vercel-composition-patterns | None | n/a | Yes |
| vercel-react-best-practices | None | n/a | Yes |
| vercel-react-native-skills | None | n/a | Yes |
| vercel-react-view-transitions | None | n/a | Yes |
| web-design-guidelines | None | n/a | Yes |
| writing-guidelines | None | n/a | Yes |

No install hooks, no obfuscation, no credential exfiltration, no prompt injection. The `deploy.sh` script's `rm -rf` only touches its own `mktemp` directory. The `curl -X POST` only sends the tarball to Vercel's deploy endpoint.

### Kadajett/agent-nestjs-skills (1 skill, no repo-level LICENSE)

The repo has no LICENSE file. The SKILL.md frontmatter declares `license: MIT`, which is a per-file declaration, not a repo-level license. Treat as unverified per AGENTS.md.

| Skill | Dangerous commands found | Already in SAFETY.md? | Safe to install? |
|---|---|---|---|
| nestjs-best-practices | None (SQL strings and `process.env` appear only in code examples, never executed) | Yes | Yes |

No scripts, no hooks, no network calls. The skill is instruction-only markdown.

## License status

| Source repo | Repo-level LICENSE | Per-file license | AGENTS.md status |
|---|---|---|---|
| vercel-labs/agent-skills | None | None | `unknown` (correct, blocked) |
| Kadajett/agent-nestjs-skills | None | `MIT` in SKILL.md frontmatter | `unknown` (conservative, blocked) |

## Decision (2026-10-27)

- `nestjs-best-practices`: license accepted as `MIT` (from SKILL.md frontmatter). Updated in `skills-lock.json`.
- All 9 `vercel-labs/agent-skills` entries dropped from the manifest. Their installed copies were removed from `~/.agents/skills/`. No traces remain in the lock, SAFETY.md, or EXTERNAL.md.

## Recommendation (historical)

The scan found no security issues. The dangerous commands in the Vercel skills are all documented in `library/SAFETY.md` and gated. The question is purely legal.

1. **nestjs-best-practices**: The frontmatter declares MIT. A per-file license declaration is weaker than a repo-level one, but it is an explicit statement by the author. Consider setting `"license": "MIT"` with a note that it comes from the SKILL.md frontmatter, not a repo LICENSE file. This unblocks publishing for this one skill.

2. **vercel-labs/agent-skills (9 skills)**: No license anywhere. Keep `"license": "unknown"` and block publishing. Options:
   - Drop these 9 skills from the manifest. This removes deploy-to-vercel, vercel-optimize, and the React best-practices skills.
   - Keep them installed for personal use only (not published).
   - Ask Vercel to add a LICENSE file to the repo.

3. If you drop the Vercel skills, the only remaining blocker is the nestjs license question, which can be resolved by accepting the frontmatter declaration.

## What was not checked

- Whether Vercel or Kadajett have published a license in a different branch or a different repo.
- Whether the per-file MIT declaration in the nestjs skill is legally sufficient. That is a legal question, not a technical one.
