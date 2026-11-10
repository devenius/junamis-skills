import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["bin/**/*.js", "src/**/*.js", "scripts/**/*.js", "scripts/**/*.mjs", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    // TypeScript is gated by `tsc`, not ESLint. Keep `eslint .` parsing the JS
    // that still ships on this branch.
    ignores: ["node_modules/**", "coverage/**", "dist/**", "src/**/*.ts", "test/types/**"],
  },
];