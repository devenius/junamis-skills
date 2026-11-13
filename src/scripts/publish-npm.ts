// A read-only publish checklist for `@devenius/junamis-skills`.
//
// This never runs a registry mutation. It validates the package metadata,
// prints the exact `npm stage publish` command a maintainer runs, and exits.
// Publishing itself happens in CI (`.github/workflows/publish.yml`) or by the
// user; the agent never runs the command.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createColors, colorsEnabled } from "../color.js";
import { isRecord, isString, parseJsonUnknown } from "../types/index.js";
import { packageRoot } from "./support.js";

const PACKAGE_NAME = "@devenius/junamis-skills";
const NPM_REGISTRY = "https://registry.npmjs.org";

function readTag(argv: readonly string[]): string {
  const index = argv.indexOf("--tag");
  if (index < 0) return "latest";
  const value = argv[index + 1];
  return value !== undefined && !value.startsWith("-") ? value : "latest";
}

function stagingCommand(tag: string): string {
  return `npm stage publish --access public --tag ${tag} --registry=${NPM_REGISTRY}`;
}

/** CLI entry. The launcher calls this with `process.argv.slice(2)`. */
export async function run(argv: readonly string[]): Promise<void> {
  const c = createColors({ enabled: colorsEnabled() });
  const tag = readTag(argv);

  const parsed = parseJsonUnknown(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (!parsed.ok || !isRecord(parsed.value)) {
    console.error(c.red(`✖ cannot read package.json: ${parsed.ok ? "expected an object" : parsed.error.message}`));
    process.exitCode = 1;
    return;
  }
  const pkg = parsed.value;
  const name = pkg["name"];
  const version = pkg["version"];
  const publishConfig = pkg["publishConfig"];

  const displayName = isString(name) ? name : "<missing name>";
  const displayVersion = isString(version) ? version : "<missing version>";
  console.log(c.cyan(`▸ publish ${displayName}@${displayVersion}`));

  const problems: string[] = [];
  if (name !== PACKAGE_NAME) {
    problems.push(`name is ${JSON.stringify(name)}; expected ${JSON.stringify(PACKAGE_NAME)}`);
  }
  if (!isRecord(publishConfig)) {
    problems.push("publishConfig is missing");
  } else {
    if (publishConfig["access"] !== "public") {
      problems.push(`publishConfig.access is ${JSON.stringify(publishConfig["access"])}; expected "public"`);
    }
    if (publishConfig["registry"] !== undefined) {
      problems.push("publishConfig.registry must be absent; npmjs is selected by the command's --registry flag");
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(c.red(`✖ ${problem}`));
    process.exitCode = 1;
    return;
  }

  console.log(c.green("✔ package metadata ok"));
  console.log(`${c.gray("·")} registry: ${c.gray(NPM_REGISTRY)}`);
  console.log(c.yellow(`! next: ${stagingCommand(tag)}`));
  console.log(
    c.gray(
      "· you run this command; the agent never does. Staged versions are approved on npmjs.com with 2FA.",
    ),
  );
}
