# 0001. Adopt mattpocock tdd and vercel-labs agent-browser; keep our library skills for everything else

Status: Accepted
Date: 2026-10-27
Supersedes: none

## Context
Researcher found candidate skills for agentic development. Before any install, each candidate was cloned and scanned for exec, network, deletion, privilege, credentials, install hooks, obfuscation, and prompt-injection patterns. Each overlapping skill was compared with our library or installed external skill.

## Decision
- Install `tdd` from mattpocock/skills (MIT). It is one instruction-only folder with no scripts or hooks. It adds a red-green loop we do not have.
- Install `agent-browser` from vercel-labs/agent-browser (Apache-2.0). It fills the browser testing gap. The `skills/agent-browser` folder is one file. Its global install and browser install are gated under `library/SAFETY.md`.
- Keep our library skills and the installed JavaScript Mastery Pro skills for debug, check review, skill authoring, handoff, research, and security audit. Their overlapping candidates were no safer, or carried scripts we would have to vet.
- Reject, for now:
  - obra/superpowers `brainstorming`: ships a local server, runs `rm -rf` on a configurable session directory, and opens a browser with `exec`.
  - CommandCodeAI `playwright-skill`: runs `npm install` and `playwright install` automatically, and deletes files.
  - raddue/crucible and svssdeva/agentic-skills as whole repos: too large to vet completely (797 and 2088 files, hook scripts and MCP calls).
  - mattpocock `git-guardrails-claude-code`: safe, but it installs Claude Code hooks. We are on OpenCode. Reconsider when Claude is a target.
  - obra `systematic-debugging`, mattpocock `diagnosing-bugs`, nchandar `dev-debug`: alternatives to the installed `debug`. Two debug skills would make routing ambiguous.

## Consequences
- Two new locked entries in `skills-lock.json`, with licenses.
- Two new rows in `library/SAFETY.md`.
- Both were installed project-local at first; moved to global by decision 0003.
- The installer scanner (Snyk, Socket, Trust Hub) passed on tdd. On agent-browser it reported Snyk medium.

## Note on scan evidence

The scan output behind this decision was produced in `/tmp` during the session and is not stored in this repository. A later reader cannot reproduce it from here. To repeat it, clone the candidate repos from their GitHub URLs, record the commit hash, and rerun the scanner used in the session (a small script that greps for exec, network, deletion, privilege, and credential patterns). Commit hashes were not recorded in this record.
