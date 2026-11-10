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
import { errorMessage, isRecord } from "../types/guards.js";
import type { DeltaOutcome, DeltaSection, DesignDelta, DesignKind } from "../types/design.js";

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

function deltaError(message: string, detail: unknown = null): DeltaError {
  return new DeltaError(message, { detail });
}

export interface DeltaFileOptions {
  readonly file?: string;
}

export function parseDeltaText(text: unknown, { file = "delta" }: DeltaFileOptions = {}): DesignDelta {
  if (typeof text !== "string" || text.trim().length === 0) throw deltaError(`${file} is empty`);
  let raw: unknown;
  if (extname(file).toLowerCase() === ".json" || text.trimStart().startsWith("{")) {
    try {
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      throw deltaError(`${file} is not valid JSON: ${errorMessage(error)}`);
    }
  } else {
    raw = parseYaml(text, { label: file });
  }
  return normalizeDelta(raw, { file });
}

export function normalizeDelta(raw: unknown, { file = "delta" }: DeltaFileOptions = {}): DesignDelta {
  if (!isRecord(raw)) {
    throw deltaError(`${file} must be a mapping`);
  }
  for (const key of Object.keys(raw)) {
    if (!DELTA_KEYS.has(key)) throw deltaError(`${file} has an unknown key ${key}`);
  }
  const surfaceId = raw["surface_id"];
  if (!isSurfaceId(surfaceId)) throw deltaError(`${file} has an invalid surface_id`);
  const kind = surfaceId.split("/")[0] ?? "";
  if (!isKind(kind)) throw deltaError(`${file} surface_id does not start with a known kind`);
  const operation = raw["operation"];
  if (typeof operation !== "string" || !OPERATIONS.has(operation)) {
    throw deltaError(`${file} operation must be create, update, deprecate, or none`);
  }
  const baseChecksum = raw["base_checksum"];
  if (operation === "create") {
    if (baseChecksum !== null && baseChecksum !== undefined) {
      throw deltaError(`${file} operation create requires base_checksum: null`);
    }
  } else if (operation !== "none") {
    if (typeof baseChecksum !== "string" || !CHECKSUM_RE.test(baseChecksum)) {
      throw deltaError(`${file} operation ${operation} requires a sha256 base_checksum`);
    }
  }

  const sections = raw["sections"] ?? [];
  if (!Array.isArray(sections)) throw deltaError(`${file} sections must be a list`);
  if (operation === "deprecate" && sections.length > 0) {
    throw deltaError(`${file} operation deprecate must have an empty sections list`);
  }
  if (operation === "none" && sections.length > 0) {
    throw deltaError(`${file} operation none must have an empty sections list`);
  }
  const normalizedSections: DeltaSection[] = sections.map((section, index) => {
    if (!isRecord(section)) {
      throw deltaError(`${file} sections[${index}] must be a mapping`);
    }
    const sectionName = section["section"];
    if (typeof sectionName !== "string" || sectionName.length === 0) {
      throw deltaError(`${file} sections[${index}].section must be a non-empty string`);
    }
    const action = section["action"];
    if (typeof action !== "string" || !ACTIONS.has(action)) {
      throw deltaError(`${file} sections[${index}].action ${JSON.stringify(action)} is not supported`);
    }
    if (action === "remove_line") {
      const match = section["match"];
      if (typeof match !== "string" || match.length === 0) {
        throw deltaError(`${file} sections[${index}] remove_line needs a match string`);
      }
      return { section: sectionName, action: "remove_line", match };
    }
    const content = section["content"];
    if (typeof content !== "string") {
      throw deltaError(`${file} sections[${index}] ${action} needs a content string`);
    }
    return { section: sectionName, action: action as "replace" | "append" | "prepend", content };
  });

  const codePathsTouched = raw["code_paths_touched"] ?? [];
  if (!Array.isArray(codePathsTouched) || codePathsTouched.some((path) => typeof path !== "string" || path.length === 0)) {
    throw deltaError(`${file} code_paths_touched must be a list of non-empty strings`);
  }
  const bump = raw["bump"] ?? "minor";
  if (bump !== "minor" && bump !== "major") throw deltaError(`${file} bump must be minor or major`);
  const taskId = raw["task_id"];
  if (taskId !== undefined && (typeof taskId !== "string" || taskId.length === 0)) {
    throw deltaError(`${file} task_id must be a non-empty string`);
  }
  const skill = raw["skill"];
  if (skill !== undefined && (typeof skill !== "string" || skill.length === 0)) {
    throw deltaError(`${file} skill must be a non-empty string`);
  }
  const rationale = raw["rationale"];
  if (rationale !== undefined && typeof rationale !== "string") {
    throw deltaError(`${file} rationale must be a string`);
  }
  const idempotent = raw["idempotent"];
  if (idempotent !== undefined && typeof idempotent !== "boolean") {
    throw deltaError(`${file} idempotent must be true or false`);
  }

  return {
    surface_id: surfaceId,
    operation: operation as DesignDelta["operation"],
    base_checksum: operation === "create" ? null : (typeof baseChecksum === "string" ? baseChecksum : null),
    sections: normalizedSections,
    code_paths_touched: codePathsTouched as string[],
    rationale: typeof rationale === "string" ? rationale : null,
    task_id: typeof taskId === "string" ? taskId : null,
    skill: typeof skill === "string" ? skill : null,
    idempotent: idempotent === true,
    bump,
  };
}

function normalizeContent(lines: readonly string[] | undefined): string {
  return (lines ?? [])
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function buildBody(sections: Map<string, readonly string[]>, kind: DesignKind): string {
  const order = canonicalSectionOrder(kind) ?? [];
  return order
    .map((title) => {
      const content = normalizeContent(sections.get(title));
      return content.length > 0 ? `## ${title}\n\n${content}\n` : `## ${title}\n`;
    })
    .join("\n");
}

function appendContent(existing: string, content: string): string {
  const normalized = normalizeContent(content.split("\n"));
  if (existing.length === 0) return content;
  if (normalized.length > 0 && existing.endsWith(normalized)) return existing;
  return `${existing}\n\n${content}`;
}

function prependContent(existing: string, content: string): string {
  const normalized = normalizeContent(content.split("\n"));
  if (existing.length === 0) return content;
  if (normalized.length > 0 && existing.startsWith(normalized)) return existing;
  return `${content}\n\n${existing}`;
}

const BULLET_SECTIONS = new Set(["Known gaps", "Change log"]);

function bulletize(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return line;
      return trimmed.startsWith("- ") ? line : `- ${trimmed}`;
    })
    .join("\n");
}

export function applySectionActions(body: string, sections: readonly DeltaSection[], kind: DesignKind): string {
  const parsed = parseSections(body);
  const map = new Map<string, string[]>([...parsed.sections.entries()].map(([title, lines]) => [title, [...lines]]));
  for (const entry of sections) {
    if (!map.has(entry.section)) {
      throw new ValidationError(`delta names missing section ## ${entry.section}`);
    }
    const current = map.get(entry.section) ?? [];
    const content = BULLET_SECTIONS.has(entry.section) && entry.content !== undefined
      ? bulletize(entry.content)
      : entry.content;
    if (entry.action === "replace") {
      map.set(entry.section, (content ?? "").split("\n"));
    } else if (entry.action === "append") {
      const existing = normalizeContent(current);
      map.set(entry.section, appendContent(existing, content ?? "").split("\n"));
    } else if (entry.action === "prepend") {
      const existing = normalizeContent(current);
      map.set(entry.section, prependContent(existing, content ?? "").split("\n"));
    } else if (entry.action === "remove_line") {
      const index = current.findIndex((line) => line.includes(entry.match ?? ""));
      if (index !== -1) current.splice(index, 1);
    }
  }
  if (map.has("Known gaps") && normalizeContent(map.get("Known gaps")).length === 0) {
    map.set("Known gaps", ["- None"]);
  }
  return buildBody(map, kind);
}

function bumpVersion(version: string, bump: string): string {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  if (bump === "major") return `${major + 1}.0.0`;
  return `${major}.${minor + 1}.0`;
}

function yamlScalar(value: unknown): string {
  const text = String(value);
  return SAFE_SCALAR_RE.test(text) ? text : JSON.stringify(text).replace(/"/g, "'");
}

function yamlList(key: string, values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) return [`${key}: []`];
  const lines = [`${key}:`];
  for (const value of values) lines.push(`  - "${String(value).replace(/"/g, "'")}"`);
  return lines;
}

/** The frontmatter `renderDesignFile` writes. */
export interface RenderableFrontmatter {
  surface_id: string;
  app?: string | null;
  kind: string;
  status: string;
  version: string;
  owner: string;
  code_paths: readonly string[];
  depends_on: readonly string[];
  related_tasks: readonly string[];
  last_reviewed: string;
  design_checksum?: string;
  last_reviewed_commit?: string | null;
}

export function renderDesignFile(frontmatter: RenderableFrontmatter, body: string): string {
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
  lines.push(`design_checksum: ${frontmatter.design_checksum ?? ""}`);
  if (frontmatter.last_reviewed_commit) lines.push(`last_reviewed_commit: ${frontmatter.last_reviewed_commit}`);
  lines.push("---", "");
  return `${lines.join("\n")}\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export function headCommit(projectRoot: string, { git = true }: { readonly git?: boolean } = {}): string | null {
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

function today(now: string | null): string {
  if (!now) return new Date().toISOString().slice(0, 10);
  const value = String(now).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw deltaError(`--now must be a YYYY-MM-DD date`);
  return value;
}

interface ChangeLogInput {
  readonly date: string;
  readonly version: string;
  readonly operation: string;
  readonly rationale: string | null;
  readonly taskId: string | null;
  readonly skill: string | null;
}

function changeLogLine({ date, version, operation, rationale, taskId, skill }: ChangeLogInput): string {
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

function hasChangeLogAction(delta: DesignDelta): boolean {
  return delta.sections.some((entry) => entry.section === "Change log");
}

interface RejectInput {
  readonly stateRoot: string;
  readonly projectRoot?: string | null;
  readonly designRoot?: string | null;
  readonly delta: DesignDelta;
  readonly reason: string;
  readonly code?: string;
  readonly detail?: unknown;
}

async function reject({
  stateRoot,
  projectRoot = null,
  designRoot = null,
  delta,
  reason,
  code = "invalid_delta",
  detail = null,
}: RejectInput): Promise<DeltaOutcome> {
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

export interface ApplyDeltaOptions {
  readonly projectRoot: string;
  readonly designRoot: string;
  readonly stateRoot: string;
  readonly deltaPath?: string | null;
  readonly deltaText?: string | null;
  readonly now?: string | null;
  readonly git?: boolean;
  readonly onWritten?: ((input: { readonly designRoot: string; readonly surfaceId: string }) => Promise<{ readonly path: string | null; readonly generatedAt: string }>) | null;
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
}: ApplyDeltaOptions): Promise<DeltaOutcome> {
  let delta: DesignDelta;
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
      return reject({
        projectRoot,
        designRoot,
        stateRoot,
        delta,
        reason: `current design file is invalid: ${(current?.errors ?? ["not found"]).join("; ")}`,
        code: "invalid_current_design",
        detail: current?.errors ?? null,
      });
    }
    if (current.frontmatter.status === "deprecated" || current.frontmatter.status === "needs_review") {
      return reject({
        projectRoot,
        designRoot,
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

  const kind = delta.surface_id.split("/")[0] ?? "";
  let body: string;
  let frontmatter: RenderableFrontmatter;
  if (delta.operation === "create") {
    const sections = new Map<string, readonly string[]>(
      (requiredSections(kind) ?? []).map((title) => [title, [] as readonly string[]]),
    );
    sections.set("Known gaps", ["- None"]);
    body = buildBody(sections, kind as DesignKind);
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
  } else if (current) {
    body = current.body;
    frontmatter = { ...current.frontmatter };
  } else {
    return reject({ projectRoot, designRoot, stateRoot, delta, reason: "surface does not exist", code: "surface_missing" });
  }

  if (delta.operation === "deprecate") {
    frontmatter.status = "deprecated";
  } else if (delta.sections.length > 0) {
    try {
      body = applySectionActions(body, delta.sections, kind as DesignKind);
    } catch (error) {
      const detail = isRecord(error) && "detail" in error ? error["detail"] : null;
      return reject({
        projectRoot,
        designRoot,
        stateRoot,
        delta,
        reason: errorMessage(error),
        code: error instanceof DeltaError || error instanceof ValidationError ? error.code : "invalid_delta",
        detail,
      });
    }
  }

  const oldChecksum = current?.checksum ?? null;
  const newChecksum = computeDesignChecksum(body, kind);

  if (delta.operation === "update" && newChecksum === oldChecksum) {
    if (delta.base_checksum !== oldChecksum && !delta.idempotent) {
      return reject({
        projectRoot,
        designRoot,
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
    return reject({
      projectRoot,
      designRoot,
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
    body = applySectionActions(body, [{ section: "Change log", action: "append", content: line }], kind as DesignKind);
  }

  frontmatter.design_checksum = computeDesignChecksum(body, kind);
  const text = renderDesignFile(frontmatter, body);
  const validated = validateDesignText(text, { file, designRoot, requireChecksum: true });
  if (!validated.ok) {
    return reject({
      projectRoot,
      designRoot,
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

export function deltaPathFor(projectRoot: string, relative: string): string {
  return join(projectRoot, relative);
}
