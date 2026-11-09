// Shared fixtures for the orchestrator unit tests.
//
// Every fixture is a fresh temporary project, library, and state root. Tests
// never write to the repository.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orchestrator-state.mjs");

export const SKILLS = {
  route: { idempotent: true, body: "# route\n" },
  develop: { idempotent: true, body: "# develop\n" },
  "release-prep": { idempotent: false, body: "# release-prep\n" },
};

export function defaultTasks() {
  return [
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
    {
      task_id: "T-002",
      capability: "develop",
      depends_on: ["T-001"],
      resolved_skill: "library/develop",
      resolution_source: "internal_override",
      owner: "orchestrator",
      adapter: null,
      idempotent: true,
    },
    {
      task_id: "T-003",
      capability: "release-prep",
      depends_on: ["T-002"],
      resolved_skill: "library/release-prep",
      resolution_source: "internal_override",
      owner: "orchestrator",
      adapter: null,
      idempotent: false,
    },
  ];
}

export function writeSkill(fixture, name, { idempotent, body = `# ${name}\n`, extra = "" } = {}) {
  const dir = join(fixture.library, "skills", name);
  mkdirSync(dir, { recursive: true });
  const idempotentLine = idempotent === undefined ? "" : `idempotent: ${idempotent}\n`;
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\nversion: "1.0.0"\n${idempotentLine}${extra}description: fixture ${name}\n---\n${body}`,
  );
}

export function makeFixture({ tasks = defaultTasks() } = {}) {
  const root = mkdtempSync(join(tmpdir(), "orch-unit-"));
  const project = join(root, "project");
  const library = join(root, "library");
  const state = join(root, "state");
  const manifest = join(root, "skills-lock.json");
  const planFile = join(root, "plan.json");

  mkdirSync(join(project, "artifacts"), { recursive: true });
  mkdirSync(join(library, "agents"), { recursive: true });
  for (const [name, skill] of Object.entries(SKILLS)) writeSkill({ library }, name, skill);
  writeFileSync(
    join(library, "agents", "orchestrator.md"),
    "---\nname: orchestrator\ndescription: fixture orchestrator\n---\n# orchestrator\n",
  );
  writeFileSync(manifest, `${JSON.stringify({ version: 1, skills: {} }, null, 2)}\n`);
  writeFileSync(planFile, `${JSON.stringify({ tasks }, null, 2)}\n`);

  return {
    root,
    project,
    library,
    state,
    manifest,
    planFile,
    session: "s-unittest",
    tasks,
  };
}

export function runCli(fixture, argv, { session = fixture.session, env = {}, state = fixture.state, project = fixture.project, library = fixture.library, manifest = fixture.manifest } = {}) {
  return spawnSync(
    process.execPath,
    [
      CLI,
      ...argv,
      "--project",
      project,
      "--state-root",
      state,
      "--library-root",
      library,
      "--manifest",
      manifest,
      "--session",
      session,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ORCH_TEST_ALLOW_TMP: "1",
        ...env,
      },
    },
  );
}

export function boot(fixture, options = {}) {
  return runCli(fixture, ["boot"], options);
}

export function planSet(fixture, { file = fixture.planFile, replace = false, ...options } = {}) {
  const argv = ["plan", "set", "--file", file];
  if (replace) argv.push("--replace");
  return runCli(fixture, argv, options);
}

export function start(fixture, taskId, options = {}) {
  return runCli(fixture, ["start", "--task", taskId], options);
}

export function end(fixture, taskId, stepId, handoff, options = {}) {
  return runCli(fixture, ["end", "--task", taskId, "--step", stepId, "--handoff", handoff], options);
}

export function endFailed(fixture, taskId, stepId, reason, options = {}) {
  return runCli(
    fixture,
    ["end", "--task", taskId, "--step", stepId, "--status", "failed", "--reason", reason],
    options,
  );
}

export function checkpoint(fixture, options = {}) {
  return runCli(fixture, ["checkpoint"], options);
}

export function finish(fixture, options = {}) {
  return runCli(fixture, ["finish"], options);
}

export function status(fixture, options = {}) {
  return runCli(fixture, ["status"], options);
}

export function writeArtifact(fixture, relative, content = "artifact\n") {
  const path = join(fixture.project, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return relative;
}

export function handoffText({
  agent = "route",
  job = "fixture job",
  status = "complete",
  artifacts = [],
  findings = [],
  decisions = [],
  next = "none",
}) {
  const lines = [
    `agent: ${agent}`,
    `job: ${job}`,
    `status: ${status}`,
    "artifacts:",
  ];
  if (artifacts.length === 0) {
    lines[lines.length - 1] = "artifacts: []";
  } else {
    for (const artifact of artifacts) {
      lines.push(`  - path: ${artifact.path}`);
      lines.push(`    kind: ${artifact.kind ?? "created"}`);
    }
  }
  if (findings.length === 0) {
    lines.push("findings: []");
  } else {
    lines.push("findings:");
    for (const finding of findings) {
      lines.push(`  - id: ${finding.id}`);
      lines.push(`    severity: ${finding.severity}`);
      lines.push(`    summary: ${finding.summary}`);
      lines.push(`    evidence: ${finding.evidence}`);
    }
  }
  if (decisions.length === 0) {
    lines.push("decisions_owed: []");
  } else {
    lines.push("decisions_owed:");
    for (const question of decisions) lines.push(`  - ${question}`);
  }
  lines.push(`next: ${next}`);
  return `${lines.join("\n")}\n`;
}

export function writeHandoff(fixture, taskId, filename, text) {
  const path = join(fixture.state, "tasks", taskId, "handoffs", filename);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return `tasks/${taskId}/handoffs/${filename}`;
}

export function completeTask(fixture, {
  taskId = "T-001",
  capability = "route",
  attempt = 1,
  status = "complete",
  next = "none",
  decisions = [],
  artifact = `artifacts/${taskId}.md`,
  session,
  options = {},
} = {}) {
  writeArtifact(fixture, artifact, `${taskId} output\n`);
  const handoff = writeHandoff(
    fixture,
    taskId,
    `${capability}-${attempt}.yaml`,
    handoffText({
      agent: capability,
      status,
      artifacts: [{ path: artifact, kind: "created" }],
      decisions,
      next,
    }),
  );
  const started = start(fixture, taskId, { ...options, session });
  const step = `${taskId}/${capability}/attempt-${attempt}`;
  const ended = end(fixture, taskId, step, handoff, { ...options, session });
  return { started, ended, handoff, step };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function fileExists(path) {
  return existsSync(path);
}

export function json(result) {
  return JSON.parse(result.stdout.trim());
}
