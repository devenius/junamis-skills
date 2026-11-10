// Apply a design_delta mechanically.
//
// A delta is the only way a skill changes a design surface. This module checks
// the base checksum, applies section actions, bumps the version, updates the
// review metadata, appends to the change log, validates the result, writes it
// atomically, journals the event, and (once the index module is wired in)
// regenerates INDEX.md.

import { spawnSync } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { exists, readText } from "../orchestrator/fsx.js";
import { atomicWriteText } from "./atomic.js";
import { appendDesignEvent } from "./events.js";
import { DeltaError, ValidationError } from "./errors.js";
import { writeIndex } from "./index-gen.js";
import {
  canonicalSectionOrder,
  computeDesignChecksum,
  isKind,
  isSurfaceId,
  parseSections,
  readSurface,
  requiredSections,
  surfacePath,
  validateDesignText,
} from "./schema.js";
import { parseYaml } from "./yaml.js";
import { runReconcile } from "../reconcile/queue.js";

const OPERATIONS = new Set(["create", "update", "deprecate", "none"]);
const ACTIONS = new Set(["replace", "append", "prepend", "remove_line"]);
const DELTA_KEYS = new Set([
  "surface_id",
  "operation",
  "base_checksum",
  "sections",
  "code_paths_touched",
  "rationale",
  "task_id",
  "skill",
  "idempotent",
  "bump",
]);
const CHECKSUM_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_SCALAR_RE = /^[A-Za-z0-9_./:@+-]+$/;

function deltaError(message, detail = null) {
  return new DeltaError(message, { detail });
}

export function parseDeltaText(text, { file = "delta" } = {}) {
  if (typeof text !== "string" || text.trim().length === 0) throw deltaError(`${file} is empty`);
  let raw;
  if (extname(file).toLowerCase() === ".json" || text.trimStart().startsWith("{")) {
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw deltaError(`${file} is not valid JSON: ${error.message}`);
    }
  } else {
    raw = parseYaml(text, { label: file });
  }
  return normalizeDelta(raw, { file });
}

export function normalizeDelta(raw, { file = "delta" } = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw deltaError(`${file} must be a mapping`);
  }
  for (const key of Object.keys(raw)) {
    if (!DELTA_KEYS.has(key)) throw deltaError(`${file} has an unknown key ${key}`);
  }
  if (!isSurfaceId(raw.surface_id)) throw deltaError(`${file} has an invalid surface_id`);
  const kind = raw.surface_id.split("/")[0];
  if (!isKind(kind)) throw deltaError(`${file} surface_id does not start with a known kind`);
  if (!OPERATIONS.has(raw.operation)) {
    throw deltaError(`${file} operation must be create, update, deprecate, or none`);
  }
  if (raw.operation === "create") {
    if (raw.base_checksum !== null && raw.base_checksum !== undefined) {
      throw deltaError(`${file} operation create requires base_checksum: null`);
    }
  } else if (raw.operation !== "none") {
    if (typeof raw.base_checksum !== "string" || !CHECKSUM_RE.test(raw.base_checksum)) {
      throw deltaError(`${file} operation ${raw.operation} requires a sha256 base_checksum`);
    }
  }

  const sections = raw.sections ?? [];
  if (!Array.isArray(sections)) throw deltaError(`${file} sections must be a list`);
  if (raw.operation === "deprecate" && sections.length > 0) {
    throw deltaError(`${file} operation deprecate must have an empty sections list`);
  }
  if (raw.operation === "none" && sections.length > 0) {
    throw deltaError(`${file} operation none must have an empty sections list`);
  }
  const normalizedSections = sections.map((section, index) => {
    if (section === null || typeof section !== "object" || Array.isArray(section)) {
      throw deltaError(`${file} sections[${index}] must be a mapping`);
    }
    if (typeof section.section !== "string" || section.section.length === 0) {
      throw deltaError(`${file} sections[${index}].section must be a non-empty string`);
    }
    if (!ACTIONS.has(section.action)) {
      throw deltaError(`${file} sections[${index}].action ${JSON.stringify(section.action)} is not supported`);
    }
    if (section.action === "remove_line") {
      if (typeof section.match !== "string" || section.match.length === 0) {
        throw deltaError(`${file} sections[${index}] remove_line needs a match string`);
      }
      return { section: section.section, action: section.action, match: section.match };
    }
    if (typeof section.content !== "string") {
      throw deltaError(`${file} sections[${index}] ${section.action} needs a content string`);
    }
    return { section: section.section, action: section.action, content: section.content };
  });

  const codePathsTouched = raw.code_paths_touched ?? [];
  if (!Array.isArray(codePathsTouched) || codePathsTouched.some((path) => typeof path !== "string" || path.length === 0)) {
    throw deltaError(`${file} code_paths_touched must be a list of non-empty strings`);
  }
  const bump = raw.bump ?? "minor";
  if (bump !== "minor" && bump !== "major") throw deltaError(`${file} bump must be minor or major`);
  if (raw.task_id !== undefined && (typeof raw.task_id !== "string" || raw.task_id.length === 0)) {
    throw deltaError(`${file} task_id must be a non-empty string`);
  }
  if (raw.skill !== undefined && (typeof raw.skill !== "string" || raw.skill.length === 0)) {
    throw deltaError(`${file} skill must be a non-empty string`);
  }
  if (raw.rationale !== undefined && typeof raw.rationale !== "string") {
    throw deltaError(`${file} rationale must be a string`);
  }
  if (raw.idempotent !== undefined && typeof raw.idempotent !== "boolean") {
    throw deltaError(`${file} idempotent must be true or false`);
  }

  return {
    surface_id: raw.surface_id,
    operation: raw.operation,
    base_checksum: raw.operation === "create" ? null : (raw.base_checksum ?? null),
    sections: normalizedSections,
    code_paths_touched: codePathsTouched,
    rationale: raw.rationale ?? null,
    task_id: raw.task_id ?? null,
    skill: raw.skill ?? null,
    idempotent: raw.idempotent ?? false,
    bump,
  };
}

function normalizeContent(lines) {
  return (lines ?? [])
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function buildBody(sections, kind) {
  const order = canonicalSectionOrder(kind);
  return order
    .map((title) => {
      const content = normalizeContent(sections.get(title));
      return content.length > 0 ? `## ${title}\n\n${content}\n` : `## ${title}\n`;
    })
    .join("\n");
}

function appendContent(existing, content) {
  const normalized = normalizeContent(content.split("\n"));
  if (existing.length === 0) return content;
  if (normalized.length > 0 && existing.endsWith(normalized)) return existing;
  return `${existing}\n\n${content}`;
}

function prependContent(existing, content) {
  const normalized = normalizeContent(content.split("\n"));
  if (existing.length === 0) return content;
  if (normalized.length > 0 && existing.startsWith(normalized)) return existing;
  return `${content}\n\n${existing}`;
}

const BULLET_SECTIONS = new Set(["Known gaps", "Change log"]);

function bulletize(content) {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return line;
      return trimmed.startsWith("- ") ? line : `- ${trimmed}`;
    })
    .join("\n");
}

export function applySectionActions(body, sections, kind) {
  const parsed = parseSections(body);
  const map = new Map([...parsed.sections.entries()].map(([title, lines]) => [title, [...lines]]));
  for (const entry of sections) {
    if (!map.has(entry.section)) {
      throw new ValidationError(`delta names missing section ## ${entry.section}`);
    }
    const current = map.get(entry.section);
    const content = BULLET_SECTIONS.has(entry.section) && entry.content !== undefined
      ? bulletize(entry.content)
      : entry.content;
    if (entry.action === "replace") {
      map.set(entry.section, content.split("\n"));
    } else if (entry.action === "append") {
      const existing = normalizeContent(current);
      map.set(entry.section, appendContent(existing, content).split("\n"));
    } else if (entry.action === "prepend") {
      const existing = normalizeContent(current);
      map.set(entry.section, prependContent(existing, content).split("\n"));
    } else if (entry.action === "remove_line") {
      const index = current.findIndex((line) => line.includes(entry.match));
      if (index !== -1) current.splice(index, 1);
    }
  }
  if (map.has("Known gaps") && normalizeContent(map.get("Known gaps")).length === 0) {
    map.set("Known gaps", ["- None"]);
  }
  return buildBody(map, kind);
}

function bumpVersion(version, bump) {
  const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10));
  if (bump === "major") return `${major + 1}.0.0`;
  return `${major}.${minor + 1}.0`;
}

function yamlScalar(value) {
  const text = String(value);
  return SAFE_SCALAR_RE.test(text) ? text : JSON.stringify(text).replace(/"/g, "'");
}

function yamlList(key, values) {
  if (!Array.isArray(values) || values.length === 0) return [`${key}: []`];
  const lines = [`${key}:`];
  for (const value of values) lines.push(`  - "${String(value).replace(/"/g, "'")}"`);
  return lines;
}

export function renderDesignFile(frontmatter, body) {
  const lines = ["---"];
  lines.push(`surface_id: ${yamlScalar(frontmatter.surface_id)}`);
  if (frontmatter.app) lines.push(`app: ${yamlScalar(frontmatter.app)}`);
  lines.push(`kind: ${frontmatter.kind}`);
  lines.push(`status: ${frontmatter.status}`);
  lines.push(`version: ${frontmatter.version}`);
  lines.push(`owner: ${yamlScalar(frontmatter.owner)}`);
  lines.push(...yamlList("code_paths", frontmatter.code_paths));
  lines.push(...yamlList("depends_on", frontmatter.depends_on));
  lines.push(...yamlList("related_tasks", frontmatter.related_tasks));
  lines.push(`last_reviewed: ${frontmatter.last_reviewed}`);
  lines.push(`design_checksum: ${frontmatter.design_checksum}`);
  if (frontmatter.last_reviewed_commit) lines.push(`last_reviewed_commit: ${frontmatter.last_reviewed_commit}`);
  lines.push("---", "");
  return `${lines.join("\n")}\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export function headCommit(projectRoot, { git = true } = {}) {
  if (!git) return null;
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const sha = (result.stdout ?? "").trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function today(now) {
  if (!now) return new Date().toISOString().slice(0, 10);
  const value = String(now).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw deltaError(`--now must be a YYYY-MM-DD date`);
  return value;
}

function changeLogLine({ date, version, operation, rationale, taskId, skill }) {
  const summary = operation === "create"
    ? "Created surface"
    : operation === "deprecate"
      ? "Deprecated surface"
      : (rationale ?? "Updated surface");
  const parts = [date, `v${version}`, String(summary).replace(/\s*\n\s*/g, " ")];
  if (taskId) parts.push(`task ${taskId}`);
  if (skill) parts.push(skill);
  return `- ${parts.join(" · ")}`;
}

function hasChangeLogAction(delta) {
  return delta.sections.some((entry) => entry.section === "Change log");
}

async function reject({ stateRoot, projectRoot = null, designRoot = null, delta, reason, code = "invalid_delta", detail = null }) {
  const journal = await appendDesignEvent({
    stateRoot,
    type: "design_delta_rejected",
    taskId: delta.task_id,
    payload: {
      surface_id: delta.surface_id,
      operation: delta.operation,
      task_id: delta.task_id ?? null,
      skill: delta.skill ?? null,
      reason,
      code,
      detail,
    },
  });
  let reconcile = null;
  if (projectRoot && designRoot && (await exists(join(stateRoot, "journal.ndjson")))) {
    try {
      reconcile = await runReconcile({
        stateRoot,
        projectRoot,
        designRoot,
        trigger: "design_delta_rejected",
        sessionId: "s-design-registry",
      });
    } catch {
      // A rejected delta still stands even if the reconcile pass cannot run.
    }
  }
  return {
    ok: false,
    rejected: true,
    surface_id: delta.surface_id,
    reason,
    code,
    journal,
    reconcile: reconcile?.status ?? null,
  };
}

export async function applyDelta({
  projectRoot,
  designRoot,
  stateRoot,
  deltaPath = null,
  deltaText = null,
  now = null,
  git = true,
  onWritten = null,
} = {}) {
  let delta;
  if (deltaText !== null) {
    delta = parseDeltaText(deltaText, { file: deltaPath ?? "delta" });
  } else {
    if (!deltaPath) throw deltaError("apply needs a delta path");
    const absolute = resolve(projectRoot, deltaPath);
    const text = await readText(absolute);
    if (text === null) throw deltaError(`delta file not found: ${absolute}`);
    delta = parseDeltaText(text, { file: absolute });
  }

  if (delta.operation === "none") {
    return {
      ok: true,
      unchanged: true,
      surface_id: delta.surface_id,
      reason: delta.rationale ?? "no change",
      operation: "none",
    };
  }

  const file = surfacePath(designRoot, delta.surface_id);
  const date = today(now);
  const existing = await exists(file);
  let current = null;
  if (existing) {
    current = await readSurface(designRoot, delta.surface_id);
    if (!current || !current.ok) {
      return reject({ projectRoot, designRoot,
        stateRoot,
        delta,
        reason: `current design file is invalid: ${(current?.errors ?? ["not found"]).join("; ")}`,
        code: "invalid_current_design",
        detail: current?.errors ?? null,
      });
    }
    if (current.frontmatter.status === "deprecated" || current.frontmatter.status === "needs_review") {
      return reject({ projectRoot, designRoot,
        stateRoot,
        delta,
        reason: `cannot apply a delta to a ${current.frontmatter.status} surface`,
        code: "status_guard",
      });
    }
  }

  if (delta.operation === "create") {
    if (existing) {
      return reject({ projectRoot, designRoot, stateRoot, delta, reason: "operation create requires the surface not to exist", code: "surface_exists" });
    }
  } else if (!existing) {
    return reject({ projectRoot, designRoot, stateRoot, delta, reason: "surface does not exist", code: "surface_missing" });
  }

  const kind = delta.surface_id.split("/")[0];
  let body;
  let frontmatter;
  if (delta.operation === "create") {
    const sections = new Map(requiredSections(kind).map((title) => [title, []]));
    sections.set("Known gaps", ["- None"]);
    body = buildBody(sections, kind);
    frontmatter = {
      surface_id: delta.surface_id,
      kind,
      status: "draft",
      version: "0.1.0",
      owner: delta.skill ?? "orchestrator",
      code_paths: [...delta.code_paths_touched],
      depends_on: [],
      related_tasks: delta.task_id ? [delta.task_id] : [],
      last_reviewed: date,
      last_reviewed_commit: headCommit(projectRoot, { git }),
    };
  } else {
    body = current.body;
    frontmatter = { ...current.frontmatter };
  }

  if (delta.operation === "deprecate") {
    body = current.body;
    frontmatter.status = "deprecated";
  } else if (delta.sections.length > 0) {
    try {
      body = applySectionActions(body, delta.sections, kind);
    } catch (error) {
      return reject({ projectRoot, designRoot,
        stateRoot,
        delta,
        reason: error.message,
        code: error.code ?? "invalid_delta",
        detail: error.detail ?? null,
      });
    }
  }

  const oldChecksum = current?.checksum ?? null;
  const newChecksum = computeDesignChecksum(body, kind);

  if (delta.operation === "update" && newChecksum === oldChecksum) {
    if (delta.base_checksum !== oldChecksum && !delta.idempotent) {
      return reject({ projectRoot, designRoot,
        stateRoot,
        delta,
        reason: "base_checksum does not match the current design_checksum",
        code: "stale_base_checksum",
        detail: { base_checksum: delta.base_checksum, current_checksum: oldChecksum },
      });
    }
    return {
      ok: true,
      unchanged: true,
      surface_id: delta.surface_id,
      reason: "delta is already applied",
      operation: delta.operation,
      checksum: oldChecksum,
    };
  }

  if (delta.operation !== "create" && delta.base_checksum !== oldChecksum) {
    return reject({ projectRoot, designRoot,
      stateRoot,
      delta,
      reason: "base_checksum does not match the current design_checksum",
      code: "stale_base_checksum",
      detail: { base_checksum: delta.base_checksum, current_checksum: oldChecksum },
    });
  }

  frontmatter.version = delta.operation === "create"
    ? "0.1.0"
    : bumpVersion(frontmatter.version, delta.bump);
  frontmatter.last_reviewed = date;
  frontmatter.last_reviewed_commit = headCommit(projectRoot, { git });
  if (delta.task_id && !(frontmatter.related_tasks ?? []).includes(delta.task_id)) {
    frontmatter.related_tasks = [...(frontmatter.related_tasks ?? []), delta.task_id];
  }

  if (!hasChangeLogAction(delta)) {
    const line = changeLogLine({
      date,
      version: frontmatter.version,
      operation: delta.operation,
      rationale: delta.rationale,
      taskId: delta.task_id,
      skill: delta.skill,
    });
    body = applySectionActions(body, [{ section: "Change log", action: "append", content: line }], kind);
  }

  frontmatter.design_checksum = computeDesignChecksum(body, kind);
  const text = renderDesignFile(frontmatter, body);
  const validated = validateDesignText(text, { file, designRoot, requireChecksum: true });
  if (!validated.ok) {
    return reject({ projectRoot, designRoot,
      stateRoot,
      delta,
      reason: `resulting design file is invalid: ${validated.errors.join("; ")}`,
      code: "invalid_result",
      detail: validated.errors,
    });
  }

  await atomicWriteText(file, text);
  const journal = await appendDesignEvent({
    stateRoot,
    type: "design_update",
    payload: {
      surface_id: delta.surface_id,
      operation: delta.operation,
      version: frontmatter.version,
      checksum: frontmatter.design_checksum,
      previous_checksum: oldChecksum,
      task_id: delta.task_id ?? null,
      skill: delta.skill ?? null,
      rationale: delta.rationale,
    },
  });

  let index;
  if (onWritten) {
    index = await onWritten({ designRoot, surfaceId: delta.surface_id });
  } else {
    const generated = await writeIndex({ designRoot });
    index = { path: generated.path, generatedAt: generated.generatedAt };
  }
  return {
    ok: true,
    unchanged: false,
    surface_id: delta.surface_id,
    operation: delta.operation,
    version: frontmatter.version,
    checksum: frontmatter.design_checksum,
    previous_checksum: oldChecksum,
    file,
    journal,
    index,
  };
}

export function deltaPathFor(projectRoot, relative) {
  return join(projectRoot, relative);
}
