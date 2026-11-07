import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default {
  id: "windsurf",
  label: "Windsurf / Devin",
  globalSkillsDir() {
    return join(homedir(), ".codeium", "windsurf", "skills");
  },
  // This target has one skills directory: library and external skills share it.
  librarySkillsDir() {
    return join(homedir(), ".codeium", "windsurf", "skills");
  },
  libraryAgentsDir() {
    return join(homedir(), ".config", "devin", "agents");
  },
  projectSkillsDir(projectDir) {
    return join(projectDir, ".windsurf", "skills");
  },
  projectLibrarySkillsDir(projectDir) {
    return join(projectDir, ".windsurf", "skills");
  },
  projectAgentsDir(projectDir) {
    return join(projectDir, ".devin", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".codeium", "windsurf"))
      || existsSync(join(homedir(), ".config", "devin"))
      || existsSync(join(homedir(), ".windsurf"));
  },
};
