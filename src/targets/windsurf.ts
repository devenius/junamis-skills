import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalAgentsDir } from "../paths.js";
import type { TargetAdapter } from "../types/index.js";

const windsurf: TargetAdapter = {
  id: "windsurf",
  label: "Windsurf / Devin",
  globalSkillsDir() {
    return join(homedir(), ".codeium", "windsurf", "skills");
  },
  // This target has one skills directory: library and external skills share it.
  librarySkillsDir() {
    return join(homedir(), ".codeium", "windsurf", "skills");
  },
  libraryAgentsCanonicalDir() {
    return canonicalAgentsDir("global");
  },
  libraryAgentsDir() {
    return join(homedir(), ".config", "devin", "agents");
  },
  projectSkillsDir(projectDir: string) {
    return join(projectDir, ".windsurf", "skills");
  },
  projectLibrarySkillsDir(projectDir: string) {
    return join(projectDir, ".windsurf", "skills");
  },
  projectLibraryAgentsCanonicalDir(projectDir: string) {
    return canonicalAgentsDir("project", projectDir);
  },
  projectAgentsDir(projectDir: string) {
    return join(projectDir, ".devin", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".codeium", "windsurf"))
      || existsSync(join(homedir(), ".config", "devin"))
      || existsSync(join(homedir(), ".windsurf"));
  },
};

export default windsurf;
