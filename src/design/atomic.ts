// Atomic writes for the design registry.
//
// The protocol is the state engine's, reused rather than reimplemented:
// temp file in the same directory, fsync, rename over the target, fsync the
// parent directory.

import { atomicWriteFile } from "../orchestrator/fsx.js";

export const DESIGN_FILE_MODE = 0o644;

export async function atomicWriteText(path: string, text: string): Promise<void> {
  await atomicWriteFile(path, text, { mode: DESIGN_FILE_MODE });
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}
