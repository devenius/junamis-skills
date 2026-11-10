// Strict, dependency-free YAML subset for design files and deltas.
//
// Supported: nested maps, block sequences, scalars, quoted strings, and the
// literal block scalar (`|`, `|-`, `|+`). Rejected: multiple documents,
// anchors, aliases, tags, flow collections, folded scalars, tabs, and odd
// indentation. This is deliberately smaller than YAML so a malformed file
// fails closed instead of being half-understood.

import { DesignError } from "./errors.js";
import { isRecord } from "../types/guards.js";

function fail(message: string, detail: unknown = null): never {
  throw new DesignError(message, { code: "invalid_yaml", detail });
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isIgnorable(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

export function parseScalar(raw: string, label = "value"): unknown {
  let value = raw.trim();
  if (value.length === 0) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    if (value.length < 2) fail(`${label} has an unterminated quoted scalar`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"') || value.startsWith("'")) {
    fail(`${label} has an unterminated quoted scalar`);
  }
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value.startsWith("&") || value.startsWith("*") || value.startsWith("!")) {
    fail(`${label} uses an unsupported YAML anchor, alias, or tag`);
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    fail(`${label} uses an unsupported flow collection`);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  // A YAML comment starts after whitespace. Content hashes and URLs are safe.
  value = value.replace(/\s+#.*$/, "").trimEnd();
  return value;
}

interface ParseState {
  readonly lines: readonly string[];
  index: number;
  readonly label: string;
}

interface Peeked {
  readonly line: string;
  readonly indent: number;
  readonly index: number;
}

function peekContent(state: ParseState): Peeked | null {
  while (state.index < state.lines.length) {
    const line = state.lines[state.index] ?? "";
    if (isIgnorable(line)) {
      state.index += 1;
      continue;
    }
    return { line, indent: indentOf(line), index: state.index };
  }
  return null;
}

function parseBlockScalar(state: ParseState, keyIndent: number, style: string): string {
  const collected: string[] = [];
  while (state.index < state.lines.length) {
    const line = state.lines[state.index] ?? "";
    if (line.trim() === "") {
      collected.push("");
      state.index += 1;
      continue;
    }
    if (indentOf(line) <= keyIndent) break;
    collected.push(line);
    state.index += 1;
  }
  const nonEmpty = collected.filter((line) => line.trim() !== "");
  const contentIndent = nonEmpty.length === 0
    ? keyIndent + 2
    : Math.min(...nonEmpty.map((line) => indentOf(line)));
  let content = collected
    .map((line) => (line.trim() === "" ? "" : line.slice(contentIndent)))
    .join("\n");
  if (style === "|-") {
    content = content.replace(/\n+$/, "");
  } else if (style === "|+") {
    // Keep the text exactly as written; the join already preserved newlines.
  } else {
    content = content.replace(/\n+$/, "");
    if (content.length > 0) content += "\n";
  }
  return content;
}

function parseMapping(state: ParseState, indent: number): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (;;) {
    const peeked = peekContent(state);
    if (!peeked) break;
    if (peeked.indent < indent) break;
    if (peeked.indent > indent) fail(`${state.label} has an unexpected indent on line ${peeked.index + 1}`);
    const trimmed = peeked.line.trim();
    if (trimmed.startsWith("- ")) fail(`${state.label} mixes a sequence and a mapping on line ${peeked.index + 1}`);
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(trimmed);
    if (!match) fail(`${state.label} line ${peeked.index + 1} is not a key: value line`);
    const key = match[1] ?? "";
    if (Object.prototype.hasOwnProperty.call(object, key)) fail(`${state.label} repeats key ${key}`);
    const rest = (match[2] ?? "").trim();
    state.index += 1;

    if (rest.length === 0) {
      const next = peekContent(state);
      if (!next || next.indent <= indent) {
        object[key] = null;
      } else {
        object[key] = parseBlock(state, next.indent);
      }
      continue;
    }
    if (rest === "|" || rest === "|-" || rest === "|+") {
      object[key] = parseBlockScalar(state, indent, rest);
      continue;
    }
    if (rest.startsWith(">")) fail(`${state.label} uses an unsupported folded block scalar for ${key}`);
    object[key] = parseScalar(rest, `${state.label}.${key}`);
  }
  return object;
}

function parseSequence(state: ParseState, indent: number): unknown[] {
  const items: unknown[] = [];
  for (;;) {
    const peeked = peekContent(state);
    if (!peeked) break;
    if (peeked.indent < indent) break;
    if (peeked.indent > indent) fail(`${state.label} has an unexpected indent on line ${peeked.index + 1}`);
    const trimmed = peeked.line.trim();
    if (!trimmed.startsWith("-")) break;
    if (trimmed !== "-" && !trimmed.startsWith("- ")) fail(`${state.label} has an invalid sequence item`);
    const rest = trimmed === "-" ? "" : trimmed.slice(2).trim();
    state.index += 1;

    if (rest.length === 0) {
      const next = peekContent(state);
      if (!next || next.indent <= indent) {
        items.push(null);
      } else {
        items.push(parseBlock(state, next.indent));
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]+:/.test(rest)) {
      const itemIndent = indent + 2;
      const itemLines: string[] = [`${" ".repeat(itemIndent)}${rest}`];
      while (state.index < state.lines.length) {
        const line = state.lines[state.index] ?? "";
        if (line.trim() === "") {
          itemLines.push(line);
          state.index += 1;
          continue;
        }
        if (indentOf(line) <= indent) break;
        itemLines.push(line);
        state.index += 1;
      }
      const sub: ParseState = { lines: itemLines, index: 0, label: state.label };
      const value = parseMapping(sub, itemIndent);
      const trailing = peekContent(sub);
      if (trailing) fail(`${state.label} has trailing content in a sequence item`);
      items.push(value);
      continue;
    }

    items.push(parseScalar(rest, `${state.label} item`));
    const next = peekContent(state);
    if (next && next.indent > indent) {
      fail(`${state.label} has a nested value under a scalar sequence item`);
    }
  }
  return items;
}

function parseBlock(state: ParseState, indent: number): unknown {
  const peeked = peekContent(state);
  if (!peeked) return null;
  if (peeked.indent < indent) return null;
  if (peeked.indent > indent) fail(`${state.label} has an unexpected indent on line ${peeked.index + 1}`);
  const trimmed = peeked.line.trim();
  if (trimmed === "-" || trimmed.startsWith("- ")) return parseSequence(state, indent);
  return parseMapping(state, indent);
}

export interface YamlOptions {
  readonly label?: string;
}

export function parseYaml(text: unknown, { label = "yaml" }: YamlOptions = {}): unknown {
  if (typeof text !== "string") fail(`${label} is not text`);
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const raw = cleaned.split("\n");
  let start = 0;
  while (start < raw.length && isIgnorable(raw[start] ?? "")) start += 1;
  if (start < raw.length && (raw[start] ?? "").trim() === "---") start += 1;

  const lines: string[] = [];
  for (let i = start; i < raw.length; i++) {
    const line = raw[i] ?? "";
    if (line.includes("\t")) fail(`${label} contains a tab on line ${i + 1}`);
    const trimmed = line.trim();
    if (trimmed === "---" || trimmed === "...") {
      fail(`${label} contains multiple YAML documents or an unexpected document marker`);
    }
    if (line.trim().length > 0 && indentOf(line) % 2 !== 0) {
      fail(`${label} indentation must be a multiple of two spaces on line ${i + 1}`);
    }
    lines.push(line);
  }
  if (lines.every((line) => isIgnorable(line))) return null;

  const state: ParseState = { lines, index: 0, label };
  const value = parseBlock(state, 0);
  const trailing = peekContent(state);
  if (trailing) fail(`${label} has trailing content on line ${trailing.index + 1}`);
  return value;
}

/** A parsed design document: validated mapping plus the body after it. */
export interface ParsedDocument {
  readonly data: Record<string, unknown>;
  readonly body: string;
}

export function parseFrontmatterDocument(text: unknown, { label = "design file" }: YamlOptions = {}): ParsedDocument {
  if (typeof text !== "string") fail(`${label} is not text`);
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = cleaned.split("\n");
  if (lines[0] !== "---") fail(`${label} must start with ---`);
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) fail(`${label} has no closing ---`);
  const frontText = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");
  if (body.startsWith("---\n") || body === "---") {
    fail(`${label} contains multiple YAML documents`);
  }
  const data = parseYaml(frontText, { label: `${label} frontmatter` });
  if (!isRecord(data)) {
    fail(`${label} frontmatter must be a mapping`);
  }
  return { data, body };
}
