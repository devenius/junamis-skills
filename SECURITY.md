# Security and scan record

Last updated: 2026-11-07
Last external scan: 2026-10
Scanner: skillsio 1.1.3 (Trust Hub, Socket, Snyk)

This file is the recorded vetting record for every skill the package installs. It
is published with the package and installed as a shared doc next to `SAFETY.md`.
The approval gate itself is in `library/SAFETY.md`.

> **Install-time scanning is skipped by design (`--skip-scan`).** The scanner
> prompts on high/critical findings and cannot be bypassed non-interactively, so
> `init` does not scan at install. This file plus `library/SAFETY.md` is the
> vetting record: `flagged` rows were scanned and reviewed by hand, and
> `pnpm run check:pins` confirms every locked tree SHA.

- **Kind `internal`**: written and owned by this project, under `library/skills/`.
- **Kind `external`**: pinned in `skills-lock.json` and installed from upstream.
  The source commit and the skill directory tree SHA are verified before the
  pinned scanner runs.
- **Scan `pass`**: no high or critical findings were reported on the recorded scan.
- **Scan `flagged`**: high or critical findings were reported and reviewed by hand. The
  review is accepted in `SAFETY.md`; re-run the scan when the skill updates.

| Skill | Kind | Source | License | Scan | Last updated at | Notes |
|---|---|---|---|---|---|---|
| db-migrate | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| decision-record | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| dependency-upgrade | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| deploy-verify | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| env-doctor | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| frontend | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| handoff | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| incident-response | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| nestjs | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| nextjs | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| perf-budget | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| refactor-safely | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| release-prep | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| research | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| rollback | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| route | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| security-audit | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| skill-author | internal | junamis-agents-skills | MIT | first-party | 2026-11 | |
| agent-browser | external | vercel-labs/agent-browser | Apache-2.0 | flagged | 2026-10 | reviewed and accepted per SAFETY.md; global install and browser download are gated |
| agent-rules | external | netresearch/agent-rules-skill | MIT OR CC-BY-SA-4.0 | flagged | 2026-10 | reviewed and accepted per SAFETY.md; 7 scanner findings (subprocess, --force); verify-commands and force runs are gated |
| architect | external | JavaScript-Mastery-Pro/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| check | external | JavaScript-Mastery-Pro/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| debug | external | JavaScript-Mastery-Pro/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| develop | external | JavaScript-Mastery-Pro/skills | MIT | flagged | 2026-10 | reviewed and accepted per SAFETY.md; HIGH sensitive-environment read in documented workflow, not executed by the install |
| doc-coauthoring | external | anthropics/skills | Apache-2.0 | pass | 2026-10 | no high or critical findings at install |
| document | external | JavaScript-Mastery-Pro/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| driftlock | external | KairosSignal/driftlock-agent-docs | MIT | flagged | 2026-10 | reviewed and accepted per SAFETY.md; 26 HIGH Python subprocess flags, shipped script read-only, tests and examples never run |
| find-skills | external | vercel-labs/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| frontend-design | external | anthropics/skills | Apache-2.0 | pass | 2026-10 | no high or critical findings at install |
| grill-me | external | mattpocock/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| grill-with-docs | external | mattpocock/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| mcp-builder | external | anthropics/skills | Apache-2.0 | flagged | 2026-10 | reviewed and accepted per SAFETY.md; reference examples use pip install, API keys, and rm -rf dist; not executed, credential access is gated |
| nestjs-best-practices | external | Kadajett/agent-nestjs-skills | MIT | flagged | 2026-10 | reviewed and accepted per SAFETY.md; HIGH external URLs in SQL/doc examples, never executed |
| scope | external | JavaScript-Mastery-Pro/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| shadcn | external | shadcn-ui/ui | MIT | flagged | 2026-10 | reviewed and accepted per SAFETY.md; HIGH external URLs/registries, any --force is gated |
| shadcn-component-discovery | external | mattbx/shadcn-skills | MIT | flagged | 2026-10 | reviewed and accepted per SAFETY.md; registry/URL reads reviewed, no writes |
| shadcn-component-review | external | mattbx/shadcn-skills | MIT | pass | 2026-10 | no high or critical findings at install |
| skill-creator | external | anthropics/skills | Apache-2.0 | flagged | 2026-10 | reviewed and accepted per SAFETY.md; CRITICAL RCE/C2 scanner report in eval scripts; script execution is gated |
| tdd | external | mattpocock/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| test | external | JavaScript-Mastery-Pro/skills | MIT | pass | 2026-10 | no high or critical findings at install |
| theme-factory | external | anthropics/skills | Apache-2.0 | pass | 2026-10 | no high or critical findings at install |
| webapp-testing | external | anthropics/skills | Apache-2.0 | flagged | 2026-10 | reviewed and accepted per SAFETY.md; CRITICAL subprocess/socket findings in with_server.py; server start and tests are gated |

## Scope of this record

- The internal skills are first-party code. They are covered by the package's
  tests and by the destructive-command check in `pnpm test`.
- The external scan record was produced when the pins in `skills-lock.json` were
  installed. Re-run the scan and update `Last external scan` whenever a pin
  changes.
- `scripts/check-security.mjs` fails CI when a skill is added to either side and
  is not listed here, or when the `Last external scan` line is missing.
