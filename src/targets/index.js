import claude from "./claude.js";
import opencode from "./opencode.js";

// Registered targets. Add a new agent by creating its file and listing it here.
export const targets = [opencode, claude];

export function getTarget(id) {
  return targets.find((t) => t.id === id) ?? null;
}
