import { test } from "node:test";
import assert from "node:assert/strict";
import { paint, createColors, stripAnsi, colorsEnabled } from "../dist/color.js";

test("paint returns plain text when color is disabled", () => {
  assert.equal(paint(36, "hello", { enabled: false }), "hello");
});

test("paint wraps text in the ANSI code when color is enabled", () => {
  assert.equal(paint(36, "hello", { enabled: true }), "\u001b[36mhello\u001b[0m");
  assert.equal(paint(31, "boom", { enabled: true }), "\u001b[31mboom\u001b[0m");
});

test("createColors builds every colour and respects the enabled flag", () => {
  const off = createColors({ enabled: false });
  assert.equal(off.cyan("c"), "c");
  assert.equal(off.green("g"), "g");
  assert.equal(off.yellow("y"), "y");
  assert.equal(off.red("r"), "r");
  assert.equal(off.gray("d"), "d");
  assert.equal(off.bold("b"), "b");

  const on = createColors({ enabled: true });
  for (const key of ["cyan", "green", "yellow", "red", "gray", "bold"]) {
    const wrapped = on[key]("x");
    assert.notEqual(wrapped, "x", `${key} must wrap its text`);
    assert.equal(stripAnsi(wrapped), "x");
  }
});

test("stripAnsi removes every ANSI sequence", () => {
  assert.equal(stripAnsi("\u001b[36mcyan\u001b[0m and \u001b[1;32mbold green\u001b[0m"), "cyan and bold green");
  assert.equal(stripAnsi("plain"), "plain");
});

test("colorsEnabled disables color for NO_COLOR, TERM=dumb, and a non-TTY stream", () => {
  assert.equal(colorsEnabled({ NO_COLOR: "1" }, { isTTY: true }), false);
  assert.equal(colorsEnabled({ TERM: "dumb" }, { isTTY: true }), false);
  assert.equal(colorsEnabled({}, { isTTY: false }), false);
  assert.equal(colorsEnabled({}, {}), false);
});

test("colorsEnabled enables color for FORCE_COLOR=1 and a TTY", () => {
  assert.equal(colorsEnabled({ FORCE_COLOR: "1" }, { isTTY: false }), true);
  assert.equal(colorsEnabled({}, { isTTY: true }), true);
});

test("NO_COLOR wins over FORCE_COLOR", () => {
  assert.equal(colorsEnabled({ NO_COLOR: "1", FORCE_COLOR: "1" }, { isTTY: true }), false);
});
