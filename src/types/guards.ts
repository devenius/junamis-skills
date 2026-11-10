// Runtime boundary guards.
//
// External input enters as `unknown`. Nothing in this package gets a typed
// value from JSON, YAML, argv, or the filesystem without passing a guard here
// first. The guards are small on purpose: they prove the shape the contract
// needs, not every field an object happens to carry.

import type { ErrorLike, Result } from "./common.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isOneOf<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Compile-time exhaustiveness check with a runtime failure for bad input. */
export function assertNever(value: never, context = "unexpected value"): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    const message = error["message"];
    if (typeof message === "string") return message;
  }
  if (error === undefined) return "unknown error";
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Convert any thrown value into the serializable error contract. */
export function toErrorLike(error: unknown): ErrorLike {
  const base = {
    name: error instanceof Error ? error.name : "Error",
    message: errorMessage(error),
  };
  if (isRecord(error)) {
    const code = error["code"];
    if (typeof code === "string") return { ...base, code };
  }
  return base;
}

/** Parse JSON without trusting it: the result is still `unknown`. */
export function parseJsonUnknown(text: string): Result<unknown, ErrorLike> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: toErrorLike(error) };
  }
}
