import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default {
  id: "claude",
  label: "Claude Code",
  globalSkillsDir() {
    return join(homedir(), ".claude", "skills");
  },
  detect() {
    return existsSync(join(homedir(), ".claude"));
  },
};
