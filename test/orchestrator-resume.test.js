import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  boot,
  completeTask,
  defaultTasks,
  makeFixture,
  planSet,
  readText,
} from "./orchestrator-helpers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = join(ROOT, "library", "skills", "route", "SKILL.md");

test("plan set refuses to change a done task's identity", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  assert.equal(completeTask(fixture, { taskId: "T-001", capability: "route", next: "develop" }).ended.status, 0);

  const changed = defaultTasks();
  changed[0].owner = "maintainer";
  const changedFile = join(fixture.root, "identity-change.json");
  writeFileSync(changedFile, `${JSON.stringify({ tasks: changed }, null, 2)}\n`);

  const result = planSet(fixture, { file: changedFile, replace: true });
  assert.equal(result.status, 5);
  assert.match(result.stderr, /identity_change|replacement changes owner/);
});

test("a RESUMING report names the recorded skill and owner, and route starts there", () => {
  const tasks = defaultTasks().slice(0, 2);
  tasks[1].owner = "maintainer";
  const fixture = makeFixture({ tasks });

  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  assert.equal(completeTask(fixture, { taskId: "T-001", capability: "route", next: "develop" }).ended.status, 0);

  const resumed = boot(fixture);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /status: RESUMING/);
  assert.match(resumed.stdout, /cursor: T-002/);

  const report = readText(join(fixture.state, "resume-report.md"));
  assert.match(report, /- Status: RESUMING/);
  assert.match(report, /- Task: T-002 \(develop\)/);
  assert.match(report, /- Next action: start --task T-002, then dispatch library\/develop to maintainer/);
  assert.match(
    report,
    /\| T-002 \| develop \| pending \| 0 \| library\/develop \| internal_override \| maintainer \|/,
    "the task table must carry the recorded skill, source, and owner",
  );

  const route = readFileSync(ROUTE, "utf8");
  assert.ok(route.includes("resume-report.md"), "route must take the resume report as input");
  assert.match(route, /^\| resume \|/m, "route needs a resume path row");
  assert.ok(route.includes("## Resume"), "route needs a Resume section");
  for (const field of ["resolved_skill", "resolution_source", "owner"]) {
    assert.ok(route.includes(field), `route Resume section must name ${field}`);
  }
  for (const status of ["RESUMING", "NEW_RUN", "COMPLETE", "BLOCKED_DRIFT", "HALT_CORRUPT"]) {
    assert.ok(route.includes(status), `route Resume section must handle ${status}`);
  }
});
