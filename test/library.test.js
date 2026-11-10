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

// Declared retry safety for every library skill. The spec table is the source.
const IDEMPOTENT = {
  "db-migrate": false,
  "decision-record": false,
  "dependency-upgrade": false,
  "deploy-verify": true,
  document: false,
  "env-doctor": true,
  frontend: false,
  handoff: true,
  "incident-response": false,
  nestjs: false,
  nextjs: false,
  "perf-budget": true,
  "refactor-safely": false,
  "release-prep": false,
  research: true,
  rollback: false,
  route: true,
  "route-external": true,
  "security-audit": true,
  "skill-author": false,
};

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
  assert.equal(skillNames.length, 20);
  assert.equal(agentNames.length, 9);
  assert.ok(existsSync(join(LIB, "HANDOFF.md")), "HANDOFF.md missing");
  assert.ok(existsSync(join(LIB, "SAFETY.md")), "SAFETY.md missing");
  assert.ok(existsSync(join(LIB, "EXTERNAL.md")), "EXTERNAL.md missing");
  assert.ok(existsSync(join(LIB, "RESUME.md")), "RESUME.md missing");
});

test("the idempotent table covers every library skill", () => {
  assert.deepEqual(Object.keys(IDEMPOTENT).sort(), skillNames);
});

test("every external lock entry pins a commit and skill tree", () => {
  for (const [name, entry] of Object.entries(LOCK.skills)) {
    assert.match(entry.ref ?? "", /^[a-f0-9]{40}$/, `${name}: missing immutable commit SHA`);
    assert.match(entry.treeSha ?? "", /^[a-f0-9]{40}$/, `${name}: missing skill tree SHA`);
  }
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
    assert.match(fm.idempotent ?? "", /^(true|false)$/, `${name}: idempotent must be true or false`);
    assert.equal(fm.idempotent, String(IDEMPOTENT[name]), `${name}: idempotent must match the spec table`);
    const frontmatterLines = text.match(/^---\n([\s\S]*?)\n---\n/)[1].split("\n");
    const versionAt = frontmatterLines.findIndex((line) => /^version:\s*/.test(line));
    assert.ok(versionAt >= 0, `${name}: missing version`);
    assert.equal(
      frontmatterLines[versionAt + 1]?.trim(),
      `idempotent: ${fm.idempotent}`,
      `${name}: idempotent must immediately follow version`,
    );
    assert.ok(text.split("\n").length < 500, `${name}: SKILL.md must stay under 500 lines`);

    assert.ok(text.includes("## Finish"), `${name}: missing ## Finish section`);
    assert.ok(text.includes(`agent: ${name}`), `${name}: Finish block must name the skill`);
    assert.match(text, /^next: /m, `${name}: Finish block must declare next`);
    assert.match(text, /status: (complete|blocked|needs-decision|failed)/, `${name}: Finish block must declare a valid status`);
    assert.ok(!/TODO|TBD|XXX|FIXME/i.test(text), `${name}: contains placeholder/TODO text`);
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

test("route-external is owned only by the orchestrator", () => {
  const orch = frontmatter(readFileSync(join(AGENTS_DIR, "orchestrator.md"), "utf8"), "orchestrator");
  assert.ok(agentSkills(orch).includes("route-external"), "orchestrator must own route-external");
  for (const name of agentNames.filter((n) => n !== "orchestrator")) {
    const fm = frontmatter(readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8"), name);
    assert.ok(!agentSkills(fm).includes("route-external"), `${name} must not own route-external`);
  }
  const text = readFileSync(join(SKILLS_DIR, "route-external", "SKILL.md"), "utf8");
  assert.ok(text.includes(".junamis/adapters/"), "route-external must write .junamis/adapters/");
  assert.match(text, /idempotent: true/, "route-external must record idempotent in the adapter");
  assert.match(text, /record `false`/, "route-external must default a missing idempotent to false");
});

test("RESUME.md is the normative contract and HANDOFF.md points to it", () => {
  const resume = readFileSync(join(LIB, "RESUME.md"), "utf8");
  assert.match(resume, /^\*\*Status:\*\* normative$/m, "RESUME.md must be normative");
  assert.match(resume, /^\*\*Schema version:\*\* 1$/m, "RESUME.md must declare schema version 1");
  assert.ok(
    resume.includes("## Reference implementation (not normative)"),
    "RESUME.md needs the reference implementation section",
  );
  for (const command of ["boot", "plan set", "plan show", "start", "end", "resolve", "status", "checkpoint", "lease", "finish"]) {
    assert.ok(resume.includes(`\`${command}`) || resume.includes(command), `RESUME.md reference section missing ${command}`);
  }

  const handoff = readFileSync(join(LIB, "HANDOFF.md"), "utf8");
  assert.match(
    handoff,
    /^This file defines the step output block\. Execution state and resume behavior are in RESUME\.md\.$/m,
    "HANDOFF.md must point to RESUME.md on its first line",
  );
  assert.ok(handoff.includes("## Schema version"), "HANDOFF.md has no Schema version section");
  assert.ok(handoff.includes("## Idempotency"), "HANDOFF.md has no Idempotency section");
  assert.ok(handoff.includes("## Persisting a handoff"), "HANDOFF.md has no Persisting a handoff section");
  assert.ok(handoff.includes("## Task status mapping"), "HANDOFF.md has no Task status mapping section");
  assert.ok(handoff.includes("<project>/.orchestrator/"), "HANDOFF.md must name the state root");
});

test("orchestrator prompt boots before routing and declares the persistence loop", () => {
  const text = readFileSync(join(AGENTS_DIR, "orchestrator.md"), "utf8");
  const persistence = text.indexOf("## Persistence");
  const understand = text.indexOf("## Understand the request first");
  assert.ok(persistence !== -1, "orchestrator has no Persistence section");
  assert.ok(understand !== -1, "orchestrator has no Understand the request first section");
  assert.ok(persistence < understand, "Persistence must come before Understand the request first");
  assert.match(text, /junamis-orchestrator boot --project/);
  assert.match(text, /resume-report\.md/);
  assert.match(text, /plan set --file <plan\.json> --replace/);
  assert.match(text, /start --task <task_id>/);
  assert.match(text, /--handoff/);
  assert.match(text, /lease release/);
});

test("HANDOFF.md reserves the suggested commit for the orchestrator", () => {
  const text = readFileSync(join(LIB, "HANDOFF.md"), "utf8");
  assert.ok(text.includes("## Suggested commit"), "HANDOFF.md has no Suggested commit section");
  assert.match(text, /Only the orchestrator/i, "HANDOFF.md must reserve the section for the orchestrator");
  assert.match(text, /Never let another skill or agent/i, "HANDOFF.md must forbid other agents from writing or committing");
  assert.ok(text.includes(".junamis/handoff.md"), "Suggested commit must live in .junamis/handoff.md");
});

test("handoff skill writes the suggested commit", () => {
  const text = readFileSync(join(SKILLS_DIR, "handoff", "SKILL.md"), "utf8");
  assert.ok(text.includes("## Suggested commit"), "handoff skill has no Suggested commit section");
  assert.ok(text.includes("State: proposed"), "handoff skill must record the proposal state");
  assert.match(text, /orchestrator-only/i, "handoff skill must mark the section orchestrator-only");
});

test("orchestrator owns the suggested commit", () => {
  const text = readFileSync(join(AGENTS_DIR, "orchestrator.md"), "utf8");
  assert.ok(text.includes("## Suggested commit"), "orchestrator has no Suggested commit section");
  assert.match(text, /git status --short/, "orchestrator must derive the suggestion from the working tree");
  assert.match(text, /Never let a specialist/i, "orchestrator must forbid specialist commits");
});

test("specialist agents never commit", () => {
  for (const name of agentNames.filter((n) => n !== "orchestrator")) {
    const text = readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8");
    assert.match(text, /Never create or edit a commit suggestion/i, `${name}: missing commit prohibition`);
    assert.match(text, /Only the orchestrator/i, `${name}: must defer commits to the orchestrator`);
  }
});

test("orchestrator routes external skills through route-external", () => {
  const text = readFileSync(join(AGENTS_DIR, "orchestrator.md"), "utf8");
  assert.ok(text.includes("route-external"), "orchestrator must mention route-external");
  assert.ok(text.toLowerCase().includes("external skill"), "orchestrator must mention external skills");
  assert.ok(text.toLowerCase().includes("sub-agent"), "orchestrator must mention sub-agents");
  assert.ok(text.includes("Nothing continues until the user answers"), "orchestrator must stop on user decisions");
});

test("every specialist agent can ask the orchestrator during work", () => {
  for (const name of agentNames.filter((n) => n !== "orchestrator")) {
    const text = readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8");
    assert.ok(text.includes("## Questions during work"), `${name}: missing Questions during work section`);
    assert.ok(text.includes("orchestrator"), `${name}: must mention the orchestrator`);
  }
});

test("route covers research and operator paths", () => {
  const route = readFileSync(join(SKILLS_DIR, "route", "SKILL.md"), "utf8");
  const orch = readFileSync(join(AGENTS_DIR, "orchestrator.md"), "utf8");
  assert.ok(route.includes("| research |"), "route SKILL.md has no research path");
  assert.ok(orch.includes("| research | research | researcher |"), "orchestrator table has no research row");
  assert.ok(route.includes("| deploy verification |"), "route SKILL.md has no deploy verification path");
  assert.ok(orch.includes("| deploy verification | deploy-verify | operator |"), "orchestrator table has no deploy verification row");
  assert.ok(route.includes("| rollback |"), "route SKILL.md has no rollback path");
  assert.ok(orch.includes("| rollback | rollback | operator |"), "orchestrator table has no rollback row");
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
