// Clock injection and ISO 8601 UTC timestamps.
//
// The contract uses second precision timestamps (for example
// 2026-11-09T10:42:13Z). Lease math still uses milliseconds.

type Clock = () => Date;

let clock: Clock = () => new Date();

export function setClock(fn: Clock): void {
  if (typeof fn !== "function") throw new TypeError("clock must be a function");
  clock = fn;
}

export function resetClock(): void {
  clock = () => new Date();
}

export function nowDate(): Date {
  return clock();
}

export function nowMs(): number {
  return clock().getTime();
}

export function toIso(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError("invalid date");
  return `${d.toISOString().slice(0, 19)}Z`;
}

export function nowIso(): string {
  return toIso(clock());
}

export function isoFromMs(ms: number): string {
  return toIso(new Date(ms));
}

export function parseIso(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
