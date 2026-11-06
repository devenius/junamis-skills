import { test } from "node:test";
import assert from "node:assert/strict";
import { devNull } from "node:os";
import { fileURLToPath } from "node:url";
import {
  KILL_GRACE_MS,
  SCANNER,
  buildCommand,
  groupLock,
  installExternal,
  installerExitCode,
  isSecurityCancellation,
  partitionExistingSkills,
  runCommand,
  sanitizedEnv,
  stripControlSequences,
  validateAgent,
  validateInstaller,
  verifyScannerIntegrity,
} from "../src/external.js";

test("external installer rejects targets it does not support", () => {
  assert.equal(validateAgent("opencode"), "opencode");
  assert.equal(validateAgent("claude"), "claude-code");
  for (const agent of ["cursor", "windsurf", "cline"]) {
    assert.throws(() => validateAgent(agent), /unknown agent/);
  }
});

test("external installation uses only the pinned scanner-enabled installer", () => {
  assert.equal(validateInstaller("skillsio"), "skillsio");
  assert.throws(() => validateInstaller("skills"), /unknown installer/);

  const command = buildCommand({
    installer: "skillsio",
    source: "owner/repo",
    agent: "opencode",
    skills: ["sample-skill"],
  });
  assert.deepEqual(command.slice(0, 5), [
    "pnpm",
    "--registry",
    SCANNER.registry,
    "dlx",
    "skillsio@1.1.3",
  ]);
  assert.ok(!command.includes("--skip-scan"));
  assert.ok(!command.includes("--silent"));
  assert.ok(!command.includes("-y"));
});

test("the pinned scanner receives a local checkout path", () => {
  const command = buildCommand({
    installer: "skillsio",
    source: "/tmp/pinned-source",
    agent: "opencode",
    skills: ["sample-skill"],
    local: true,
  });

  assert.equal(command[6], "/tmp/pinned-source");
  assert.throws(() => buildCommand({
    installer: "skillsio",
    source: "relative/path",
    agent: "opencode",
    skills: ["sample-skill"],
    local: true,
  }), /local source path/);
});

test("security scan cancellation is treated as an installer failure", () => {
  assert.equal(installerExitCode(0, "Installation cancelled due to security concerns"), 125);
  assert.equal(installerExitCode(0, "Security scan passed"), 0);
  assert.equal(installerExitCode(3, "Installation failed"), 3);
});

test("security cancellation detection accepts alternate wording and rejects a pass", () => {
  assert.equal(installerExitCode(0, "Security scan blocked by policy"), 125);
  assert.equal(installerExitCode(0, "SECURITY SCAN DECLINED"), 125);
  assert.equal(installerExitCode(0, "security scanner failed"), 125);
  assert.equal(installerExitCode(0, "INSTALLATION CANCELLED DUE TO SECURITY CONCERNS"), 125);
  assert.equal(installerExitCode(0, "Security scan passed"), 0);
  assert.equal(installerExitCode(0, "No security issues found"), 0);
  assert.equal(isSecurityCancellation("Security scan blocked by policy"), true);
  assert.equal(isSecurityCancellation("Security scan passed"), false);
});

test("security cancellation detection matches whole words only", () => {
  for (const line of [
    "Installation cancelled due to security concerns",
    "Security scan blocked by policy",
    "security check fails",
  ]) {
    assert.equal(isSecurityCancellation(line), true, `expected cancellation: ${line}`);
  }

  for (const line of [
    "security scan passed",
    "No security issues found",
    "Security update available; no failures",
  ]) {
    assert.equal(isSecurityCancellation(line), false, `expected pass: ${line}`);
  }
});

test("runCommand converts scanner cancellation output to a failure status", async () => {
  const message = "Installation cancelled due to security concerns";
  const script = `process.stdout.write(${JSON.stringify(message)})`;
  const code = await runCommand([process.execPath, "-e", script], 5000);
  assert.equal(code, 125);
});

test("runCommand settles when a detached descendant keeps the pipes open", async () => {
  const script = `
    const { spawn } = require("node:child_process");
    const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    grandchild.unref();
    setTimeout(() => process.exit(0), 50);
  `;
  const started = Date.now();
  const code = await runCommand([process.execPath, "-e", script], 300);
  const elapsed = Date.now() - started;

  assert.equal(code, 124);
  assert.ok(elapsed >= KILL_GRACE_MS, `gave up before the SIGKILL window: ${elapsed}ms`);
  assert.ok(elapsed < KILL_GRACE_MS + 4000, `waited for the descendant: ${elapsed}ms`);
});

test("scanner environment drops project-controlled variables", () => {
  const env = sanitizedEnv({
    HOME: "/home/example",
    KEEP_ME: "yes",
    NPM_CONFIG_REGISTRY: "https://evil.example/",
    npm_config_proxy: "https://evil.example/",
    pnpm_config_store: "/tmp/evil",
    PNPM_CONFIG_HOME: "/tmp/evil",
    NODE_OPTIONS: "--require /tmp/evil.js",
    NODE_PATH: "/tmp/evil",
    COREPACK_HOME: "/tmp/evil",
    CI: "true",
    GITHUB_ACTIONS: "true",
  });

  assert.equal(env.HOME, "/home/example");
  assert.equal(env.KEEP_ME, "yes");
  for (const key of [
    "NPM_CONFIG_REGISTRY",
    "npm_config_proxy",
    "pnpm_config_store",
    "PNPM_CONFIG_HOME",
    "NODE_OPTIONS",
    "NODE_PATH",
    "COREPACK_HOME",
    "CI",
    "GITHUB_ACTIONS",
  ]) {
    assert.ok(!(key in env), `${key} must be removed`);
  }
  assert.equal(env.npm_config_registry, SCANNER.registry);
  assert.equal(env.npm_config_userconfig, devNull);
  assert.equal(env.npm_config_globalconfig, devNull);
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.FORCE_COLOR, "0");
});

const SCANNER_TARBALL = "https://registry.npmjs.org/skillsio/-/skillsio-1.1.3.tgz";

test("scanner integrity verification requires the pinned integrity and tarball", async () => {
  await assert.doesNotReject(verifyScannerIntegrity(async () => ({
    ok: true,
    json: async () => ({ dist: { integrity: SCANNER.integrity, tarball: SCANNER_TARBALL } }),
  })));

  await assert.rejects(
    verifyScannerIntegrity(async () => ({
      ok: true,
      json: async () => ({ dist: { integrity: "sha512-different", tarball: SCANNER_TARBALL } }),
    })),
    /integrity mismatch/,
  );

  await assert.rejects(
    verifyScannerIntegrity(async () => ({
      ok: true,
      json: async () => ({ dist: { integrity: SCANNER.integrity, tarball: "https://evil.example/skillsio.tgz" } }),
    })),
    /tarball mismatch/,
  );

  await assert.rejects(
    verifyScannerIntegrity(async () => ({
      ok: true,
      json: async () => ({ dist: { integrity: SCANNER.integrity } }),
    })),
    /tarball mismatch/,
  );
});

test("installer output strips ANSI and OSC control sequences", () => {
  assert.equal(stripControlSequences("\x1b[31mred\x1b[0m\x1b]0;title\x07 done"), "red done");
  assert.equal(stripControlSequences("a\x1b]8;;https://example.test\x1b\\b\x1b]8;;\x1b\\c"), "abc");
  const cleared = stripControlSequences("\x1b[2J\x1b]0;owned\x07");
  assert.ok(!cleared.includes("\x1b"));
  assert.ok(!cleared.includes("\x07"));
});

test("groupLock rejects malformed manifest envelopes", () => {
  assert.throws(() => groupLock({}), /skills object/);
  assert.throws(() => groupLock({ skills: {} }), /at least one skill/);
  assert.throws(() => groupLock({ skills: [] }), /skills object/);
});

test("groupLock validates source metadata, skill paths, and licenses", () => {
  const entry = {
    source: "owner/repo",
    sourceType: "github",
    skillPath: "skills/sample/SKILL.md",
    license: "MIT",
    ref: "a".repeat(40),
    treeSha: "b".repeat(40),
  };
  const withEntry = (changes) => groupLock({ skills: { "sample-skill": { ...entry, ...changes } } });

  assert.throws(() => withEntry({ sourceType: "git" }), /sourceType/);
  assert.throws(() => withEntry({ skillPath: "skills/../SKILL.md" }), /skillPath/);
  assert.throws(() => withEntry({ skillPath: "skills\\sample\\SKILL.md" }), /skillPath/);
  assert.throws(() => withEntry({ license: "" }), /license/);
  assert.throws(() => withEntry({ ref: "main" }), /commit SHA/);
  assert.throws(() => withEntry({ treeSha: "invalid" }), /tree SHA/);
});

test("groupLock separates skills from the same repo pinned to different commits", () => {
  const base = {
    source: "owner/repo",
    sourceType: "github",
    license: "MIT",
    skillPath: "skills/sample/SKILL.md",
    treeSha: "b".repeat(40),
  };
  const groups = groupLock({
    skills: {
      first: { ...base, ref: "a".repeat(40) },
      second: { ...base, ref: "c".repeat(40) },
    }
  });

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].ref, groups[1].ref);
});

test("existing skills are partitioned without being overwritten", () => {
  const skills = [
    { name: "existing", skillPath: "skills/existing/SKILL.md" },
    { name: "new", skillPath: "skills/new/SKILL.md" },
  ];
  const result = partitionExistingSkills(skills, "/skills", (path) => path === "/skills/existing");

  assert.deepEqual(result.available.map((skill) => skill.name), ["new"]);
  assert.deepEqual(result.conflicts.map(({ name, path }) => ({ name, path })), [
    { name: "existing", path: "/skills/existing" },
  ]);
});

test("failed external installs use the pinned local checkout and remain failures", async () => {
  const lockPath = fileURLToPath(new URL("../skills-lock.json", import.meta.url));
  let scannerCalls = 0;
  let cleanupCalls = 0;

  const messages = [];
  const result = await installExternal({
    lockPath,
    agent: "opencode",
    verifyScanner: async () => {},
    run: async (argv) => {
      scannerCalls++;
      assert.equal(argv[4], "skillsio@1.1.3");
      assert.ok(argv[6].startsWith("/tmp/"));
      return 1;
    },
    prepareSource: async (group) => ({
      path: `/tmp/pinned-${group.ref}`,
      cleanup: async () => { cleanupCalls++; },
    }),
    verifyTree: async () => { },
    exists: () => false,
    retries: 0,
    log: (message) => messages.push(message),
  });

  assert.ok(result.groups > 0);
  assert.equal(result.failed, result.groups);
  assert.equal(scannerCalls, result.groups);
  assert.equal(cleanupCalls, result.groups);
  assert.ok(messages.some((message) => message.includes("FAILED:")));
  assert.ok(messages.every((message) => !message.includes("direct GitHub fetch")));
});

test("tree mismatch blocks scanner installation and cleans the checkout", async () => {
  const lockPath = fileURLToPath(new URL("../skills-lock.json", import.meta.url));
  let scannerCalls = 0;
  let cleanupCalls = 0;

  const result = await installExternal({
    lockPath,
    agent: "opencode",
    verifyScanner: async () => {},
    run: async () => { scannerCalls++; return 0; },
    prepareSource: async (group) => ({
      path: `/tmp/pinned-${group.ref}`,
      cleanup: async () => { cleanupCalls++; },
    }),
    verifyTree: async () => { throw new Error("locked tree SHA mismatch"); },
    exists: () => false,
    retries: 0,
    log: () => { },
  });

  assert.equal(result.failed, result.groups);
  assert.equal(scannerCalls, 0);
  assert.equal(cleanupCalls, result.groups);
});

test("scanner integrity failure blocks every install and cleans the checkout", async () => {
  const lockPath = fileURLToPath(new URL("../skills-lock.json", import.meta.url));
  let scannerCalls = 0;
  let cleanupCalls = 0;

  const result = await installExternal({
    lockPath,
    agent: "opencode",
    run: async () => { scannerCalls++; return 0; },
    verifyScanner: async () => { throw new Error("scanner integrity mismatch"); },
    prepareSource: async (group) => ({
      path: `/tmp/pinned-${group.ref}`,
      cleanup: async () => { cleanupCalls++; },
    }),
    verifyTree: async () => { },
    exists: () => false,
    retries: 0,
    log: () => { },
  });

  assert.equal(result.failed, result.groups);
  assert.equal(scannerCalls, 0);
  assert.equal(cleanupCalls, result.groups);
});

test("a declined security scan is not retried", async () => {
  const lockPath = fileURLToPath(new URL("../skills-lock.json", import.meta.url));
  let scannerCalls = 0;

  const result = await installExternal({
    lockPath,
    agent: "opencode",
    verifyScanner: async () => {},
    run: async () => { scannerCalls++; return 125; },
    prepareSource: async (group) => ({ path: `/tmp/pinned-${group.ref}`, cleanup: async () => { } }),
    verifyTree: async () => { },
    exists: () => false,
    retries: 3,
    log: () => { },
  });

  assert.equal(result.failed, result.groups);
  assert.equal(scannerCalls, result.groups);
});

test("existing external skills block all checkout and scanner writes", async () => {
  const lockPath = fileURLToPath(new URL("../skills-lock.json", import.meta.url));
  let checkoutCalls = 0;
  let scannerCalls = 0;
  const messages = [];

  const result = await installExternal({
    lockPath,
    agent: "opencode",
    exists: () => true,
    prepareSource: async () => { checkoutCalls++; throw new Error("unexpected checkout"); },
    verifyScanner: async () => {},
    run: async () => { scannerCalls++; return 0; },
    log: (message) => messages.push(message),
  });

  assert.ok(result.groups > 0);
  assert.equal(result.failed, result.groups);
  assert.equal(checkoutCalls, 0);
  assert.equal(scannerCalls, 0);
  assert.ok(messages.some((message) => message.includes("existing skill was not overwritten")));
});

test("skills that appear during checkout are rechecked before scanner installation", async () => {
  const lockPath = fileURLToPath(new URL("../skills-lock.json", import.meta.url));
  let checkoutCalls = 0;
  let scannerCalls = 0;
  let cleanupCalls = 0;
  let appeared = false;

  const result = await installExternal({
    lockPath,
    agent: "opencode",
    exists: () => appeared,
    prepareSource: async (group) => {
      checkoutCalls++;
      appeared = true;
      return { path: `/tmp/pinned-${group.ref}`, cleanup: async () => { cleanupCalls++; } };
    },
    verifyScanner: async () => {},
    run: async () => { scannerCalls++; return 0; },
    verifyTree: async () => {},
    log: () => {},
  });

  assert.ok(result.groups > 0);
  assert.equal(result.failed, result.groups);
  assert.equal(checkoutCalls, 1);
  assert.equal(scannerCalls, 0);
  assert.equal(cleanupCalls, checkoutCalls);
});
