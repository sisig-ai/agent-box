// Flat ESLint config for the vanilla ES-module frontend and node tests.
const browserGlobals = {
  window: "readonly", document: "readonly", navigator: "readonly", location: "readonly",
  fetch: "readonly", localStorage: "readonly", WebSocket: "readonly", console: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  addEventListener: "readonly", removeEventListener: "readonly", crypto: "readonly",
  matchMedia: "readonly", getComputedStyle: "readonly", requestAnimationFrame: "readonly",
  confirm: "readonly", alert: "readonly",
  cancelAnimationFrame: "readonly", URL: "readonly", Blob: "readonly", Event: "readonly",
  CustomEvent: "readonly", FormData: "readonly", FileReader: "readonly", DOMParser: "readonly",
  history: "readonly", HTMLElement: "readonly", Element: "readonly", Node: "readonly",
  XMLHttpRequest: "readonly", URLSearchParams: "readonly", marked: "readonly",
  DOMPurify: "readonly", CodeMirror: "readonly",
};
export default [
  {
    files: ["static/js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: browserGlobals },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }], "no-undef": "error" },
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022, sourceType: "module",
      globals: { console: "readonly", URL: "readonly", process: "readonly" },
    },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }], "no-undef": "error" },
  },
];
