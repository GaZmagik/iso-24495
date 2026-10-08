import { expect, test } from "bun:test";
import { emphasisMarkOffsets, renderInline, withoutEmphasis } from "../../scripts/lib/inline-wording.ts";

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

test("paired emphasis marks are removed and every other character stays", () => {
  const SLASH = String.fromCharCode(92);
  for (const [source, expected] of [
    ["in **order** to", "in order to"],
    ["in *order* to, in _order_ to, in __order__ to", "in order to, in order to, in order to"],
    ["sh*all* sh**all** _shall_ __shall__", "shall shall shall shall"],
    ["***nested*** and *one **two** three*", "nested and one two three"],
    // An underscore inside a word is not emphasis, so an identifier survives.
    ["snake_case_name and sh_all_ and a_b_", "snake_case_name and sh_all_ and a_b_"],
    ["2 * 3 * 4 and *unmatched", "2 * 3 * 4 and *unmatched"],
    ["foo**bar*baz", "foo**bar*baz"],
    ["*foo _bar* baz_", "foo _bar baz_"],
    // Escapes, code spans and character references are left exactly as written.
    [`${SLASH}*shall${SLASH}* and ${SLASH}_shall${SLASH}_`, `${SLASH}*shall${SLASH}* and ${SLASH}_shall${SLASH}_`],
    ["`in *order* to` and *out*", "`in *order* to` and out"],
    ["`` *a* ` *b* `` *c*", "`` *a* ` *b* `` c"],
    ["&amp; **x** &#42;y&#42;", "&amp; x &#42;y&#42;"],
    ["line *one\ntwo* and **three\nfour**", "line one\ntwo and three\nfour"],
    // Strikethrough is two tildes exactly, and the struck words stay.
    ["~~struck~~ in ~~order~~ to", "struck in order to"],
    ["~one~ and ~~~three~~~ and ~~ loose ~~ and ~~open", "~one~ and ~~~three~~~ and ~~ loose ~~ and ~~open"],
    ["**a ~~b** c~~ and ~~**shall**~~", "a ~~b c~~ and shall"],
    ["\u{1F600}*a*\u{1F600} \u00e9_b_\u00e9 \u3002*c*", "\u{1F600}a\u{1F600} \u00e9_b_\u00e9 \u3002c"],
    ["", ""],
  ]) expect(withoutEmphasis(source), source).toBe(expected);
});

test("the offsets name each removed mark, in order", () => {
  expect(emphasisMarkOffsets("a *b* **c**")).toEqual([2, 4, 6, 7, 9, 10]);
  expect(emphasisMarkOffsets("***a** b*")).toEqual([0, 1, 2, 4, 5, 8]);
  expect(emphasisMarkOffsets("no marks, snake_case and 2 * 3")).toEqual([]);
  expect(emphasisMarkOffsets("")).toEqual([]);
});

test("rendered wording keeps strikethrough marks, which are not CommonMark emphasis", () => {
  expect(renderInline("~~Overview~~ and *Summary*")).toBe("~~Overview~~ and Summary");
});
