// Advisory single-writer lease.
//
// A lease is one JSON file under locks/. A live lease owned by another session
// halts boot. A stale lease is taken over. A dead lease with the same session
// id and host is reclaimed after a crash.

import { hostname } from "node:os";
import { join } from "node:path";
import { atomicWriteFile, ensureDir, listDir, readJsonFile, removeFile } from "./fsx.js";
import { LeaseHeldError, LeaseLostError } from "./errors.js";
import { nowIso, nowMs, parseIso } from "./time.js";

export function leasePath(root, sessionId) {
  return join(root, "locks", `session-${sessionId}.json`);
}

export function readLeases(root) {
  return (async () => {
    const dir = join(root, "locks");
    const entries = await listDir(dir);
    const leases = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("session-") || !entry.name.endsWith(".json")) continue;
      const path = join(dir, entry.name);
      const parsed = await readJsonFile(path);
      if (parsed.exists && !parsed.error && parsed.value && typeof parsed.value === "object") {
        leases.push({ path, lease: parsed.value });
      } else {
        leases.push({ path, lease: null, invalid: true });
      }
    }
    leases.sort((a, b) => String(a.lease?.session_id ?? a.path).localeCompare(String(b.lease?.session_id ?? b.path)));
    return leases;
  })();
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

export function heartbeatMs(lease) {
  const value = parseIso(lease?.heartbeat_at);
  if (value !== null) return value;
  return parseIso(lease?.started_at) ?? 0;
}

export function leaseIsLive(lease, atMs = nowMs()) {
  if (!lease) return false;
  const ttl = Number(lease.ttl_seconds);
  if (!Number.isFinite(ttl) || ttl <= 0) return false;
  return atMs - heartbeatMs(lease) < ttl * 1000;
}

export function leaseView(lease, atMs = nowMs()) {
  if (!lease) return { live: false, stale: true, age_seconds: null };
  const ageMs = Math.max(0, atMs - heartbeatMs(lease));
  return {
    ...lease,
    live: leaseIsLive(lease, atMs),
    stale: !leaseIsLive(lease, atMs),
    age_seconds: Math.floor(ageMs / 1000),
  };
}

function newLease({ sessionId, pid, host, ttlSeconds }) {
  const at = nowIso();
  return {
    session_id: sessionId,
    pid,
    host,
    started_at: at,
    heartbeat_at: at,
    ttl_seconds: ttlSeconds,
  };
}

export async function acquireLease({
  root,
  sessionId,
  pid = process.pid,
  host = hostname(),
  ttlSeconds = 60,
  atMs = nowMs(),
}) {
  await ensureDir(join(root, "locks"));
  const leases = await readLeases(root);
  const live = leases.filter((entry) => entry.lease && leaseIsLive(entry.lease, atMs));

  for (const entry of live) {
    const lease = entry.lease;
    const sameSession = lease.session_id === sessionId;
    const sameHost = lease.host === host;
    if (sameSession && sameHost && !pidAlive(lease.pid)) {
      const reclaimed = newLease({ sessionId, pid, host, ttlSeconds });
      await atomicWriteFile(leasePath(root, sessionId), `${JSON.stringify(reclaimed, null, 2)}\n`);
      return { action: "reacquired", lease: reclaimed, previous: lease };
    }
    throw new LeaseHeldError(lease.session_id, { detail: { lease, path: entry.path } });
  }

  const stale = leases.filter((entry) => entry.lease && !leaseIsLive(entry.lease, atMs));
  const lease = newLease({ sessionId, pid, host, ttlSeconds });

  if (stale.length > 0) {
    stale.sort((a, b) => heartbeatMs(b.lease) - heartbeatMs(a.lease));
    const previous = stale[0].lease;
    for (const entry of leases) {
      try {
        await removeFile(entry.path);
      } catch {
        // A lease file we cannot remove is reported through the next read.
      }
    }
    await atomicWriteFile(leasePath(root, sessionId), `${JSON.stringify(lease, null, 2)}\n`);
    return { action: "taken_over", lease, previous };
  }

  // Invalid, unreadable lease files are treated as stale and cleared.
  if (leases.length > 0) {
    for (const entry of leases) {
      try {
        await removeFile(entry.path);
      } catch {
        // best effort
      }
    }
  }
  await atomicWriteFile(leasePath(root, sessionId), `${JSON.stringify(lease, null, 2)}\n`);
  return { action: "acquired", lease, previous: null };
}

export async function readOwnLease(root, sessionId) {
  const parsed = await readJsonFile(leasePath(root, sessionId));
  if (!parsed.exists || parsed.error || !parsed.value) return null;
  if (parsed.value.session_id !== sessionId) return null;
  return parsed.value;
}

export async function assertLease(root, sessionId) {
  const lease = await readOwnLease(root, sessionId);
  if (!lease) throw new LeaseLostError(sessionId);
  return lease;
}

export async function heartbeatLease({ root, sessionId, ttlSeconds = null, atMs = nowMs() }) {
  const lease = await assertLease(root, sessionId);
  const next = {
    ...lease,
    heartbeat_at: new Date(atMs).toISOString().slice(0, 19) + "Z",
    ttl_seconds: ttlSeconds ?? lease.ttl_seconds,
  };
  await atomicWriteFile(leasePath(root, sessionId), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function releaseLease({ root, sessionId }) {
  const lease = await assertLease(root, sessionId);
  await removeFile(leasePath(root, sessionId));
  return lease;
}

export function summarizeLeases(leases, atMs = nowMs()) {
  return leases.map((entry) => ({
    path: entry.path,
    ...(entry.lease ? leaseView(entry.lease, atMs) : { invalid: true }),
  }));
}
