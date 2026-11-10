// Detector manifest for RECONCILE.
//
// The manifest lives at $ORCH_STATE_ROOT/reconcile/detectors.yaml. A missing
// file is created with the pass A defaults: the three MVP detectors enabled
// and every extended detector disabled.

import { join } from "node:path";
import { readText, writeIfMissing } from "../orchestrator/fsx.js";
import { parseYaml } from "../design/yaml.js";

export const RECONCILE_DIR = "reconcile";
export const DETECTOR_MANIFEST = "detectors.yaml";

export const SUPPORTED_DETECTORS = Object.freeze(["plan_pending", "code_drift", "failed_step"]);
export const EXTENDED_DETECTORS = Object.freeze([
  "coverage_gap",
  "dependency_drift",
  "needs_review",
  "stale_surface",
  "shadow_conflict",
]);

const DEFAULT_MANIFEST = `schema_version: 1
detectors:
  - id: plan_pending
    enabled: true
    order: 10
  - id: code_drift
    enabled: true
    order: 20
    params:
      use_git: true
      fallback_mtime: true
  - id: failed_step
    enabled: true
    order: 30
  - id: coverage_gap
    enabled: false
    order: 40
  - id: dependency_drift
    enabled: false
    order: 50
  - id: needs_review
    enabled: false
    order: 60
  - id: stale_surface
    enabled: false
    order: 70
  - id: shadow_conflict
    enabled: false
    order: 5
`;

export function detectorManifestPath(stateRoot) {
  return join(stateRoot, RECONCILE_DIR, DETECTOR_MANIFEST);
}

function normalizeDetector(raw, index) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`detectors[${index}] must be a mapping`);
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new Error(`detectors[${index}].id must be a non-empty string`);
  }
  const order = Number.parseInt(raw.order ?? "0", 10);
  const params = raw.params && typeof raw.params === "object" && !Array.isArray(raw.params) ? raw.params : {};
  return {
    id: raw.id,
    enabled: raw.enabled === true,
    order: Number.isFinite(order) ? order : 0,
    params,
    supported: SUPPORTED_DETECTORS.includes(raw.id),
  };
}

export async function loadDetectorManifest(stateRoot, { create = true } = {}) {
  const path = detectorManifestPath(stateRoot);
  const created = create ? await writeIfMissing(path, DEFAULT_MANIFEST) : false;
  const text = await readText(path);
  if (text === null) throw new Error(`detector manifest not found: ${path}`);
  let parsed;
  try {
    parsed = parseYaml(text, { label: "detectors.yaml" });
  } catch (error) {
    throw new Error(`invalid detector manifest ${path}: ${error.message}`, { cause: error });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid detector manifest ${path}: expected a mapping`);
  }
  if (parsed.schema_version !== 1 && parsed.schema_version !== "1") {
    throw new Error(`invalid detector manifest ${path}: schema_version must be 1`);
  }
  if (!Array.isArray(parsed.detectors)) {
    throw new Error(`invalid detector manifest ${path}: detectors must be a list`);
  }
  const detectors = parsed.detectors.map(normalizeDetector);
  detectors.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { path, created, detectors };
}
