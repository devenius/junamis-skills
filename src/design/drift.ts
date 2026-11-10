// Design drift detectors.
//
// Code drift compares files matched by code_paths against the surface's
// last_reviewed_commit, or against last_reviewed by mtime when git is
// unavailable. Dependency drift compares the dependent surface's current
// version with the version recorded in its change log at or before this
// surface's last_reviewed. Coverage reports overlapping claims and unclaimed
// source files; overlap is always reported, and the bootstrap flag gates the
// failure until a human or architect flips it.

import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { listDir, readJsonFile, statSafe, toPosixPath } from "../orchestrator/fsx.js";
import { ValidationError } from "./errors.js";
import { loadSurfaces } from "./schema.js";
import { isRecord } from "../types/guards.js";
import type {
  CodeDriftFlag,
  CoverageReport,
  DependencyDriftFlag,
  DesignSurface,
  DriftReport,
} from "../types/design.js";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".orchestrator",
  ".junamis",
  ".config",
  "docs",
  "test",
  "tests",
  "coverage",
  "dist",
  "build",
  "out",
]);

const CODE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".sh",
  ".bash",
]);

function escapeRegExp(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern: unknown): RegExp {
  const normalized = String(pattern).replace(/\\/g, "/").replace(/^\.\//, "");
  const source = normalized.endsWith("/") ? `${normalized}**` : normalized;
  let out = "^";
  for (let i = 0; i < source.length; i++) {
    const char = source[i] ?? "";
    if (char === "*") {
      if (source[i + 1] === "*") {
        i += 1;
        if (source[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    if (char === "[") {
      const end = source.indexOf("]", i + 1);
      if (end !== -1) {
        out += source.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    out += escapeRegExp(char);
  }
  out += "$";
  return new RegExp(out);
}

export function matchesAny(path: string, patterns: readonly string[] | null | undefined): boolean {
  return (patterns ?? []).some((pattern) => {
    try {
      return globToRegExp(pattern).test(path);
    } catch {
      return false;
    }
  });
}

async function walk(root: string, current: string, out: string[]): Promise<void> {
  const entries = await listDir(current);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      await walk(root, path, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(toPosixPath(relative(root, path)));
  }
}

export async function listProjectFiles(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  await walk(projectRoot, projectRoot, out);
  out.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return out;
}

function gitLines(projectRoot: string, args: readonly string[]): string[] | null {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitCommitTime(projectRoot: string, path: string): number | null {
  const lines = gitLines(projectRoot, ["log", "-1", "--format=%ct", "--", path]);
  if (!lines || lines.length === 0) return null;
  const value = Number.parseInt(lines[0] ?? "", 10);
  return Number.isFinite(value) ? value : null;
}

async function mtimeMs(path: string): Promise<number | null> {
  const stat = await statSafe(path);
  return stat ? stat.mtimeMs : null;
}

interface CodeChangeInput {
  readonly projectRoot: string;
  readonly matched: readonly string[];
  readonly git: boolean;
}

async function codeChangedFiles(surface: DesignSurface, { projectRoot, matched, git }: CodeChangeInput): Promise<string[]> {
  const frontmatter = surface.frontmatter;
  if (!frontmatter) return [];
  const commit = frontmatter.last_reviewed_commit;
  if (git && commit) {
    const changed = gitLines(projectRoot, ["diff", "--name-only", `${commit}..HEAD`, "--", ...matched]);
    if (changed !== null) {
      const matchedSet = new Set(matched);
      const files = changed.filter((path) => matchedSet.has(path));
      if (files.length === 0) return [];
      const designRelative = toPosixPath(relative(projectRoot, surface.file));
      const designTime = gitCommitTime(projectRoot, designRelative);
      let codeTime = 0;
      for (const path of files) {
        const time = gitCommitTime(projectRoot, path);
        if (time !== null && time > codeTime) codeTime = time;
      }
      // A design update at or after the code change is the delta that
      // accompanied it. Only code newer than the design is drift.
      if (designTime !== null && codeTime > 0 && designTime >= codeTime) return [];
      return files;
    }
  }

  const cutoff = new Date(`${frontmatter.last_reviewed ?? ""}T23:59:59Z`).getTime();
  const changed: string[] = [];
  for (const path of matched) {
    const mtime = await mtimeMs(join(projectRoot, path));
    if (mtime !== null && mtime > cutoff) changed.push(path);
  }
  if (changed.length === 0) return [];
  const designMtime = await mtimeMs(surface.file);
  let newest = 0;
  for (const path of changed) {
    const mtime = await mtimeMs(join(projectRoot, path));
    if (mtime !== null && mtime > newest) newest = mtime;
  }
  if (designMtime !== null && designMtime >= newest && newest > 0) return [];
  return changed;
}

export interface CodeDriftInput {
  readonly designRoot: string;
  readonly projectRoot: string;
  readonly git?: boolean;
}

export async function detectCodeDrift({ designRoot, projectRoot, git = true }: CodeDriftInput): Promise<CodeDriftFlag[]> {
  const loaded = await loadSurfaces(designRoot, { validate: true });
  if (loaded.errors.length > 0) {
    const lines = loaded.errors.flatMap((entry) => entry.errors.map((error) => `${entry.file}: ${error}`));
    throw new ValidationError("cannot detect drift on an invalid design registry", { errors: lines });
  }
  const projectFiles = await listProjectFiles(projectRoot);
  const flags: CodeDriftFlag[] = [];
  for (const surface of loaded.surfaces) {
    if (surface.frontmatter?.status !== "active") continue;
    const patterns = surface.frontmatter?.code_paths ?? [];
    const matched = projectFiles.filter((path) => matchesAny(path, patterns));
    if (matched.length === 0) continue;
    const files = await codeChangedFiles(surface, { projectRoot, matched, git });
    if (files.length === 0) continue;
    flags.push({
      type: "CODE_DRIFT",
      surface_id: surface.surface_id,
      files,
      last_reviewed: surface.frontmatter?.last_reviewed ?? "",
      last_reviewed_commit: surface.frontmatter?.last_reviewed_commit ?? null,
    });
  }
  return flags;
}

interface ChangeLogEntry {
  readonly date: string;
  readonly version: string;
}

function parseChangeLog(body: unknown): ChangeLogEntry[] {
  const entries: ChangeLogEntry[] = [];
  for (const line of String(body ?? "").split("\n")) {
    const match = /^-\s+(\d{4}-\d{2}-\d{2})\s+·\s+v(\d+\.\d+\.\d+)/.exec(line.trim());
    if (match) entries.push({ date: match[1] ?? "", version: match[2] ?? "" });
  }
  return entries;
}

function versionAt(entries: readonly ChangeLogEntry[], date: string | undefined): string | null {
  let found: string | null = null;
  for (const entry of entries) {
    if (entry.date <= (date ?? "")) found = entry.version;
  }
  return found;
}

export async function detectDependencyDrift({ designRoot }: { readonly designRoot: string }): Promise<DependencyDriftFlag[]> {
  const loaded = await loadSurfaces(designRoot, { validate: true });
  if (loaded.errors.length > 0) {
    const lines = loaded.errors.flatMap((entry) => entry.errors.map((error) => `${entry.file}: ${error}`));
    throw new ValidationError("cannot detect dependency drift on an invalid design registry", { errors: lines });
  }
  const byId = new Map(loaded.surfaces.map((surface) => [surface.surface_id, surface]));
  const flags: DependencyDriftFlag[] = [];
  for (const surface of loaded.surfaces) {
    const lastReviewed = surface.frontmatter?.last_reviewed;
    for (const depId of surface.frontmatter?.depends_on ?? []) {
      const dep = byId.get(depId);
      if (!dep) continue;
      const recorded = versionAt(parseChangeLog(dep.body), lastReviewed);
      if (recorded === null) continue;
      const current = dep.frontmatter?.version ?? null;
      if (recorded !== current) {
        flags.push({
          type: "DEPENDENCY_DRIFT",
          surface_id: surface.surface_id,
          depends_on: depId,
          recorded_version: recorded,
          current_version: current,
          at: lastReviewed ?? "",
        });
      }
    }
  }
  return flags;
}

export async function readBootstrapFlag(designRoot: string): Promise<boolean> {
  const parsed = await readJsonFile(join(designRoot, "_registry.json"));
  if (!parsed.exists || parsed.error || !isRecord(parsed.value)) {
    return false;
  }
  return parsed.value["bootstrap_complete"] === true;
}

export interface CoverageInput {
  readonly designRoot: string;
  readonly projectRoot: string;
}

export async function detectCoverage({ designRoot, projectRoot }: CoverageInput): Promise<CoverageReport> {
  const loaded = await loadSurfaces(designRoot, { validate: true });
  if (loaded.errors.length > 0) {
    const lines = loaded.errors.flatMap((entry) => entry.errors.map((error) => `${entry.file}: ${error}`));
    throw new ValidationError("cannot audit coverage on an invalid design registry", { errors: lines });
  }
  const projectFiles = await listProjectFiles(projectRoot);
  const codeFiles = projectFiles.filter((path) => CODE_EXTENSIONS.has(extnameLower(path)));
  const claims = new Map<string, string[]>();
  for (const surface of loaded.surfaces) {
    for (const path of codeFiles) {
      if (!matchesAny(path, surface.frontmatter?.code_paths ?? [])) continue;
      const existing = claims.get(path);
      if (existing) existing.push(surface.surface_id);
      else claims.set(path, [surface.surface_id]);
    }
  }
  const overlaps: { path: string; surfaces: string[] }[] = [];
  for (const [path, surfaces] of claims) {
    if (surfaces.length > 1) overlaps.push({ path, surfaces: [...surfaces].sort() });
  }
  const unclaimed = codeFiles.filter((path) => !claims.has(path));
  const bootstrapComplete = await readBootstrapFlag(designRoot);
  const enforced = bootstrapComplete === true;
  return {
    bootstrap_complete: bootstrapComplete,
    enforced,
    overlaps: overlaps.sort((a, b) => a.path.localeCompare(b.path)),
    unclaimed,
    claimed_files: claims.size,
    code_files: codeFiles.length,
  };
}

function extnameLower(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index).toLowerCase();
}

export interface RunDriftInput {
  readonly designRoot: string;
  readonly projectRoot: string;
  readonly git?: boolean;
}

export async function runDrift({ designRoot, projectRoot, git = true }: RunDriftInput): Promise<DriftReport> {
  const code = await detectCodeDrift({ designRoot, projectRoot, git });
  const dependency = await detectDependencyDrift({ designRoot });
  const coverage = await detectCoverage({ designRoot, projectRoot });
  const coverageFailing = coverage.enforced && (coverage.overlaps.length > 0 || coverage.unclaimed.length > 0);
  return {
    ok: code.length === 0 && dependency.length === 0 && !coverageFailing,
    code,
    dependency,
    coverage,
  };
}
