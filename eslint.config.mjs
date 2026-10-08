// Lints the TypeScript in this repository against the Google TypeScript Style
// Guide. Only the gate needs this file and the packages it imports: no shipped
// command reads them, so a user who installs the plugin installs nothing.
//
// Google's own package for the guide is gts. It is not a dependency here,
// because it brings Prettier and would rewrite every string to single quotes.
// ENFORCED_RULES below holds the rules gts 7.0.0 switches on, less the
// formatter, the rules a hand-written test used to check by regular
// expression, and the rules of the recommended sets that have found a fault
// here.
//
// scripts/tests/lint-rules.test.ts imports ENFORCED_RULES. It asks ESLint for
// the configuration that applies to each TypeScript file and requires every
// rule there to be an error. It also gives the linter one breach of each rule
// and requires an error for each. Add a rule and its breach together.
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

/**
 * The rules this project enforces: each is an error in every TypeScript file
 * the gate lints. The configuration below is built from this one value, and
 * the test reads the same value, so the two cannot part.
 */
export const ENFORCED_RULES = {
  // Group 1: what gts 7.0.0 switches on, less "prettier/prettier", "quotes"
  // and "no-control-regex". The two whitespace rules are deprecated in ESLint
  // itself.
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

  // Group 2: the other rules of the hand-written test.
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

  // Group 3: rules of the recommended sets that have found a fault in this
  // repository. They are named so that a change to a set cannot drop them.
  "no-useless-escape": "error",
  "no-irregular-whitespace": "error",
  "no-regex-spaces": "error",
  "preserve-caught-error": "error",
  "@typescript-eslint/no-unused-vars": "error",
};

export default defineConfig([
  // A comment in a file cannot change a rule or switch one off. Without this,
  // one comment weakens a rule for its file and nothing in this configuration
  // shows it. ESLint reports such a comment as a warning, and the gate fails
  // on a warning.
  { linterOptions: { noInlineConfig: true } },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Off, where gts has it on. It reports a control character in a pattern,
      // and the patterns here that hold one exist to find control characters:
      // they refuse them in JSON and strip them from text before it is printed.
      "no-control-regex": "off",
      ...ENFORCED_RULES,
    },
  },
]);
