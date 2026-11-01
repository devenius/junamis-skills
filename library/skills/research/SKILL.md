---
name: research
version: "1.0.0"
description: Use when the user asks for information that is not in this repo: current docs for a library or API, what a version changed, comparing options, checking whether a package or CVE applies, or finding how others solved a problem. Read-only. Searches the web and public registries, cites every claim, and writes a compact summary to docs/research/. Do not use for questions answerable from this repo's code, and do not use to change anything.
---

# research

Answer one question with sources. Say what is verified and what is not.

## Inputs

- The question, verbatim.
- Version or date constraints if the user gave them. If the answer depends on a version and none was given, use the version in the project's lockfile or manifest and say so.

## Steps

1. **Restate the question** in one line. If it has two readings, pick the one the project needs and name the other in the summary.
2. **Check the project first.** Read the lockfile or manifest for the version in question. Do not research a version the project does not use.
3. **Search.** Prefer, in order: official docs and changelogs, the package registry page, the source repository's release notes, then reputable articles. Use at least two independent sources for any claim that affects a decision.
4. **Verify dates.** Record the publish or update date of every source. Mark anything older than the version in use as possibly stale.
5. **Summarize.** Answer first, then evidence. Keep the summary under 300 words unless the user asks for depth.
6. **Write** `docs/research/<YYYY-MM-DD>-<slug>.md`:

```markdown
# <Question>

Asked: <YYYY-MM-DD>   Version context: <what the project uses>

## Answer
<two to five sentences>

## Evidence
- <claim> — <source title>, <url>, <date>

## Unverified
- <anything you could not confirm from a primary source>

## Not checked
- <what was out of scope or unreachable>
```

## Gotchas

- Search results are not sources. Open the page and cite what it says.
- Do not present a blog post as official behavior. Name the source type.
- Do not send project code, secrets, or env values in a search query. Describe the problem generically.
- If two sources disagree, report both and the one you trust more, with the reason. Do not average them.
- Do not install packages to test a claim. If a test would need installing, say so and stop; that is a user decision.

## Finish

```yaml
agent: research
job: answer <question>
status: complete | blocked | failed
artifacts:
  - path: docs/research/<YYYY-MM-DD>-<slug>.md
    kind: created
findings: []
decisions_owed: []
next: orchestrator
```

Use `status: blocked` when no reliable source could be reached. Use `next: user` when the answer depends on a choice only the user can make, and list that choice in `decisions_owed`.
