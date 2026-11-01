import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Verified against https://code.claude.com/docs/en/sub-agents
export default {
  id: "claude",
  label: "Claude Code",
  globalSkillsDir() {
    return join(homedir(), ".claude", "skills");
  },
  // Subagent definitions: ~/.claude/agents/<name>.md (name and description are required)
  libraryAgentsDir() {
    return join(homedir(), ".claude", "agents");
  },
  projectSkillsDir(projectDir) {
    return join(projectDir, ".claude", "skills");
  },
  projectAgentsDir(projectDir) {
    return join(projectDir, ".claude", "agents");
  },
  libraryAgentFormat: "claude",
  detect() {
    return existsSync(join(homedir(), ".claude"));
  },
};
