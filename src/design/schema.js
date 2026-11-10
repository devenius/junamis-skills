// Design registry schema: frontmatter, required body sections, canonical body,
// and checksum.
//
// The checksum is computed over the canonicalized body only. Sections are put
// in a fixed order, trailing whitespace is stripped per line, line endings are
// normalized to \n, and frontmatter is excluded.

import { dirname, isAbsolute, join, relative } from "node:path";
import { listDir, readText, statSafe, toPosixPath } from "../orchestrator/fsx.js";
import { sha256Hex } from "../orchestrator/hash.js";
import { ValidationError } from "./errors.js";
import { parseFrontmatterDocument } from "./yaml.js";

export const KINDS = Object.freeze(["web", "api", "data", "infra", "cli", "other"]);
export const STATUSES = Object.freeze(["draft", "active", "deprecated", "needs_review"]);
export const STATUS_ORDER = Object.freeze(["active", "draft", "deprecated", "needs_review"]);

export const COMMON_SECTIONS = Object.freeze(["Intent", "Current state", "Known gaps", "Change log"]);

export const KIND_SECTIONS = Object.freeze({
  web: Object.freeze(["Structure", "Routes", "State & data", "Props & events", "Accessibility"]),
  api: Object.freeze(["Endpoint", "Request", "Response — 200", "Errors", "Examples"]),
  data: Object.freeze(["Entities", "Indexes", "Migrations"]),
  infra: Object.freeze(["Topology", "Resources", "Env & secrets"]),
  cli: Object.freeze(["Command", "Flags", "Output"]),
  other: Object.freeze([]),
});

const REQUIRED_KEYS = Object.freeze([
  "surface_id",
  "kind",
  "status",
  "version",
  "owner",
  "code_paths",
  "depends_on",
  "related_tasks",
  "last_reviewed",
  "design_checksum",
]);

const OPTIONAL_KEYS = Object.freeze(["app", "last_reviewed_commit"]);

const SURFACE_ID_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHECKSUM_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

export function isKind(value) {
  return typeof value === "string" && KINDS.includes(value);
}

export function isSurfaceId(value) {
  return typeof value === "string" && SURFACE_ID_RE.test(value);
}

export function isStatus(value) {
  return typeof value === "string" && STATUSES.includes(value);
}

export function requiredSections(kind) {
  if (!isKind(kind)) return null;
  return [...COMMON_SECTIONS, ...KIND_SECTIONS[kind]];
}

export function canonicalSectionOrder(kind) {
  if (!isKind(kind)) return null;
  return ["Intent", "Current state", "Known gaps", ...KIND_SECTIONS[kind], "Change log"];
}

export function parseSections(body) {
  const text = String(body ?? "").replace(/\r\n?/g, "\n");
  const sections = new Map();
  const order = [];
  let current = null;
  for (const line of text.split("\n")) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      const title = match[1].trim();
      if (sections.has(title)) {
        throw new ValidationError(`duplicate section "## ${title}"`, { errors: [`duplicate section ${title}`] });
      }
      sections.set(title, []);
      order.push(title);
      current = title;
      continue;
    }
    if (current === null) {
      if (line.trim().length > 0) {
        throw new ValidationError("body content appears before the first section", {
          errors: ["body content before the first ## section"],
        });
      }
      continue;
    }
    sections.get(current).push(line);
  }
  return { sections, order };
}

function normalizeSection(lines) {
  return (lines ?? [])
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

export function canonicalBody(body, kind) {
  const order = canonicalSectionOrder(kind);
  if (!order) throw new ValidationError(`unknown kind ${JSON.stringify(kind)}`);
  const { sections } = parseSections(body);
  const parts = [];
  for (const title of order) {
    const content = normalizeSection(sections.get(title));
    parts.push(content.length > 0 ? `## ${title}\n\n${content}\n` : `## ${title}\n`);
  }
  return parts.join("\n");
}

export function computeDesignChecksum(body, kind) {
  return `sha256:${sha256Hex(canonicalBody(body, kind))}`;
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function stringList(value, name, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be a list`);
    return;
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) errors.push(`${name} entries must be non-empty strings`);
  }
}

function validateCodePath(path, errors) {
  if (typeof path !== "string" || path.length === 0) {
    errors.push("code_paths entries must be non-empty strings");
    return;
  }
  if (isAbsolute(path) || path.split(/[\\/]+/).includes("..")) {
    errors.push(`code_paths entry ${JSON.stringify(path)} must be a repo-relative glob`);
  }
}

export function validateFrontmatter(data, { kind = null } = {}) {
  const errors = [];
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return ["frontmatter must be a mapping"];
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) errors.push(`missing required key ${key}`);
  }
  for (const key of Object.keys(data)) {
    if (!REQUIRED_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key)) errors.push(`unknown frontmatter key ${key}`);
  }

  if (typeof data.surface_id !== "string" || !SURFACE_ID_RE.test(data.surface_id)) {
    errors.push("surface_id must be a lowercase slash-separated id");
  }
  if (!isKind(data.kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  if (kind && data.kind !== kind) errors.push(`kind ${JSON.stringify(data.kind)} does not match its directory ${kind}`);
  if (!isStatus(data.status)) errors.push(`status must be one of ${STATUSES.join(", ")}`);
  if (typeof data.version !== "string" || !VERSION_RE.test(data.version)) {
    errors.push("version must be a semver string such as 1.0.0");
  }
  if (typeof data.owner !== "string" || data.owner.trim().length === 0) {
    errors.push("owner must be a non-empty string");
  }
  stringList(data.code_paths, "code_paths", errors);
  for (const path of data.code_paths ?? []) validateCodePath(path, errors);
  stringList(data.depends_on, "depends_on", errors);
  for (const dep of data.depends_on ?? []) {
    if (typeof dep === "string" && !SURFACE_ID_RE.test(dep)) errors.push(`depends_on entry ${JSON.stringify(dep)} is not a surface_id`);
  }
  stringList(data.related_tasks, "related_tasks", errors);
  if (typeof data.last_reviewed !== "string" || !isValidDate(data.last_reviewed)) {
    errors.push("last_reviewed must be a YYYY-MM-DD date");
  }
  if (typeof data.design_checksum !== "string" || !CHECKSUM_RE.test(data.design_checksum)) {
    errors.push("design_checksum must be sha256: followed by 64 lowercase hex characters");
  }
  if (Object.prototype.hasOwnProperty.call(data, "app") && (typeof data.app !== "string" || data.app.length === 0)) {
    errors.push("app must be a non-empty string when present");
  }
  if (Object.prototype.hasOwnProperty.call(data, "last_reviewed_commit")) {
    if (typeof data.last_reviewed_commit !== "string" || !COMMIT_RE.test(data.last_reviewed_commit)) {
      errors.push("last_reviewed_commit must be a 40-character lowercase commit SHA when present");
    }
  }
  return errors;
}

export function validateSections(body, kind) {
  const errors = [];
  const required = requiredSections(kind);
  if (!required) return [`unknown kind ${JSON.stringify(kind)}`];
  let parsed;
  try {
    parsed = parseSections(body);
  } catch (error) {
    return [error.message];
  }
  for (const title of required) {
    if (!parsed.sections.has(title)) errors.push(`missing required section ## ${title}`);
  }
  for (const title of parsed.order) {
    if (!required.includes(title)) errors.push(`unknown section ## ${title}`);
  }

  const gaps = parsed.sections.get("Known gaps");
  if (gaps) {
    const lines = gaps.map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      errors.push("## Known gaps must be explicit; use - None when there are no gaps");
    }
    for (const line of lines) {
      if (!line.startsWith("- ")) errors.push(`## Known gaps line is not a bullet: ${line}`);
    }
  }

  const changeLog = parsed.sections.get("Change log");
  if (changeLog) {
    for (const line of changeLog.map((entry) => entry.trim()).filter(Boolean)) {
      if (!line.startsWith("- ")) errors.push(`## Change log line is not a bullet: ${line}`);
    }
  }
  return errors;
}

export function relativeSurfaceId(file, designRoot) {
  const rel = toPosixPath(relative(designRoot, file));
  return rel.endsWith(".md") ? rel.slice(0, -3) : rel;
}

export function validateDesignText(text, { file = null, designRoot = null, requireChecksum = true } = {}) {
  let parsed;
  try {
    parsed = parseFrontmatterDocument(text, { label: file ?? "design file" });
  } catch (error) {
    return { ok: false, errors: [error.message], file, frontmatter: null, body: null, checksum: null };
  }
  const { data, body } = parsed;
  let kind = data?.kind ?? null;
  let pathKind = null;
  let surfaceId = data?.surface_id ?? null;

  if (file && designRoot) {
    const rel = relativeSurfaceId(file, designRoot);
    surfaceId = rel;
    pathKind = rel.split("/")[0];
    if (!isKind(pathKind)) {
      return { ok: false, errors: [`file is not under a known kind directory: ${rel}`], file, frontmatter: data, body, checksum: null };
    }
    kind = pathKind;
  }

  const errors = validateFrontmatter(data, { kind: pathKind });
  if (surfaceId && typeof data?.surface_id === "string" && data.surface_id !== surfaceId) {
    errors.push(`surface_id ${JSON.stringify(data.surface_id)} does not equal its path ${JSON.stringify(surfaceId)}`);
  }
  if (isKind(kind)) errors.push(...validateSections(body, kind));

  let checksum = null;
  if (isKind(kind)) {
    try {
      checksum = computeDesignChecksum(body, kind);
    } catch (error) {
      errors.push(error.message);
    }
    if (requireChecksum && checksum && data?.design_checksum !== checksum) {
      errors.push(`design_checksum does not match the body (expected ${checksum})`);
    }
  }
  return { ok: errors.length === 0, errors, file, frontmatter: data, body, checksum, surfaceId, kind };
}

export async function listSurfaceFiles(designRoot) {
  const files = [];
  for (const kind of KINDS) {
    const dir = join(designRoot, kind);
    const stat = await statSafe(dir);
    if (!stat || !stat.isDirectory()) continue;
    await walk(dir, files);
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return files;
}

async function walk(dir, out) {
  const entries = await listDir(dir);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    out.push(path);
  }
}

export async function loadSurfaces(designRoot, { validate = false } = {}) {
  const files = await listSurfaceFiles(designRoot);
  const surfaces = [];
  const errors = [];
  for (const file of files) {
    const text = await readText(file);
    const result = validateDesignText(text ?? "", { file, designRoot, requireChecksum: validate });
    if (validate && !result.ok) {
      errors.push({ file, errors: result.errors });
      continue;
    }
    if (!result.ok && result.frontmatter === null) {
      errors.push({ file, errors: result.errors });
      continue;
    }
    surfaces.push({
      file,
      relative: toPosixPath(relative(designRoot, file)),
      surface_id: result.surfaceId,
      frontmatter: result.frontmatter,
      body: result.body,
      checksum: result.checksum,
    });
  }
  return { files, surfaces, errors };
}

export async function validateRegistry(designRoot) {
  const { files, surfaces, errors } = await loadSurfaces(designRoot, { validate: true });
  const seen = new Map();
  for (const surface of surfaces) {
    if (seen.has(surface.surface_id)) {
      errors.push({ file: surface.file, errors: [`duplicate surface_id also used by ${seen.get(surface.surface_id)}`] });
    } else {
      seen.set(surface.surface_id, surface.relative);
    }
  }
  return { ok: errors.length === 0, count: files.length, files, surfaces, errors };
}

export async function readSurface(designRoot, surfaceId) {
  if (typeof surfaceId !== "string" || !SURFACE_ID_RE.test(surfaceId)) {
    throw new ValidationError(`invalid surface_id ${JSON.stringify(surfaceId)}`);
  }
  const kind = surfaceId.split("/")[0];
  if (!isKind(kind)) throw new ValidationError(`surface_id ${surfaceId} does not start with a known kind`);
  const file = join(designRoot, `${surfaceId}.md`);
  const rel = relative(designRoot, file);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ValidationError(`surface_id ${surfaceId} escapes the design root`);
  const text = await readText(file);
  if (text === null) return null;
  return validateDesignText(text, { file, designRoot, requireChecksum: true });
}

export function surfacePath(designRoot, surfaceId) {
  return join(designRoot, `${surfaceId}.md`);
}

export function parentDir(file) {
  return dirname(file);
}
