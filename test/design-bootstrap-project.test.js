import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bootstrapRegistry } from "../dist/design/bootstrap.js";
import { readSurface } from "../dist/design/schema.js";
import { makeDesignFixture, REPO_DESIGN } from "./design-helpers.js";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writePackage(project, dir, value) {
  writeJson(join(project, dir, "package.json"), value);
}

test("bootstrap creates one draft overview per workspace with the detected kind", async () => {
  const fixture = makeDesignFixture();
  const project = fixture.project;

  writePackage(project, ".", { private: true, workspaces: ["apps/*", "packages/*"] });
  writePackage(project, "apps/storefront", { name: "storefront", dependencies: { react: "^19.0.0" } });
  writePackage(project, "apps/server", { name: "server", dependencies: { "@nestjs/core": "^11.0.0" } });
  writePackage(project, "packages/db", { name: "db", dependencies: { prisma: "^6.0.0" } });
  mkdirSync(join(project, "apps/storefront/src"), { recursive: true });
  writeFileSync(join(project, "apps/storefront/src/App.tsx"), "export const App = () => null;\n");
  mkdirSync(join(project, "apps/server/src"), { recursive: true });
  writeFileSync(join(project, "apps/server/src/main.ts"), "export const boot = () => null;\n");
  mkdirSync(join(project, "packages/db/prisma"), { recursive: true });
  writeFileSync(join(project, "packages/db/prisma/schema.prisma"), "model User { id String @id }\n");

  const result = await bootstrapRegistry({ projectRoot: project, now: "2026-11-10" });
  assert.deepEqual(
    result.created.sort(),
    ["api/server/overview.md", "data/db/overview.md", "other/project.md", "web/storefront/overview.md"].sort(),
  );

  const map = await readSurface(fixture.designRoot, "other/project");
  assert.equal(map.ok, true, map.errors.join("; "));
  assert.equal(map.frontmatter.kind, "other");
  assert.equal(map.frontmatter.status, "draft");
  assert.equal(map.frontmatter.owner, "library/document");
  assert.deepEqual(map.frontmatter.code_paths, []);
  assert.ok(map.body.includes("Read it with `_schema.md`, `INDEX.md`"));
  assert.ok(map.body.includes("`apps/storefront`"));
  assert.ok(map.body.includes("`web/storefront/overview`"));
  assert.ok(map.body.includes("`apps/server/**`"));

  const web = await readSurface(fixture.designRoot, "web/storefront/overview");
  assert.equal(web.ok, true, web.errors.join("; "));
  assert.equal(web.frontmatter.app, "storefront");
  assert.equal(web.frontmatter.status, "draft");
  assert.deepEqual(web.frontmatter.code_paths, ["apps/storefront/**"]);
  assert.ok(web.body.includes("## Intent"));
  assert.ok(web.body.includes("## Known gaps"));
  assert.ok(web.body.includes("Split page, endpoint, entity, or resource surfaces"));

  const api = await readSurface(fixture.designRoot, "api/server/overview");
  assert.equal(api.ok, true, api.errors.join("; "));
  assert.equal(api.frontmatter.app, "server");
  assert.ok(api.body.includes("## Endpoint"));
  assert.ok(api.body.includes("## Response — 200"));

  const data = await readSurface(fixture.designRoot, "data/db/overview");
  assert.equal(data.ok, true, data.errors.join("; "));
  assert.equal(data.frontmatter.app, "db");
  assert.ok(data.body.includes("## Entities"));

  assert.equal(readFileSync(join(fixture.designRoot, "_schema.md"), "utf8"), readFileSync(join(REPO_DESIGN, "_schema.md"), "utf8"));
  assert.deepEqual(JSON.parse(readFileSync(join(fixture.designRoot, "_registry.json"), "utf8")), { bootstrap_complete: false });
  assert.equal(existsSync(join(fixture.designRoot, "INDEX.md")), true);
  assert.equal(existsSync(join(fixture.designRoot, "web", "homepage.md")), false);
  assert.equal(existsSync(join(fixture.designRoot, "api", "get-user.md")), false);

  const rerun = await bootstrapRegistry({ projectRoot: project, now: "2026-11-10" });
  assert.deepEqual(rerun.created, []);
  assert.equal(rerun.skipped.length, 4);
});

test("bootstrap uses one root target for a single project", async () => {
  const fixture = makeDesignFixture();
  const project = fixture.project;
  writePackage(project, ".", { name: "single", dependencies: { react: "^19.0.0" } });
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src/index.js"), "export const boot = () => null;\n");

  const result = await bootstrapRegistry({ projectRoot: project, now: "2026-11-10" });
  assert.deepEqual(result.created.sort(), ["other/project.md", "web/overview.md"].sort());
  const surface = await readSurface(fixture.designRoot, "web/overview");
  assert.equal(surface.ok, true, surface.errors.join("; "));
  assert.equal(surface.frontmatter.app, undefined);
  assert.equal(surface.frontmatter.status, "draft");
  assert.deepEqual(surface.frontmatter.code_paths, ["src/**"]);
  assert.equal(existsSync(join(fixture.designRoot, "web", "homepage.md")), false);

  const map = await readSurface(fixture.designRoot, "other/project");
  assert.equal(map.ok, true, map.errors.join("; "));
  assert.equal(map.frontmatter.surface_id, "other/project");
  assert.ok(map.body.includes("Project: `single`"));
  assert.ok(map.body.includes("`web/overview`"));
});

test("bootstrap never rewrites an existing project-wide map", async () => {
  const fixture = makeDesignFixture();
  const project = fixture.project;
  writePackage(project, ".", { name: "single", dependencies: { react: "^19.0.0" } });
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src/index.js"), "export const boot = () => null;\n");

  await bootstrapRegistry({ projectRoot: project, now: "2026-11-10" });
  const mapPath = join(fixture.designRoot, "other", "project.md");
  const before = readFileSync(mapPath, "utf8");

  const rerun = await bootstrapRegistry({ projectRoot: project, now: "2026-11-11" });
  assert.ok(rerun.skipped.includes("other/project"), "the existing map is reported as skipped");
  assert.equal(readFileSync(mapPath, "utf8"), before, "the existing map keeps its bytes");
});
