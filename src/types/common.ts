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
