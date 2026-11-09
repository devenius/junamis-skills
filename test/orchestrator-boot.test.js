import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  boot,
  checkpoint,
  completeTask,
  makeFixture,
  planSet,
  readJson,
  readText,
  runCli,
  status,
} from "./orchestrator-helpers.js";

function freshStateRoot() {
  const dir = mkdtempSync(join(tmpdir(), "orch-state-copy-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function copyState(fixture, { includeLocks = false } = {}) {
  const dest = freshStateRoot();
  for (const name of ["journal.ndjson", "state.json", "plan.json", "STATE.md", "resume-report.md", ".gitignore"]) {
    const source = join(fixture.state, name);
    if (existsSync(source)) copyFileSync(source, join(dest, name));
  }
  for (const name of ["checkpoints", "tasks"]) {
    const source = join(fixture.state, name);
    if (existsSync(source)) cpSync(source, join(dest, name), { recursive: true });
  }
  if (includeLocks && existsSync(join(fixture.state, "locks"))) {
    cpSync(join(fixture.state, "locks"), join(dest, "locks"), { recursive: true });
  }
  return dest;
}

function journalEvents(path) {
  return readText(path)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test("a new boot writes the state tree, report, STATE.md, and self-ignoring .gitignore", () => {
  const fixture = makeFixture();
  const result = boot(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: NEW_RUN/);
  assert.match(result.stdout, /report: .*resume-report\.md/);

  for (const path of [
    join(fixture.state, "state.json"),
    join(fixture.state, "plan.json"),
    join(fixture.state, "journal.ndjson"),
    join(fixture.state, "STATE.md"),
    join(fixture.state, "resume-report.md"),
    join(fixture.state, ".gitignore"),
  ]) {
    assert.equal(existsSync(path), true, `missing ${path}`);
  }
  assert.equal(readText(join(fixture.state, ".gitignore")).trim(), "*");
  const state = readJson(join(fixture.state, "state.json"));
  assert.equal(state.run_status, "NEW_RUN");
  assert.equal(state.cursor, null);
  assert.equal(readJson(join(fixture.state, "plan.json")).tasks.length, 0);
});

test("boot reports NEW_RUN, RESUMING, then COMPLETE", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);

  const resuming = boot(fixture);
  assert.equal(resuming.status, 0, resuming.stderr);
  assert.match(resuming.stdout, /status: RESUMING/);
  assert.match(resuming.stdout, /cursor: T-001/);

  for (const [taskId, capability, next] of [
    ["T-001", "route", "develop"],
    ["T-002", "develop", "release-prep"],
    ["T-003", "release-prep", "none"],
  ]) {
    const done = completeTask(fixture, { taskId, capability, next });
    assert.equal(done.started.status, 0, done.started.stderr);
    assert.equal(done.ended.status, 0, done.ended.stderr);
  }

  const complete = boot(fixture);
  assert.equal(complete.status, 0, complete.stderr);
  assert.match(complete.stdout, /status: COMPLETE/);
  assert.match(complete.stdout, /cursor: none/);
});

test("a live lease held by another session halts with exit 2 and writes nothing", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture, { session: "s-owner" }).status, 0);
  const journalPath = join(fixture.state, "journal.ndjson");
  const before = readFileSync(journalPath, "utf8");

  const blocked = boot(fixture, { session: "s-other" });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /halt: lease_held/);
  assert.equal(readFileSync(journalPath, "utf8"), before);

  const lease = readJson(join(fixture.state, "locks", "session-s-owner.json"));
  assert.equal(lease.session_id, "s-owner");
});

test("the resume report is sufficient on its own", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const result = boot(fixture);
  assert.equal(result.status, 0, result.stderr);
  const report = readText(join(fixture.state, "resume-report.md"));

  for (const line of [
    "# Resume Report",
    "- Run: ",
    "- Session: ",
    "- Status: RESUMING",
    "## Cursor",
    "- Task: T-001",
    "- Next action: ",
    "## Tasks",
    "| id | capability | status | attempts | resolved skill | source | owner |",
    "| T-001 | route | pending | 0 | library/route | internal_override | orchestrator |",
    "## Reconciliation",
    "## Environment fingerprint",
    "- environment match: true",
    "## Recent events",
  ]) {
    assert.ok(report.includes(line), `report is missing ${JSON.stringify(line)}\n${report}`);
  }
});

test("STATE.md is regenerated on boot and is never read as input", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const first = boot(fixture);
  assert.equal(first.status, 0);

  writeFileSync(join(fixture.state, "STATE.md"), "this is not markdown\n");
  const second = boot(fixture);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /status: RESUMING/);
  assert.match(readText(join(fixture.state, "STATE.md")), /^# Orchestrator State/);
});

test("manifest drift blocks with exit 3 and records old and new hashes", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const journalPath = join(fixture.state, "journal.ndjson");
  const before = journalEvents(journalPath).filter((event) => event.type === "step_start").length;

  writeFileSync(fixture.manifest, `${JSON.stringify({ version: 1, skills: { extra: { source: "x" } } }, null, 2)}\n`);
  const drifted = boot(fixture);
  assert.equal(drifted.status, 3);
  assert.match(drifted.stdout, /status: BLOCKED_DRIFT/);
  const report = readText(join(fixture.state, "resume-report.md"));
  assert.match(report, /## Drift/);
  assert.match(report, /- skills_lock_sha256: sha256:[0-9a-f]{64} -> sha256:[0-9a-f]{64}/);
  const after = journalEvents(journalPath).filter((event) => event.type === "step_start").length;
  assert.equal(after, before);

  const readOnly = status(fixture);
  assert.equal(readOnly.status, 0);
  assert.match(readOnly.stdout, /drift: detected/);
});

test("library drift names the changed path and blocks with exit 3", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  writeFileSync(join(fixture.library, "agents", "orchestrator.md"), "---\nname: orchestrator\n---\nchanged\n");
  const drifted = boot(fixture);
  assert.equal(drifted.status, 3);
  const report = readText(join(fixture.state, "resume-report.md"));
  assert.match(report, /library_overrides_sha256/);
  assert.match(report, /agents\/orchestrator\.md/);
});

test("a broken journal hash chain halts corrupt with exit 4 and a report", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const journalPath = join(fixture.state, "journal.ndjson");
  const lines = readText(journalPath).trimEnd().split("\n");
  const event = JSON.parse(lines[1]);
  event.prev_hash = `sha256:${"0".repeat(64)}`;
  lines[1] = JSON.stringify(event);
  writeFileSync(journalPath, `${lines.join("\n")}\n`);

  const halted = boot(fixture);
  assert.equal(halted.status, 4);
  assert.match(halted.stdout, /status: HALT_CORRUPT/);
  assert.doesNotMatch(halted.stderr, /at .*\.js:/);
  const report = readText(join(fixture.state, "resume-report.md"));
  assert.match(report, /Status: HALT_CORRUPT/);
  assert.match(report, /reason: corrupt_state/);
});

test("a torn state.json and partial journal tail recover from the checkpoint", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  assert.equal(completeTask(fixture, { taskId: "T-001", capability: "route", next: "develop" }).ended.status, 0);
  assert.equal(checkpoint(fixture).status, 0);

  const copy = copyState(fixture);
  const statePath = join(copy, "state.json");
  const stateText = readFileSync(statePath, "utf8");
  writeFileSync(statePath, stateText.slice(0, Math.floor(stateText.length / 2)));
  appendFileSync(join(copy, "journal.ndjson"), '{"seq":999,"type":"step_start"');

  const recovered = runCli(fixture, ["boot"], { state: copy, session: "s-recover" });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /status: RESUMING/);
  assert.match(recovered.stdout, /report: /);

  const journal = readText(join(copy, "journal.ndjson"));
  assert.match(journal, /journal_truncated/);
  assert.doesNotMatch(journal, /"seq":999/);
  const state = readJson(statePath);
  assert.equal(state.schema_version, 1);
  assert.equal(state.tasks_summary.done, 1);
  assert.equal(state.tasks_summary.pending, 2);
});

test("checkpoint truncates the journal and replay works with or without it", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  assert.equal(completeTask(fixture, { taskId: "T-001", capability: "route", next: "develop" }).ended.status, 0);

  const fullJournal = readText(join(fixture.state, "journal.ndjson"));
  const checkpointed = checkpoint(fixture);
  assert.equal(checkpointed.status, 0, checkpointed.stderr);

  const retained = journalEvents(join(fixture.state, "journal.ndjson"));
  assert.ok(retained.length >= 1);
  assert.ok(retained.every((event) => event.type === "checkpoint_written" || event.seq > retained[0].checkpoint_seq));

  // Copy the checkpoint and the truncated journal into a fresh root.
  const fromCheckpoint = copyState(fixture);
  const bootedCheckpoint = runCli(fixture, ["boot"], { state: fromCheckpoint, session: "s-checkpoint" });
  assert.equal(bootedCheckpoint.status, 0, bootedCheckpoint.stderr);
  assert.match(bootedCheckpoint.stdout, /status: RESUMING/);

  // Replay from sequence 0 with no checkpoint.
  const noCheckpoint = freshStateRoot();
  writeFileSync(join(noCheckpoint, "journal.ndjson"), fullJournal);
  const bootedReplay = runCli(fixture, ["boot"], { state: noCheckpoint, session: "s-replay" });
  assert.equal(bootedReplay.status, 0, bootedReplay.stderr);
  assert.match(bootedReplay.stdout, /status: RESUMING/);

  for (const root of [fromCheckpoint, noCheckpoint]) {
    const task = readJson(join(root, "tasks", "T-001", "task.json"));
    assert.equal(task.status, "done");
    assert.equal(task.attempt, 1);
    const state = readJson(join(root, "state.json"));
    assert.equal(state.tasks_summary.done, 1);
  }
});
