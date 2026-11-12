// Per-project and monorepo design registry bootstrap.
//
// The project root is the caller's cwd. The registry always lives at
// <projectRoot>/docs/design. A monorepo gets one draft overview per app or
// package, under a kind folder that reflects what the workspace actually is.
// A single project gets one draft overview under the detected kind.
//
// Bootstrap copies the package's normative schema when the project has none,
// creates _registry.json, and writes INDEX.md. It never overwrites an existing
// surface and never promotes a draft.

import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exists, listDir, readJsonFile, readText, statSafe } from "../orchestrator/fsx.js";
import { atomicWriteJson, atomicWriteText } from "./atomic.js";
import { headCommit, renderDesignFile } from "./delta.js";
import { writeIndex } from "./index-gen.js";
import { computeDesignChecksum, surfacePath, validateDesignText } from "./schema.js";
import { parseYaml } from "./yaml.js";
import { isRecord } from "../types/guards.js";
import type { BootstrapResult, BootstrapTarget, DesignKind } from "../types/design.js";

const WORKSPACE_DIRS = ["apps", "packages", "services", "libs", "plugins"];
const SOURCE_ROOTS = ["src", "bin", "scripts", "app", "pages", "lib"];
const WEB_DEPS = ["react", "next", "vue", "nuxt", "svelte", "@angular/core", "solid-js"];
const API_DEPS = ["@nestjs/core", "express", "fastify", "koa", "hapi"];
const DATA_DEPS = ["prisma", "@prisma/client", "drizzle-orm", "typeorm", "sequelize", "mongoose"];
const INFRA_FILES = ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "serverless.yml"];
const INFRA_DIRS = ["terraform", "k8s", "helm", "pulumi"];

function today(now: string | null): string {
  if (!now) return new Date().toISOString().slice(0, 10);
  const value = String(now).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--now must be a YYYY-MM-DD date");
  return value;
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

async function isDirectory(path: string): Promise<boolean> {
  const stat = await statSafe(path);
  return Boolean(stat?.isDirectory());
}

async function isFile(path: string): Promise<boolean> {
  const stat = await statSafe(path);
  return Boolean(stat?.isFile());
}

async function readPackage(dir: string): Promise<Record<string, unknown> | null> {
  const parsed = await readJsonFile(join(dir, "package.json"));
  if (!parsed.exists || parsed.error || !isRecord(parsed.value)) return null;
  return parsed.value;
}

function depsOf(pkg: Record<string, unknown> | null, key: string): Record<string, unknown> {
  const value = pkg?.[key];
  return isRecord(value) ? value : {};
}

function packageDependencies(pkg: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ...depsOf(pkg, "dependencies"),
    ...depsOf(pkg, "devDependencies"),
    ...depsOf(pkg, "peerDependencies"),
  };
}

function hasDependency(deps: Record<string, unknown>, names: readonly string[]): boolean {
  return names.some((name) => Object.prototype.hasOwnProperty.call(deps, name));
}

async function hasAnyDir(base: string, names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    if (await isDirectory(join(base, name))) return true;
  }
  return false;
}

async function hasAnyFile(base: string, names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    if (await isFile(join(base, name))) return true;
  }
  return false;
}

export async function detectKind(dir: string, pkg: Record<string, unknown> | null = null): Promise<DesignKind> {
  const deps = packageDependencies(pkg);

  if (hasDependency(deps, WEB_DEPS) || (await hasAnyDir(dir, ["app", "pages", "src/app", "src/pages"]))) {
    return "web";
  }
  if (hasDependency(deps, API_DEPS) || (await hasAnyDir(dir, ["src/routes", "src/controllers", "api"]))) {
    return "api";
  }
  if (hasDependency(deps, DATA_DEPS) || (await hasAnyDir(dir, ["prisma", "migrations", "db", "models"]))) {
    return "data";
  }
  if ((await hasAnyFile(dir, INFRA_FILES)) || (await hasAnyDir(dir, INFRA_DIRS))) {
    return "infra";
  }
  if (pkg?.["bin"] || (await hasAnyDir(dir, ["src/cli", "bin"]))) {
    return "cli";
  }
  return "other";
}

async function workspacePatterns(projectRoot: string): Promise<string[]> {
  const patterns: string[] = [];
  const rootPackage = await readPackage(projectRoot);
  const workspaces = rootPackage?.["workspaces"];
  if (Array.isArray(workspaces)) {
    patterns.push(...(workspaces as unknown[]).filter((value): value is string => typeof value === "string"));
  } else if (isRecord(workspaces) && Array.isArray(workspaces["packages"])) {
    patterns.push(...(workspaces["packages"] as unknown[]).filter((value): value is string => typeof value === "string"));
  }

  const pnpmText = await readText(join(projectRoot, "pnpm-workspace.yaml"));
  if (pnpmText !== null) {
    try {
      const parsed = parseYaml(pnpmText, { label: "pnpm-workspace.yaml" });
      if (isRecord(parsed) && Array.isArray(parsed["packages"])) {
        patterns.push(...(parsed["packages"] as unknown[]).filter((value): value is string => typeof value === "string"));
      }
    } catch {
      // A malformed workspace file is not a reason to refuse a bootstrap. The
      // direct-directory scan below still finds conventional workspaces.
    }
  }
  return patterns;
}

async function expandPattern(projectRoot: string, pattern: string): Promise<string[]> {
  const cleaned = String(pattern).trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (cleaned.length === 0 || cleaned.startsWith("!")) return [];

  if (cleaned.endsWith("/*") && !cleaned.slice(0, -2).includes("*")) {
    const prefix = cleaned.slice(0, -2);
    const entries = await listDir(join(projectRoot, prefix));
    const out: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativeDir = `${prefix}/${entry.name}`;
      if (await isFile(join(projectRoot, relativeDir, "package.json"))) out.push(relativeDir);
    }
    return out;
  }
  if (cleaned.includes("*")) return [];
  if (await isFile(join(projectRoot, cleaned, "package.json"))) return [cleaned];
  return [];
}

export async function discoverWorkspaces(projectRoot: string): Promise<string[]> {
  const dirs = new Set<string>();
  const patterns = await workspacePatterns(projectRoot);
  for (const pattern of patterns) {
    for (const dir of await expandPattern(projectRoot, pattern)) dirs.add(toPosix(dir));
  }
  for (const root of WORKSPACE_DIRS) {
    const entries = await listDir(join(projectRoot, root));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativeDir = `${root}/${entry.name}`;
      if (await isFile(join(projectRoot, relativeDir, "package.json"))) dirs.add(relativeDir);
    }
  }
  return [...dirs].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

function safeAppName(dir: string): string {
  const raw = basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw.length > 0 ? raw : "app";
}

interface DiscoveredTarget {
  readonly dir: string;
  readonly app: string | null;
  readonly monorepo: boolean;
}

async function discoverTargets(projectRoot: string): Promise<DiscoveredTarget[]> {
  const workspaces = await discoverWorkspaces(projectRoot);
  if (workspaces.length === 0) {
    return [{ dir: ".", app: null, monorepo: false }];
  }
  const used = new Map<string, number>();
  return workspaces.map((dir) => {
    const base = safeAppName(dir);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return {
      dir,
      app: count === 0 ? base : `${base}-${count + 1}`,
      monorepo: true,
    };
  });
}

async function sourceRoots(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const root of SOURCE_ROOTS) {
    if (await isDirectory(join(projectRoot, root))) out.push(`${root}/**`);
  }
  return out.length > 0 ? out : ["src/**"];
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content}`;
}

function table(headers: string, separator: string): string {
  return `${headers}\n${separator}\n| (none yet) |${" |".repeat(headers.split("|").length - 3)}`;
}

function kindSections(kind: DesignKind, subject: string): string[] {
  if (kind === "web") {
    return [
      section("Structure", `Describe the component tree and layout for ${subject}.`),
      section("Routes", table("| path | component | auth | notes |", "|------|-----------|------|-------|")),
      section("State & data", table("| name | source | shape | notes |", "|------|--------|-------|-------|")),
      section("Props & events", table("| component | props | events |", "|-----------|-------|--------|")),
      section("Accessibility", "Record the accessibility requirements and test status."),
    ];
  }
  if (kind === "api") {
    return [
      section("Endpoint", "- Method: `TBD`\n- Path: `TBD`\n- Auth: `TBD`\n- Rate limit: `TBD`"),
      section("Request", table("| field | in | type | required | notes |", "|-------|----|------|----------|-------|")),
      section("Response — 200", table("| field | type | nullable | notes |", "|-------|------|----------|-------|")),
      section("Errors", table("| status | code | meaning |", "|--------|------|---------|")),
      section("Examples", "```json\n{}\n```"),
    ];
  }
  if (kind === "data") {
    return [
      section("Entities", `Describe the entities owned by ${subject}.`),
      section("Indexes", table("| name | columns | type |", "|------|---------|------|")),
      section("Migrations", table("| id | applied | description |", "|----|---------|-------------|")),
    ];
  }
  if (kind === "infra") {
    return [
      section("Topology", `Describe the named resources and their relations for ${subject}.`),
      section("Resources", table("| name | type | spec | notes |", "|------|------|------|-------|")),
      section("Env & secrets", table("| name | kind | source |", "|------|------|--------|")),
    ];
  }
  if (kind === "cli") {
    return [
      section("Command", "`<tool> [args]`"),
      section("Flags", table("| flag | type | default | notes |", "|------|------|---------|-------|")),
      section("Output", "Describe stdout/stderr format and exit codes."),
    ];
  }
  return [];
}

export interface OverviewBodyInput {
  readonly kind: DesignKind;
  readonly app?: string | null;
  readonly codePaths?: readonly string[];
  readonly date: string;
  readonly monorepo?: boolean;
}

export function overviewBody({ kind, app = null, codePaths = [], date, monorepo = false }: OverviewBodyInput): string {
  const subject = monorepo && app ? `the ${app} workspace` : "this project";
  const paths = codePaths.length > 0 ? codePaths.map((path) => `\`${path}\``).join(", ") : "no source path yet";
  return [
    section("Intent", `Describe the ${kind} surface for ${subject}. This draft is the overview that later page, endpoint, entity, or resource surfaces will split from.`),
    section("Current state", `Draft overview created by the design registry bootstrap for ${subject}. It covers ${paths}. No behavior has been reviewed yet.`),
    section("Known gaps", "- Split page, endpoint, entity, or resource surfaces out of this overview as work begins.\n- Confirm the surface boundary and owner."),
    ...kindSections(kind, subject),
    section("Change log", `- ${date} · v0.1.0 · Created draft overview · bootstrap · library/document`),
  ].join("\n\n");
}

export interface ProjectMapBodyInput {
  readonly projectName: string;
  readonly targets: readonly BootstrapTarget[];
  readonly date: string;
}

// The project-wide map is the entry point to the registry: it names every
// discovered target and links the reader to the per-surface docs. It is always
// a draft and never claims a code path of its own.
export function projectMapBody({ projectName, targets, date }: ProjectMapBodyInput): string {
  const rows = targets.map((target) => {
    const paths = target.code_paths.length > 0
      ? target.code_paths.map((path) => `\`${path}\``).join(", ")
      : "(none)";
    return `| \`${target.dir}\` | ${target.kind} | \`${target.surface_id}\` | ${paths} |`;
  });
  const state = [
    `Project: \`${projectName}\`. Bootstrap discovered ${targets.length} target${targets.length === 1 ? "" : "s"}.`,
    "",
    "| workspace | kind | surface_id | code_paths |",
    "|-----------|------|------------|------------|",
    ...(rows.length > 0 ? rows : ["| `(root)` | other | - | (none) |"]),
  ].join("\n");
  return [
    section("Intent", "This is the project-wide design map. Read it with `_schema.md`, `INDEX.md`, and the per-surface docs."),
    section("Current state", state),
    section(
      "Known gaps",
      "- Confirm each target boundary and owner.\n- Split page, endpoint, entity, or resource surfaces out of the target overviews as work begins.\n- Fill in cross-target contracts.",
    ),
    section("Change log", `- ${date} · v0.1.0 · Created the project-wide design map · bootstrap · library/document`),
  ].join("\n\n");
}

interface SurfaceTextInput {
  readonly surfaceId: string;
  readonly kind: DesignKind;
  readonly app: string | null;
  readonly codePaths: readonly string[];
  readonly body: string;
  readonly date: string;
  readonly commit: string | null;
}

function surfaceText({ surfaceId, kind, app, codePaths, body, date, commit }: SurfaceTextInput): string {
  const frontmatter = {
    surface_id: surfaceId,
    ...(app ? { app } : {}),
    kind,
    status: "draft",
    version: "0.1.0",
    owner: "library/document",
    code_paths: codePaths,
    depends_on: [],
    related_tasks: [],
    last_reviewed: date,
    design_checksum: computeDesignChecksum(body, kind),
    ...(commit ? { last_reviewed_commit: commit } : {}),
  };
  return renderDesignFile(frontmatter, body);
}

interface WriteSurfaceInput {
  readonly designRoot: string;
  readonly surfaceId: string;
  readonly text: string;
  readonly created: string[];
  readonly skipped: string[];
}

async function writeSurface({ designRoot, surfaceId, text, created, skipped }: WriteSurfaceInput): Promise<boolean> {
  const file = surfacePath(designRoot, surfaceId);
  if (await exists(file)) {
    skipped.push(surfaceId);
    return false;
  }
  const validated = validateDesignText(text, { file, designRoot, requireChecksum: true });
  if (!validated.ok) {
    throw new Error(`bootstrap produced an invalid ${surfaceId}: ${validated.errors.join("; ")}`);
  }
  await atomicWriteText(file, text);
  created.push(relative(designRoot, file).split("\\").join("/"));
  return true;
}

async function ensureSchema(designRoot: string): Promise<boolean> {
  const target = join(designRoot, "_schema.md");
  if (await exists(target)) return false;
  const source = fileURLToPath(new URL("../../docs/design/_schema.md", import.meta.url));
  const text = await readText(source);
  if (text === null) throw new Error(`package design schema not found at ${source}`);
  await atomicWriteText(target, text);
  return true;
}

export interface BootstrapOptions {
  readonly projectRoot: string;
  readonly now?: string | null;
}

export async function bootstrapRegistry({ projectRoot, now = null }: BootstrapOptions): Promise<BootstrapResult> {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new Error("bootstrap needs a project root");
  }
  const root = resolve(projectRoot);
  const designRoot = join(root, "docs", "design");
  const date = today(now);
  const commit = headCommit(root);
  const created: string[] = [];
  const skipped: string[] = [];
  const targets: BootstrapTarget[] = [];

  const schemaCopied = await ensureSchema(designRoot);
  const rootPackage = await readPackage(root);
  const projectName = typeof rootPackage?.["name"] === "string" && rootPackage["name"].length > 0
    ? rootPackage["name"]
    : basename(root);
  const discovered = await discoverTargets(root);
  for (const target of discovered) {
    const dir = target.dir === "." ? root : join(root, target.dir);
    const pkg = await readPackage(dir);
    const kind = await detectKind(dir, pkg);
    const codePaths = target.monorepo ? [`${target.dir}/**`] : await sourceRoots(root);
    const surfaceId = target.monorepo
      ? `${kind}/${target.app}/overview`
      : `${kind}/overview`;
    const body = overviewBody({
      kind,
      app: target.app,
      codePaths,
      date,
      monorepo: target.monorepo,
    });
    const text = surfaceText({
      surfaceId,
      kind,
      app: target.app,
      codePaths,
      body,
      date,
      commit,
    });
    await writeSurface({ designRoot, surfaceId, text, created, skipped });
    targets.push({
      dir: target.dir,
      app: target.app,
      kind,
      surface_id: surfaceId,
      code_paths: codePaths,
    });
  }

  const registryPath = join(designRoot, "_registry.json");
  let registryCreated = false;
  if (!(await exists(registryPath))) {
    await atomicWriteJson(registryPath, { bootstrap_complete: false });
    registryCreated = true;
  }

  // Every registry gets one project-wide map. It is written after the target
  // overviews so its table can list them, and it is never rewritten when it
  // already exists.
  const projectMapSurfaceId = "other/project";
  const projectMapText = surfaceText({
    surfaceId: projectMapSurfaceId,
    kind: "other",
    app: null,
    codePaths: [],
    body: projectMapBody({ projectName, targets, date }),
    date,
    commit,
  });
  await writeSurface({
    designRoot,
    surfaceId: projectMapSurfaceId,
    text: projectMapText,
    created,
    skipped,
  });

  const index = await writeIndex({ designRoot });
  return {
    created,
    skipped,
    schemaCopied,
    registryCreated,
    targets,
    index: { path: index.path, generatedAt: index.generatedAt },
    date,
    commit,
  };
}
