# TypeScript build and consumer contract

**Status:** normative
**Companions:** `tsconfig.json`, `tsconfig.build.json`, `tsconfig.types.json`, `src/types/README.md`

## 1. Source of truth

- All runtime code is TypeScript under `src/**/*.ts`.
- `src/types/` is the single type contract. It is exported through
  `src/types/index.ts`.
- `src/index.ts` is the package entry. It re-exports the contract and nothing
  else.
- `bin/junamis-skills.js` and the three `.mjs` launchers in `scripts/` are the
  only JavaScript that ships. They are thin, contain no logic, and import their
  implementation from `dist/`.

## 2. Build outputs

`pnpm build` runs `tsc -p tsconfig.build.json` and writes to `dist/`:

| Output | Meaning |
|---|---|
| `dist/index.js` | runtime entry (re-exports the type barrel's runtime values) |
| `dist/index.d.ts` | public declaration entry |
| `dist/types/*.js` | runtime guards (`isRecord`, `isOneOf`, ...) |
| `dist/types/*.d.ts` | declarations for every contract file |
| `dist/cli.js` | installer and `status` CLI |
| `dist/guide.js` | guide rendering and the shared `PACKAGE_ROOT` |
| `dist/orchestrator/*.js` | journal-first resume engine and its CLI |
| `dist/design/*.js` | design registry engine and its CLI |
| `dist/reconcile/*.js` | reconcile work queue and its CLI |
| `dist/scripts/*.js` | every dev check, run by a launcher in `scripts/` |
| `dist/**/*.js.map`, `*.d.ts.map` | source maps |

`dist/` is generated, gitignored, and never committed. It is built by
`prepack`, by `pnpm test`, and by `pnpm run check:pack`.

## 3. Compiler settings

Both configs share the strict settings in `tsconfig.json`:

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `useUnknownInCatchVariables`
- `isolatedModules`, `verbatimModuleSyntax`
- `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- `target: "ES2024"`, `lib: ["ES2024"]`, `types: ["node"]`

`tsconfig.json` type-checks only and emits nothing. `tsconfig.build.json` adds
`declaration`, `declarationMap`, `sourceMap`, `rootDir: "src"`, and
`outDir: "dist"`. `dist`, `node_modules`, and `.worktrees` are excluded.

## 4. Commands

| Command | Runs | Use |
|---|---|---|
| `pnpm build` | `tsc -p tsconfig.build.json` | emit `dist/` |
| `pnpm typecheck` | `tsc -p tsconfig.json && tsc -p tsconfig.types.json` | check source, then the consumer contract |
| `pnpm test` | `pnpm build && pnpm typecheck && node --test test/*.test.js` | full gate |
| `pnpm run check:pack` | `pnpm build && node scripts/check-pack.mjs` | prove the published set |

`pnpm typecheck` reads `dist/`, so run `pnpm build` first. `pnpm test` does both
in order.

## 5. Consumer contract

The package exposes:

```json
"main": "dist/index.js",
"types": "dist/index.d.ts",
"exports": {
  ".":      { "types": "./dist/index.d.ts",      "import": "./dist/index.js" },
  "./types":{ "types": "./dist/types/index.d.ts","import": "./dist/types/index.js" }
}
```

A consumer imports from the package root, or from the `./types` subpath. It
never imports from `src/`. `test/types/consumer.ts` imports only from
`dist/index.js` and is compiled by `tsconfig.types.json`; if the public shape
breaks, the build fails there before a consumer sees it.

`files` in `package.json` lists `dist` and never `src`. `check:pack` asserts the
built entry, declarations, every CLI, and the launchers are present, and refuses
any `src/` path in the packed set.

The bins (`bin/junamis-skills.js`, `scripts/orchestrator-state.mjs`,
`scripts/design-registry.mjs`, `scripts/reconcile.mjs`) are thin launchers over
`dist/`. `scripts/*.mjs` and `scripts/check-yaml.js` are the same: each imports
`dist/scripts/*.js` (and, where it needs the installer's rules, the built module
that owns them). They need `pnpm build` (or a prior `pnpm test`) before they run,
and CI builds before every check.

A check that needs an installer function receives it from its launcher —
`groupLock`, `preparePinnedSource`, `getSkillTreeSha`, or the OpenCode skills
directory. The check treats what it receives as `unknown` and narrows it with the
guards in `src/types/`, so no second copy of the installer's rules lives under
`src/scripts/`.

## 6. Unknown input at boundaries

- External input is `unknown`: JSON files, YAML, argv, environment variables,
  journal lines, handoff blocks, and design frontmatter.
- Narrow it with `guards.ts` (`isRecord`, `isString`, `isStringArray`,
  `isOneOf`, `parseJsonUnknown`) or with a module's own validator.
- No `any`. A cast is allowed only after a guard has proved the shape, and it
  must be as narrow as possible.
- `assertNever` closes an exhaustive switch so a new union member is a compile
  error, not a silent fallthrough.

## 7. Package and repository rules

- The package ships `dist/` only. `src/` stays in the repository and is the
  source of truth, but it is not published.
- The area branches (`ts-core`, `ts-runtime`, `ts-scripts`) are merged into
  `ts-integration` with **merge commits**, so every conversion commit is
  preserved.
- Do not commit `dist/`, `node_modules/`, or worktree state.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm run check:pack`,
  `pnpm run check:security`, `pnpm run check:yaml`, and `pnpm lint` must stay
  green.
- Update `CHANGELOG.md` in the same change.
