// Clock injection and ISO 8601 UTC timestamps.
//
// The contract uses second precision timestamps (for example
// 2026-11-09T10:42:13Z). Lease math still uses milliseconds.

let clock = () => new Date();

export function setClock(fn) {
  if (typeof fn !== "function") throw new TypeError("clock must be a function");
  clock = fn;
}

export function resetClock() {
  clock = () => new Date();
}

export function nowDate() {
  return clock();
}

export function nowMs() {
  return clock().getTime();
}

export function toIso(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError("invalid date");
  return `${d.toISOString().slice(0, 19)}Z`;
}

export function nowIso() {
  return toIso(clock());
}

export function isoFromMs(ms) {
  return toIso(new Date(ms));
}

export function parseIso(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
