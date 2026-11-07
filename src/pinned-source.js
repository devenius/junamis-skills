import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join, posix } from "node:path";

const SOURCE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;

function isValidSkillPath(value) {
  if (typeof value !== "string") return false;
  const segments = value.split("/");
  return segments.at(-1) === "SKILL.md" && segments.every((segment) =>
    segment !== "" && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment),
  );
}

export function validatePinnedSource({ source, ref, skills }) {
  if (typeof source !== "string" || !SOURCE.test(source)) {
    throw new Error(`invalid GitHub source: ${JSON.stringify(source)}`);
  }
  if (typeof ref !== "string" || !SHA.test(ref)) {
    throw new Error(`invalid commit SHA for ${source}`);
  }
  if (!Array.isArray(skills) || skills.length === 0) {
    throw new Error(`no skills listed for ${source}`);
  }

  for (const skill of skills) {
    if (!skill || typeof skill.name !== "string" || !isValidSkillPath(skill.skillPath)) {
      throw new Error(`invalid skill path for ${skill?.name ?? "unknown skill"}`);
    }
    if (typeof skill.treeSha !== "string" || !SHA.test(skill.treeSha)) {
      throw new Error(`invalid tree SHA for ${skill.name}`);
    }
  }
}

export function buildPinnedCheckoutCommands(source, ref, directory) {
  if (typeof source !== "string" || !SOURCE.test(source)) {
    throw new Error(`invalid GitHub source: ${JSON.stringify(source)}`);
  }
  if (typeof ref !== "string" || !SHA.test(ref)) {
    throw new Error(`invalid commit SHA for ${source}`);
  }

  const url = `https://github.com/${source}.git`;
  return [
    ["init", "--quiet", directory],
    ["-C", directory, "remote", "add", "origin", url],
    ["-C", directory, "fetch", "--quiet", "--depth=1", "origin", ref],
    ["-C", directory, "checkout", "--quiet", "--detach", "FETCH_HEAD"],
  ];
}

const MAX_CAPTURE_BYTES = 64 * 1024;
const KILL_GRACE_MS = 5000;
const SETTLE_GRACE_MS = KILL_GRACE_MS + 2000;

// maxBytes = 0 means unlimited. Local repository metadata (rev-parse, cat-file,
// ls-tree) can legitimately be large; network commands keep the small cap.
function runGit(args, timeout = 300000, { maxBytes = MAX_CAPTURE_BYTES } = {}) {
  const limit = maxBytes > 0 ? maxBytes : Number.POSITIVE_INFINITY;
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_CONFIG_")));
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
      GIT_TERMINAL_PROMPT: "0",
      GIT_LFS_SKIP_SMUDGE: "1",
    });

    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env, detached: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let overflowed = false;
    let killTimer = null;
    let settleTimer = null;

    const killGroup = (signal) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* ignore */ }
      }
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      if (error) reject(error);
      else resolve(result);
    };
    const terminate = () => {
      killGroup("SIGTERM");
      if (!killTimer) killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
      if (!settleTimer) settleTimer = setTimeout(() => {
        // A detached descendant can hold the pipes open forever. Stop waiting.
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (timedOut) return finish(new Error("git operation timed out"));
        if (overflowed) return finish(new Error("git output exceeded the 64 KiB capture limit"));
        finish(new Error("git operation did not close"));
      }, SETTLE_GRACE_MS);
    };
    const timer = timeout > 0
      ? setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeout)
      : null;

    const capture = (stream, which) => {
      stream.on("data", (chunk) => {
        const text = chunk.toString();
        const next = (which === "stdout" ? stdout : stderr) + text;
        if (next.length > limit) {
          overflowed = true;
          terminate();
        }
        const capped = Number.isFinite(limit) ? next.slice(-limit) : next;
        if (which === "stdout") stdout = capped;
        else stderr = capped;
      });
    };
    capture(child.stdout, "stdout");
    capture(child.stderr, "stderr");
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (timedOut) return finish(new Error("git operation timed out"));
      if (overflowed) return finish(new Error("git output exceeded the 64 KiB capture limit"));
      finish(null, { code: code ?? 1, stdout, stderr });
    });
  });
}

async function runCheckedGit(args, timeout, options) {
  const result = await runGit(args, timeout, options);
  if (result.code !== 0) {
    throw new Error(`git ${args.slice(1).join(" ")} failed (exit ${result.code}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function verifyCheckout(directory, ref, timeout = 300000) {
  if (typeof ref !== "string" || !SHA.test(ref)) {
    throw new Error(`invalid locked commit SHA: ${JSON.stringify(ref)}`);
  }
  const head = await runCheckedGit(["-C", directory, "rev-parse", "HEAD"], timeout, { maxBytes: 0 });
  if (head !== ref) {
    throw new Error(`checkout HEAD ${head} does not match locked commit ${ref}`);
  }
  return head;
}

export async function preparePinnedSource({ source, ref, skills }, { timeout = 300000 } = {}) {
  validatePinnedSource({ source, ref, skills });
  const directory = await mkdtemp(join(tmpdir(), "junamis-skills-"));

  try {
    for (const command of buildPinnedCheckoutCommands(source, ref, directory)) {
      await runCheckedGit(command, timeout);
    }
    await verifyCheckout(directory, ref, timeout);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    path: directory,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function getSkillTreeSha(directory, skillPath, { timeout = 300000 } = {}) {
  if (!isValidSkillPath(skillPath)) {
    throw new Error(`invalid skill path: ${JSON.stringify(skillPath)}`);
  }
  const folder = skillPath.slice(0, -"/SKILL.md".length);
  const revision = folder ? `HEAD:${folder}` : "HEAD^{tree}";
  const sha = await runCheckedGit(["-C", directory, "rev-parse", "--verify", revision], timeout, { maxBytes: 0 });
  if (!SHA.test(sha)) throw new Error(`git returned an invalid tree SHA for ${skillPath}`);

  const type = await runCheckedGit(["-C", directory, "cat-file", "-t", sha], timeout, { maxBytes: 0 });
  if (type !== "tree") {
    throw new Error(`pinned path for ${skillPath} is not a directory tree (found ${type})`);
  }

  const listing = await runCheckedGit(["-C", directory, "ls-tree", "-r", sha], timeout, { maxBytes: 0 });
  for (const line of listing.split("\n")) {
    if (!line) continue;
    const match = line.match(/^(\d+)\s+\w+\s+([0-9a-f]+)\t(.+)$/);
    if (!match) continue;
    const [, mode, object, entryPath] = match;
    if (mode === "120000") {
      // In-tree symlinks are legitimate (for example CLAUDE.md -> AGENTS.md).
      // Read the blob and allow it only when its target stays inside the skill
      // folder; an absolute or escaping target is rejected.
      const target = await runCheckedGit(["-C", directory, "cat-file", "blob", object], timeout, { maxBytes: 0 });
      assertContainedSymlink(entryPath, target, skillPath, line);
      continue;
    }
    if (mode === "160000") {
      throw new Error(`pinned path for ${skillPath} contains a gitlink: ${line}`);
    }
  }

  return sha;
}

// Resolve a symlink target lexically from the link's own directory using POSIX
// rules. Reject absolute targets and anything that climbs above the skill folder.
function assertContainedSymlink(entryPath, target, skillPath, line) {
  if (posix.isAbsolute(target)) {
    throw new Error(`pinned path for ${skillPath} contains an absolute symlink: ${line}`);
  }
  const base = posix.dirname(entryPath);
  const resolved = posix.normalize(posix.join(base === "." ? "" : base, target));
  if (posix.isAbsolute(resolved) || resolved === ".." || resolved.startsWith("../")) {
    throw new Error(`pinned path for ${skillPath} contains a symlink that escapes the skill folder: ${line}`);
  }
}
