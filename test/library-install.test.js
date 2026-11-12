import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync, readlinkSync, readdirSync, statSync, lstatSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getTarget } from "../dist/targets/index.js";
import {
  planLibraryInstall,
  applyLibraryInstall,
  manifestPath,
  SHARED_DOCS,
  SHARED_DATA,
} from "../dist/library-install.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(PACKAGE_ROOT, "bin", "junamis-skills.js");

function fileCount(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? fileCount(join(dir, entry.name)) : 1;
  }
  return count;
}

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    });
}

test("planLibraryInstall uses documented paths for Cursor, Cline, and Windsurf/Devin", async () => {
  const projectDir = join(PACKAGE_ROOT, "target-path-test-project");
  const targets = [
    {
      agent: "cursor",
      globalSkills: join(homedir(), ".cursor", "skills"),
      globalAgents: join(homedir(), ".cursor", "agents"),
      projectSkills: join(projectDir, ".cursor", "skills"),
      projectAgents: join(projectDir, ".cursor", "agents"),
    },
    {
      agent: "cline",
      globalSkills: join(homedir(), ".cline", "skills"),
      globalAgents: join(homedir(), ".cline", "agents"),
      projectSkills: join(projectDir, ".cline", "skills"),
      projectAgents: join(projectDir, ".cline", "agents"),
    },
    {
      agent: "windsurf",
      globalSkills: join(homedir(), ".codeium", "windsurf", "skills"),
      globalAgents: join(homedir(), ".config", "devin", "agents"),
      projectSkills: join(projectDir, ".windsurf", "skills"),
      projectAgents: join(projectDir, ".devin", "agents"),
    },
  ];
  const globalCanonical = join(homedir(), ".config", "junamis", "skills", "agents");
  const projectCanonical = join(projectDir, ".config", "junamis", "skills", "agents");

  for (const target of targets) {
    const globalFiles = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: target.agent });
    const projectFiles = await planLibraryInstall({
      packageRoot: PACKAGE_ROOT,
      agent: target.agent,
      scope: "project",
      projectDir,
    });
    const globalSkill = globalFiles.find((file) => file.path.endsWith("/route/SKILL.md"));
    const globalAgent = globalFiles.find((file) => file.path.endsWith("/orchestrator.md"));
    const projectSkill = projectFiles.find((file) => file.path.endsWith("/route/SKILL.md"));
    const projectAgent = projectFiles.find((file) => file.path.endsWith("/orchestrator.md"));

    assert.ok(globalSkill?.path.startsWith(`${target.globalSkills}/`), `${target.agent}: global skill path`);
    assert.ok(globalAgent?.path.startsWith(`${globalCanonical}/`), `${target.agent}: canonical global agent path`);
    assert.ok(projectSkill?.path.startsWith(`${target.projectSkills}/`), `${target.agent}: project skill path`);
    assert.ok(projectAgent?.path.startsWith(`${projectCanonical}/`), `${target.agent}: canonical project agent path`);
    assert.match(projectAgent.content.toString("utf8"), /^---\nname: orchestrator\ndescription:/);

    const globalLink = globalFiles.links.find((link) => link.path.endsWith("/orchestrator.md"));
    const projectLink = projectFiles.links.find((link) => link.path.endsWith("/orchestrator.md"));
    assert.ok(globalLink.path.startsWith(`${target.globalAgents}/`), `${target.agent}: global agent link path`);
    assert.equal(globalLink.target, globalAgent.path, `${target.agent}: global link target`);
    assert.ok(projectLink.path.startsWith(`${target.projectAgents}/`), `${target.agent}: project agent link path`);
    assert.equal(projectLink.target, projectAgent.path, `${target.agent}: project link target`);
  }
});

test("OpenCode installs internal skills under ~/.config/junamis/skills and records the manifest there", async () => {
  await withHome(async (home) => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const skill = files.find((file) => file.path.endsWith("/route/SKILL.md"));
    const doc = files.find((file) => file.path.endsWith("/HANDOFF.md"));
    const resume = files.find((file) => file.path.endsWith("/RESUME.md"));
    const reconcile = files.find((file) => file.path.endsWith("/RECONCILE.md"));
    const lockFile = files.find((file) => file.path.endsWith("/skills-lock.json"));
    const agent = files.find((file) => file.path.endsWith("/orchestrator.md"));
    const link = files.links.find((entry) => entry.path.endsWith("/orchestrator.md"));

    assert.equal(skill?.path, join(home, ".config", "junamis", "skills", "skills", "route", "SKILL.md"));
    assert.equal(doc?.path, join(home, ".config", "junamis", "skills", "HANDOFF.md"));
    assert.equal(resume?.path, join(home, ".config", "junamis", "skills", "RESUME.md"));
    assert.equal(reconcile?.path, join(home, ".config", "junamis", "skills", "RECONCILE.md"));
    assert.equal(lockFile?.path, join(home, ".config", "junamis", "skills", "skills-lock.json"));
    assert.equal(agent?.path, join(home, ".config", "junamis", "skills", "agents", "orchestrator.md"));
    assert.equal(link?.path, join(home, ".config", "opencode", "agents", "orchestrator.md"));
    assert.equal(link?.target, agent.path);
    assert.equal(manifestPath("opencode"), join(home, ".config", "junamis", "skills", "installed", "library-opencode.json"));

    const result = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });
    assert.equal(result.ok, true);
    assert.ok(existsSync(join(home, ".config", "junamis", "skills", "installed", "library-opencode.json")));
    assert.ok(existsSync(join(home, ".config", "junamis", "skills", "skills", "route", "SKILL.md")));
    assert.ok(existsSync(join(home, ".config", "junamis", "skills", "RESUME.md")));
    assert.ok(existsSync(join(home, ".config", "junamis", "skills", "RECONCILE.md")));
    assert.ok(existsSync(join(home, ".config", "junamis", "skills", "skills-lock.json")));
    assert.equal(lstatSync(join(home, ".config", "opencode", "agents", "orchestrator.md")).isSymbolicLink(), true);
    assert.equal(existsSync(join(home, ".agents", "skills")), false, "the external skills dir is not touched by the library install");
  });
});

test("shared doc and data constants include the resume, reconcile, and manifest contracts", () => {
  assert.ok(SHARED_DOCS.includes("RESUME.md"), "RESUME.md must be installed as a shared doc");
  assert.ok(SHARED_DOCS.includes("RECONCILE.md"), "RECONCILE.md must be installed as a shared doc");
  assert.ok(SHARED_DATA.includes("skills-lock.json"), "skills-lock.json must be installed as shared data");
});

test("install-library creates files, then reports them unchanged", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const first = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });
    assert.equal(first.ok, true);
    assert.ok(first.actions.every((a) => a.action === "create"), "first run must create");

    const secondFiles = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const second = await applyLibraryInstall({ agent: "opencode", files: secondFiles, version: "1.0.0" });
    assert.equal(second.ok, true);
    assert.ok(second.actions.every((a) => a.action === "unchanged"), "second run must be unchanged");
  });
});

test("editing a managed file makes the next install a conflict", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const target = files.find((f) => f.path.endsWith("orchestrator.md"));
    assert.ok(target);
    writeFileSync(target.path, "user edit\n");

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0" });
    assert.equal(result.ok, false);
    assert.ok(result.conflicts.includes(target.path));
  });
});

test("--force overwrites an edited managed file", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const target = files.find((f) => f.path.endsWith("orchestrator.md"));
    writeFileSync(target.path, "user edit\n");

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0", force: true });
    assert.equal(result.ok, true);
    assert.match(readFileSync(target.path, "utf8"), /orchestrator/);
  });
});

test("--dry-run reports actions without writing", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    // Nothing should have been written.
    assert.equal(existsSync(files[0].path), false);
  });
});

test("stale unmodified files are removed", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const routeFile = files.find((f) => f.path.endsWith("/route/SKILL.md"));
    assert.ok(routeFile);
    const subset = files.filter((f) => f.path !== routeFile.path);

    const result = await applyLibraryInstall({ agent: "opencode", files: subset, version: "1.0.0" });
    assert.equal(result.ok, true);
    assert.ok(result.stale.includes(routeFile.path));
    assert.equal(existsSync(routeFile.path), false);
  });
});

test("project scope installs under the project directory", async () => {
  await withHome(async (_home) => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    try {
      const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode", scope: "project", projectDir: project });
      const result = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", scope: "project", projectDir: project });
      assert.equal(result.ok, true);
      assert.ok(existsSync(join(project, ".config", "junamis", "skills", "skills", "route", "SKILL.md")));
      assert.ok(existsSync(join(project, ".config", "junamis", "skills", "RESUME.md")));
      assert.ok(existsSync(join(project, ".config", "junamis", "skills", "RECONCILE.md")));
      assert.ok(existsSync(join(project, ".config", "junamis", "skills", "skills-lock.json")));
      assert.ok(existsSync(join(project, ".opencode", "agents", "orchestrator.md")));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test("project scope rejects a .config parent symlinked outside the project", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
    try {
      // A lexical containment check passes here, but the real destination is
      // outside the project. The manifest must be rejected, not acted on.
      symlinkSync(outside, join(project, ".config"));
      writeManifest(
        "opencode",
        { files: [{ path: join(project, ".config", "junamis", "skills", "HANDOFF.md"), sha256: sha256("outside\n") }] },
        "project",
        project,
      );

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0", scope: "project", projectDir: project }),
        /managed root contains a symlink or escapes its expected location/,
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("project scope rejects a managed root symlinked outside the project", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
    try {
      symlinkSync(outside, join(project, ".config"));
      writeManifest(
        "opencode",
        { files: [{ path: join(project, ".config", "junamis", "skills", "skills", "route", "SKILL.md"), sha256: sha256("outside\n") }] },
        "project",
        project,
      );

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0", scope: "project", projectDir: project }),
        /managed root contains a symlink or escapes its expected location/,
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("project scope rejects .config/junamis/skills symlinked to the project root", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    try {
      mkdirSync(join(project, ".config", "junamis"), { recursive: true });
      symlinkSync(project, join(project, ".config", "junamis", "skills"));
      const victim = join(project, "package.json");
      writeFileSync(victim, "victim\n");
      writeManifest(
        "opencode",
        { files: [{ path: join(project, ".config", "junamis", "skills", "package.json"), sha256: sha256("victim\n") }] },
        "project",
        project,
      );

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0", scope: "project", projectDir: project }),
        /managed root contains a symlink or escapes its expected location/,
      );
      assert.equal(existsSync(victim), true, "the project file must not be deleted");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test("project scope rejects .config/junamis/skills symlinked to .git", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    try {
      mkdirSync(join(project, ".config", "junamis"), { recursive: true });
      mkdirSync(join(project, ".git"), { recursive: true });
      writeFileSync(join(project, ".git", "config"), "secret\n");
      symlinkSync(join(project, ".git"), join(project, ".config", "junamis", "skills"));
      writeManifest(
        "opencode",
        { files: [{ path: join(project, ".config", "junamis", "skills", "config"), sha256: sha256("secret\n") }] },
        "project",
        project,
      );

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0", scope: "project", projectDir: project }),
        /managed root contains a symlink or escapes its expected location/,
      );
      assert.equal(existsSync(join(project, ".git", "config")), true, ".git/config must not be deleted");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test("global scope rejects a managed root symlinked outside the home directory", async () => {
  await withHome(async (home) => {
    const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
    try {
      mkdirSync(join(outside, "junamis", "skills"), { recursive: true });
      const victim = join(outside, "junamis", "skills", "victim.txt");
      writeFileSync(victim, "outside\n");
      symlinkSync(outside, join(home, ".config"));
      writeManifest("opencode", {
        files: [{ path: join(home, ".config", "junamis", "skills", "victim.txt"), sha256: sha256("outside\n") }],
      });

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0" }),
        /managed root contains a symlink or escapes its expected location/,
      );
      assert.equal(existsSync(victim), true, "the outside file must not be deleted");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("project scope allows the project directory itself to be reached through a symlink", async () => {
  const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
  const link = join(tmpdir(), `junamis-proj-link-${process.pid}-${Date.now()}`);
  try {
    symlinkSync(project, link);
    writeManifest("opencode", { files: [] }, "project", link);
    const result = await applyLibraryInstall({
      agent: "opencode",
      files: [],
      version: "1.0.0",
      scope: "project",
      projectDir: link,
    });
    assert.equal(result.ok, true);
  } finally {
    rmSync(link, { force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("project scope rejects a target behind an intermediate symlink inside a managed root", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
    try {
      const skillsRoot = join(project, ".config", "junamis", "skills");
      mkdirSync(skillsRoot, { recursive: true });
      symlinkSync(outside, join(skillsRoot, "route"));
      writeManifest(
        "opencode",
        { files: [{ path: join(skillsRoot, "route", "SKILL.md"), sha256: sha256("outside\n") }] },
        "project",
        project,
      );

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0", scope: "project", projectDir: project }),
        /path escapes the managed project roots through a symlink/,
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("stale edited files are not removed and become conflicts", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const routeFile = files.find((f) => f.path.endsWith("/route/SKILL.md"));
    writeFileSync(routeFile.path, "user edit\n");
    const subset = files.filter((f) => f.path !== routeFile.path);

    const result = await applyLibraryInstall({ agent: "opencode", files: subset, version: "1.0.0" });
    assert.equal(result.ok, false);
    assert.ok(result.conflicts.includes(routeFile.path));
    assert.equal(existsSync(routeFile.path), true);
  });
});

test("a correct agent link is reported unchanged", async () => {
  await withHome(async () => {
    const first = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files: first, version: "1.0.0" });

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0" });
    assert.equal(result.ok, true);
    assert.ok(result.linkActions.every((a) => a.action === "link unchanged"));
  });
});

test("an identical regular file at a link path is adopted as a symlink", async () => {
  await withHome(async (home) => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const link = files.links.find((entry) => entry.path.endsWith("/orchestrator.md"));
    const canonical = link.target;
    const content = readFileSync(canonical);
    rmSync(link.path);
    writeFileSync(link.path, content);

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0" });
    assert.equal(result.ok, true);
    assert.equal(lstatSync(link.path).isSymbolicLink(), true);
    assert.equal(readlinkSync(link.path), canonical);
    assert.ok(home);
  });
});

test("a differing regular file at a link path conflicts unless --force", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const link = files.links.find((entry) => entry.path.endsWith("/orchestrator.md"));
    rmSync(link.path);
    writeFileSync(link.path, "user edit\n");

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const conflict = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0" });
    assert.equal(conflict.ok, false);
    assert.ok(conflict.conflicts.includes(link.path));
    assert.equal(readFileSync(link.path, "utf8"), "user edit\n");

    const forced = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0", force: true });
    assert.equal(forced.ok, true);
    assert.equal(lstatSync(link.path).isSymbolicLink(), true);
    assert.equal(readlinkSync(link.path), link.target);
  });
});

test("a symlink pointing elsewhere at a link path conflicts unless --force", async () => {
  await withHome(async (home) => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const link = files.links.find((entry) => entry.path.endsWith("/orchestrator.md"));
    rmSync(link.path);
    const elsewhere = join(home, "elsewhere.md");
    writeFileSync(elsewhere, "elsewhere\n");
    symlinkSync(elsewhere, link.path);

    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const conflict = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0" });
    assert.equal(conflict.ok, false);
    assert.ok(conflict.conflicts.includes(link.path));

    const forced = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0", force: true });
    assert.equal(forced.ok, true);
    assert.equal(readlinkSync(link.path), link.target);
  });
});

test("--dry-run reports link actions without writing them", async () => {
  await withHome(async (home) => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const result = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", dryRun: true });
    assert.equal(result.ok, true);
    assert.ok(result.linkActions.some((a) => a.action === "create link"));
    assert.equal(existsSync(join(home, ".config", "opencode", "agents", "orchestrator.md")), false);
    assert.equal(existsSync(join(home, ".config", "junamis", "skills", "agents", "orchestrator.md")), false);
  });
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function writeManifest(agent, manifest, scope = "global", projectDir = process.cwd()) {
  const path = manifestPath(agent, scope, projectDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest));
}

test("library manifests cannot point outside the managed roots", async () => {
  await withHome(async (home) => {
    const victim = join(home, "victim.txt");
    writeFileSync(victim, "do not delete\n");
    writeManifest("opencode", {
      files: [{ path: victim, sha256: sha256("do not delete\n") }],
    });

    await assert.rejects(
      applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0" }),
      /invalid library manifest .*outside the managed global roots/,
    );
    assert.equal(existsSync(victim), true);
  });
});

test("library manifests reject malformed hashes and duplicate paths", async () => {
  await withHome(async (home) => {
    const target = getTarget("opencode");
    const inside = join(target.librarySkillsDir(), "route", "SKILL.md");

    writeManifest("opencode", { files: [{ path: inside, sha256: "not-a-hash" }] });
    await assert.rejects(
      applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0" }),
      /sha256 must be 64 lowercase hex characters/,
    );

    writeManifest("opencode", {
      files: [
        { path: inside, sha256: sha256("one") },
        { path: inside, sha256: sha256("two") },
      ],
    });
    await assert.rejects(
      applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0" }),
      /duplicate path/,
    );
    assert.ok(home);
  });
});

test("library manifests reject symlinked targets inside a managed root", async () => {
  await withHome(async (home) => {
    const target = getTarget("opencode");
    const root = target.librarySkillsDir();
    mkdirSync(root, { recursive: true });
    const victim = join(home, "victim.txt");
    writeFileSync(victim, "secret\n");
    const link = join(root, "linked");
    symlinkSync(victim, link);
    writeManifest("opencode", {
      files: [{ path: link, sha256: sha256("secret\n") }],
    });

    await assert.rejects(
      applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0" }),
      /refusing symlinked path/,
    );
    assert.equal(existsSync(victim), true);
  });
});

test("a directory at a planned path is a conflict, not an EISDIR crash", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const routeFile = files.find((f) => f.path.endsWith("/route/SKILL.md"));
    assert.ok(routeFile);
    mkdirSync(routeFile.path, { recursive: true });

    const result = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });
    assert.equal(result.ok, false);
    assert.ok(result.conflicts.includes(routeFile.path));
    assert.equal(statSync(routeFile.path).isDirectory(), true, "the directory must not be read or removed");
  });
});

test("a directory at a stale path is refused without being read or deleted", async () => {
  await withHome(async () => {
    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });

    const routeFile = files.find((f) => f.path.endsWith("/route/SKILL.md"));
    assert.ok(routeFile);
    rmSync(routeFile.path);
    mkdirSync(routeFile.path, { recursive: true });
    const subset = files.filter((f) => f.path !== routeFile.path);
    const kept = subset.find((f) => f.path.endsWith("orchestrator.md"));

    await assert.rejects(
      applyLibraryInstall({ agent: "opencode", files: subset, version: "1.0.0" }),
      /refusing non-regular file/,
    );
    assert.equal(statSync(routeFile.path).isDirectory(), true, "the directory must not be read or removed");
    assert.ok(kept);
    assert.equal(existsSync(kept.path), true, "no other managed file may be deleted");
  });
});

test("library manifests reject malformed JSON", async () => {
  await withHome(async () => {
    const path = manifestPath("opencode");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");

    await assert.rejects(
      applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0" }),
      /invalid library manifest/,
    );
  });
});

test("planned install rejects a symlinked managed root even with no manifest", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
    try {
      symlinkSync(outside, join(project, ".config"));
      const files = await planLibraryInstall({
        packageRoot: PACKAGE_ROOT,
        agent: "opencode",
        scope: "project",
        projectDir: project,
      });

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", scope: "project", projectDir: project }),
        /managed root contains a symlink or escapes its expected location/,
      );
      assert.equal(fileCount(outside), 0, "nothing may be written through the symlinked root");
      assert.equal(existsSync(join(outside, "junamis", "skills", "skills", "route", "SKILL.md")), false);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("planned install rejects a symlinked subdirectory even with an empty manifest", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
    try {
      mkdirSync(join(project, ".config", "junamis", "skills", "skills"), { recursive: true });
      symlinkSync(outside, join(project, ".config", "junamis", "skills", "skills", "route"));
      writeManifest("opencode", { files: [] }, "project", project);
      const files = await planLibraryInstall({
        packageRoot: PACKAGE_ROOT,
        agent: "opencode",
        scope: "project",
        projectDir: project,
      });

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", scope: "project", projectDir: project }),
        /invalid library destination .*path escapes the managed project roots through a symlink/,
      );
      assert.equal(fileCount(outside), 0, "nothing may be written through the symlinked subdirectory");
      assert.equal(existsSync(join(outside, "SKILL.md")), false);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("--force does not overwrite a file outside the managed roots through a symlinked subdirectory", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
    try {
      mkdirSync(join(project, ".config", "junamis", "skills", "skills"), { recursive: true });
      symlinkSync(outside, join(project, ".config", "junamis", "skills", "skills", "route"));
      writeManifest("opencode", { files: [] }, "project", project);
      const victim = join(outside, "SKILL.md");
      writeFileSync(victim, "user data that must survive\n");
      const files = await planLibraryInstall({
        packageRoot: PACKAGE_ROOT,
        agent: "opencode",
        scope: "project",
        projectDir: project,
      });

      await assert.rejects(
        applyLibraryInstall({
          agent: "opencode",
          files,
          version: "1.0.0",
          scope: "project",
          projectDir: project,
          force: true,
        }),
        /invalid library destination .*path escapes the managed project roots through a symlink/,
      );
      assert.equal(readFileSync(victim, "utf8"), "user data that must survive\n");
      assert.equal(fileCount(outside), 1, "only the pre-existing victim may remain");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("init --dry-run rejects a symlinked project root instead of reporting creates", async () => {
  const home = mkdtempSync(join(tmpdir(), "junamis-home-"));
  const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
  const outside = mkdtempSync(join(tmpdir(), "junamis-outside-"));
  try {
    symlinkSync(outside, join(project, ".config"));
    const result = spawnSync(
      process.execPath,
      [CLI, "init", "--dry-run", "--agent", "opencode", "--scope", "project", "--dir", project],
      { encoding: "utf8", env: { ...process.env, HOME: home } },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /managed root contains a symlink or escapes its expected location/);
    assert.doesNotMatch(result.stdout, /create/);
    assert.equal(fileCount(outside), 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a regular file at a managed root is rejected for a manifest entry without an ENOTDIR crash", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    try {
      mkdirSync(join(project, ".config", "junamis", "skills"), { recursive: true });
      const rootFile = join(project, ".config", "junamis", "skills", "skills");
      writeFileSync(rootFile, "not a directory\n");
      writeManifest(
        "opencode",
        { files: [{ path: join(rootFile, "x"), sha256: sha256("x") }] },
        "project",
        project,
      );

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files: [], version: "1.0.0", scope: "project", projectDir: project }),
        /managed root is not a directory: .*\.config\/junamis\/skills\/skills/,
      );
      assert.equal(readFileSync(rootFile, "utf8"), "not a directory\n");
      assert.equal(existsSync(join(project, ".config", "junamis", "skills", "HANDOFF.md")), false, "nothing may be written");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test("a regular file at a managed root is rejected for planned paths without an ENOTDIR crash", async () => {
  await withHome(async () => {
    const project = mkdtempSync(join(tmpdir(), "junamis-proj-"));
    try {
      mkdirSync(join(project, ".config", "junamis", "skills"), { recursive: true });
      const rootFile = join(project, ".config", "junamis", "skills", "skills");
      writeFileSync(rootFile, "not a directory\n");
      const files = await planLibraryInstall({
        packageRoot: PACKAGE_ROOT,
        agent: "opencode",
        scope: "project",
        projectDir: project,
      });

      await assert.rejects(
        applyLibraryInstall({ agent: "opencode", files, version: "1.0.0", scope: "project", projectDir: project }),
        /managed root is not a directory: .*\.config\/junamis\/skills\/skills/,
      );
      assert.equal(readFileSync(rootFile, "utf8"), "not a directory\n");
      assert.equal(existsSync(join(project, ".config", "junamis", "skills", "HANDOFF.md")), false, "nothing may be written");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test("global scope accepts a managed root symlinked inside the home directory", async () => {
  await withHome(async (home) => {
    const dotfiles = join(home, "dotfiles");
    mkdirSync(dotfiles, { recursive: true });
    symlinkSync(dotfiles, join(home, ".config"));

    const files = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const first = await applyLibraryInstall({ agent: "opencode", files, version: "1.0.0" });
    assert.equal(first.ok, true);
    assert.ok(existsSync(join(dotfiles, "junamis", "skills", "skills", "route", "SKILL.md")), "the install must land inside home");

    // The second run validates a real manifest against the same symlinked root.
    const next = await planLibraryInstall({ packageRoot: PACKAGE_ROOT, agent: "opencode" });
    const second = await applyLibraryInstall({ agent: "opencode", files: next, version: "1.0.0" });
    assert.equal(second.ok, true);
  });
});
