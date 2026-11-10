// SHA 256 helpers, canonical JSON, and every checksum the engine records.
//
// Canonical JSON sorts object keys and emits no whitespace, so the same logical
// value hashes to the same digest regardless of how a caller serialized it.

import { createHash } from "node:crypto";
import { isRecord } from "../types/guards.js";

const TASK_IDENTITY_FIELDS = [
  "capability",
  "depends_on",
  "resolved_skill",
  "resolution_source",
  "owner",
  "adapter",
  "idempotent",
] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256(data: string | Buffer): string {
  return `sha256:${sha256Hex(data)}`;
}

export function eventHash(event: Record<string, unknown>): string {
  const { hash: _hash, ...body } = event;
  return sha256(canonicalJson(body));
}

export function checkpointChecksum(checkpoint: Record<string, unknown>): string {
  const { checksum: _checksum, ...body } = checkpoint;
  return sha256(canonicalJson(body));
}

export function planChecksum(tasks: unknown): string {
  return sha256(canonicalJson(tasks));
}

/** The identity fields a task's inputs hash covers, in a fixed order. */
export function inputsHash(task: unknown): string {
  const source = isRecord(task) ? task : {};
  const body: Record<string, unknown> = {};
  for (const key of TASK_IDENTITY_FIELDS) {
    body[key] = key === "adapter" ? (source[key] ?? null) : source[key];
  }
  if (body["depends_on"] === undefined) body["depends_on"] = [];
  return sha256(canonicalJson(body));
}

export function fileHash(buffer: Buffer | string): string {
  return sha256(buffer);
}
