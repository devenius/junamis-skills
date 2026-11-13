import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

function packageJson() {
  return JSON.parse(read("package.json"));
}

test("package metadata targets the public npmjs registry", () => {
  const pkg = packageJson();
  assert.equal(pkg.name, "@devenius/junamis-skills");
  assert.equal(pkg.publishConfig?.access, "public");
  assert.equal(
    pkg.publishConfig?.registry,
    undefined,
    "publishConfig.registry must stay absent; the publish command selects the registry",
  );
  assert.ok(
    typeof pkg.scripts?.["publish:npm"] === "string",
    "package.json must define a publish:npm script",
  );
});

test("README documents the npx install and the 1.1.0 status", () => {
  const text = read("README.md");
  assert.match(text, /npx @devenius\/junamis-skills@latest/);
  assert.match(text, /1\.1\.0/);
});

test("AGENTS.md documents the npm publication policy", () => {
  const text = read("AGENTS.md");
  assert.match(text, /## Publishing and deprecation/);
  assert.match(text, /The agent never runs registry mutations/);
  assert.match(text, /1\.1\.0/);
});

test("SAFETY.md gates the npm registry commands", () => {
  const text = read("library/SAFETY.md");
  assert.match(text, /npm stage publish/);
  assert.match(text, /npm deprecate/);
});

test("the route table has a publish row", () => {
  assert.match(read("library/skills/route/SKILL.md"), /\| publish \|/);
});

test("the npm runbook and decision record exist", () => {
  assert.ok(existsSync(join(ROOT, "docs", "publishing", "npm.md")));
  assert.ok(existsSync(join(ROOT, "docs", "decisions", "0020-npm-publication.md")));
});

test("the publish workflow has both registries and OIDC staging", () => {
  const workflow = read(".github/workflows/publish.yml");
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm stage publish/);
  assert.match(workflow, /registry\.npmjs\.org/);
  assert.match(workflow, /npm\.pkg\.github\.com/);
  assert.match(workflow, /environment: npm-publish/);
});

test("the color helper and publish checker are present", () => {
  assert.ok(existsSync(join(ROOT, "src", "color.ts")));
  assert.ok(existsSync(join(ROOT, "scripts", "publish-npm.mjs")));
});
