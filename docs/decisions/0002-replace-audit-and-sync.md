# 0002. Replace JavaScript Mastery Pro audit and sync with agent-rules and driftlock

Status: Accepted
Date: 2026-10-27
Supersedes: none

## Context
The installed `audit` and `sync` (JavaScript Mastery Pro) carried unresolved critical scanner flags from install. Their upstream text runs `npx skills find` and `npx skills add <owner>/<repo> -y` during discovery, and runs discovery subagents in the background. Alternatives were searched, cloned, scanned, and compared.

## Decision
- Replace `sync` with `driftlock` (KairosSignal, MIT). It detects documentation drift with read-only git commands, and never installs anything. Its 26 HIGH scanner flags are Python subprocess calls. The one in the shipped script runs read-only git only. The rest are in tests and examples.
- Replace `audit` with `agent-rules` (netresearch, MIT or CC-BY-SA-4.0). It writes AGENTS.md only with `--force`. It has no background installs. Its one executor, `scripts/verify-commands.sh`, runs documented commands through an allowlist and rejects shell chaining. Its 7 CRITICAL and HIGH scanner flags were reviewed as prohibition text, comments, and examples.
- Remove the JavaScript Mastery Pro `audit` and `sync` folders and their lock entries. The user approved the deletion.

Rejected:
- `Eriemon/agents-md-generator` (Apache-2.0): 289 files, including an installer that deletes lock files with `rm -f` and release scripts that push to git. Too large to vet.
- `openai/openai-agents-python` docs-sync (MIT): clean and asks for approval before edits, but it is written for OpenAI's `docs/` tree and would need changing to be generic.
- `Diew/living-docs` (MIT): a template with its own governance registry. It conflicts with our AGENTS.md, handoff, and decision records. Reconsider only if we want that structure.
- `larchanka/project-change-intelligence` and `codebase-context-generator` (MIT): not overlapping. The README gives sudo install steps.

## Consequences
- `skills-lock.json` now has 24 entries, with licenses for the two new ones.
- Both replacements were installed with `--skip-scan` after the user approved the override.
- `library/SAFETY.md` has rows for both. Script execution from both is gated.
- Installed project-local at first; moved to global by decision 0003.

## Note on scan evidence

The scan output behind this decision was produced in `/tmp` during the session and is not stored in this repository. A later reader cannot reproduce it from here. To repeat it, clone the candidate repos from their GitHub URLs, record the commit hash, and rerun the scanner used in the session (a small script that greps for exec, network, deletion, privilege, and credential patterns). Commit hashes were not recorded in this record.
