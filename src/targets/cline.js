import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default {
  id: "cline",
  label: "Cline",
  globalSkillsDir() {
    return join(homedir(), ".cline", "skills");
  },
  libraryAgentsDir() {
    return join(homedir(), ".cline", "agents");
  },
  projectSkillsDir(projectDir) {
    return join(projectDir, ".cline", "skills");
  },
  projectAgentsDir(projectDir) {
    return join(projectDir, ".cline", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".cline"));
  },
};