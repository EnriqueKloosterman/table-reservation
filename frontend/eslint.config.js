import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report", "src/api/schema.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "Nothing may be stored in the browser." },
        { name: "sessionStorage", message: "Nothing may be stored in the browser." },
        { name: "indexedDB", message: "Nothing may be stored in the browser." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "document", property: "cookie", message: "Nothing may be stored in the browser." },
        { object: "window", property: "localStorage", message: "Nothing may be stored in the browser." },
        { object: "window", property: "sessionStorage", message: "Nothing may be stored in the browser." },
        { object: "Date", property: "now", message: "Dates come from the server, not the visitor's clock." },
      ],
    },
  },
  {
    // Plain JavaScript tooling files are not part of the TypeScript project.
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Test and tooling files: type-aware strictness stays, but the ban on the
    // browser storage globals is lifted so tests can assert that nothing is stored.
    files: ["tests/**", "e2e/**", "scripts/**"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
      "no-console": "off",
    },
  },
);
