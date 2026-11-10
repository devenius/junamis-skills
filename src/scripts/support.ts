// Shared helpers for the development checks that ship in `scripts/`.
//
// Every check is compiled to `dist/scripts/` and run through a thin launcher in
// `scripts/`. A launcher passes in the still-JavaScript runtime modules a check
// depends on, so that boundary is untyped: whatever crosses it starts as
// `unknown` here and is narrowed with the guards from `src/types/`.
//
// These shapes are private to the dev tooling. `src/types/` stays the public
// package contract and is not widened for files a consumer never imports.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord, isString, parseJsonUnknown } from "../types/index.js";

/** Repository root: two levels above a compiled `dist/scripts` module. */
export const packageRoot: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `Array.isArray` narrows to `any[]`. This guard stops at `unknown[]` so a
 * caller never inherits an implicit `any` element.
 */
export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Read and parse a JSON file without trusting the result. */
export async function readJsonFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  const parsed = parseJsonUnknown(raw);
  if (!parsed.ok) throw new Error(`${path} is not valid JSON: ${parsed.error.message}`);
  return parsed.value;
}

/** `skills-lock.json`, narrowed only as far as the checks need. */
export interface SkillsLock {
  readonly version: unknown;
  readonly skills: Readonly<Record<string, unknown>>;
}

export async function readSkillsLock(path: string): Promise<SkillsLock> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`missing ${path}`);
  }

  const parsed = parseJsonUnknown(raw);
  if (!parsed.ok) throw new Error(`skills-lock.json is not valid JSON: ${parsed.error.message}`);

  const lock = parsed.value;
  if (!isRecord(lock) || !isRecord(lock["skills"])) {
    throw new Error("skills-lock.json must contain a skills object");
  }

  return { version: lock["version"], skills: lock["skills"] };
}

/** One skill entry in a lock group, as `groupLock` returns it. */
export interface PinnedSkill {
  readonly name: string;
  readonly skillPath: string;
  readonly treeSha: string;
}

/** One `source@ref` commit from `skills-lock.json`, as `groupLock` returns it. */
export interface SkillsLockGroup {
  readonly source: string;
  readonly ref: string;
  readonly skills: readonly PinnedSkill[];
}

/** Injected `groupLock` from `src/external.js`; its result is still untyped. */
export type GroupLock = (lock: unknown) => unknown;

/** Narrow the result of the injected `groupLock` before a check reads it. */
export function lockGroups(value: unknown): readonly SkillsLockGroup[] {
  if (!isUnknownArray(value)) throw new Error("lock groups must be an array");

  return value.map((group) => {
    if (!isRecord(group)) throw new Error("invalid lock group");
    const source = group["source"];
    const ref = group["ref"];
    const skills = group["skills"];
    if (!isString(source) || !isString(ref) || !isUnknownArray(skills)) {
      throw new Error("invalid lock group");
    }

    return {
      source,
      ref,
      skills: skills.map((skill) => {
        if (!isRecord(skill)) throw new Error("invalid locked skill");
        const name = skill["name"];
        const skillPath = skill["skillPath"];
        const treeSha = skill["treeSha"];
        if (!isString(name) || !isString(skillPath) || !isString(treeSha)) {
          throw new Error("invalid locked skill");
        }
        return { name, skillPath, treeSha };
      }),
    };
  });
}

/** A prepared checkout of one locked commit. */
export interface PinnedCheckout {
  readonly path: string;
  cleanup(): Promise<void>;
}

/** Injected `preparePinnedSource` from `src/pinned-source.js`. */
export type PreparePinnedSource = (group: SkillsLockGroup) => Promise<PinnedCheckout>;

/** Injected `getSkillTreeSha` from `src/pinned-source.js`. */
export type SkillTreeSha = (directory: string, skillPath: string) => Promise<string>;
