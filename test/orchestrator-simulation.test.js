// End-to-end orchestrator simulation.
//
// Runs the built CLIs against a temporary project: design bootstrap, boot
// (NEW_RUN), plan set, reconcile (plan_pending head), start, a complete
// handoff plus artifact, end, then a final reconcile to no_work/run_complete.
//
// Hermetic: no model, no network, no real skill is dispatched. The fixture
// project is copied into a temp directory and the state root stays there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test", "fixtures", "orchestrator", "project");
const ORCHESTRATOR = join(ROOT, "scripts", "orchestrator-state.mjs");
const DESIGN = join(ROOT, "scripts", "design-registry.mjs");
const RECONCILE = join(ROOT, "scripts", "reconcile.mjs");

const SINGLE_TASK_PLAN = {
  tasks: [
    {
      task_id: "T-001",
      capability: "route",
      depends_on: [],
      resolved_skill: "library/route",
      resolution_source: "internal_override",
      owner: "orchestrator",
      adapter: null,
      idempotent: true,
    },
  ],
};

function makeProject() {
  const base = mkdtempSync(join(tmpdir(), "orch-simulation-"));
  const project = join(base, "project");
  cpSync(FIXTURE, project, { recursive: true });
  // One task makes the run converge to no_work after the first end.
  writeFileSync(join(project, "plan.json"), `${JSON.stringify(SINGLE_TASK_PLAN, null, 2)}\n`);
  return { base, project, stateRoot: join(base, "state"), session: "s-simulation" };
}

function cli(context, script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: context.project,
    encoding: "utf8",
    env: {
      ...process.env,
      ORCH_PROJECT_ROOT: context.project,
      ORCH_STATE_ROOT: context.stateRoot,
      ORCH_SESSION_ID: context.session,
      ORCH_LIBRARY_ROOT: join(context.project, "library"),
      ORCH_MANIFEST: join(context.project, "skills-lock.json"),
      ORCH_TEST_ALLOW_TMP: "1",
    },
  });
}

function succeeded(result, label) {
  assert.equal(result.status, 0, `${label} failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function journal(context) {
  return readFileSync(join(context.stateRoot, "journal.ndjson"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test("SIM-T1 the built CLIs drive one request from bootstrap to no_work", async () => {
  const context = makeProject();

  // 1. Design registry bootstrap: one single-project overview, valid.
  const bootstrapped = succeeded(cli(context, DESIGN, ["bootstrap", "--json"]), "design bootstrap");
  const bootstrapResult = JSON.parse(bootstrapped.stdout);
  assert.equal(bootstrapResult.ok, true);
  assert.deepEqual(bootstrapResult.created, ["other/overview.md"]);
  succeeded(cli(context, DESIGN, ["validate"]), "design validate");
  succeeded(cli(context, DESIGN, ["index", "--check"]), "design index --check");

  // 2. Orchestrator boot starts a new run.
  succeeded(cli(context, ORCHESTRATOR, ["boot"]), "orchestrator boot");
  const report = readFileSync(join(context.stateRoot, "resume-report.md"), "utf8");
  assert.match(report, /^- Status: NEW_RUN$/m, report);

  // 3. Plan set records the single task.
  succeeded(cli(context, ORCHESTRATOR, ["plan", "set", "--file", "plan.json"]), "plan set");
  const plan = readJson(join(context.stateRoot, "plan.json"));
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].task_id, "T-001");

  // 4. Reconcile derives a plan_pending head for the plan task.
  succeeded(cli(context, RECONCILE, ["pass", "--trigger", "boot"]), "reconcile pass");
  const firstQueue = readJson(join(context.stateRoot, "work-queue.json"));
  assert.equal(firstQueue.status, "ready");
  assert.equal(firstQueue.queue.length, 1);
  assert.equal(firstQueue.queue[0].reason, "plan_pending");
  assert.equal(firstQueue.queue[0].target.id, "T-001");
  assert.equal(firstQueue.queue[0].resolved_skill, "library/route");
  assert.equal(firstQueue.queue[0].ready, true);

  // 5. Start the head task.
  succeeded(cli(context, ORCHESTRATOR, ["start", "--task", "T-001"]), "start");
  const task = readJson(join(context.stateRoot, "tasks", "T-001", "task.json"));
  assert.equal(task.status, "in_progress");
  const stepId = task.current_step.step_id;

  // 6. The specialist writes a complete handoff and its artifact.
  const artifact = join(context.project, "artifacts", "simulation.md");
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, "# simulation\n\nRoute classified the request.\n");
  const handoffDir = join(context.stateRoot, "tasks", "T-001", "handoffs");
  mkdirSync(handoffDir, { recursive: true });
  writeFileSync(join(handoffDir, "route-1.yaml"), [
    "agent: route",
    "job: classify the simulated request",
    "status: complete",
    "artifacts:",
    "  - path: artifacts/simulation.md",
    "    kind: created",
    "findings: []",
    "decisions_owed: []",
    "next: none",
    "",
  ].join("\n"));

  // 7. End validates the handoff, records the artifact, and reconciles.
  succeeded(
    cli(context, ORCHESTRATOR, ["end", "--task", "T-001", "--step", stepId, "--handoff", "tasks/T-001/handoffs/route-1.yaml"]),
    "end",
  );
  const done = readJson(join(context.stateRoot, "tasks", "T-001", "task.json"));
  assert.equal(done.status, "done");
  assert.deepEqual(done.outputs, ["artifacts/simulation.md"]);

  // 8. A fresh pass converges: all done, no head, run_complete journaled once.
  succeeded(cli(context, RECONCILE, ["pass", "--trigger", "step_end"]), "final reconcile pass");
  const finalQueue = readJson(join(context.stateRoot, "work-queue.json"));
  assert.equal(finalQueue.status, "no_work");
  assert.equal(finalQueue.queue.length, 0);
  assert.equal(finalQueue.summary.total, 0);

  const events = journal(context);
  assert.equal(events.filter((event) => event.type === "run_complete").length, 1);
  assert.ok(events.some((event) => event.type === "reconcile_pass" && event.status === "no_work"));
});

test("SIM-T2 the orchestrator prompt isolates work and routes from the queue head", () => {
  const prompt = readFileSync(join(ROOT, "library", "agents", "orchestrator.md"), "utf8");
  assert.match(prompt, /## Work isolation/);
  assert.match(prompt, /pull request/);
  assert.match(prompt, /work-queue\.json/);
  assert.match(prompt, /never skip past the queue head/i);

  const route = readFileSync(join(ROOT, "library", "skills", "route", "SKILL.md"), "utf8");
  assert.match(route, /queue\[0\]/);
  assert.match(route, /never skip past the head/i);
});
