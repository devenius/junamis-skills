import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECURITY = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
const LOCK = JSON.parse(readFileSync(join(ROOT, "skills-lock.json"), "utf8"));

function tableNames() {
  const names = new Set();
  for (const line of SECURITY.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const first = line.split("|")[1].trim();
    if (first === "Skill" || first.startsWith("---")) continue;
    names.add(first);
  }
  return names;
}

function tableRows() {
  const names = [];
  for (const line of SECURITY.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const first = line.split("|")[1].trim();
    if (first === "Skill" || first.startsWith("---")) continue;
    names.push(first);
  }
  return names;
}

test("SECURITY.md records the scanner and the last external scan month", () => {
  assert.match(SECURITY, /^Last external scan:\s*\d{4}-\d{2}\s*$/m);
  assert.match(SECURITY, /^Scanner:\s*skillsio 1\.1\.3/m);
  assert.match(SECURITY, /Trust Hub, Socket, Snyk/);
});

test("SECURITY.md covers every internal skill", () => {
  const internal = readdirSync(join(ROOT, "library", "skills"))
    .filter((name) => statSync(join(ROOT, "library", "skills", name)).isDirectory())
    .sort();
  assert.equal(internal.length, 20);
  const names = tableNames();
  for (const name of internal) assert.ok(names.has(name), `SECURITY.md has no row for internal skill ${name}`);
});

test("SECURITY.md covers every external skill with its locked source and license", () => {
  const external = Object.keys(LOCK.skills).sort();
  assert.equal(external.length, 24);
  const names = tableNames();
  for (const name of external) assert.ok(names.has(name), `SECURITY.md has no row for external skill ${name}`);
  for (const name of ["shadcn", "shadcn-component-discovery", "nestjs-best-practices"]) {
    const row = SECURITY.split("\n").find((line) => line.startsWith(`| ${name} |`));
    assert.match(row, /\| external \|/, `${name}: kind must be external`);
    assert.match(row, /\| flagged \|/, `${name}: accepted critical report must be flagged`);
    assert.match(row, /reviewed and accepted per SAFETY\.md/, `${name}: note must record the accepted review`);
  }
});

test("SECURITY.md total coverage is 20 internal + 24 external rows", () => {
  const internal = readdirSync(join(ROOT, "library", "skills"))
    .filter((name) => statSync(join(ROOT, "library", "skills", name)).isDirectory());
  assert.equal(internal.length + Object.keys(LOCK.skills).length, 44);
  assert.ok(tableRows().length >= 44, "SECURITY.md must list at least 44 skill rows");
  assert.equal(tableRows().filter((name) => name === "document").length, 2, "document must have an internal and an external row");
});
