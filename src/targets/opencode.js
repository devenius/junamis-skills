import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Verified against https://opencode.ai/docs/skills and https://opencode.ai/docs/agents
export default {
  id: "opencode",
  label: "OpenCode",
  // External skills (skillsio -g --agent opencode) land here.
  globalSkillsDir() {
    return join(homedir(), ".agents", "skills");
  },
  // Internal (library) skills live apart from external skills so the two can be
  // managed and resolved independently.
  librarySkillsDir() {
    return join(homedir(), ".config", "junamis", "skills");
  },
  // Markdown agent definitions: ~/.config/opencode/agents/<name>.md
  libraryAgentsDir() {
    return join(homedir(), ".config", "opencode", "agents");
  },
  projectSkillsDir(projectDir) {
    return join(projectDir, ".agents", "skills");
  },
  projectLibrarySkillsDir(projectDir) {
    return join(projectDir, ".config", "junamis", "skills");
  },
  projectAgentsDir(projectDir) {
    return join(projectDir, ".opencode", "agents");
  },
  // OpenCode passes unknown frontmatter keys to the model provider, so only these are written.
  libraryAgentFormat: "opencode",
  detect() {
    return existsSync(join(homedir(), ".config", "opencode"));
  },
};
