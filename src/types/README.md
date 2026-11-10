# `src/types/`

The single type contract for the package. Every runtime module and every
consumer reads these shapes; no module defines a second copy.

## Rules

- `interface` for object shapes, `type` for unions and aliases.
- Snapshot fields are `readonly`. A snapshot is read, never mutated in place.
- No `any`. External input is `unknown` and is narrowed by `guards.ts` or by a
  module's own validator before it becomes one of these types.
- Imports use the `.js` extension (`./common.js`) because the package is ESM
  with `module: "NodeNext"`. TypeScript resolves that to `common.ts`.
- The barrel `index.ts` is the only import surface. Add a file here and export
  it from the barrel in the same change.

## Files

| File | Contract |
|---|---|
| `common.ts` | JSON, `Result`, severity, priority, lifecycle, `ErrorLike` |
| `handoff.ts` | `library/HANDOFF.md` block |
| `orchestrator.ts` | journal, derived state, boot result, command result, context |
| `design.ts` | `docs/design/_schema.md` surface, delta, fingerprint |
| `reconcile.ts` | `docs/RECONCILE.md` candidate, queue, detector manifest |
| `guards.ts` | runtime boundary helpers (`isRecord`, `isOneOf`, ...) |

## Where the types go

`pnpm build` emits JavaScript and declarations to `dist/`. The public entry is
`src/index.ts` → `dist/index.js` and `dist/index.d.ts`. `src/types/*` is
mirrored at `dist/types/*`. Consumers never import from `src/`.
