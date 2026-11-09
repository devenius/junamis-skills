// SHA 256 helpers, canonical JSON, and every checksum the engine records.
//
// Canonical JSON sorts object keys and emits no whitespace, so the same logical
// value hashes to the same digest regardless of how a caller serialized it.

import { createHash } from "node:crypto";

const TASK_IDENTITY_FIELDS = [
  "capability",
  "depends_on",
  "resolved_skill",
  "resolution_source",
  "owner",
  "adapter",
  "idempotent",
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256(data) {
  return `sha256:${sha256Hex(data)}`;
}

export function eventHash(event) {
  const body = { ...event };
  delete body.hash;
  return sha256(canonicalJson(body));
}

export function checkpointChecksum(checkpoint) {
  const body = { ...checkpoint };
  delete body.checksum;
  return sha256(canonicalJson(body));
}

export function planChecksum(tasks) {
  return sha256(canonicalJson(tasks));
}

export function inputsHash(task) {
  const body = {};
  for (const key of TASK_IDENTITY_FIELDS) {
    body[key] = key === "adapter" ? (task[key] ?? null) : task[key];
  }
  if (body.depends_on === undefined) body.depends_on = [];
  return sha256(canonicalJson(body));
}

export function fileHash(buffer) {
  return sha256(buffer);
}
