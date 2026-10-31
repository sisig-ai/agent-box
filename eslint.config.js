// Flat ESLint config for the vanilla ES-module frontend and node tests.
export default [
  {
    files: ["static/js/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { window: "readonly", document: "readonly", navigator: "readonly", fetch: "readonly", localStorage: "readonly", WebSocket: "readonly", console: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", location: "readonly", addEventListener: "readonly" },
    },
    rules: { "no-unused-vars": "warn", "no-undef": "error" },
  },
];
