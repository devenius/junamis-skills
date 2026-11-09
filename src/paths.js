import { homedir } from "node:os";
import { join } from "node:path";

// Single source of truth for where this package writes.
//
// The npm package is @devenius/junamis-skills, so its segment under
// ~/.config/junamis is "skills". The resulting tree is:
//
//   <configRoot>/skills/<name>/SKILL.md        internal (library) skills
//   <configRoot>/agents/<name>.md              canonical agent definitions
//   <configRoot>/{HANDOFF,SAFETY,EXTERNAL,SECURITY}.md
//   <configRoot>/installed/library-<agent>.json
//
// Target-specific agents directories are link destinations only; the canonical
// file always lives in <configRoot>/agents.

export const PROJECT_SEGMENT = "skills";

export function configRoot(scope = "global", projectDir = process.cwd()) {
  if (scope === "project") {
    return join(projectDir, ".config", "junamis", PROJECT_SEGMENT);
  }
  return join(homedir(), ".config", "junamis", PROJECT_SEGMENT);
}

// The legacy root, before the nested layout. Used only to report leftovers;
// nothing is ever written or deleted there by this package.
export function legacyConfigParent(scope = "global", projectDir = process.cwd()) {
  if (scope === "project") {
    return join(projectDir, ".config", "junamis");
  }
  return join(homedir(), ".config", "junamis");
}

export function internalSkillsDir(scope = "global", projectDir = process.cwd()) {
  return join(configRoot(scope, projectDir), "skills");
}

export function canonicalAgentsDir(scope = "global", projectDir = process.cwd()) {
  return join(configRoot(scope, projectDir), "agents");
}

export function sharedDocsDir(scope = "global", projectDir = process.cwd()) {
  return configRoot(scope, projectDir);
}

export function manifestPath(agentId, scope = "global", projectDir = process.cwd()) {
  return join(configRoot(scope, projectDir), "installed", `library-${agentId}.json`);
}
