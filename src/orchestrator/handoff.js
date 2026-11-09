// Strict HANDOFF block parser and artifact check.
//
// The documented block is a constrained subset: scalars, two lists of objects,
// and one list of questions. Anchors, aliases, flow collections, and multiple
// documents are rejected so a malformed handoff fails closed.

import { isAbsolute, join, resolve, sep } from "node:path";
import { exists, isInside, realpathDeep } from "./fsx.js";
import { HandoffError } from "./errors.js";

const TOP_KEYS = new Set(["agent", "job", "status", "artifacts", "findings", "decisions_owed", "next"]);
const HANDOFF_STATUSES = new Set(["complete", "blocked", "needs-decision", "failed"]);
const ARTIFACT_KINDS = new Set(["created", "updated", "read-only"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

function fail(message) {
  throw new HandoffError(message);
}

function extractBlock(text) {
  if (typeof text !== "string") fail("handoff is not text");
  const cleaned = text.replace(/^\uFEFF/, "");
  const fenced = /```ya?ml[ \t]*\r?\n([\s\S]*?)\r?\n```/i.exec(cleaned);
  if (fenced) return fenced[1];

  const lines = cleaned.split(/\r?\n/);
  const nonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (nonEmpty === -1) fail("handoff is empty");
  if (lines[nonEmpty].trim() === "---") {
    const end = lines.findLastIndex((line) => line.trim() === "---");
    if (end <= nonEmpty) fail("handoff document has no closing ---");
    return lines.slice(nonEmpty + 1, end).join("\n");
  }
  return cleaned;
}

function parseScalar(raw, field) {
  let value = raw.trim();
  if (value.length === 0) return "";
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") || value.startsWith("{") || value.startsWith("&") || value.startsWith("*") || value.startsWith("!")) {
    fail(`${field} uses an unsupported YAML construct`);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  return value;
}

function parseKeyValue(trimmed, allowed, field) {
  const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(trimmed);
  if (!match) fail(`${field} is not a key: value line`);
  const key = match[1];
  if (allowed && !allowed.has(key)) fail(`${field} has an unknown key ${key}`);
  let rest = match[2].trim();
  if (rest.startsWith("#")) rest = "";
  const hasValue = rest.length > 0;
  return { key, value: hasValue ? parseScalar(rest, `${field}.${key}`) : undefined, hasValue };
}

export function parseHandoff(text) {
  const block = extractBlock(text);
  const lines = block.split(/\r?\n/);
  const top = {};
  let currentKey = null;
  let currentItem = null;

  for (const rawLine of lines) {
    if (rawLine.includes("\t")) fail("handoff contains a tab");
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "---") fail("handoff contains multiple YAML documents");
    const indent = line.length - line.trimStart().length;
    if (indent % 2 !== 0) fail("handoff indentation must be a multiple of two spaces");

    if (indent === 0) {
      const { key, value, hasValue } = parseKeyValue(trimmed, TOP_KEYS, "handoff");
      if (Object.prototype.hasOwnProperty.call(top, key)) fail(`handoff repeats ${key}`);
      if (!hasValue) {
        top[key] = null;
        currentKey = key;
        currentItem = null;
      } else {
        top[key] = value;
        currentKey = null;
        currentItem = null;
      }
      continue;
    }

    if (!currentKey) fail(`handoff has an indented line outside a list: ${trimmed}`);
    if (top[currentKey] === null) top[currentKey] = [];
    if (!Array.isArray(top[currentKey])) fail(`handoff field ${currentKey} is not a list`);

    if (trimmed.startsWith("- ")) {
      const rest = trimmed.slice(2).trim();
      if (currentKey === "artifacts" || currentKey === "findings") {
        const item = {};
        if (rest.length > 0) {
          const parsed = parseKeyValue(rest, null, currentKey);
          if (!parsed.hasValue) fail(`${currentKey} item needs a value`);
          item[parsed.key] = parsed.value;
        }
        top[currentKey].push(item);
        currentItem = item;
      } else if (currentKey === "decisions_owed") {
        if (rest.length === 0) fail("decisions_owed item is empty");
        top[currentKey].push(parseScalar(rest, "decisions_owed"));
        currentItem = null;
      } else {
        fail(`handoff field ${currentKey} is not a list`);
      }
      continue;
    }

    if (!currentItem) fail(`handoff has a property without a list item: ${trimmed}`);
    const parsed = parseKeyValue(trimmed, null, currentKey);
    if (!parsed.hasValue) fail(`${currentKey} item property needs a value`);
    currentItem[parsed.key] = parsed.value;
  }

  for (const key of ["agent", "job", "status", "artifacts", "next"]) {
    if (!(key in top)) fail(`handoff is missing ${key}`);
  }
  if (typeof top.agent !== "string" || top.agent.length === 0) fail("handoff.agent must be a string");
  if (typeof top.job !== "string" || top.job.length === 0) fail("handoff.job must be a string");
  if (!HANDOFF_STATUSES.has(top.status)) fail(`handoff.status ${JSON.stringify(top.status)} is not valid`);
  if (typeof top.next !== "string" || top.next.length === 0) fail("handoff.next must be a string");

  if (!Array.isArray(top.artifacts)) fail("handoff.artifacts must be a list");
  for (const artifact of top.artifacts) {
    if (typeof artifact.path !== "string" || artifact.path.length === 0) fail("artifact.path must be a string");
    if (!ARTIFACT_KINDS.has(artifact.kind)) fail(`artifact.kind ${JSON.stringify(artifact.kind)} is not valid`);
  }

  const findings = top.findings ?? [];
  if (!Array.isArray(findings)) fail("handoff.findings must be a list");
  for (const finding of findings) {
    if (typeof finding.id !== "string" || finding.id.length === 0) fail("finding.id must be a string");
    if (!SEVERITIES.has(finding.severity)) fail(`finding.severity ${JSON.stringify(finding.severity)} is not valid`);
    if (typeof finding.summary !== "string") fail("finding.summary must be a string");
    if (typeof finding.evidence !== "string") fail("finding.evidence must be a string");
  }

  const decisions = top.decisions_owed ?? [];
  if (!Array.isArray(decisions) || decisions.some((q) => typeof q !== "string" || q.length === 0)) {
    fail("handoff.decisions_owed must be a list of questions");
  }

  return {
    agent: top.agent,
    job: top.job,
    status: top.status,
    artifacts: top.artifacts,
    findings,
    decisions_owed: decisions,
    next: top.next,
  };
}

function unsafeArtifactPath(path) {
  if (typeof path !== "string" || path.length === 0) return true;
  if (isAbsolute(path)) return true;
  const segments = path.split(/[\\/]+/);
  return segments.some((segment) => segment === "..");
}

export async function checkHandoffArtifacts(handoff, { projectRoot }) {
  const missing = [];
  const outside = [];
  const realRoot = await realpathDeep(projectRoot);
  for (const artifact of handoff.artifacts ?? []) {
    if (unsafeArtifactPath(artifact.path)) {
      outside.push(artifact.path);
      continue;
    }
    const full = resolve(projectRoot, artifact.path);
    const real = await realpathDeep(full);
    if (!isInside(realRoot, real)) {
      outside.push(artifact.path);
      continue;
    }
    if (!(await exists(full))) missing.push(artifact.path);
  }
  return { ok: missing.length === 0 && outside.length === 0, missing, outside };
}

export function normalizeHandoffPath(projectRelative) {
  return projectRelative.split(sep).join("/");
}

export function handoffPath(base, relative) {
  return join(base, relative);
}
