import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ROOT, "library");
const SKILLS_DIR = join(LIB, "skills");
const AGENTS_DIR = join(LIB, "agents");
const LOCK = JSON.parse(readFileSync(join(ROOT, "skills-lock.json"), "utf8"));

// Externals the library refers to by name. Each must be in the lock.
const EXTERNAL = new Set(["debug", "architect", "develop", "test", "check"]);
// Handoff targets that are not skills or agents.
const SPECIAL = new Set(["user", "none", "orchestrator"]);

// Destructive or gated commands. Any hit in library prose must be a prohibition
// or an approval requirement (see ALLOWED_CONTEXT). library/SAFETY.md is the policy
// itself and is exempt.
const DESTRUCTIVE = [
  /\brm\s+-[a-zA-Z]*[rf]/,
  /\bsudo\b/,
  /\bchmod\s+-R\b|\bchown\s/,
  /\bnpm\s+(i|install|add)\s+(-g|--global)\b|\bpnpm\s+(add|i)\s+-g\b/,
  /\bgit\s+(push|reset\s+--hard|clean|rebase|tag)\b/,
  /\bvercel\s+deploy[^\n]*--prod\b/,
  /\b(npm|pnpm)\s+publish\b/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b|\bTRUNCATE\s+TABLE\b/i,
  /\bvercel\s+env\s+rm\b/,
  /\bkill\s+-9\b|\bpkill\b/,
  /\|\s*(sudo\s+)?(sh|bash)\b/,
  /--force\b/,
];
const ALLOWED_CONTEXT = /\b(never|do not|don't|must not|approval|approve|confirm|ask|ask the user|user|gate|gated|stop|refuse|before)\b/i;

function frontmatter(text, file) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file}: missing frontmatter`);
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

function listDirs(dir) {
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort();
}

function listMarkdown(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...listMarkdown(p));
    else if (n.endsWith(".md")) out.push(p);
  }
  return out;
}

function agentSkills(fm) {
  return fm.skills.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
}

const skillNames = listDirs(SKILLS_DIR);
const agentFiles = readdirSync(AGENTS_DIR).filter((n) => n.endsWith(".md")).sort();
const agentNames = agentFiles.map((f) => f.replace(/\.md$/, ""));
const lockNames = Object.keys(LOCK.skills);

test("library has the expected skills and agents", () => {
  assert.equal(skillNames.length, 15);
  assert.equal(agentNames.length, 6);
  assert.ok(existsSync(join(LIB, "HANDOFF.md")), "HANDOFF.md missing");
  assert.ok(existsSync(join(LIB, "SAFETY.md")), "SAFETY.md missing");
  assert.ok(existsSync(join(LIB, "EXTERNAL.md")), "EXTERNAL.md missing");
});

for (const name of skillNames) {
  test(`skill ${name}: frontmatter, length, handoff block`, () => {
    const file = join(SKILLS_DIR, name, "SKILL.md");
    assert.ok(existsSync(file), `${name}: SKILL.md missing`);
    const text = readFileSync(file, "utf8");
    const fm = frontmatter(text, file);

    assert.equal(fm.name, name, `${name}: frontmatter name must equal folder name`);
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${name}: folder name must be lowercase-hyphenated`);
    assert.ok(fm.description && fm.description.length > 0, `${name}: empty description`);
    assert.ok(fm.description.length <= 1024, `${name}: description over 1024 chars`);
    assert.match(fm.description, /Use (when|to|first|after|before)/, `${name}: description must state when to use it`);
    assert.ok(text.split("\n").length < 500, `${name}: SKILL.md must stay under 500 lines`);

    assert.ok(text.includes("## Finish"), `${name}: missing ## Finish section`);
    assert.ok(text.includes(`agent: ${name}`), `${name}: Finish block must name the skill`);
    assert.match(text, /^next: /m, `${name}: Finish block must declare next`);
  });
}

for (const name of agentNames) {
  test(`agent ${name}: frontmatter and skill list`, () => {
    const file = join(AGENTS_DIR, `${name}.md`);
    const fm = frontmatter(readFileSync(file, "utf8"), file);

    assert.equal(fm.name, name, `${name}: frontmatter name must equal filename`);
    assert.ok(fm.description && fm.description.length <= 1024, `${name}: description missing or too long`);
    assert.match(fm.skills ?? "", /^\[.*\]$/, `${name}: skills must be an inline list`);
    for (const s of agentSkills(fm)) {
      assert.ok(skillNames.includes(s), `${name}: "${s}" must be a library skill`);
    }
  });
}

test("every library skill is owned by exactly one agent", () => {
  const owners = new Map(skillNames.map((s) => [s, []]));
  for (const name of agentNames) {
    const fm = frontmatter(readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8"), name);
    for (const s of agentSkills(fm)) if (owners.has(s)) owners.get(s).push(name);
  }
  for (const [skill, list] of owners) {
    assert.equal(list.length, 1, `${skill}: owned by ${list.length} agents (${list.join(", ") || "none"})`);
  }
});

test("every next target in a Finish block resolves", () => {
  const targets = new Set([...skillNames, ...agentNames, ...SPECIAL, ...EXTERNAL]);
  for (const name of skillNames) {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    for (const m of text.matchAll(/^next: (.+)$/gm)) {
      const n = m[1].trim();
      if (n.startsWith("<")) continue; // placeholder in a template
      assert.ok(targets.has(n), `${name}: next "${n}" is not a skill, agent, or known external`);
    }
  }
});

test("orchestrator dispatches to every agent", () => {
  const text = readFileSync(join(AGENTS_DIR, "orchestrator.md"), "utf8");
  for (const name of agentNames.filter((n) => n !== "orchestrator")) {
    assert.ok(text.includes(name), `orchestrator does not reference agent "${name}"`);
  }
});

test("route covers the research path and the orchestrator routes to researcher", () => {
  const route = readFileSync(join(SKILLS_DIR, "route", "SKILL.md"), "utf8");
  const orch = readFileSync(join(AGENTS_DIR, "orchestrator.md"), "utf8");
  assert.ok(route.includes("| research |"), "route SKILL.md has no research path");
  assert.ok(orch.includes("| research | research | researcher |"), "orchestrator table has no research row");
});

test("destructive commands in library prose are prohibitions or gated", () => {
  const files = listMarkdown(LIB).filter((f) => relative(LIB, f) !== "SAFETY.md");
  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of DESTRUCTIVE) {
        if (re.test(line) && !ALLOWED_CONTEXT.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], `ungated destructive command in library:\n${offenders.join("\n")}`);
});

test("SAFETY.md has a status row for every locked external skill", () => {
  const text = readFileSync(join(LIB, "SAFETY.md"), "utf8");
  const section = text.split("## External skills: status")[1]?.split("## Library enforcement")[0] ?? "";
  const covered = new Set();
  for (const line of section.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const first = line.split("|")[1].trim();
    if (first === "Skill (lock name)" || first.startsWith("---")) continue;
    for (const n of first.split(",").map((s) => s.trim())) covered.add(n);
  }
  const missing = lockNames.filter((n) => !covered.has(n));
  assert.deepEqual(missing, [], `locked skills with no SAFETY.md row: ${missing.join(", ")}`);
});

test("EXTERNAL.md names resolve to lock entries", () => {
  const text = readFileSync(join(LIB, "EXTERNAL.md"), "utf8");
  const names = [...text.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| (MIT|unknown|[^|]+) \|/gm)].map((m) => m[1]);
  assert.ok(names.length >= EXTERNAL.size, "EXTERNAL.md table is missing rows");
  for (const n of names) assert.ok(lockNames.includes(n), `EXTERNAL.md "${n}" is not in skills-lock.json`);
  for (const n of EXTERNAL) assert.ok(names.includes(n), `EXTERNAL.md has no row for "${n}"`);
});

test("external names used by library files exist in the lock", () => {
  const hits = new Set();
  for (const file of listMarkdown(LIB)) {
    const text = readFileSync(file, "utf8");
    for (const n of EXTERNAL) if (new RegExp(`\\b${n}\\b.*\\(external\\)|\\b${n}\\b, then|\\bexternal \\x60?${n}`).test(text)) hits.add(n);
  }
  for (const n of hits) assert.ok(lockNames.includes(n), `"${n}" is referenced as external but not in skills-lock.json`);
  assert.ok(hits.size >= 4, "library references too few external skills");
});
