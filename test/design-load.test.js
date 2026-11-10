import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DESIGN_CLI, makeDesignFixture, writeSurface } from "./design-helpers.js";

function load(fixture, argv) {
  return spawnSync(
    process.execPath,
    [
      DESIGN_CLI,
      "load",
      ...argv,
      "--project",
      fixture.project,
      "--design-root",
      fixture.designRoot,
      "--json",
    ],
    { encoding: "utf8" },
  );
}

function context(fixture, codePath) {
  const result = load(fixture, ["--code-path", codePath]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test("load --code-path returns the matching surfaces with checksums and bodies", () => {
  const fixture = makeDesignFixture();
  writeSurface({
    designRoot: fixture.designRoot,
    surfaceId: "web/storefront/overview",
    kind: "web",
    app: "storefront",
    codePaths: ["apps/storefront/**"],
  });

  const loaded = context(fixture, "apps/storefront/src/App.tsx");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.design_context, "loaded");
  assert.equal(loaded.surfaces.length, 1);
  assert.equal(loaded.surfaces[0].surface_id, "web/storefront/overview");
  assert.equal(loaded.surfaces[0].app, "storefront");
  assert.equal(loaded.surfaces[0].kind, "web");
  assert.equal(loaded.surfaces[0].status, "draft");
  assert.match(loaded.surfaces[0].checksum, /^sha256:[0-9a-f]{64}$/);
  assert.ok(loaded.surfaces[0].body.includes("## Intent"));

  const unmatched = context(fixture, "packages/other/src/index.ts");
  assert.equal(unmatched.design_context, "none");
  assert.deepEqual(unmatched.surfaces, []);
});

test("load --surface still returns one surface", () => {
  const fixture = makeDesignFixture();
  writeSurface({
    designRoot: fixture.designRoot,
    surfaceId: "api/server/overview",
    kind: "api",
    app: "server",
    codePaths: ["apps/server/**"],
  });

  const result = load(fixture, ["--surface", "api/server/overview"]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.surface_id, "api/server/overview");
  assert.match(parsed.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.ok(parsed.body.includes("## Endpoint"));
});
