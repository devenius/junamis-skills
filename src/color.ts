// A tiny, dependency-free ANSI color helper.
//
// Nothing here decides policy about when color is safe except `colorsEnabled`,
// which follows the NO_COLOR convention, TERM=dumb, and TTY detection. Callers
// build one palette per run and pass `{ enabled }` down, so output stays plain
// in tests and in a pipe.

const ANSI = {
  cyan: 36,
  green: 32,
  yellow: 33,
  red: 31,
  gray: 90,
  bold: 1,
} as const;

export type AnsiCode = (typeof ANSI)[keyof typeof ANSI];

export interface ColorOptions {
  readonly enabled: boolean;
}

/** Wrap `text` in an ANSI SGR code, or return it unchanged when disabled. */
export function paint(code: AnsiCode | number, text: string, options: ColorOptions): string {
  if (!options.enabled) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

export interface Colors {
  readonly cyan: (text: string) => string;
  readonly green: (text: string) => string;
  readonly yellow: (text: string) => string;
  readonly red: (text: string) => string;
  readonly gray: (text: string) => string;
  readonly bold: (text: string) => string;
}

/** Build a palette bound to one enabled/disabled decision. */
export function createColors(options: ColorOptions): Colors {
  const colorize = (code: AnsiCode) => (text: string): string => paint(code, text, options);
  return {
    cyan: colorize(ANSI.cyan),
    green: colorize(ANSI.green),
    yellow: colorize(ANSI.yellow),
    red: colorize(ANSI.red),
    gray: colorize(ANSI.gray),
    bold: colorize(ANSI.bold),
  };
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** Remove every ANSI SGR sequence from `text`. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** True when a stream looks like an interactive terminal. */
export interface TtyStream {
  readonly isTTY?: boolean | undefined;
}

/**
 * Decide whether colored output is appropriate.
 *
 * NO_COLOR (any non-empty value) and TERM=dumb force color off. FORCE_COLOR=1
 * forces it on. Otherwise color follows whether the stream is a TTY, so a
 * captured pipe stays plain by default.
 */
export function colorsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
  stream: TtyStream = process.stdout,
): boolean {
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") return false;
  if (env["TERM"] === "dumb") return false;
  if (env["FORCE_COLOR"] === "1") return true;
  return stream.isTTY === true;
}
