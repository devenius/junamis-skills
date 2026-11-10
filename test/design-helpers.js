// Shared fixtures for the design registry contract tests.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDesignFile } from "../src/design/delta.js";
import { computeDesignChecksum, KIND_SECTIONS } from "../src/design/schema.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DESIGN_CLI = join(ROOT, "scripts", "design-registry.mjs");
export const REPO_DESIGN = join(ROOT, "docs", "design");

export function makeDesignFixture() {
  const base = mkdtempSync(join(tmpdir(), "design-contract-"));
  const project = join(base, "project");
  const designRoot = join(project, "docs", "design");
  const stateRoot = join(base, "state");
  mkdirSync(designRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  return { base, project, designRoot, stateRoot };
}

export function bodyFor(kind, { intent = "Why this exists.", current = "What is here now.", gaps = ["- None"], changeLog = ["- 2026-11-10 · v0.1.0 · Created · bootstrap · library/document"] } = {}) {
  const sections = [
    ["Intent", intent],
    ["Current state", current],
    ["Known gaps", gaps.join("\n")],
  ];
  for (const title of KIND_SECTIONS[kind] ?? []) {
    sections.push([title, `Draft content for ${title}.`]);
  }
  sections.push(["Change log", changeLog.join("\n")]);
  return sections.map(([title, content]) => `## ${title}\n\n${content}`);
}

export function writeSurface({
  designRoot,
  surfaceId,
  kind = surfaceId.split("/")[0],
  app = null,
  status = "draft",
  version = "0.1.0",
  codePaths = [],
  dependsOn = [],
  relatedTasks = [],
  lastReviewed = "2026-11-10",
  lastReviewedCommit = null,
  body = null,
  now = "2026-11-10",
} = {}) {
  const content = body ?? bodyFor(kind);
  const bodyText = Array.isArray(content) ? content.join("\n\n") : content;
  const frontmatter = {
    surface_id: surfaceId,
    ...(app ? { app } : {}),
    kind,
    status,
    version,
    owner: "library/document",
    code_paths: codePaths,
    depends_on: dependsOn,
    related_tasks: relatedTasks,
    last_reviewed: lastReviewed,
    design_checksum: computeDesignChecksum(bodyText, kind),
    ...(lastReviewedCommit ? { last_reviewed_commit: lastReviewedCommit } : {}),
  };
  const file = join(designRoot, `${surfaceId}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderDesignFile(frontmatter, bodyText));
  return { file, frontmatter, body: bodyText, now };
}

export function writeDelta(project, name, content) {
  const file = join(project, name);
  writeFileSync(file, content);
  return file;
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readTextFile(path) {
  return readFileSync(path, "utf8");
}

export function git(project, args, { date = null } = {}) {
  const env = { ...process.env };
  if (date) {
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  const result = spawnSync(
    "git",
    ["-c", "user.email=design-test@example.com", "-c", "user.name=Design Test", ...args],
    { cwd: project, env, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return (result.stdout ?? "").trim();
}

export function initGit(project) {
  git(project, ["init", "-q"]);
  return project;
}

export function commitAll(project, message, date) {
  git(project, ["add", "-A"]);
  git(project, ["commit", "-q", "-m", message], { date });
  return git(project, ["rev-parse", "HEAD"]);
}
