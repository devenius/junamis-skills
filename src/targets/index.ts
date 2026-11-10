import claude from "./claude.js";
import cline from "./cline.js";
import cursor from "./cursor.js";
import opencode from "./opencode.js";
import windsurf from "./windsurf.js";
import type { TargetAdapter } from "../types/index.js";

// Registered targets. Add a new agent by creating its file and listing it here.
export const targets: readonly TargetAdapter[] = [opencode, claude, cursor, windsurf, cline];

export function getTarget(id: string): TargetAdapter | null {
  return targets.find((t) => t.id === id) ?? null;
}
