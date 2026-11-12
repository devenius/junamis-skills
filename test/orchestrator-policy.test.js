// Proves the PR-only authority and single-use approval policy is stated in the
// orchestrator prompt and in the repo policy files. Reads only committed files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

const POLICY_FILES = [
  "library/agents/orchestrator.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  ".github/pull_request_template.md",
];
const ORCHESTRATOR = read("library/agents/orchestrator.md");
const AGENTS = read("AGENTS.md");
const CONTRIBUTING = read("CONTRIBUTING.md");
const TEMPLATE = read(".github/pull_request_template.md");

test("the orchestrator has a single-use approvals section", () => {
  const heading = ORCHESTRATOR.indexOf("## Approvals are single-use");
  assert.ok(heading !== -1, "orchestrator has no ## Approvals are single-use section");

  const section = ORCHESTRATOR.slice(heading).split("\n## ")[0];
  assert.match(section, /exactly one command/i);
  assert.match(section, /exactly once/i);
  assert.match(section, /does not cover a retry/i);
  assert.match(section, /ask again every time/i);
  assert.match(section, /the approval is spent/i);
});

test("the orchestrator's authority ends at the pull request", () => {
  assert.match(ORCHESTRATOR, /end of the orchestrator's authority/);
  assert.match(ORCHESTRATOR, /never merges/i);
  assert.match(ORCHESTRATOR, /never uses `--admin`/);
  assert.match(ORCHESTRATOR, /gh pr create/);
  assert.match(ORCHESTRATOR, /user reviews and merges/i);
  assert.match(ORCHESTRATOR, /`gh pr merge`, `--admin`, and `main` pushes are denied by `opencode\.json`/);
  assert.match(ORCHESTRATOR, /never runs `gh pr merge`/);
});

test("the orchestrator never defers the merge to itself", () => {
  for (const text of [ORCHESTRATOR, AGENTS, CONTRIBUTING]) {
    assert.doesNotMatch(text, /After the pull request merges, the task is done/);
    assert.doesNotMatch(text, /stop for (the user's )?approval\./);
  }
});

test("every policy file states the single-use approval rule", () => {
  for (const relative of POLICY_FILES) {
    assert.match(read(relative), /single-use/i, `${relative} must state the single-use approval rule`);
  }
});

test("AGENTS.md and CONTRIBUTING.md end the agent's authority at gh pr create", () => {
  for (const text of [AGENTS, CONTRIBUTING]) {
    assert.match(text, /authority ends at `gh pr create`/);
    assert.match(text, /The user reviews and merges/i);
    assert.match(text, /Approvals are single-use/);
    assert.match(text, /gh pr merge/);
  }
});

test("the pull request template records that the agent created but did not merge", () => {
  assert.match(TEMPLATE, /created by the agent and not merged by it/i);
  assert.match(TEMPLATE, /`main` was not pushed/i);
  assert.match(TEMPLATE, /Every approval used in this task was single-use/i);
  assert.match(TEMPLATE, /no approval was reused/i);
});

test("the orchestrator checks the branch and designs the delegation", () => {
  assert.match(ORCHESTRATOR, /## Branch and worktree isolation/);
  assert.match(ORCHESTRATOR, /git branch --show-current/);
  assert.match(ORCHESTRATOR, /git switch -c task\/<task-slug>/);
  assert.match(ORCHESTRATOR, /## Delegation plan/);
  assert.match(ORCHESTRATOR, /allowed files/i);
  assert.match(ORCHESTRATOR, /git merge --no-ff/);
  assert.match(ORCHESTRATOR, /one pull request/i);
  assert.match(ORCHESTRATOR, /the user merges/i);
});

test("AGENTS.md and CONTRIBUTING.md record the branch-per-prompt and worktree merge-back flow", () => {
  for (const text of [AGENTS, CONTRIBUTING]) {
    assert.match(text, /git branch --show-current/);
    assert.match(text, /git switch -c task\/<task-slug>/);
    assert.match(text, /allowed files/i);
    assert.match(text, /git merge --no-ff/);
    assert.match(text, /one pull request/i);
    assert.match(text, /The user reviews and merges; the orchestrator never does\./);
  }
});

test("every specialist agent has a file allocation and never opens a pull request", () => {
  const agents = readdirSync(join(ROOT, "library", "agents"))
    .filter((name) => name.endsWith(".md") && name !== "orchestrator.md");
  assert.ok(agents.length > 0, "no specialist agents found");
  for (const file of agents) {
    const text = read(join("library", "agents", file));
    assert.match(text, /## File allocation/, `${file} must have a File allocation section`);
    assert.match(text, /Do not create a pull request/i, `${file} must forbid creating a pull request`);
  }
  assert.match(ORCHESTRATOR, /Sub-agents never create a pull request/i);
});
