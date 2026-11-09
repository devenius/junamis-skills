import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLease,
  heartbeatLease,
  leasePath,
  readLeases,
  releaseLease,
  summarizeLeases,
} from "../src/orchestrator/lease.js";
import { atomicWriteFile } from "../src/orchestrator/fsx.js";
import { LeaseHeldError, LeaseLostError } from "../src/orchestrator/errors.js";
import { toIso } from "../src/orchestrator/time.js";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "orch-lease-"));
}

test("lease acquire, reacquire a dead same-session pid, hold, and release", async () => {
  const root = tempRoot();
  const first = await acquireLease({ root, sessionId: "s-a", pid: 999999, host: "host-a", ttlSeconds: 60 });
  assert.equal(first.action, "acquired");
  assert.equal(first.lease.session_id, "s-a");

  const reacquired = await acquireLease({ root, sessionId: "s-a", pid: process.pid, host: "host-a", ttlSeconds: 60 });
  assert.equal(reacquired.action, "reacquired");

  await assert.rejects(
    () => acquireLease({ root, sessionId: "s-b", pid: process.pid, host: "host-a", ttlSeconds: 60 }),
    (error) => error instanceof LeaseHeldError && error.owner === "s-a",
  );

  const heartbeat = await heartbeatLease({ root, sessionId: "s-a", ttlSeconds: 120 });
  assert.equal(heartbeat.ttl_seconds, 120);
  assert.equal(heartbeat.session_id, "s-a");

  const released = await releaseLease({ root, sessionId: "s-a" });
  assert.equal(released.session_id, "s-a");
  assert.deepEqual(await readLeases(root), []);
  await assert.rejects(() => releaseLease({ root, sessionId: "s-a" }), LeaseLostError);
});

test("a stale lease is taken over and the old owner slot is removed", async () => {
  const root = tempRoot();
  mkdirSync(join(root, "locks"), { recursive: true });
  const oldHeartbeat = toIso(new Date(Date.now() - 120_000));
  const oldLease = {
    session_id: "s-old",
    pid: 999999,
    host: "host-a",
    started_at: oldHeartbeat,
    heartbeat_at: oldHeartbeat,
    ttl_seconds: 60,
  };
  await atomicWriteFile(leasePath(root, "s-old"), `${JSON.stringify(oldLease, null, 2)}\n`);

  const acquired = await acquireLease({ root, sessionId: "s-new", pid: process.pid, host: "host-a", ttlSeconds: 60 });
  assert.equal(acquired.action, "taken_over");
  assert.equal(acquired.previous.session_id, "s-old");
  const leases = await readLeases(root);
  assert.equal(leases.length, 1);
  assert.equal(leases[0].lease.session_id, "s-new");
});

test("lease status marks live and stale leases without writing", async () => {
  const root = tempRoot();
  await acquireLease({ root, sessionId: "s-live", pid: process.pid, host: "host-a", ttlSeconds: 60 });
  const staleAt = toIso(new Date(Date.now() - 120_000));
  await atomicWriteFile(
    leasePath(root, "s-stale"),
    `${JSON.stringify({
      session_id: "s-stale",
      pid: 999999,
      host: "host-a",
      started_at: staleAt,
      heartbeat_at: staleAt,
      ttl_seconds: 60,
    }, null, 2)}\n`,
  );
  const view = summarizeLeases(await readLeases(root));
  const live = view.find((lease) => lease.session_id === "s-live");
  const stale = view.find((lease) => lease.session_id === "s-stale");
  assert.equal(live.live, true);
  assert.equal(stale.live, false);
  assert.equal(stale.stale, true);
});
