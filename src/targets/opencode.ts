import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalAgentsDir, internalSkillsDir } from "../paths.js";
import type { TargetAdapter } from "../types/index.js";

// Verified against https://opencode.ai/docs/skills and https://opencode.ai/docs/agents
const opencode: TargetAdapter = {
  id: "opencode",
  label: "OpenCode",
  // External skills (skillsio -g --agent opencode) land here.
  globalSkillsDir() {
    return join(homedir(), ".agents", "skills");
  },
  // Internal (library) skills live apart from external skills so the two can be
  // managed and resolved independently. They are nested under the config root:
  // ~/.config/junamis/skills/skills/<name>/SKILL.md
  librarySkillsDir() {
    return internalSkillsDir("global");
  },
  // Canonical agent definitions, shared by every target and linked into each
  // target's agents directory.
  libraryAgentsCanonicalDir() {
    return canonicalAgentsDir("global");
  },
  // Markdown agent definitions: ~/.config/opencode/agents/<name>.md (symlinks
  // to the canonical files in libraryAgentsCanonicalDir()).
  libraryAgentsDir() {
    return join(homedir(), ".config", "opencode", "agents");
  },
  projectSkillsDir(projectDir: string) {
    return join(projectDir, ".agents", "skills");
  },
  projectLibrarySkillsDir(projectDir: string) {
    return internalSkillsDir("project", projectDir);
  },
  projectLibraryAgentsCanonicalDir(projectDir: string) {
    return canonicalAgentsDir("project", projectDir);
  },
  projectAgentsDir(projectDir: string) {
    return join(projectDir, ".opencode", "agents");
  },
  // OpenCode passes unknown frontmatter keys to the model provider, so only these are written.
  libraryAgentFormat: "opencode",
  detect() {
    return existsSync(join(homedir(), ".config", "opencode"));
  },
};

export default opencode;
