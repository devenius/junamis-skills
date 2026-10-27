# Best available skills for agentic development

Asked: 2026-10-27   Version context: junamis-skills 1.0.0, OpenCode target, Agent Skills (SKILL.md) format.

## Answer

The strongest, most-installed, and openly licensed candidates are in three places: `obra/superpowers` (workflow and discipline), `mattpocock/skills` (TDD and diagnosis), and `nchandar/skills` (a full dev-workflow set). Each is MIT, so they can be installed or vendored with attribution. Adopt them as external skills through the manifest, and cover gaps with a small number of our own library skills. Do not adopt anything without a verified license.

## Evidence

- Skills leaderboard is ranked by anonymous install telemetry, not quality. Top overall: `find-skills` (vercel-labs/skills, ~4.1M installs), `grill-me` (mattpocock/skills, ~1.4M), `agent-browser` (vercel-labs/agent-browser, ~1.3M) — skills.sh, fetched 2026-10-27.
- `obra/superpowers` — MIT. A workflow framework of composable skills, including systematic debugging, TDD, brainstorming, plans, and code review. Its README says the agent checks for relevant skills before any task. — github.com/obra/superpowers, license via GitHub API.
- `mattpocock/skills` — MIT. TDD skill (red-green-refactor, one vertical slice at a time) and a `diagnosing-bugs` skill. — github.com/mattpocock/skills, license via GitHub API; TDD SKILL.md read from the search excerpt.
- `nchandar/skills` — MIT. Generic dev workflow set: brainstorm, plan, execute, TDD, debug, review, verify, skill authoring. — github.com/nchandar/skills, license via GitHub API.
- `raddue/crucible` — MIT. Build pipelines, TDD, debugging, quality gates, with stated eval results (+23% on execution evals, Opus 4.8). Eval claims are self-reported; not independently checked. — github.com/raddue/crucible.
- `svssdeva/agentic-skills` — MIT. TDD, debugging, code review, handoff. — github.com/svssdeva/agentic-skills.
- `CommandCodeAI/agent-skills` — MIT. Includes a writing-skills skill that applies TDD to skill authoring. — github.com/CommandCodeAI/agent-skills.
- `jwilger/agent-skills` — CC0-1.0 (public domain dedication). TDD, domain modeling, code review, ADRs. — github.com/jwilger/agent-skills, default branch `forgejo/workflow-migration`.
- `anthropics/skills` — the GitHub API returned no license. The repo README and the Zendot/localskills summaries describe document skills (docx, pdf, pptx, xlsx) as source-available, not open source. Treat as unverified per skill. Useful skills include `webapp-testing`, `skill-creator`, `mcp-builder`. — github.com/anthropics/skills.
- `vercel-labs/agent-browser` — Apache-2.0. Browser automation CLI skill, high install count. — github.com/vercel-labs/agent-browser.
- Awesome lists (VoltAgent, linny006, skillcreatorai, heilcheng) are curated by unknown maintainers. VoltAgent's own notice says the list is "curated, not audited." Use them as discovery only, never as a license source.

## Gap map against our library

| Need | Best candidate | License | Overlaps with our library |
|---|---|---|---|
| Disciplined TDD | mattpocock/skills `tdd` | MIT | `test`, `refactor-safely` (partial) |
| Root-cause debugging | obra/superpowers `systematic-debugging`, mattpocock `diagnosing-bugs` | MIT | `debug` (external, MIT), `incident-response` |
| Code review, multi-stage | nchandar/skills review, crucible `quality-gate` | MIT | `check review`, `security-audit` |
| Planning and brainstorming | obra/superpowers, nchandar/skills | MIT | `architect`, `scope` |
| Browser and web testing | vercel-labs/agent-browser | Apache-2.0 | none (new capability) |
| Skill authoring with tests | CommandCodeAI writing-skills, anthropics skill-creator | MIT / unverified | `skill-author` |
| Handoff between agents | svssdeva handoff | MIT | `handoff` (ours, covers this) |
| Domain modeling, ADRs | jwilger/agent-skills | CC0 | `decision-record` |

## Unverified

- Crucible's eval deltas were not reproduced.
- Anthropic's per-skill licenses were not checked one by one.
- The "best" ranking is a judgment, not a benchmark. No head-to-head test of these skills was run.

## Not checked

- Security scans of the candidates. skillsio reported critical Socket flags on several installed skills earlier; the same scan must run before installing any of these.
- Whether candidate skills conflict with our library's routing (for example, two TDD skills in one project).
- Upstream repo activity and maintenance status beyond what the search results show.
