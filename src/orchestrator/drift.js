// Environment fingerprints and drift comparison.
//
// Only the two hashes are gates. The file map and paths are informational, and
// they are what let the report name the exact changed file.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { listDir, readBuffer, statSafe } from "./fsx.js";
import { sha256Hex } from "./hash.js";
import { HANDOFF_SCHEMA_VERSION } from "./state.js";

function sortByteOrder(paths) {
  return [...paths].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

async function libraryFiles(libraryRoot) {
  if (!libraryRoot) return null;
  const stat = await statSafe(libraryRoot);
  if (!stat || !stat.isDirectory()) return null;

  const files = [];
  const skillEntries = await listDir(join(libraryRoot, "skills"));
  for (const entry of skillEntries) {
    if (!entry.isDirectory()) continue;
    const path = join(libraryRoot, "skills", entry.name, "SKILL.md");
    const fileStat = await statSafe(path);
    if (fileStat?.isFile()) files.push({ relative: `skills/${entry.name}/SKILL.md`, absolute: path });
  }
  const agentEntries = await listDir(join(libraryRoot, "agents"));
  for (const entry of agentEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(libraryRoot, "agents", entry.name);
    files.push({ relative: `agents/${entry.name}`, absolute: path });
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a.relative, "utf8"), Buffer.from(b.relative, "utf8")));
  return files;
}

async function libraryDigest(libraryRoot) {
  const files = await libraryFiles(libraryRoot);
  if (files === null) return { hash: null, files: null };
  const hash = createHash("sha256");
  const map = {};
  for (const file of sortByteOrder(files.map((f) => f.relative))) {
    const entry = files.find((f) => f.relative === file);
    const bytes = await readBuffer(entry.absolute);
    if (bytes === null) continue;
    map[file] = `sha256:${sha256Hex(bytes)}`;
    hash.update(Buffer.from(file, "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(bytes);
    hash.update(Buffer.from([0]));
  }
  return { hash: `sha256:${hash.digest("hex")}`, files: map };
}

export async function computeFingerprint({ libraryRoot = null, manifestPath = null, version = "0.0.0" }) {
  const manifestBytes = manifestPath ? await readBuffer(manifestPath) : null;
  const library = await libraryDigest(libraryRoot);
  return {
    skills_lock_sha256: manifestBytes === null ? null : `sha256:${sha256Hex(manifestBytes)}`,
    library_overrides_sha256: library.hash,
    library_overrides_files: library.files,
    orchestrator_version: version,
    handoff_schema_version: HANDOFF_SCHEMA_VERSION,
    library_root: libraryRoot ?? null,
    manifest_path: manifestBytes === null ? null : manifestPath,
  };
}

function driftPaths(recordedFiles, currentFiles) {
  if (!recordedFiles && !currentFiles) return [];
  const oldMap = recordedFiles ?? {};
  const newMap = currentFiles ?? {};
  const paths = [];
  for (const path of sortByteOrder([...new Set([...Object.keys(oldMap), ...Object.keys(newMap)])])) {
    const oldHash = oldMap[path] ?? null;
    const newHash = newMap[path] ?? null;
    if (oldHash === newHash) continue;
    paths.push({
      path,
      old: oldHash,
      new: newHash,
      change: oldHash === null ? "added" : newHash === null ? "removed" : "changed",
    });
  }
  return paths;
}

export function compareFingerprints(recorded, current) {
  if (!recorded) {
    return {
      match: true,
      recorded_missing: true,
      manifest: { old: null, new: current.skills_lock_sha256, changed: false },
      overrides: { old: null, new: current.library_overrides_sha256, changed: false, paths: [] },
      versionChanged: false,
      current,
    };
  }
  const manifestChanged = (recorded.skills_lock_sha256 ?? null) !== (current.skills_lock_sha256 ?? null);
  const overridesChanged = (recorded.library_overrides_sha256 ?? null) !== (current.library_overrides_sha256 ?? null);
  const paths = driftPaths(recorded.library_overrides_files, current.library_overrides_files);
  const overrides = {
    old: recorded.library_overrides_sha256 ?? null,
    new: current.library_overrides_sha256 ?? null,
    changed: overridesChanged,
    paths,
  };
  // If the aggregate differs but the per-file map was not recorded, still name
  // the aggregate so the report is actionable.
  if (overridesChanged && paths.length === 0 && !recorded.library_overrides_files) {
    overrides.paths = [{ path: "(library overrides)", old: overrides.old, new: overrides.new, change: "changed" }];
  }
  return {
    match: !manifestChanged && !overridesChanged,
    recorded_missing: false,
    manifest: {
      old: recorded.skills_lock_sha256 ?? null,
      new: current.skills_lock_sha256 ?? null,
      changed: manifestChanged,
      path: current.manifest_path ?? recorded.manifest_path ?? null,
    },
    overrides,
    versionChanged: (recorded.orchestrator_version ?? null) !== (current.orchestrator_version ?? null),
    recorded_version: recorded.orchestrator_version ?? null,
    current_version: current.orchestrator_version ?? null,
    current,
  };
}

export function driftSummary(diff) {
  if (!diff) return { detected: false };
  return {
    detected: !diff.match,
    manifest: diff.manifest,
    overrides: diff.overrides,
    versionChanged: diff.versionChanged,
  };
}
