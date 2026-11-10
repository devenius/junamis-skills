// Transitional bridge between the converted core and the unconverted runtime.
//
// `src/orchestrator/cli.js` still imports `../guide.js` because the orchestrator
// area is JavaScript on this branch. The guide is TypeScript now, so this file
// re-exports the built module: PACKAGE_ROOT resolves to the same repository
// root from `dist/guide.js` as it did from `src/guide.js`.
//
// Delete this file at integration. Once the orchestrator area is converted, its
// `../guide.js` import resolves to `guide.ts`, and every bin runs from `dist/`.
// It exists only so the source-based runtime tests keep passing while the areas
// are converted one at a time.
export * from "../dist/guide.js";
