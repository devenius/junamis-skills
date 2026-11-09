import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalAgentsDir } from "../paths.js";

// Best-effort paths; verify against the agent's current documentation before relying on them.
export default {
  id: "cursor",
  label: "Cursor",
  globalSkillsDir() {
    return join(homedir(), ".cursor", "skills");
  },
  // This target has one skills directory: library and external skills share it.
  librarySkillsDir() {
    return join(homedir(), ".cursor", "skills");
  },
  libraryAgentsCanonicalDir() {
    return canonicalAgentsDir("global");
  },
  libraryAgentsDir() {
    return join(homedir(), ".cursor", "agents");
  },
  projectSkillsDir(projectDir) {
    return join(projectDir, ".cursor", "skills");
  },
  projectLibrarySkillsDir(projectDir) {
    return join(projectDir, ".cursor", "skills");
  },
  projectLibraryAgentsCanonicalDir(projectDir) {
    return canonicalAgentsDir("project", projectDir);
  },
  projectAgentsDir(projectDir) {
    return join(projectDir, ".cursor", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".cursor"));
  },
};
