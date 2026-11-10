// Shared primitives used by every contract in this package.
//
// These types are the single vocabulary for JSON input, results, and the
// severity/priority/lifecycle words the contracts already use in prose.

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * A JSON object. Use this only for data that has already been serialized.
 * Untrusted input is `unknown` and must pass a guard in `guards.ts` first.
 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A success or failure value. Errors carry a plain, serializable shape. */
export type Result<T, E = ErrorLike> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type Severity = "critical" | "high" | "medium" | "low";

export type Priority = "p0" | "p1" | "p2" | "p3";

export type LifecycleStatus = "active" | "draft" | "deprecated" | "needs_review";

/** The subset of an Error that survives a JSON boundary. */
export interface ErrorLike {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly detail?: unknown;
  readonly cause?: unknown;
}

// ---------------------------------------------------------------------------
// Installer contract
//
// The installer reads untrusted values (argv, project JSON, `skills-lock.json`)
// and writes into the user's config root. These shapes are what a value becomes
// after a module validator has proved it; they are never produced by a bare
// cast of parsed input.
// ---------------------------------------------------------------------------

/** Where an install lands: the shared global root, or the project's own root. */
export type InstallScope = "global" | "project";

/** A scope selector that may also mean "both install scopes". */
export type ScopeSelection = InstallScope | "all";

/** The frontmatter layout a target expects for agent definitions. */
export type AgentFormat = "opencode" | "claude";

/**
 * One agent-specific install adapter. `src/targets/` is the only place that
 * knows these paths; every other module goes through this interface.
 */
export interface TargetAdapter {
  readonly id: string;
  readonly label: string;
  readonly libraryAgentFormat: AgentFormat;
  globalSkillsDir(): string;
  librarySkillsDir(): string;
  libraryAgentsCanonicalDir(): string;
  libraryAgentsDir(): string;
  projectSkillsDir(projectDir: string): string;
  projectLibrarySkillsDir(projectDir: string): string;
  projectLibraryAgentsCanonicalDir(projectDir: string): string;
  projectAgentsDir(projectDir: string): string;
  detect(): boolean;
}

/** The manifest, config, and directory state reported for one scope. */
export interface StatusLocation {
  readonly scope: InstallScope;
  readonly skillsDir: string;
  readonly librarySkillsDir: string;
  readonly canonicalAgentsDir: string;
  readonly agentsDir: string;
  readonly manifestPath: string;
}

/** The marker `.junamis/junamis-skills.json` that records the guide write. */
export interface GuideMarker {
  readonly guide: string;
  readonly version: string;
  readonly writtenAt: string;
}

/** What `writeGuide` did on this run. */
export type GuideStatus = "created" | "exists" | "kept-user-file";

export interface GuideResult {
  readonly status: GuideStatus;
  readonly path: string;
  readonly version: string;
}

/** A library agent definition rendered from `library/agents/<name>.md`. */
export interface GuideAgent {
  readonly name: string;
  readonly description: string;
  readonly skills: readonly string[];
}

/** One `skills-lock.json` entry as the guide lists it. */
export interface LockedSkillSummary {
  readonly name: string;
  readonly source: string;
  readonly license: string;
}

export interface GuideInput {
  readonly version: string;
  readonly library: readonly string[];
  readonly agents: readonly GuideAgent[];
  readonly locked: readonly LockedSkillSummary[];
}

/** A skill pinned in `skills-lock.json`, after validation. */
export interface PinnedSourceSkill {
  readonly name: string;
  readonly skillPath: string;
  readonly treeSha: string;
}

export type LockedSkill = PinnedSourceSkill;

/** One source and commit, with the skills pinned to it. */
export interface PinnedSource {
  readonly source: string;
  readonly ref: string;
  readonly skills: readonly PinnedSourceSkill[];
}

/** Every skill pinned to the same source and commit, installed in one call. */
export type LockGroup = PinnedSource;

/** The minimum a skill needs for an on-disk existence check. */
export interface SkillRef {
  readonly name: string;
  readonly skillPath: string;
}

/** Existing skills are reported as conflicts and never overwritten. */
export interface SkillPartition<T extends SkillRef = SkillRef> {
  readonly available: T[];
  readonly conflicts: Array<T & { readonly path: string }>;
}

/** The tally `installExternal` returns and `init` reports. */
export interface ExternalInstallResult {
  readonly groups: number;
  readonly installed: number;
  readonly skipped: number;
  readonly failed: number;
}

/** A prepared, verified local checkout of one pinned source. */
export interface PreparedCheckout {
  readonly path: string;
  cleanup(): Promise<void>;
}

/** One file the library installer will write. */
export interface LibraryFile {
  readonly path: string;
  readonly content: Buffer;
}

/** A planned file with the hash of its content. */
export interface PlannedFile extends LibraryFile {
  readonly sha256: string;
}

/** A canonical agent definition linked into a target's agents directory. */
export interface PlannedLink {
  readonly path: string;
  readonly target: string;
}

/**
 * The plan is an array of files. `files` and `links` are also exposed as
 * non-enumerable properties so callers may treat the plan as an object.
 */
export interface LibraryPlan extends Array<PlannedFile> {
  readonly files: readonly PlannedFile[];
  readonly links: readonly PlannedLink[];
}

/** A file list that may also carry the plan's link list. */
export type LibraryFileList = readonly PlannedFile[] & {
  readonly links?: readonly PlannedLink[];
};

/** One recorded file in `installed/library-<agent>.json`. */
export interface LibraryManifestEntry {
  readonly path: string;
  readonly sha256: string;
}

/** The install manifest. Only `files` is contract: the rest is descriptive. */
export interface LibraryManifest {
  readonly agent?: string;
  readonly version?: string;
  readonly installedAt?: string;
  readonly files: readonly LibraryManifestEntry[];
}

/** One action the library installer reports for `--dry-run` and summaries. */
export interface LibraryAction {
  readonly path: string;
  readonly action: string;
  readonly target?: string;
}

/** The result of `applyLibraryInstall`. */
export interface LibraryInstallResult {
  readonly ok: boolean;
  readonly actions: readonly LibraryAction[];
  readonly linkActions: readonly LibraryAction[];
  readonly conflicts: readonly string[];
  readonly stale: readonly string[];
  readonly dryRun?: boolean;
  readonly warnings?: readonly string[];
}

/** An agent entry parsed from `library/agents/<name>.md` frontmatter. */
export interface AgentDefinition {
  readonly fields: Readonly<Record<string, string>>;
  readonly body: string;
}
