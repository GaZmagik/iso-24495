// The types of eslint.config.mjs, for the test that imports it. The
// configuration is plain JavaScript, because ESLint loads it without a
// compiler, so the type check has nothing else to read its exports from.

/** How one rule is set: its severity alone, or its severity followed by its options. */
export type RuleSetting = string | number | readonly unknown[];

/**
 * The rules this project enforces, each keyed by its name. Every setting is
 * "error", or a list that opens with "error".
 */
export declare const ENFORCED_RULES: Readonly<Record<string, RuleSetting>>;

declare const configuration: readonly unknown[];
// ESLint requires the configuration as the default export.
export default configuration;
