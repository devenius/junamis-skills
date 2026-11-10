# TypeScript build and consumer contract

**Status:** normative for the TypeScript foundation
**Companions:** `tsconfig.json`, `tsconfig.build.json`, `tsconfig.types.json`, `src/types/README.md`

## 1. Source of truth

- TypeScript source lives in `src/**/*.ts`.
- `src/types/` is the single type contract. It is exported through
  `src/types/index.ts`.
- `src/index.ts` is the package entry. It re-exports the contract and nothing
  else on this branch.
- The JavaScript modules under `src/` are not converted yet. They remain the
  runtime on this branch. Converting them is a separate, later change.

## 2. Build outputs

`pnpm build` runs `tsc -p tsconfig.build.json` and writes to `dist/`:

| Output | Meaning |
|---|---|
| `dist/index.js` | runtime entry (re-exports the type barrel's runtime values) |
| `dist/index.d.ts` | public declaration entry |
| `dist/types/*.js` | runtime guards (`isRecord`, `isOneOf`, ...) |
| `dist/types/*.d.ts` | declarations for every contract file |
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

The bins (`bin/junamis-skills.js`, `scripts/orchestrator-state.mjs`,
`scripts/design-registry.mjs`, `scripts/reconcile.mjs`) are thin launchers that
still point at source modules because those modules are JavaScript. The
integration branch switches them to `dist/` and then drops `src` from `files`.

The dev checks (`scripts/check-*.mjs`, `scripts/check-yaml.js`,
`scripts/release-check.mjs`) are already launchers over `dist/scripts/*.js`, so
they need `pnpm build` (or a prior `pnpm test`) before they run. A check that
still needs an unconverted runtime module receives that module's functions from
its launcher — `groupLock`, `preparePinnedSource`, `getSkillTreeSha`, or the
OpenCode skills directory. The check treats what it receives as `unknown` and
narrows it with the guards in `src/types/`, so no second copy of the installer's
rules lives under `src/scripts/`.

## 6. Unknown input at boundaries

- External input is `unknown`: JSON files, YAML, argv, environment variables,
  journal lines, handoff blocks, and design frontmatter.
- Narrow it with `guards.ts` (`isRecord`, `isString`, `isStringArray`,
  `isOneOf`, `parseJsonUnknown`) or with a module's own validator.
- No `any`. A cast is allowed only after a guard has proved the shape, and it
  must be as narrow as possible.
- `assertNever` closes an exhaustive switch so a new union member is a compile
  error, not a silent fallthrough.

## 7. Branch and merge model

The conversion is split so every branch stays reviewable and green:

1. **Foundation** (this branch, `ts-foundation`): toolchain, shared types,
   build outputs, consumption rules. No JS module is converted.
2. **Area branches**: one per area (`orchestrator`, `design`, `reconcile`,
   installer/targets). Each converts its own modules to TypeScript, imports
   the shared contract from `src/types`, keeps the `.js` extension on relative
   imports, and leaves the tests and the bins working against source.
3. **Integration**: merges the area branches with **merge commits** (never
   squash or rebase, so every conversion commit is preserved), switches the
   bins to `dist/`, removes `src` from `files` and the public entry points, and
   updates this document.

Rules for every branch:

- Do not commit `dist/`, `node_modules/`, or worktree state.
- Do not convert a module outside the branch's area.
- Keep `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm run check:pack`,
  `pnpm run check:security`, `pnpm run check:yaml`, and `pnpm lint` green.
- Update `CHANGELOG.md` in the same change.
