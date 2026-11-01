import claude from "./claude.js";
import cline from "./cline.js";
import cursor from "./cursor.js";
import opencode from "./opencode.js";
import windsurf from "./windsurf.js";

// Registered targets. Add a new agent by creating its file and listing it here.
export const targets = [opencode, claude, cursor, windsurf, cline];

export function getTarget(id) {
  return targets.find((t) => t.id === id) ?? null;
}
