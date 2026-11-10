// Design registry fingerprint for RESUME.md B4.
//
// index_sha256 binds the actual INDEX.md bytes and every surface file, so a
// body edit is drift even when the derived table would not change. The field
// name stays index_sha256 per the contract; the hash covers the indexed set.

import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { readBuffer, statSafe, toPosixPath } from "../orchestrator/fsx.js";
import { sha256Hex } from "../orchestrator/hash.js";
import { listSurfaceFiles, STATUS_ORDER } from "./schema.js";
import { parseFrontmatterDocument } from "./yaml.js";
import type { DesignFingerprint, DesignStatus } from "../types/design.js";

function emptyStatusCounts(): Record<DesignStatus, number> {
  const counts: Record<DesignStatus, number> = { active: 0, draft: 0, deprecated: 0, needs_review: 0 };
  for (const status of STATUS_ORDER) counts[status] = 0;
  return counts;
}

function isDesignStatus(value: unknown): value is DesignStatus {
  return typeof value === "string" && (STATUS_ORDER as readonly string[]).includes(value);
}

export interface DesignFingerprintResult {
  readonly registry: DesignFingerprint | null;
  readonly files: Record<string, string> | null;
  readonly designRoot: string | null;
}

export async function computeDesignFingerprint({
  designRoot = null,
}: { readonly designRoot?: string | null } = {}): Promise<DesignFingerprintResult> {
  if (!designRoot) return { registry: null, files: null, designRoot: null };
  const stat = await statSafe(designRoot);
  if (!stat || !stat.isDirectory()) return { registry: null, files: null, designRoot };

  const files = await listSurfaceFiles(designRoot);
  const fileMap: Record<string, string> = {};
  const statusCounts = emptyStatusCounts();
  const hash = createHash("sha256");

  const indexBytes = await readBuffer(join(designRoot, "INDEX.md"));
  hash.update("index\0");
  hash.update(indexBytes ?? Buffer.from("missing", "utf8"));
  hash.update("\0");

  for (const file of files) {
    const relativePath = toPosixPath(relative(designRoot, file));
    const bytes = await readBuffer(file);
    if (bytes === null) continue;
    fileMap[relativePath] = `sha256:${sha256Hex(bytes)}`;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
    try {
      const parsed = parseFrontmatterDocument(bytes.toString("utf8"), { label: relativePath });
      const status = parsed.data["status"];
      if (isDesignStatus(status)) statusCounts[status] += 1;
    } catch {
      // An unparsable surface still changes the file hash. Boot reports the
      // drift; it does not guess the status.
    }
  }

  return {
    registry: {
      index_sha256: `sha256:${hash.digest("hex")}`,
      surface_count: files.length,
      status_counts: statusCounts,
    },
    files: fileMap,
    designRoot,
  };
}
