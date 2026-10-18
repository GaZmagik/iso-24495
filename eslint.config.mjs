// Lints the TypeScript in this repository against the Google TypeScript Style
// Guide. Only the gate needs this file and the packages it imports: no shipped
// command reads them, so a user who installs the plugin installs nothing.
//
// Google's own package for the guide is gts. It is not a dependency here,
// because it brings Prettier and would rewrite every string to single quotes.
// ENFORCED_RULES below holds the rules gts 7.0.0 switches on, less the
// formatter, the rules a hand-written test used to check by regular
// expression, the rules of the recommended sets that have found a fault
// here, and the further rules of the guide that a linter can state.
//
// scripts/tests/lint-rules.test.ts imports ENFORCED_RULES and GUIDE_SYNTAX. It
// asks ESLint for the configuration that applies to each TypeScript file and
// requires every rule there to be an error. It also gives the linter one
// breach of each rule, and of each syntax selector, and requires an error for
// each. Add a rule and its breach together.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// The README records two departures from the guide. Double quotes: the gts
// "quotes" rule is left out. Kebab-case file names: neither gts nor ESLint
// checks a file name, so there is nothing to switch off.

// A backslash that is not itself escaped, then the numeric escape of a
// character that has a letter escape: \b \t \n \v \f \r, a quotation mark,
// an apostrophe or a backslash.
const NUMERIC_SPECIAL_ESCAPE = String.raw`/(^|[^\\])(\\\\)*\\(x(0[89a-d]|2[27]|5c)|u(000[89a-d]|002[27]|005c)|u\{0*([89a-d]|2[27]|5c)\})/i`;

/**
 * Each entry is one rule that only a syntax selector can state. The message
 * names the rule, and the lint test tells the entries apart by it, so each
 * message is different.
 */
export const GUIDE_SYNTAX = [
  { selector: "ExportDefaultDeclaration", message: "guide: no default exports" },
  { selector: "PrivateIdentifier", message: "guide: no #private fields" },
  { selector: "ExportNamedDeclaration > VariableDeclaration[kind='let']", message: "guide: no mutable exports" },
  { selector: "TSEnumDeclaration[const=true]", message: "guide: no const enum" },
  {
    // A method, a getter and a setter hold a function expression too, and the
    // guide allows a generator, which has no arrow form.
    selector: ":not(MethodDefinition, TSAbstractMethodDefinition, Property[method=true], Property[kind='get'], Property[kind='set']) > FunctionExpression[generator=false]",
    message: "guide: no function expressions",
  },
  {
    // The guide allows an arrow where its type needs stating.
    selector: ":matches(Program, ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator:not([id.typeAnnotation]) > ArrowFunctionExpression.init",
    message: "guide: a named top-level function is a declaration",
  },
  {
    // The guide allows parseInt for another base, once the digits are checked.
    selector: "CallExpression:matches([callee.name=/^parse(Int|Float)$/], [callee.property.name=/^parse(Int|Float)$/]):not(:matches([callee.name='parseInt'], [callee.property.name='parseInt'])[arguments.1.type='Literal']:not([arguments.1.value=10]))",
    message: "guide: parse a number with Number()",
  },
  {
    selector: "CallExpression[callee.type='Identifier'][callee.name=/^(Aggregate|Eval|Range|Reference|Syntax|Type|URI)?Error$/]",
    message: "guide: create an error with new",
  },
  {
    // A legacy octal number, or a leading zero, does not parse in a module.
    selector: "Literal[raw=/^0[XOB]/]",
    message: "guide: a number literal has a lowercase prefix",
  },
  {
    selector: `:matches(Literal[raw=/^["']/][raw=${NUMERIC_SPECIAL_ESCAPE}], TemplateElement[value.raw=${NUMERIC_SPECIAL_ESCAPE}])`,
    message: "guide: a special escape is written as its letter",
  },
  {
    selector: "CallExpression[callee.object.name='Object'][callee.property.name=/^definePropert(y|ies)$/] Property[key.name=/^(get|set)$/]",
    message: "guide: no accessors through Object.defineProperty",
  },
  {
    selector: ":matches(MethodDefinition[static=true], PropertyDefinition[static=true], StaticBlock) ThisExpression",
    message: "guide: no this in a static context",
  },
  {
    selector: ":matches(MethodDefinition, PropertyDefinition)[computed=true]:not([key.object.name='Symbol']), :matches(MethodDefinition, PropertyDefinition)[key.type='Literal']",
    message: "guide: a class member is named, or keyed by a symbol",
  },
  {
    selector: [
      ":function > ObjectPattern > Property > :matches(ObjectPattern, ArrayPattern, AssignmentPattern[left.type=/Pattern$/])",
      ":function > AssignmentPattern > ObjectPattern > Property > :matches(ObjectPattern, ArrayPattern, AssignmentPattern[left.type=/Pattern$/])",
      ":function > ObjectPattern > Property[computed=true]",
      ":function > AssignmentPattern > ObjectPattern > Property[computed=true]",
    ].join(", "),
    message: "guide: a destructured parameter is one level deep",
  },
  {
    selector: [
      ":function > AssignmentPattern[left.type='ObjectPattern']:not([right.type='ObjectExpression'][right.properties.length=0])",
      ":function > AssignmentPattern[left.type='ArrayPattern']:not([right.type='ArrayExpression'][right.elements.length=0])",
    ].join(", "),
    message: "guide: an optional destructured parameter defaults to an empty literal",
  },
  {
    selector: "TSTypeAliasDeclaration > TSUnionType > :matches(TSNullKeyword, TSUndefinedKeyword)",
    message: "guide: a type alias holds no null or undefined",
  },
  {
    selector: "TSAsExpression > TSAsExpression.expression:not([typeAnnotation.type='TSUnknownKeyword'])",
    message: "guide: a double assertion goes through unknown",
  },
  {
    // The guide lets a one-line if statement go without braces, and nothing else.
    selector: ":matches(ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement) > :not(BlockStatement).body",
    message: "guide: a loop body is a braced block",
  },
  {
    selector: "IfStatement > :not(BlockStatement, IfStatement).alternate",
    message: "guide: an else body is a braced block",
  },
  {
    // Not a rule of the guide. With noUncheckedIndexedAccess on, an indexed
    // read may be undefined, and a cast there tells the compiler it is not.
    selector: "TSAsExpression > MemberExpression.expression[computed=true], TSAsExpression > ChainExpression.expression > MemberExpression.expression[computed=true]",
    message: "no cast on an indexed read",
  },
];

/** Every name selector forbids a leading or trailing underscore, as the guide does. */
const NO_UNDERSCORE = { leadingUnderscore: "forbid", trailingUnderscore: "forbid" };

/**
 * The guide's names: lowerCamelCase by default, UpperCamelCase for types and
 * CONSTANT_CASE for module constants and enum values. Each treats an acronym
 * as a word, as in loadHttpUrl.
 */
const GUIDE_NAMES = [
  { selector: "default", format: ["strictCamelCase"], ...NO_UNDERSCORE },
  { selector: "variable", modifiers: ["const", "global"], format: ["strictCamelCase", "UPPER_CASE"], ...NO_UNDERSCORE },
  { selector: "classProperty", modifiers: ["static", "readonly"], format: ["strictCamelCase", "UPPER_CASE"], ...NO_UNDERSCORE },
  // The guide keeps a platform's own name: Node calls a terminal a TTY.
  { selector: "parameter", filter: { regex: "TTY", match: true }, format: ["camelCase"], ...NO_UNDERSCORE },
  { selector: "typeLike", format: ["StrictPascalCase"], ...NO_UNDERSCORE },
  { selector: "interface", format: ["StrictPascalCase"], custom: { regex: "^I[A-Z]", match: false }, ...NO_UNDERSCORE },
  { selector: "enumMember", format: ["UPPER_CASE"], ...NO_UNDERSCORE },
  { selector: "import", format: ["strictCamelCase", "StrictPascalCase"], ...NO_UNDERSCORE },
  // A property's name is often set by a format outside this code: an
  // environment variable, a field of GitHub's JSON, a file name.
  { selector: ["objectLiteralProperty", "objectLiteralMethod", "typeProperty", "typeMethod"], format: null, ...NO_UNDERSCORE },
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
  // The guide allows no white space but the plain space anywhere in a file,
  // strings and comments included.
  "no-irregular-whitespace": [
    "error",
    { skipStrings: false, skipComments: false, skipRegExps: false, skipTemplates: false, skipJSXText: false },
  ],
  "no-regex-spaces": "error",
  "preserve-caught-error": "error",
  "@typescript-eslint/no-unused-vars": "error",

  // Group 4: the further rules of the guide that a linter can state, each
  // under the guide's own heading. Some are in a recommended set already, and
  // are named for the same reason as group 3. A rule of the guide that no
  // tool here states is left to review of the diff.
  // Source file basics.
  "no-tabs": "error",
  // Naming.
  "@typescript-eslint/naming-convention": ["error", ...GUIDE_NAMES],
  "id-match": ["error", "^[A-Za-z0-9_$]+$", { properties: true, classFields: true, onlyDeclarations: false, ignoreDestructuring: false }],
  // Classes.
  "new-parens": "error",
  "no-extra-semi": "error",
  "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "no-public" }],
  "@typescript-eslint/prefer-readonly": "error",
  "@typescript-eslint/no-extraneous-class": "error",
  "@typescript-eslint/no-useless-constructor": "error",
  "@typescript-eslint/no-this-alias": "error",
  // Functions.
  "prefer-rest-params": "error",
  "prefer-spread": "error",
  "@typescript-eslint/no-invalid-this": "error",
  // A variable or class is reported wherever it is read above its
  // declaration, a read from inside a function or a class member included,
  // by the owner's ruling. A function declaration is never reported, so the
  // front-loaded entry points stay legal.
  "@typescript-eslint/no-use-before-define": [
    "error",
    { functions: false, classes: true, variables: true, enums: false, typedefs: false, ignoreTypeReferences: true },
  ],
  // Arrays and objects.
  "@typescript-eslint/no-array-constructor": "error",
  "no-object-constructor": "error",
  "guard-for-in": "error",
  // Primitive literals and coercion. The guide allows !! and String().
  "no-multi-str": "error",
  "no-new-wrappers": "error",
  "no-implicit-coercion": ["error", { boolean: false, number: true, string: false, disallowTemplateShorthand: false }],
  // Control structures.
  "curly": ["error", "multi-line"],
  // The first statement of a block begins on its own line, and the closing
  // brace sits on the line of a following "else", "catch" or "finally".
  "brace-style": ["error", "1tbs", { allowSingleLine: false }],
  "no-cond-assign": "error",
  "default-case": "error",
  "default-case-last": "error",
  "no-fallthrough": "error",
  "no-extra-boolean-cast": "error",
  "@typescript-eslint/prefer-for-of": "error",
  // Exceptions.
  "no-empty": "error",
  "@typescript-eslint/only-throw-error": "error",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
  // Disallowed features.
  "semi": ["error", "always"],
  "no-debugger": "error",
  "no-eval": "error",
  "no-new-func": "error",
  "@typescript-eslint/no-implied-eval": "error",
  "no-extend-native": "error",
  // Imports and modules.
  "@typescript-eslint/no-require-imports": "error",
  // Type system.
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "never" }],
  "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
  "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
  // The guide names variables and parameters, not properties.
  "@typescript-eslint/no-inferrable-types": ["error", { ignoreParameters: false, ignoreProperties: true }],
  "@typescript-eslint/consistent-generic-constructors": ["error", "constructor"],
  "@typescript-eslint/no-wrapper-object-types": "error",
  "@typescript-eslint/no-empty-object-type": "error",
  // Not a rule of the guide, which asks for a reason beside each one. Here a
  // non-null assertion would only move a cast the rule above forbids.
  "@typescript-eslint/no-non-null-assertion": "error",
  // Comments.
  "multiline-comment-style": ["error", "separate-lines"],
};

export default defineConfig([
  // With this setting, a comment in a file cannot change a rule or switch one
  // off. A later block could set it back for some files, and no test here
  // would notice: that is an edit for review of the diff to catch. Without this,
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
