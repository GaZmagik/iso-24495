import { expect, test } from "bun:test";
import { renderInline } from "../../scripts/lib/inline-wording.ts";

test("rendered wording respects delimiter runs, literal escapes and code spans", () => {
  for (const [source, expected] of [
    ["Over_view_ foo_bar_baz", "Over_view_ foo_bar_baz"],
    ["_Overview_ **Summary** ***nested***", "Overview Summary nested"],
    ["*one **two** three*", "one two three"],
    ["a*b*c a**b**c", "abc abc"],
    ["* unmatched _markers", "* unmatched _markers"],
    ["\\*literal\\* \\_literal\\_ \\`tick\\`", "*literal* _literal_ `tick`"],
    ["`*literal* &amp; \\_`", "*literal* &amp; \\_"],
    ["`` `tick` ``", "`tick`"],
    ["`two\nlines` `  ` ` padding `", "two lines    padding"],
    ["[**Link**](#link) &amp; &#65; &#x41; &unknown; &#0;", "Link & A A &unknown; \ufffd"],
    ["**&ast;literal&ast;**", "*literal*"],
    ["foo**bar*baz", "foo**bar*baz"],
    ["*foo _bar* baz_", "foo _bar baz_"],
  ]) expect(renderInline(source), source).toBe(expected);
});
