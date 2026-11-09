// Filesystem primitives for the state engine.
//
// Every snapshot write is: temp file in the same directory, fsync the file,
// rename over the target, fsync the parent directory. Journal appends are one
// complete line through an append-only handle, fsynced before returning.

import { promises as fsp } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { CorruptStateError, IoError } from "./errors.js";

export const FILE_MODE = 0o600;
export const DIR_MODE = 0o700;

const DIRECTORY_FSYNC_CODES = new Set(["EPERM", "EINVAL"]);

function randomSuffix() {
  return `${process.pid}-${randomBytes(6).toString("hex")}`;
}

export function expandHome(path) {
  if (typeof path !== "string" || path.length === 0) return path;
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

export async function exists(path) {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function statSafe(path) {
  try {
    return await fsp.stat(path);
  } catch {
    return null;
  }
}

export async function ensureDir(path) {
  await fsp.mkdir(path, { recursive: true, mode: DIR_MODE });
  try {
    await fsp.chmod(path, DIR_MODE);
  } catch {
    // A platform that ignores modes is not a failure.
  }
}

export async function ensureTree(root, { taskIds = [] } = {}) {
  await ensureDir(root);
  for (const name of ["checkpoints", "tasks", "locks"]) {
    await ensureDir(join(root, name));
  }
  for (const taskId of taskIds) {
    await ensureDir(join(root, "tasks", taskId));
    await ensureDir(join(root, "tasks", taskId, "handoffs"));
    await ensureDir(join(root, "tasks", taskId, "artifacts"));
  }
}

export async function ensureTaskTree(root, taskId) {
  await ensureDir(join(root, "tasks", taskId));
  await ensureDir(join(root, "tasks", taskId, "handoffs"));
  await ensureDir(join(root, "tasks", taskId, "artifacts"));
}

async function fsyncDir(dir) {
  let handle;
  try {
    handle = await fsp.open(dir, "r");
  } catch (error) {
    if (error && DIRECTORY_FSYNC_CODES.has(error.code)) return;
    throw error;
  }
  try {
    await handle.sync();
  } catch (error) {
    if (!error || !DIRECTORY_FSYNC_CODES.has(error.code)) throw error;
  } finally {
    await handle.close();
  }
}

export async function atomicWriteFile(path, data, { mode = FILE_MODE } = {}) {
  const dir = dirname(path);
  await fsp.mkdir(dir, { recursive: true, mode: DIR_MODE });
  const temp = join(dir, `.${basename(path)}.tmp-${randomSuffix()}`);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  let handle;
  try {
    handle = await fsp.open(temp, "wx", mode);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temp, path);
    try {
      await fsp.chmod(path, mode);
    } catch {
      // A platform that ignores modes is not a failure.
    }
    await fsyncDir(dir);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // best effort
      }
    }
    try {
      await fsp.unlink(temp);
    } catch {
      // best effort
    }
    throw error;
  }
}

export async function writeIfMissing(path, data, options = {}) {
  if (await exists(path)) return false;
  await atomicWriteFile(path, data, options);
  return true;
}

export async function appendLine(path, line) {
  const text = String(line);
  const complete = text.endsWith("\n") ? text : `${text}\n`;
  let handle;
  try {
    handle = await fsp.open(path, "a", FILE_MODE);
    await handle.writeFile(complete, "utf8");
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
}

export async function readText(path) {
  try {
    return await fsp.readFile(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readBuffer(path) {
  try {
    return await fsp.readFile(path);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readJsonFile(path) {
  const raw = await readText(path);
  if (raw === null) return { exists: false, value: null, raw: null, error: null };
  try {
    return { exists: true, value: JSON.parse(raw), raw, error: null };
  } catch (error) {
    return { exists: true, value: null, raw, error };
  }
}

export async function readJson(path) {
  const result = await readJsonFile(path);
  if (!result.exists) return null;
  if (result.error) throw new CorruptStateError(`invalid JSON in ${path}`, { detail: result.error.message });
  return result.value;
}

export async function removeFile(path) {
  try {
    await fsp.unlink(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function listDir(path, { withFileTypes = true } = {}) {
  try {
    return await fsp.readdir(path, { withFileTypes });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function listFiles(path, suffix = null) {
  const entries = await listDir(path);
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (suffix && !entry.name.endsWith(suffix)) continue;
    out.push(join(path, entry.name));
  }
  out.sort();
  return out;
}

// Resolve a path to a real location without requiring the leaf to exist.
// The deepest existing ancestor is realpathed, then the missing tail is
// appended. This makes the temp-directory guard resistant to symlinks.
export async function realpathDeep(path) {
  let current = resolve(path);
  const tail = [];
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      tail.push(basename(current));
      current = parent;
    }
  }
}

export function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function assertPathInside(root, path, { label = "path" } = {}) {
  const realRoot = await realpathDeep(root);
  const realPath = await realpathDeep(path);
  if (!isInside(realRoot, realPath)) {
    throw new IoError(`${label} escapes ${root}`, { detail: { path, root } });
  }
  return realPath;
}

export async function assertStateRootSafe(root, { allowTmp = false } = {}) {
  const resolved = resolve(root);
  const real = await realpathDeep(resolved);
  const fsRoot = resolve("/");
  const realTmp = await realpathDeep(tmpdir());
  if (resolved === fsRoot || real === fsRoot) {
    throw new IoError("state root cannot be the filesystem root", { detail: { root: resolved } });
  }
  if (isInside(realTmp, real)) {
    if (!allowTmp) {
      throw new IoError("state root cannot be inside the operating system temp directory", {
        detail: { root: resolved, temp: realTmp },
      });
    }
  }
  return resolved;
}

export function toPosixPath(path) {
  return path.split(sep).join("/");
}

export function relativePosix(root, path) {
  return toPosixPath(relative(root, path));
}

export async function directorySize(path) {
  const stat = await statSafe(path);
  return stat ? stat.size : 0;
}
