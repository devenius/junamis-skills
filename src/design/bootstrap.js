// One-shot design registry bootstrap.
//
// Scans src/, bin/, and scripts/ and drafts one `other` surface per source
// file. It also writes the two canonical acceptance examples. Drafts are never
// promoted. Existing surfaces are never overwritten, so a rerun is safe.

import { join, relative } from "node:path";
import { exists, listDir, readText } from "../orchestrator/fsx.js";
import { atomicWriteJson, atomicWriteText } from "./atomic.js";
import { headCommit, renderDesignFile } from "./delta.js";
import { writeIndex } from "./index-gen.js";
import {
  computeDesignChecksum,
  surfacePath,
  validateDesignText,
} from "./schema.js";

const SOURCE_ROOTS = ["src", "bin", "scripts"];
const CODE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".swift",
]);

function today(now) {
  if (!now) return new Date().toISOString().slice(0, 10);
  const value = String(now).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--now must be a YYYY-MM-DD date");
  return value;
}

function isCodeFile(name) {
  const index = name.lastIndexOf(".");
  return index !== -1 && CODE_EXTENSIONS.has(name.slice(index).toLowerCase());
}

async function walk(root, current, out) {
  const entries = await listDir(current);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walk(root, path, out);
      continue;
    }
    if (entry.isFile() && isCodeFile(entry.name)) out.push(path);
  }
}

function slugFor(relativePath) {
  const withoutExtension = relativePath.replace(/\.[^.]+$/, "");
  return withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function surfaceText({ surfaceId, kind, app = null, owner, codePaths, body, date, commit }) {
  const frontmatter = {
    surface_id: surfaceId,
    ...(app ? { app } : {}),
    kind,
    status: "draft",
    version: "0.1.0",
    owner,
    code_paths: codePaths,
    depends_on: [],
    related_tasks: [],
    last_reviewed: date,
    design_checksum: computeDesignChecksum(body, kind),
    ...(commit ? { last_reviewed_commit: commit } : {}),
  };
  return renderDesignFile(frontmatter, body);
}

function otherBody(path, date) {
  return `## Intent

Draft surface for \`${path}\`. Bootstrap could observe only that this file exists
and that it is part of the source tree, so the intent is intentionally unstated.

## Current state

The file exists at \`${path}\`. Its behavior has not been reviewed and no
caller or data flow is documented yet.

## Known gaps

- Describe the intent and current behavior of \`${path}\`.
- Confirm this file belongs to exactly one surface and assign an owner.

## Change log

- ${date} · v0.1.0 · Created draft surface · bootstrap · library/document
`;
}

function homepageBody(date) {
  return `## Intent

The homepage is the default public landing surface. It introduces the product,
shows the primary call to action, and hands the visitor to the next useful
surface without requiring a sign-in.

## Current state

Nothing is implemented yet. This file is the intended contract for the
homepage: a component tree, one public route, the data it needs, and the
accessibility work that must ship with it. No code path is claimed until the
page exists.

## Known gaps

- Build the HomePage component tree and the public \`/\` route.
- Decide the hero headline and the primary call to action.
- Confirm which visitor data, if any, may be loaded on first paint.
- Run the accessibility checks before this surface becomes active.

## Structure

- HomePage
  - Header
    - Logo
    - Navigation
  - Hero
    - HeroHeadline
    - HeroSubhead
    - HeroCTA
  - FeatureGrid
    - FeatureCard ×3
  - Footer

## Routes

| path | component | auth | notes |
|------|-----------|------|-------|
| \`/\` | HomePage | public | default landing |

## State & data

| name | source | shape | notes |
|------|--------|-------|-------|
| \`viewer\` | api/get-user | \`{id, name, email}\` | optional; only when signed in |

## Props & events

| component | props | events |
|-----------|-------|--------|
| Hero | \`{headline, subhead, cta}\` | \`onCtaClick\` |
| FeatureGrid | \`{features}\` | none |

## Accessibility

The page needs one \`h1\`, keyboard-reachable navigation, and visible focus on
the primary call to action. Automated checks and a manual keyboard pass are
required before this surface becomes active.

## Change log

- ${date} · v0.1.0 · Created draft surface · bootstrap · library/document
`;
}

function getUserBody(date) {
  return `## Intent

Read one user by id for the profile and account surfaces. The endpoint returns
the public identity fields only; it never returns credentials or secrets.

## Current state

Nothing is implemented yet. This file is the intended contract for the
endpoint: method, path, auth, request, response, errors, and one example. No
code path is claimed until the route exists.

## Known gaps

- Implement \`GET /api/users/:id\` behind bearer auth and the 100/min limit.
- Decide whether a soft-deleted user is 404 or a distinct error code.
- Add the response contract test before this surface becomes active.

## Endpoint

- Method: \`GET\`
- Path: \`/api/users/:id\`
- Auth: \`bearer\`
- Rate limit: \`100/min\`

## Request

| field | in | type | required | notes |
|-------|----|------|----------|-------|
| \`id\` | path | \`string(uuid)\` | yes | user id |
| \`Authorization\` | header | \`string(bearer)\` | yes | access token |

## Response — 200

| field | type | nullable | notes |
|-------|------|----------|-------|
| \`id\` | \`string(uuid)\` | no | user id |
| \`email\` | \`string(email)\` | no | primary email |
| \`createdAt\` | \`string(iso8601)\` | no | account creation time |

## Errors

| status | code | meaning |
|--------|------|---------|
| 401 | \`unauthorized\` | missing or invalid token |
| 403 | \`forbidden\` | token is valid but may not read this user |
| 404 | \`user_not_found\` | id is valid but unknown |

## Examples

\`\`\`json
{ "id": "5b0f0f0e-0000-4000-8000-000000000001", "email": "a@b.c", "createdAt": "2026-11-10T10:00:00Z" }
\`\`\`

## Change log

- ${date} · v0.1.0 · Created draft surface · bootstrap · library/document
`;
}

async function writeSurface({ designRoot, surfaceId, text, created }) {
  const file = surfacePath(designRoot, surfaceId);
  if (await exists(file)) return false;
  const validated = validateDesignText(text, { file, designRoot, requireChecksum: true });
  if (!validated.ok) {
    throw new Error(`bootstrap produced an invalid ${surfaceId}: ${validated.errors.join("; ")}`);
  }
  await atomicWriteText(file, text);
  created.push(relative(designRoot, file));
  return true;
}

export async function bootstrapRegistry({ projectRoot, designRoot, now = null }) {
  const date = today(now);
  const commit = headCommit(projectRoot);
  const created = [];
  const skipped = [];

  for (const root of SOURCE_ROOTS) {
    const absolute = join(projectRoot, root);
    if (!(await exists(absolute))) continue;
    const files = [];
    await walk(projectRoot, absolute, files);
    files.sort();
    for (const file of files) {
      const relativePath = relative(projectRoot, file).split("\\").join("/");
      let slug = slugFor(relativePath);
      let surfaceId = `other/${slug}`;
      let suffix = 2;
      while (await exists(surfacePath(designRoot, surfaceId))) {
        const existing = await readText(surfacePath(designRoot, surfaceId));
        if (existing !== null) {
          // A previous bootstrap already owns this slug. Only skip when the
          // existing file claims this exact code path; otherwise disambiguate.
          if (existing.includes(`"${relativePath}"`)) break;
        }
        slug = `${slugFor(relativePath)}-${suffix}`;
        surfaceId = `other/${slug}`;
        suffix += 1;
      }
      if (await exists(surfacePath(designRoot, surfaceId))) {
        skipped.push(surfaceId);
        continue;
      }
      const text = surfaceText({
        surfaceId,
        kind: "other",
        owner: "library/document",
        codePaths: [relativePath],
        body: otherBody(relativePath, date),
        date,
        commit,
      });
      await writeSurface({ designRoot, surfaceId, text, created });
    }
  }

  const canonical = [
    { surfaceId: "web/homepage", app: "web", kind: "web", owner: "library/frontend", body: homepageBody(date) },
    { surfaceId: "api/get-user", app: null, kind: "api", owner: "library/develop", body: getUserBody(date) },
  ];
  for (const entry of canonical) {
    const text = surfaceText({
      surfaceId: entry.surfaceId,
      kind: entry.kind,
      app: entry.app,
      owner: entry.owner,
      codePaths: [],
      body: entry.body,
      date,
      commit,
    });
    await writeSurface({ designRoot, surfaceId: entry.surfaceId, text, created });
  }

  const registryPath = join(designRoot, "_registry.json");
  let registryCreated = false;
  if (!(await exists(registryPath))) {
    await atomicWriteJson(registryPath, { bootstrap_complete: false });
    registryCreated = true;
  }

  const index = await writeIndex({ designRoot });
  return {
    created,
    skipped,
    registryCreated,
    index: { path: index.path, generatedAt: index.generatedAt },
    date,
    commit,
  };
}
