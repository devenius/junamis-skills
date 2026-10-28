import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Verified against https://opencode.ai/docs/skills and https://opencode.ai/docs/agents
export default {
  id: "opencode",
  label: "OpenCode",
  // External skills (skillsio -g --agent opencode) and library skills both land here.
  globalSkillsDir() {
    return join(homedir(), ".agents", "skills");
  },
  // Markdown agent definitions: ~/.config/opencode/agents/<name>.md
  libraryAgentsDir() {
    return join(homedir(), ".config", "opencode", "agents");
  },
  // OpenCode passes unknown frontmatter keys to the model provider, so only these are written.
  libraryAgentFormat: "opencode",
  detect() {
    return existsSync(join(homedir(), ".config", "opencode"));
  },
};
