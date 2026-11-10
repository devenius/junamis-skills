import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalAgentsDir } from "../paths.js";
import type { TargetAdapter } from "../types/index.js";

const cline: TargetAdapter = {
  id: "cline",
  label: "Cline",
  globalSkillsDir() {
    return join(homedir(), ".cline", "skills");
  },
  // This target has one skills directory: library and external skills share it.
  librarySkillsDir() {
    return join(homedir(), ".cline", "skills");
  },
  libraryAgentsCanonicalDir() {
    return canonicalAgentsDir("global");
  },
  libraryAgentsDir() {
    return join(homedir(), ".cline", "agents");
  },
  projectSkillsDir(projectDir: string) {
    return join(projectDir, ".cline", "skills");
  },
  projectLibrarySkillsDir(projectDir: string) {
    return join(projectDir, ".cline", "skills");
  },
  projectLibraryAgentsCanonicalDir(projectDir: string) {
    return canonicalAgentsDir("project", projectDir);
  },
  projectAgentsDir(projectDir: string) {
    return join(projectDir, ".cline", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".cline"));
  },
};

export default cline;
