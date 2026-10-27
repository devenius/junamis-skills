import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default {
  id: "opencode",
  label: "OpenCode",
  // skillsio -g with --agent opencode installs here (the universal Agent Skills
  // location, which OpenCode reads). ~/.config/opencode/skills also exists but is
  // not where this installer writes.
  globalSkillsDir() {
    return join(homedir(), ".agents", "skills");
  },
  detect() {
    return existsSync(join(homedir(), ".config", "opencode"));
  },
};
