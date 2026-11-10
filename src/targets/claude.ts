import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalAgentsDir } from "../paths.js";
import type { TargetAdapter } from "../types/index.js";

// Verified against https://code.claude.com/docs/en/sub-agents
const claude: TargetAdapter = {
  id: "claude",
  label: "Claude Code",
  globalSkillsDir() {
    return join(homedir(), ".claude", "skills");
  },
  // This target has one skills directory: library and external skills share it.
  librarySkillsDir() {
    return join(homedir(), ".claude", "skills");
  },
  // Canonical agent definitions live under the shared config root.
  libraryAgentsCanonicalDir() {
    return canonicalAgentsDir("global");
  },
  // Subagent definitions: ~/.claude/agents/<name>.md (name and description are required)
  libraryAgentsDir() {
    return join(homedir(), ".claude", "agents");
  },
  projectSkillsDir(projectDir: string) {
    return join(projectDir, ".claude", "skills");
  },
  projectLibrarySkillsDir(projectDir: string) {
    return join(projectDir, ".claude", "skills");
  },
  projectLibraryAgentsCanonicalDir(projectDir: string) {
    return canonicalAgentsDir("project", projectDir);
  },
  projectAgentsDir(projectDir: string) {
    return join(projectDir, ".claude", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".claude"));
  },
};

export default claude;
