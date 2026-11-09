// Strict frontmatter subset parser.
//
// Skills use a small YAML frontmatter block. The state engine needs exactly one
// field from it (`idempotent`), so this parser accepts plain `key: value` lines
// and nothing else. It never becomes a general YAML dependency.

import { readText } from "./fsx.js";

function scalar(raw) {
  let value = raw.trim();
  if (value.length === 0) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  return value;
}

export function parseFrontmatter(text) {
  if (typeof text !== "string") return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const data = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\s/.test(line)) continue; // nested values are not part of this subset
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (!field) continue;
    data[field[1]] = scalar(field[2]);
  }
  return data;
}

export async function readFrontmatterFile(path) {
  const text = await readText(path);
  if (text === null) return null;
  return parseFrontmatter(text);
}
