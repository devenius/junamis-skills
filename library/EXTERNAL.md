# External skills referenced by the library

These skills are installed from `skills-lock.json` into the global skills directory (`~/.agents/skills/` for OpenCode, as `skillsio -g` writes it). They are not owned by this project. The library refers to them by name only. Each reference must resolve to a lock entry, which `test/library.test.js` checks.

| Name | Lock source | License | Referenced by | Used for |
|---|---|---|---|---|
| debug | JavaScript-Mastery-Pro/skills | MIT | route, orchestrator | bug path: reproduce, root cause, minimal fix |
| architect | JavaScript-Mastery-Pro/skills | MIT | route, orchestrator | feature path: decision and build spec |
| develop | JavaScript-Mastery-Pro/skills | MIT | route, orchestrator | feature path: build from spec |
| test | JavaScript-Mastery-Pro/skills | MIT | route, orchestrator | tests written after a change |
| tdd | mattpocock/skills | MIT | route, orchestrator | build a behavior test-first (red-green) |
| check | JavaScript-Mastery-Pro/skills | MIT | release-prep | `check review` on the release diff before tagging |

Routing between `test` and `tdd` is in `library/skills/route/SKILL.md`. Both are installed; the route decides which runs.

External skills assigned to library agents (by reference, not ownership):

- `scope`, `document` → orchestrator (workflow planning and release documentation)
- `find-skills` → maintainer agent (skill discovery and installation)
- `mcp-builder`, `skill-creator` → maintainer agent (MCP servers, skill authoring)
- `shadcn`, `shadcn-component-discovery`, `shadcn-component-review` → frontend agent (UI components)
- `frontend-design`, `theme-factory` → frontend agent (design guidance)
- `webapp-testing` → frontend agent (browser-based UI testing)
- `nestjs-best-practices` → nestjs agent (deep NestJS patterns)
- `agent-browser` → reviewer agent (browser-based verification)
- `driftlock` → context-keeper agent (documentation governance)
- `agent-rules` → context-keeper agent (AGENTS.md generation and maintenance)
- `grill-me`, `grill-with-docs` → architect agent (stress-testing plans and designs)
- `doc-coauthoring` → orchestrator (structured documentation workflow)

Their licenses and safety status are in `skills-lock.json` and `~/.junamis/library/SAFETY.md`.

If an external name is not installed, the orchestrator stops and tells the user which one is missing. It does not perform that skill's work itself.
