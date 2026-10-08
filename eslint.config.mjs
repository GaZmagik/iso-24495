// Lints the TypeScript in this repository against the Google TypeScript Style
// Guide. Only the gate needs this file and the packages it imports: no shipped
// command reads them, so a user who installs the plugin installs nothing.
//
// Google's own package for the guide is gts. It is not a dependency here,
// because it brings Prettier and would rewrite every string to single quotes.
// The first group below copies the rules gts 7.0.0 switches on, less the
// formatter. The second group holds the rules a hand-written test used to
// check by regular expression.
//
// scripts/tests/lint-rules.test.ts gives the linter one breach of each rule
// named here, and fails when a rule does not report or a rule here has no
// breach. Add a rule and its breach together.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// The README records two departures from the guide. Double quotes: the gts
// "quotes" rule is left out. Kebab-case file names: neither gts nor ESLint
// checks a file name, so there is nothing to switch off.

/** Each entry is one rule of the guide that only a syntax selector can state. */
const GUIDE_SYNTAX = [
  { selector: "ExportDefaultDeclaration", message: "guide: no default exports" },
  { selector: "PrivateIdentifier", message: "guide: no #private fields" },
];

export default defineConfig([
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Group 1: what gts 7.0.0 switches on, less "prettier/prettier" and
      // "quotes". The two whitespace rules are deprecated in ESLint itself.
      // Off, where gts has it on. It reports a control character in a pattern,
      // and the patterns here that hold one exist to find control characters:
      // they refuse them in JSON and strip them from text before it is printed.
      "no-control-regex": "off",
      "block-scoped-var": "error",
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      "eol-last": "error",
      "no-trailing-spaces": "error",
      "prefer-arrow-callback": "error",
      "no-restricted-properties": [
        "error",
        { object: "describe", property: "only" },
        { object: "it", property: "only" },
        { object: "test", property: "only" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      // gts sets this to a warning and allows a described directive. The
      // hand-written test banned all three directives, so this does too.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false },
      ],

      // Group 2: the rules of the hand-written test that group 1 and the
      // recommended sets do not already hold. Those sets supply three more:
      // no-explicit-any, no-namespace and triple-slash-reference. They are
      // named here so that a change to a recommended set cannot drop them.
      "one-var": ["error", "never"],
      "no-restricted-syntax": ["error", ...GUIDE_SYNTAX],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-namespace": "error",
      // The recommended set allows a "lib" reference and, where the module is
      // not also imported, a "types" one. The hand-written test allowed none.
      "@typescript-eslint/triple-slash-reference": [
        "error",
        { lib: "never", path: "never", types: "never" },
      ],
    },
  },
]);
