// Detector manifest for RECONCILE.
//
// The manifest lives at $ORCH_STATE_ROOT/reconcile/detectors.yaml. A missing
// file is created with the pass A defaults: the three MVP detectors enabled
// and every extended detector disabled.

import { join } from "node:path";
import { readText, writeIfMissing } from "../orchestrator/fsx.js";
import { parseYaml } from "../design/yaml.js";
import { errorMessage, isRecord } from "../types/guards.js";
import type { DetectorEntry, DetectorManifest } from "../types/reconcile.js";

export const RECONCILE_DIR = "reconcile";
export const DETECTOR_MANIFEST = "detectors.yaml";

export const SUPPORTED_DETECTORS: readonly string[] = Object.freeze([
  "plan_pending",
  "code_drift",
  "failed_step",
  "coverage_gap",
  "dependency_drift",
  "needs_review",
  "stale_surface",
  "shadow_conflict",
]);
export const EXTENDED_DETECTORS: readonly string[] = Object.freeze([
  "coverage_gap",
  "dependency_drift",
  "needs_review",
  "stale_surface",
  "shadow_conflict",
]);

const DEFAULT_MANIFEST = `schema_version: 1
tick_every: 10
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
    params:
      max_age_days: 30
  - id: shadow_conflict
    enabled: false
    order: 5
`;

export function detectorManifestPath(stateRoot: string): string {
  return join(stateRoot, RECONCILE_DIR, DETECTOR_MANIFEST);
}

function normalizeDetector(raw: unknown, index: number): DetectorEntry {
  if (!isRecord(raw)) {
    throw new Error(`detectors[${index}] must be a mapping`);
  }
  const id = raw["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`detectors[${index}].id must be a non-empty string`);
  }
  const orderValue = raw["order"] ?? "0";
  const order = Number.parseInt(String(orderValue), 10);
  const rawParams = raw["params"];
  const params = isRecord(rawParams) ? rawParams : {};
  return {
    id,
    enabled: raw["enabled"] === true,
    order: Number.isFinite(order) ? order : 0,
    params,
    supported: SUPPORTED_DETECTORS.includes(id),
  };
}

export interface LoadManifestOptions {
  readonly create?: boolean;
}

export async function loadDetectorManifest(
  stateRoot: string,
  { create = true }: LoadManifestOptions = {},
): Promise<DetectorManifest> {
  const path = detectorManifestPath(stateRoot);
  const created = create ? await writeIfMissing(path, DEFAULT_MANIFEST) : false;
  const text = await readText(path);
  if (text === null) throw new Error(`detector manifest not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = parseYaml(text, { label: "detectors.yaml" });
  } catch (error) {
    throw new Error(`invalid detector manifest ${path}: ${errorMessage(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`invalid detector manifest ${path}: expected a mapping`);
  }
  if (parsed["schema_version"] !== 1 && parsed["schema_version"] !== "1") {
    throw new Error(`invalid detector manifest ${path}: schema_version must be 1`);
  }
  const rawDetectors = parsed["detectors"];
  if (!Array.isArray(rawDetectors)) {
    throw new Error(`invalid detector manifest ${path}: detectors must be a list`);
  }
  const detectors = (rawDetectors as unknown[]).map(normalizeDetector);
  detectors.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const tickEvery = Number.parseInt(String(parsed["tick_every"] ?? "10"), 10);
  return {
    path,
    created,
    detectors,
    tickEvery: Number.isInteger(tickEvery) && tickEvery > 0 ? tickEvery : 10,
  };
}
