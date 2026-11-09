import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertReplaceAllowed,
  validatePlanInput,
} from "../src/orchestrator/plan.js";
import {
  IdentityChangeError,
  TransitionError,
  UsageError,
} from "../src/orchestrator/errors.js";
import {
  boot,
  completeTask,
  defaultTasks,
  makeFixture,
  planSet,
  readJson,
  writeSkill,
} from "./orchestrator-helpers.js";

function baseTask(overrides = {}) {
  return {
    task_id: "T-001",
    capability: "route",
    depends_on: [],
    resolved_skill: "library/route",
    resolution_source: "internal_override",
    owner: "orchestrator",
    adapter: null,
    idempotent: true,
    ...overrides,
  };
}

async function validate(fixture, tasks) {
  return validatePlanInput(
    { tasks },
    {
      libraryRoot: fixture.library,
      runId: "run-test-1",
      createdAt: "2026-11-09T10:00:00Z",
      envFingerprint: { skills_lock_sha256: null, library_overrides_sha256: null },
    },
  );
}

test("plan validation computes checksums and inputs hashes and ignores supplied values", async () => {
  const fixture = makeFixture();
  const plan = await validate(fixture, [
    baseTask({ checksum: "sha256:client", inputs_hash: "sha256:client" }),
  ]);
  assert.equal(plan.schema_version, 1);
  assert.equal(plan.tasks.length, 1);
  assert.match(plan.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.match(plan.tasks[0].inputs_hash, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(plan.checksum, "sha256:client");
  assert.notEqual(plan.tasks[0].inputs_hash, "sha256:client");
});

test("plan validation rejects invalid ids, duplicates, missing dependencies, and cycles", async () => {
  const fixture = makeFixture();
  await assert.rejects(() => validate(fixture, [baseTask({ task_id: ".." })]), UsageError);
  await assert.rejects(
    () => validate(fixture, [baseTask(), baseTask({ task_id: "T-001" })]),
    UsageError,
  );
  await assert.rejects(
    () => validate(fixture, [baseTask({ depends_on: ["T-404"] })]),
    UsageError,
  );
  await assert.rejects(
    () =>
      validate(fixture, [
        baseTask({ task_id: "T-001", depends_on: ["T-002"] }),
        baseTask({ task_id: "T-002", depends_on: ["T-001"] }),
      ]),
    UsageError,
  );
});

test("internal skills must declare idempotent and must match the plan", async () => {
  const fixture = makeFixture();
  writeSkill(fixture, "no-idem", { idempotent: undefined });
  await assert.rejects(
    () => validate(fixture, [baseTask({ resolved_skill: "library/no-idem" })]),
    (error) => error instanceof TransitionError && error.code === "idempotency_missing",
  );

  await assert.rejects(
    () =>
      validate(fixture, [
        baseTask({ resolved_skill: "library/release-prep", idempotent: true }),
      ]),
    (error) => error instanceof TransitionError && error.code === "idempotency_mismatch",
  );

  const declared = await validate(fixture, [
    baseTask({ resolved_skill: "library/release-prep", idempotent: false }),
  ]);
  assert.equal(declared.tasks[0].idempotent, false);
});

test("an external skill without an idempotent value is recorded as false", async () => {
  const fixture = makeFixture();
  const plan = await validate(fixture, [
    baseTask({
      resolved_skill: "external/debug",
      resolution_source: "manifest",
      idempotent: undefined,
    }),
  ]);
  assert.equal(plan.tasks[0].idempotent, false);
});

test("replace protection rejects identity changes and removals for done tasks", () => {
  const currentPlan = { tasks: [baseTask()] };
  const done = [{ task_id: "T-001", status: "done" }];

  assert.throws(
    () =>
      assertReplaceAllowed({
        currentPlan,
        currentTasks: done,
        newPlan: { tasks: [baseTask({ owner: "someone-else" })] },
        replace: true,
      }),
    IdentityChangeError,
  );
  assert.throws(
    () =>
      assertReplaceAllowed({
        currentPlan,
        currentTasks: done,
        newPlan: { tasks: [] },
        replace: true,
      }),
    IdentityChangeError,
  );
  assert.throws(
    () =>
      assertReplaceAllowed({
        currentPlan,
        currentTasks: done,
        newPlan: { tasks: [baseTask()] },
        replace: false,
      }),
    TransitionError,
  );
  assert.doesNotThrow(() =>
    assertReplaceAllowed({
      currentPlan,
      currentTasks: done,
      newPlan: { tasks: [baseTask()] },
      replace: true,
    }),
  );
  assert.doesNotThrow(() =>
    assertReplaceAllowed({
      currentPlan: { tasks: [] },
      currentTasks: [],
      newPlan: { tasks: [baseTask()] },
      replace: false,
    }),
  );
});

test("plan set refuses to change a done task and preserves it on a valid replace", () => {
  const fixture = makeFixture();
  assert.equal(boot(fixture).status, 0);
  assert.equal(planSet(fixture).status, 0);
  const done = completeTask(fixture, { taskId: "T-001", capability: "route", next: "develop" });
  assert.equal(done.ended.status, 0);

  const changed = defaultTasks();
  changed[0].owner = "another-owner";
  const changedFile = join(fixture.root, "changed-plan.json");
  writeFileSync(changedFile, `${JSON.stringify({ tasks: changed }, null, 2)}\n`);
  const rejected = planSet(fixture, { file: changedFile, replace: true });
  assert.equal(rejected.status, 5);
  assert.match(rejected.stderr, /identity_change|replacement changes owner/);

  const same = defaultTasks();
  const sameFile = join(fixture.root, "same-plan.json");
  writeFileSync(sameFile, `${JSON.stringify({ tasks: same }, null, 2)}\n`);
  const accepted = planSet(fixture, { file: sameFile, replace: true });
  assert.equal(accepted.status, 0, accepted.stderr);
  const task = readJson(join(fixture.state, "tasks", "T-001", "task.json"));
  assert.equal(task.status, "done");
  assert.equal(task.attempt, 1);
  assert.match(readJson(join(fixture.state, "plan.json")).checksum, /^sha256:[0-9a-f]{64}$/);
});
