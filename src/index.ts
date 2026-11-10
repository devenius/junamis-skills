// Public entry point for the package's type contract.
//
// The runtime modules under `src/` are still JavaScript on this branch. This
// file exists so the build emits a stable `dist/index.js` + `dist/index.d.ts`
// pair that consumers can import while the conversion lands.

export * from "./types/index.js";
