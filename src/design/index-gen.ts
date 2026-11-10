// Generate the derived design registry index.
//
// The output is byte-stable for the same input. The Generated timestamp comes
// from the newest last_reviewed date at T00:00:00Z, or from an explicit
// --generated-at value, never from the wall clock on its own.

import { join } from "node:path";
import { atomicWriteText } from "./atomic.js";
import { ValidationError } from "./errors.js";
import { loadSurfaces, parseSections, STATUS_ORDER } from "./schema.js";
import type { DesignSurface, IndexResult } from "../types/design.js";

const EMPTY_DATE = "1970-01-01T00:00:00Z";

function byteSort(values: readonly string[]): string[] {
  return [...values].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function countGaps(body: unknown): number {
  let parsed;
  try {
    parsed = parseSections(body);
  } catch {
    return 0;
  }
  const lines = parsed.sections.get("Known gaps") ?? [];
  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && line !== "- None").length;
}

export function deriveGeneratedAt(surfaces: readonly DesignSurface[], override: string | null = null): string {
  if (override) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(override)) {
      throw new ValidationError("--generated-at must be an ISO timestamp like 2026-11-09T00:00:00Z");
    }
    return override;
  }
  let newest: string | null = null;
  for (const surface of surfaces) {
    const date = surface.frontmatter?.last_reviewed;
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (newest === null || date > newest) newest = date;
    }
  }
  return newest ? `${newest}T00:00:00Z` : EMPTY_DATE;
}

export interface GenerateIndexInput {
  readonly designRoot: string;
  readonly generatedAt?: string | null;
}

export async function generateIndex({ designRoot, generatedAt = null }: GenerateIndexInput): Promise<IndexResult> {
  const loaded = await loadSurfaces(designRoot, { validate: true });
  if (loaded.errors.length > 0) {
    const lines = loaded.errors.flatMap((entry) => entry.errors.map((error) => `${entry.file}: ${error}`));
    throw new ValidationError("cannot generate INDEX.md from an invalid design registry", { errors: lines });
  }
  const surfaces = [...loaded.surfaces].sort((a, b) => {
    return Buffer.compare(Buffer.from(a.surface_id, "utf8"), Buffer.from(b.surface_id, "utf8"));
  });
  const counts: Record<string, number> = {};
  for (const status of STATUS_ORDER) counts[status] = 0;
  for (const surface of surfaces) {
    const status = surface.frontmatter?.status;
    if (typeof status === "string" && Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
  }
  const stamp = deriveGeneratedAt(surfaces, generatedAt);
  const summary = STATUS_ORDER.map((status) => `${status} ${counts[status] ?? 0}`).join(" · ");
  const lines = [
    "# Design Registry Index",
    "",
    `Generated: ${stamp}`,
    `Surfaces: ${surfaces.length} · ${summary}`,
    "",
    "| surface_id | kind | app | status | version | last_reviewed | gaps |",
    "|-----------|------|-----|--------|---------|---------------|------|",
  ];
  for (const surface of surfaces) {
    const frontmatter = surface.frontmatter ?? {};
    lines.push(
      `| ${cell(surface.surface_id)} | ${cell(frontmatter.kind)} | ${cell(frontmatter.app ?? "")} | ${cell(frontmatter.status)} | ${cell(frontmatter.version)} | ${cell(frontmatter.last_reviewed)} | ${countGaps(surface.body)} |`,
    );
  }
  lines.push("");
  return { content: lines.join("\n"), generatedAt: stamp, surfaceCount: surfaces.length, statusCounts: counts, surfaces };
}

export function indexFilePath(designRoot: string): string {
  return join(designRoot, "INDEX.md");
}

export interface WrittenIndex extends IndexResult {
  readonly path: string;
}

export async function writeIndex({ designRoot, generatedAt = null }: GenerateIndexInput): Promise<WrittenIndex> {
  const result = await generateIndex({ designRoot, generatedAt });
  const path = indexFilePath(designRoot);
  await atomicWriteText(path, result.content);
  return { ...result, path };
}

export { byteSort };
