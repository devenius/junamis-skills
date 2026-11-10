import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./design-helpers.js";

test("the orchestrator starts a project through the design registry", () => {
  const text = readFileSync(join(ROOT, "library", "agents", "orchestrator.md"), "utf8");
  assert.ok(text.includes("## Project start (design registry)"), "missing Project start section");
  assert.ok(text.includes("junamis-design-registry bootstrap"), "missing bootstrap command");
  assert.ok(text.includes("design_context"), "missing design_context");
  assert.ok(text.includes("load --project <project> --code-path"), "missing code-path load");
  assert.ok(
    text.indexOf("## Project start (design registry)") < text.indexOf("## Understand the request first"),
    "Project start must come before Understand the request first",
  );
});
