import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default {
  id: "windsurf",
  label: "Windsurf",
  globalSkillsDir() {
    return join(homedir(), ".windsurf", "skills");
  },
  libraryAgentsDir() {
    return join(homedir(), ".windsurf", "agents");
  },
  projectSkillsDir(projectDir) {
    return join(projectDir, ".windsurf", "skills");
  },
  projectAgentsDir(projectDir) {
    return join(projectDir, ".windsurf", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".windsurf")) || existsSync(join(homedir(), ".codeium", "windsurf"));
  },
};