import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditCorpus,
  auditText,
  ENGINE_THRESHOLDS,
  acronymReading,
  linkSyntaxIn,
  projectAcronyms,
} from "../scripts/audit-corpus.ts";
import { withoutEmphasis } from "../scripts/lib/inline-wording.ts";
import { COMPLEX_WORDS } from "../scripts/lib/lexicon.ts";
import { REFERENCE_SHAPES } from "./fixtures/reference-blocks.ts";
import {
  classifyBoundary,
  frontMatterRange,
  headings,
  mergedSentences,
  proseBlocks,
  readDocument,
  readerProseBlocks,
  splitSentences,
  wordCount,
} from "../scripts/lib/parse.ts";

const BREAK = String.fromCharCode(10);
const KNOWN_GOOD = join(import.meta.dir, "fixtures", "known-good");
const DIFFICULT = join(import.meta.dir, "fixtures", "difficult");
const RULES = [
  "sentence-length",
  "sentence-average",
  "paragraph-length",
  "legalese",
  "heading-depth",
  "heading-skip",
  "heading-style",
  "acronym-undefined",
  "doublet",
  "prose-enumeration",
  "link-text",
  "image-alt",
  "wordy-phrase",
  "complex-word",
  "double-negative",
  "filler-opening",
  "table-header",
] as const;

function rulesFor(text: string): string[] {
  return auditText(text).map((violation) => violation.rule);
}

function sentenceOf(words: number, stem = "word"): string {
  return `${Array.from({ length: words }, (_, index) => `${stem}${index}`).join(" ")}.`;
}

/**
 * How long a hostile-input guard may take, well beyond what it needs.
 *
 * A timeout catches a genuine stall on the selected large inputs. It does not
 * establish the growth rate of any helper. The absolute budgets elsewhere in
 * this file bound selected single operations more tightly.
 */
const HOSTILE_TIMEOUT_MS = 60_000;

/**
 * How long one call takes, in milliseconds.
 *
 * This helper is used only by the single-operation budgets below. It is not a
 * growth-rate measure, because other audit work can mask one slow helper.
 */
function elapsed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

/** Deeply nested labels that never resolve. */
function deepLabelDocument(size: number): string {
  return `[a](x)${"[".repeat(size)}${"]".repeat(size)}`;
}

/** Sentences that each hold a nested link label. */
function nestedLinkDocument(size: number): string {
  return "Read [outer [inner] text](/uri) here. ".repeat(size);
}

/** Acronym candidates that are all discounted. */
function discountedAcronymDocument(size: number): string {
  return Array(size).fill("A.A.A. (").join(" ") + " and).";
}

/** Acronym definitions, one after another. */
function acronymDefinitionDocument(size: number): string {
  return Array(size).fill("Alpha Beta (AB)").join(" ") + ".";
}

/** The 31-word sentence the paragraph guard repeats. */
const LONG_SENTENCE = Array.from({ length: 31 }, (_, index) => `word${index}`).join(" ") + ".";

/** One paragraph of long sentences. */
function longParagraphDocument(size: number): string {
  return Array(size).fill(LONG_SENTENCE).join(" ");
}

describe("reader-facing behaviour contracts", () => {
  test("an acronym is defined only when its first use actually gives the meaning", () => {
    const laterDefinition = [
      "The EBITDA report is ready.",
      "",
      "This paragraph separates the first use from the definition.",
      "",
      "Earnings before interest, taxes, depreciation and amortisation (EBITDA) is the measure.",
    ].join(BREAK);
    expect(auditText(laterDefinition).filter((finding) => finding.rule === "acronym-undefined"))
      .toEqual([{
        rule: "acronym-undefined",
        line: 1,
        detail: 'define acronym "EBITDA" on first use',
      }]);
    expect(rulesFor("The EBITDA report (draft) is ready."))
      .toContain("acronym-undefined");
    expect(rulesFor("EBITDA (draft report) is ready."))
      .toContain("acronym-undefined");
    expect(rulesFor("EBITDA means (earnings before interest, taxes, depreciation and amortisation)."))
      .not.toContain("acronym-undefined");
    expect(rulesFor("The result changed because (EBITDA fell sharply)."))
      .toContain("acronym-undefined");
    expect(rulesFor("EBITDA rose. Earnings before interest, taxes, depreciation and amortisation (EBITDA) explains the change."))
      .toContain("acronym-undefined");
    expect(rulesFor("The appendix labels the measure (EBITDA). Later, EBITDA appears in the report."))
      .toContain("acronym-undefined");
    expect(rulesFor("EBITDA (earnings before interest, taxes, depreciation and amortisation) is useful."))
      .not.toContain("acronym-undefined");
  });

  test("reader-facing links and images are checked in every Markdown form", () => {
    const input = [
      "See [click here][refunds].",
      "",
      "![][diagram]",
      "",
      '<img src="chart.png">',
      "",
      "[refunds]: https://example.com/refunds",
      "[diagram]: diagram.png",
    ].join(BREAK);
    expect(auditText(input).filter((finding) =>
      finding.rule === "link-text" || finding.rule === "image-alt"))
      .toEqual([
        {
          rule: "link-text",
          line: 1,
          detail: 'link text "click here" describes no destination (refunds)',
        },
        {
          rule: "image-alt",
          line: 3,
          detail: "image has no alternative text (diagram)",
        },
        {
          rule: "image-alt",
          line: 5,
          detail: "image has no alternative text (chart.png)",
        },
      ]);
    expect(rulesFor("See [how to claim a refund][refunds].\n\n[refunds]: /refunds"))
      .not.toContain("link-text");
    expect(rulesFor("See [][refunds].\n\n[refunds]: /refunds"))
      .toContain("link-text");
    expect(rulesFor("See [click here][Refund   Policy].\n\n[refund policy]: /refunds"))
      .toContain("link-text");
    expect(rulesFor("See [click here].\n\n[click here]: /refunds"))
      .toContain("link-text");
    expect(rulesFor("See [the refund policy].\n\n[the refund policy]: /refunds"))
      .not.toContain("link-text");
    expect(rulesFor("See [**click here**](https://example.com/refunds)."))
      .toContain("link-text");
    expect(rulesFor("See [click here][missing]."))
      .not.toContain("link-text");
    expect(rulesFor("![Order flow][diagram]\n\n[diagram]: diagram.png"))
      .not.toContain("image-alt");
    expect(rulesFor("![][missing]"))
      .not.toContain("image-alt");
    expect(rulesFor('![](decorative-chart.png)'))
      .toContain("image-alt");
    expect(rulesFor('![](chart.png "not decorative")'))
      .toContain("image-alt");
    expect(rulesFor('![](chart.png "decorative")'))
      .not.toContain("image-alt");
    expect(rulesFor('<img src="chart.png" alt="Orders move from basket to payment">'))
      .not.toContain("image-alt");
    expect(rulesFor('<img title="Orders > returns" alt="Order flow" src="chart.png">'))
      .not.toContain("image-alt");
    expect(rulesFor('<a href="/refunds">click here</a>.'))
      .toContain("link-text");
    expect(rulesFor('<a\n href="/refunds">click here</a>.'))
      .toContain("link-text");
    expect(rulesFor('<a href="/refunds">click\nhere</a>.'))
      .toContain("link-text");
    expect(rulesFor('<a href="/refunds">click&nbsp;here</a>.'))
      .toContain("link-text");
    expect(rulesFor('<a href="/refunds"><span title="orders > returns">click here</span></a>.'))
      .toContain("link-text");
    expect(rulesFor('[click\nhere](/refunds)'))
      .toContain("link-text");
    expect(rulesFor('[refund\nguide](/refunds)'))
      .not.toContain("link-text");
    expect(rulesFor('<img\n src="chart.png">'))
      .toContain("image-alt");
    expect(rulesFor('<a href="/refunds">\n\nclick here</a>.'))
      .not.toContain("link-text");
    expect(rulesFor('<img\n\nsrc="chart.png">'))
      .not.toContain("image-alt");
    expect(rulesFor('Before. <!-- <img src="hidden.png"> --> After.'))
      .not.toContain("image-alt");
  });

  test("table headers are checked through Markdown containers", () => {
    const quoted = [
      "> | Name | |",
      "> | --- | --- |",
      "> | Alice | Admin |",
    ].join(BREAK);
    const listed = [
      "- | Name | |",
      "  | --- | --- |",
      "  | Alice | Admin |",
    ].join(BREAK);
    for (const table of [quoted, listed]) {
      expect(auditText(table).filter((finding) => finding.rule === "table-header"))
        .toEqual([{
          rule: "table-header",
          line: 1,
          detail: "table header has an empty column name",
        }]);
    }
    expect(rulesFor("| ** ** | Role |\n| --- | --- |\n| Alice | Admin |"))
      .toContain("table-header");
  });

  test("advice points to the line where a long sentence begins", () => {
    const long = sentenceOf(31);
    const findings = auditText(`A short opening line.${BREAK}${long}`)
      .filter((finding) => finding.rule === "sentence-length");
    expect(findings).toEqual([{
      rule: "sentence-length",
      line: 2,
      detail: "31 words (limit 30)",
    }]);
  });

  test("literal answers and proper names do not receive stock phrase advice", () => {
    expect(rulesFor("Certainly not. The change is unsafe."))
      .not.toContain("filler-opening");
    expect(rulesFor("[Certainly](https://example.com), the answer is 42."))
      .toContain("filler-opening");
    expect(rulesFor("[Certainly], the answer is 42.\n\n[Certainly]: https://example.com"))
      .toContain("filler-opening");
    expect(rulesFor("The journal Each and Every Child published a study."))
      .not.toContain("doublet");
    expect(rulesFor("Check each and every record."))
      .toContain("doublet");
    expect(rulesFor("Each and Every Customer must sign."))
      .toContain("doublet");
    expect(rulesFor("Terms and Conditions apply."))
      .toContain("doublet");
    expect(rulesFor("The word 'shall' is not suitable here."))
      .not.toContain("legalese");
    expect(rulesFor("Read [the policy](https://example.com/shall) before replying."))
      .not.toContain("legalese");
    expect(rulesFor("Read [the policy][shall] before replying."))
      .toContain("legalese");

    // The rule name says which check fired; the detail says what to do about
    // it. A review changed that detail from a banned term to a recommended
    // one, and every check here passed, because none of them read it. A
    // finding that recommends what it means to forbid is worse than no
    // finding at all.
    const detail = auditText("The party shall comply.")
      .find((violation) => violation.rule === "legalese")?.detail ?? "";
    expect(detail, "a legalese finding must name the term as banned")
      .toBe('banned term "shall"');
  });

  // Every rewrite this engine suggests, in the words it suggests them.
  //
  // A review changed one suggestion so that "in the absence of" was said to
  // mean the same as "with", and every test passed. The rule name says which
  // check fired and the count says how often; only these say what to write
  // instead, which is the part a reader acts on. A wrong one is worse than a
  // missing one, because it is followed.
  test("the engine suggests the rewrites it is meant to suggest", () => {
    const wordy: Array<[string, string]> = [
    ["null and void", "void"],
    ["each and every", "each"],
    ["first and foremost", "first"],
    ["true and correct", "true"],
    ["full and complete", "complete"],
    ["revert back", "revert"],
    ["repeat again", "repeat"],
    ["free gift", "gift"],
    ["past history", "history"],
    ["future plans", "plans"],
    ["end result", "result"],
    ["unexpected surprise", "surprise"],
    ["advance planning", "planning"],
    ["close proximity", "close"],
    ["general consensus", "consensus"],
    ["in order to", "to"],
    ["due to the fact that", "because"],
    ["in the event that", "if"],
    ["at this point in time", "now"],
    ["at this moment in time", "now"],
    ["in the near future", "soon"],
    ["for the purpose of", "to"],
    ["with regard to", "about"],
    ["with reference to", "about"],
    ["in relation to", "about"],
    ["in the absence of", "without"],
    ["a large number of", "many"],
    ["a small number of", "a few"],
    ["the majority of", "most"],
    ["prior to", "before"],
    ["subsequent to", "after"],
    ["in spite of the fact that", "although"],
    ["notwithstanding the fact that", "although"],
    ["it is possible that", "may"],
    ["has the ability to", "can"],
    ["is able to", "can"],
    ["make a decision", "decide"],
    ["provide assistance", "help"],
    ["take into consideration", "consider"],
    ];
    const complexWords: Array<[string, string]> = [
    ["utilise", "use"],
    ["utilize", "use"],
    ["utilising", "using"],
    ["utilizing", "using"],
    ["commence", "start"],
    ["commences", "starts"],
    ["commenced", "started"],
    ["ascertain", "find"],
    ["facilitate", "help"],
    ["facilitates", "helps"],
    ["endeavour", "try"],
    ["endeavor", "try"],
    ["terminate", "end"],
    ["terminates", "ends"],
    ["aforementioned", "this"],
    ["notwithstanding", "despite"],
    ["henceforth", "now"],
    ["thereafter", "then"],
    ["whereby", "how"],
    ["herein", "here"],
    ["thereof", "its"],
    ["therein", "inside"],
    ["expedite", "hasten"],
    ["disseminate", "share"],
    ["remuneration", "pay"],
    ];

    // Matched on the replacement rather than on the rule or the sentence
    // around it. A phrase may be reported as a doublet rather than a wordy
    // phrase, and the two word their advice differently, but which rule fires
    // is not the part a reader acts on. The word to write instead is.
    for (const [phrase, lean] of wordy) {
      const advice = auditText(`We acted ${phrase} the report.`)
        .map((violation) => violation.detail)
        .filter((detail) => detail.includes(`"${phrase}"`));
      expect(advice.length, `"${phrase}" must be reported at all`).toBeGreaterThan(0);
      expect(advice.join(" "), `"${phrase}" must be offered "${lean}"`)
        .toContain(`"${lean}"`);
    }

    // Matched whole. A review changed "end" to "extend", and a check reading
    // for a substring accepted it, so the engine advised replacing "terminate"
    // with a word meaning its opposite.
    for (const [word, plain] of complexWords) {
      const detail = auditText(`We ${word} the report today.`)
        .find((violation) => violation.rule === "complex-word")?.detail ?? "";
      expect(detail, `"${word}" must be offered "${plain}" and nothing else`)
        .toBe(`"${word}" where "${plain}" would do`);
    }
  });

  test("a full stop inside emphasis or quotes still ends the sentence", () => {
    // `**Lead in.** Next sentence.` is the commonest heading-in-a-paragraph pattern in
    // this repository's own skills. The stop sits before the closing markers, not before
    // the space, so a naive boundary rule merges the pair and reports one long sentence.
    const cases = [
      "**Lead in here.** Then a following sentence.",
      "*Emphasised lead.* Then a following sentence.",
      '"A quoted sentence." Then a following sentence.',
      "(A parenthetical sentence.) Then a following sentence.",
    ];
    for (const text of cases) {
      expect(splitSentences(text), text).toHaveLength(2);
      expect(mergedSentences(text), text).toHaveLength(2);
    }

    // Two halves that are each short must not add up to one over-long sentence.
    const lead = "**A bold lead in sentence of exactly twelve words here now yes.**";
    const follow = `Then ${Array.from({ length: 21 }, (_, index) => `word${index}`).join(" ")}.`;
    expect(rulesFor(`${lead} ${follow}`).filter((rule) => rule === "sentence-length")).toHaveLength(0);
  });

  test("an unmatched backtick run keeps the sentence it follows", () => {
    // A run that never closes is literal text, not a code span, so it must not erase the
    // stop before it. Clearing the state on sight of a backtick merged two sentences.
    for (const run of [1, 2, 3, 7]) {
      const text = `Stop.${"`".repeat(run)} Next sentence.`;
      expect(splitSentences(text), text).toHaveLength(2);
      expect(mergedSentences(text), text).toHaveLength(2);
    }
    const left = `First ${Array(16).fill("alpha").join(" ")}`;
    const right = `Next ${Array(16).fill("beta").join(" ")}`;
    expect(auditText(`${left}.\` ${right}.`).filter((v) => v.rule === "sentence-length")).toHaveLength(0);
  });

  test("hostile input cannot stall or crash the audit itself", () => {
    // Testing the splitter alone proved the wrong thing: `auditText` rebuilt every
    // sentence as a regular expression to locate it, and threw on a large one.
    const markers = `.${")".repeat(200_000)} Next.`;
    const startedMarkers = performance.now();
    expect(() => auditText(markers)).not.toThrow();
    expect(performance.now() - startedMarkers).toBeLessThan(5_000);

    // Backtick runs were rescanned for every unmatched run, which was quadratic.
    const ticks = `x${"`".repeat(10_000)}y`;
    const startedTicks = performance.now();
    auditText(ticks);
    expect(performance.now() - startedTicks).toBeLessThan(2_000);
  });

  test("a long run of closing markers cannot stall the audit", () => {
    // A variable-length lookbehind rescanned the marker run, which cost 2.1 seconds at
    // 25,000 markers and about 127 CPU seconds at a million. Hostile or generated
    // Markdown must not be able to stop an audit.
    const hostile = `.${")".repeat(25_000)} Next.`;
    const started = performance.now();
    splitSentences(hostile);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("a code span is one atom, whatever its delimiter run", () => {
    // CommonMark allows any number of backticks to open a span, and a backslash escapes
    // a backtick. A mask that only knows paired single ticks miscounts both.
    const doubled = "One. Two. Three. Four. Use ``alpha. beta`` in the call.";
    expect(splitSentences(doubled)).toHaveLength(5);

    const escaped = `The escaped marker \\\` appears here. The next one \\\` appears there.`;
    expect(splitSentences(escaped)).toHaveLength(2);
  });
  test("an escaped character is read as the character a reader sees", () => {
    // CommonMark renders an escape as the bare character, so an escaped "!" still ends a
    // sentence. Clearing the boundary state for every escape was right only for an escaped
    // backtick opener, and it swallowed every other rendered terminator and closing marker.
    const slash = String.fromCharCode(92);
    const tick = String.fromCharCode(96);

    // The contract is equivalence, not a count: escaping a character must not change how
    // the text reads, whatever the surrounding rules then decide about it.
    const marks = ["!", "?", ".", ",", ";", ":", tick, String.fromCharCode(34), ")", "]"];
    for (const mark of marks) {
      const plain = "Items include etc" + mark + " Next sentence here.";
      const escaped = "Items include etc" + slash + mark + " Next sentence here.";
      expect(splitSentences(escaped).length, mark).toBe(splitSentences(plain).length);
      expect(mergedSentences(escaped).length, mark).toBe(mergedSentences(plain).length);
    }

    // A numbering dot and an abbreviation must survive the escape too, or the classifier
    // reads a token the reader never sees. The compound case is the one that matters: a
    // real stop, then an escaped closing marker after it, which is what the first version
    // of this loop failed to construct and therefore failed to catch.
    for (const lead of ["Step 1", "Items include etc", "Items include e.g", "Dr"]) {
      for (const closer of ["", ")", "]", String.fromCharCode(34), "'"]) {
        const plain = lead + "." + closer + " Next sentence here.";
        const escaped = lead + "." + (closer === "" ? "" : slash + closer) + " Next sentence here.";
        expect(splitSentences(escaped).length, escaped).toBe(splitSentences(plain).length);
        expect(mergedSentences(escaped).length, escaped).toBe(mergedSentences(plain).length);
      }
    }

    // Both reproducers from review, verbatim. An abbreviation behind an escaped closer
    // was read as "e.g.\\", which is not an abbreviation, so it started a sixth sentence
    // and reported a paragraph that was never over the limit.
    const paragraph = "One. Two. Three. Four. Items include e.g" + slash + ") tools and paper.";
    expect(splitSentences(paragraph)).toHaveLength(5);
    expect(auditText(paragraph).map((v) => v.rule)).not.toContain("paragraph-length");
    expect(splitSentences("Dr" + slash + ") Smith explains it.")).toHaveLength(1);

    // The harm as a reader meets it: two sixteen-word sentences reported as one long one.
    const text = Array(16).fill("alpha").join(" ") + slash + "! Beta "
      + Array(15).fill("beta").join(" ") + ".";
    expect(splitSentences(text)).toHaveLength(2);
    expect(auditText(text).filter((v) => v.rule === "sentence-length")).toHaveLength(0);
  });

  test("a backslash blocks a code span from opening, never from closing", () => {
    // CommonMark reads escapes left to right, so an escape stops a run from opening a
    // span. Once a span is open the search for its closer ignores backslashes entirely.
    // Built by concatenation because a backslash inside a template literal is read twice
    // over, and the first version of this test silently escaped its own interpolation.
    const tick = String.fromCharCode(96);
    const escapedTick = "\\" + tick;

    // The spec's own example. The escaped backtick closes the span, so "bar" is prose and
    // the stop after it splits. Discarding the escaped run let the opener reach the final
    // backtick instead, which swallowed that stop and merged two sentences into one.
    expect(splitSentences(tick + "foo" + escapedTick + "bar. Next." + tick)).toHaveLength(2);

    // The same defect seen as a reader sees it: two short sentences reported as one long.
    const left = Array(15).fill("alpha").join(" ");
    const right = Array(15).fill("beta").join(" ");
    const closed = tick + "code" + escapedTick + " " + left + ". " + right + tick + ".";
    expect(auditText(closed).filter((v) => v.rule === "sentence-length")).toHaveLength(0);

    // An escaped run at the start opens nothing, so the run is literal and the stop stands.
    expect(splitSentences("Stop. " + escapedTick + "not code" + tick + " follows.")).toHaveLength(2);

    // Two backslashes escape each other, so the backtick after them still opens a span and
    // the stop inside it ends nothing.
    const pair = "Use \\\\" + tick + "alpha. beta" + tick + " once. Then stop.";
    expect(splitSentences(pair)).toHaveLength(2);
  });

  test("what sits inside a link label is still read", () => {
    // CommonMark allows an image inside a link. Jumping past the whole link once the
    // outer one was recognised hid everything nested in it, so an image with no
    // alternative text produced no finding and its markup was counted as prose.
    const nested = "[read ![](image.png)](destination) here.";
    expect(auditText(nested).map((v) => v.rule)).toContain("image-alt");
    expect(readerProseBlocks(nested)[0]?.lines.join("")).toBe("read  here.");

    // A described image inside a link is fine, and its description is the prose.
    const described = "[read ![a chart of costs](chart.png)](destination) here.";
    expect(auditText(described).map((v) => v.rule)).not.toContain("image-alt");
    expect(readerProseBlocks(described)[0]?.lines.join("")).toBe("read a chart of costs here.");

    // A link inside a link label is read as well, so its text is judged.
    expect(auditText("[[click here](inner)](outer) here.").map((v) => v.rule))
      .toContain("link-text");

    // Reference and shortcut forms are unchanged, here and on the released engine.
    const shortcut = "[[click here]] follows." + "\n\n" + "[click here]: /uri";
    expect(readerProseBlocks(shortcut)[0]?.lines.join(""))
      .toBe("[[click here]] follows.");
  });

  test("a linked badge is read, and an alt text is not read as elements", () => {
    // The commonest nested link in a README is a badge: an image inside a reference
    // link. The scan read on inside an inline label only, so a reference label hid
    // whatever it held and the badge lost its finding.
    const badge = "[![][badge]][link] here." + "\n\n" + "[badge]: /b.png\n[link]: /l";
    expect(auditText(badge).map((v) => v.rule)).toContain("image-alt");
    expect(readerProseBlocks(badge)[0]?.lines.join("")).toBe(" here.");

    // What sits inside an alt text gives the alt its words and is never rendered on its
    // own, so reading it as an element manufactured a finding about an image nobody
    // ever sees. The words still count, because a reader hears them.
    const inAlt = "![outer ![](inner.png)](outer.png) here.";
    expect(auditText(inAlt).map((v) => v.rule)).not.toContain("image-alt");
    expect(readerProseBlocks(inAlt)[0]?.lines.join("")).toBe("outer  here.");

    // A square bracket may sit in a destination, where it is not label structure.
    const bracketed = "[![](img.png)](https://example.com/a[b]) here.";
    expect(auditText(bracketed).map((v) => v.rule)).toContain("image-alt");
    expect(readerProseBlocks(bracketed)[0]?.lines.join("")).toBe(" here.");
  });

  test("deep nesting finishes and does not exhaust the stack", () => {
    // Reading a label by starting again inside it would cost a pass for every level.
    // Brackets that never resolve must stay cheap too, and must not exhaust the stack.
    const deep = (size: number): void => {
      auditText(deepLabelDocument(size));
    };
    deep(3_000);

    let layered = "innermost";
    for (let level = 0; level < 400; level++) layered = `[${layered}](/uri)`;
    expect(() => auditText(layered)).not.toThrow();
  }, HOSTILE_TIMEOUT_MS);

  test("an empty link shows a reader nothing, so it measures as nothing", () => {
    // A link with no text still has a destination and a title, and leaving them in place
    // counted hidden markup as prose. A reader sees an empty link and a full stop.
    const hidden = Array.from({ length: 35 }, (_, index) => `hidden${index}`).join(" ");
    const empty = `[](/uri "${hidden}").`;
    const rules = auditText(empty).map((v) => v.rule);
    expect(rules).toContain("link-text");
    expect(rules).not.toContain("sentence-length");
    expect(readerProseBlocks(empty)[0]?.lines.join("")).toBe(".");

    // A reference naming nothing is not a link, so it stays exactly as it was found.
    expect(readerProseBlocks("[][nothing] here.")[0]?.lines.join(""))
      .toBe("[][nothing] here.");
  });

  test("a link label may hold brackets, and only the label is prose", () => {
    // CommonMark allows balanced brackets inside a link label. Matching the label with a
    // pattern that stopped at the first "]" left the destination and title unflattened, so
    // hidden text was counted as prose and manufactured a sentence-length finding.
    const hidden = Array.from({ length: 35 }, (_, index) => `hidden${index}`).join(" ");
    const nested = `Read [outer [inner] text](/uri "${hidden}").`;
    expect(auditText(nested).filter((v) => v.rule === "sentence-length")).toHaveLength(0);

    // The label itself is still prose, brackets and all.
    const long = Array.from({ length: 31 }, (_, index) => `word${index}`).join(" ");
    expect(auditText(`Read [outer [inner] ${long}](/uri).`)
      .filter((v) => v.rule === "sentence-length")).toHaveLength(1);

    // An image label behaves the same way, and an empty one is still allowed.
    expect(auditText(`Read ![alt [inner] text](/uri "${hidden}").`)
      .filter((v) => v.rule === "sentence-length")).toHaveLength(0);

    // Line endings inside a nested link are kept, exactly as for a plain one.
    const sentence = `${long}.`;
    const found = auditText(`Read [outer [inner] text](/uri "first
second"). Short.
${sentence}`)
      .filter((v) => v.rule === "sentence-length");
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });

  test("nested link labels and unmatched brackets finish", () => {
    // Every rule that reads links once ran a separate scan. Ten thousand
    // unmatched brackets took about nine seconds before the shared scan.
    const audit = (size: number): void => {
      auditText(nestedLinkDocument(size));
    };
    audit(3_000);

    // Brackets that never close are the shape that was worst, and the shape a generated
    // or damaged document reaches without anybody meaning harm.
    for (const hostile of ["[".repeat(20_000), "[".repeat(20_000) + "]", "[a](".repeat(5_000)]) {
      const started = performance.now();
      auditText(hostile);
      expect(performance.now() - started, hostile.slice(0, 12)).toBeLessThan(1_000);
    }

    // A bracket inside a code span is content, not structure. Counting it took the outer
    // label's closing bracket, which corrupted the reader text and lost the finding that
    // the same sentence produces without the span.
    const tick = String.fromCharCode(96);
    const spanned = "[Certainly " + tick + "[" + tick + " we should proceed](/uri).";
    expect(readerProseBlocks(spanned)[0]?.lines.join(""))
      .toBe("Certainly " + tick + "[" + tick + " we should proceed.");
    expect(auditText(spanned).map((v) => v.rule)).toContain("filler-opening");

    // Anything that does not parse as a link is left exactly as it was found, which is
    // what the pattern it replaced did too.
    for (const literal of [
      "Read [ this and [ that here.",
      "Read [label](unclosed destination here.",
      "Read [label][unclosed reference here.",
      "Read [outer [inner]] text.",
    ]) {
      expect(readerProseBlocks(literal)[0]?.lines.join(""), literal).toBe(literal);
    }
  }, HOSTILE_TIMEOUT_MS);

  test("markup that spans lines does not move the lines after it", () => {
    // A link destination or title may hold a line ending. Flattening the link to its
    // label deleted that line ending, so every later sentence in the block was reported
    // one line early and the reader opened an innocent line.
    const long = `${Array.from({ length: 31 }, (_, index) => `word${index}`).join(" ")}.`;
    const cases: Array<[string, number]> = [
      [`Read [the guide](/uri "first\nsecond"). Short.\n${long}`, 3],
      [`Read ![alt](/uri "first\nsecond"). Short.\n${long}`, 3],
      [`Read [the guide][a\nb]. Short.\n${long}\n\n[a b]: /uri`, 3],
      [`Read <span\nclass="x">here</span>. Short.\n${long}`, 3],
    ];
    for (const [text, line] of cases) {
      const found = auditText(text).filter((violation) => violation.rule === "sentence-length");
      expect(found, text).toHaveLength(1);
      expect(found[0]?.line, text).toBe(line);
    }
  });

  test("a definition is judged by the words that actually spell the acronym", () => {
    // The count of words carrying an initial has to match the key exactly, and the key
    // decides how many that is. A fixed six was borrowed from the pattern that finds a
    // definition, whose capture really is capped at six, and applied to the pattern that
    // finds an acronym, which is not capped at all.
    const spell = (letters: string[]): string => letters.join(".") + ".";
    const words = ["Alpha", "Beta", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
      "India", "Juliett"];
    for (const size of [3, 6, 7, 8, 9, 10]) {
      const key = spell(words.slice(0, size).map((word) => word[0] as string));
      const defined = `${key} (${words.slice(0, size).join(" ")}) works.`;
      expect(auditText(defined).map((v) => v.rule), defined.slice(0, 40))
        .not.toContain("acronym-undefined");
    }

    // A definition that spells something else is still undefined, at every length.
    const wrong = "A.B.C.D.E.F.G.H.I. (Alpha Beta Charlie) works.";
    expect(auditText(wrong).map((v) => v.rule)).toContain("acronym-undefined");
  });

  test("discounted words do not stall the definition search", () => {
    // Every word here is discounted: "A" reads as the article, and so does "and". The
    // guard counted nothing and therefore read the whole remaining document for every
    // candidate, which is the cost it was written to prevent.
    const hostile = (size: number): void => {
      auditText(discountedAcronymDocument(size));
    };
    hostile(3_000);
  }, HOSTILE_TIMEOUT_MS);

  test("an expansion is read to its closing bracket, however long it runs", () => {
    // A definition is spelled by the words that carry initials, and the ignored words
    // between them are unlimited. Bounding the lookahead by a token count therefore cut
    // valid expansions short and reported an acronym that the text defines on the spot.
    const padded = `ABCDEF (Alpha ${Array(30).fill("and").join(" ")} `
      + "Beta Charlie Delta Echo Foxtrot) works.";
    expect(auditText(padded).map((v) => v.rule)).not.toContain("acronym-undefined");

    // Just outside: the expansion no longer spells the acronym, so it is undefined.
    const wrong = `ABCDEF (Alpha ${Array(30).fill("and").join(" ")} Beta Charlie) works.`;
    expect(auditText(wrong).map((v) => v.rule)).toContain("acronym-undefined");

    // A parenthesis that never closes cannot define anything, and must not be searched
    // to the end of the document for every acronym that precedes it.
    expect(auditText("ABCDEF (Alpha Beta Charlie Delta Echo Foxtrot works.")
      .map((v) => v.rule)).toContain("acronym-undefined");
  });

  test("large documents finish and retain their findings", () => {
    // Three places rebuilt a whole prefix or suffix inside a loop over the same text, so
    // each cost grew with the square of the document. Repairing only the one the review
    // named would have left the shape alive in the other two.
    //
    // Every acronym rebuilt the entire remaining token list to look three tokens ahead.
    const known = new Set(["AB"]);
    const acronyms = (size: number): void => {
      auditText(acronymDefinitionDocument(size), { knownAcronyms: known });
    };
    acronyms(3_000);

    // Every finding counted the line endings before it from the start of the paragraph.
    const paragraphs = (size: number): void => {
      auditText(longParagraphDocument(size));
    };
    paragraphs(3_000);

    // The findings themselves must survive the repair, not merely arrive sooner.
    const long = Array(500).fill(LONG_SENTENCE).join(" ");
    expect(auditText(long).filter((v) => v.rule === "sentence-length")).toHaveLength(500);
  }, HOSTILE_TIMEOUT_MS);

  test("a hostile token cannot stall the rules that read it", () => {
    // Trimming a token to its letters with an anchored alternation retried the suffix at
    // every position, so one token of 100,000 markers took about ten seconds. The parser
    // was already linear by then, which is why the cost survived the earlier repair.
    const token = `x${"`".repeat(40_000)}y`;
    const started = performance.now();
    auditText(token);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("an abbreviation stays an abbreviation behind emphasis", () => {
    // `**e.g.**` must behave as `e.g.` does. Allowing a stop to end a sentence through
    // closing markup let the classifier see "**e.g.**" and miss the abbreviation.
    const emphasised = "Items include **e.g.** tools and paper. Next section starts here.";
    expect(splitSentences(emphasised)).toHaveLength(2);
  });

  test("a code span is one atom, so punctuation inside it ends nothing", () => {
    // Writing about punctuation means quoting it. A span in backticks is a term being
    // named, so a stop inside it is part of the name and never a sentence boundary.
    const spans = [
      "Use the token `alpha. beta` in the call. Then continue here.",
      "The splitter read `**Lead in.** Next sentence.` as one sentence. That was the bug.",
      "Set `timeout=1.5` before starting. The default is lower.",
    ];
    for (const text of spans) {
      expect(splitSentences(text), text).toHaveLength(2);
    }
  });

  test("technical punctuation and ambiguous boundaries cannot invent findings", () => {
    expect(classifyBoundary("packs etc.", "Customers receive them.")).toBe("ambiguous");
    expect(classifyBoundary("Dr.", "Smith explains it.")).toBe("merge");
    expect(classifyBoundary("paper.", "Next section.")).toBe("split");

    const abbreviations = "Items include e.g. tools, pens, and paper. Next section starts here.";
    expect(splitSentences(abbreviations)).toHaveLength(2);
    expect(mergedSentences(abbreviations)).toHaveLength(2);

    const atoms = [
      ["Call", "`system.config.init()`", "before", "running", "`service.start()`"],
      ["Upgrade", "to", "v2.4.1", "at", "staging.example.com"],
      ["The", "value", "is", "10.5", "before", "conversion"],
    ];
    for (const atom of atoms) {
      const short = `${atom.join(" ")}.`;
      expect(splitSentences(short), short).toHaveLength(1);
      const long = [...atom, ...Array.from({ length: 31 - atom.length }, (_, index) => `word${index}`)];
      const sentence = `${long.join(" ")}.`;
      expect(wordCount(sentence), sentence).toBe(31);
      expect(rulesFor(sentence).filter((rule) => rule === "sentence-length"), sentence).toHaveLength(1);
    }

    const firstHalf = `${Array(15).fill("alpha").join(" ")} etc.`;
    const secondHalf = `Customers ${Array(15).fill("beta").join(" ")}.`;
    expect(wordCount(`${firstHalf} ${secondHalf}`)).toBe(32);
    expect(rulesFor(`${firstHalf} ${secondHalf}`)).not.toContain("sentence-length");

    const paragraph = "One. Two. Three. Four. Packs etc. Customers wait.";
    expect(splitSentences(paragraph)).toHaveLength(6);
    expect(mergedSentences(paragraph)).toHaveLength(5);
    expect(rulesFor(paragraph)).not.toContain("paragraph-length");

    const average = [
      ...Array.from({ length: 8 }, () => sentenceOf(21)),
      `${Array(20).fill("alpha").join(" ")} etc.`,
      `Customers ${Array(20).fill("beta").join(" ")}.`,
    ].join(" ");
    expect(splitSentences(average)).toHaveLength(10);
    expect(mergedSentences(average)).toHaveLength(9);
    expect(rulesFor(average)).not.toContain("sentence-average");
    expect(rulesFor("# U.S. Customers receive support")).not.toContain("heading-style");
  });

  test("acronyms are separated from shouting and Roman numerals", () => {
    const cases: Array<[string, string[]]> = [
      ["ENABLE MFA before deployment.", ["MFA"]],
      ["VERIFY OTP before login.", ["OTP"]],
      ["ROTATE KEYS before deployment.", []],
      ["DO NOT USE S3 DATA.", []],
      ["AWS IAM SSO controls access.", ["AWS", "IAM", "SSO"]],
      ["Elizabeth II reigned for decades.", []],
      ["Chapter IV explains setup.", []],
      ["Open the form and review CI settings.", ["CI"]],
      ["The group uses CI during deployment.", ["CI"]],
      ["The MMIX architecture is described here.", ["MMIX"]],
    ];
    for (const [input, expected] of cases) {
      const found = auditText(input)
        .filter((violation) => violation.rule === "acronym-undefined")
        .map((violation) => /"([A-Z.]+)"/.exec(violation.detail)?.[1] ?? "");
      expect(found, input).toEqual(expected);
    }
  });

  // SOURCES.md documents where the corpus came from; it is not a corpus
  // document, so it is not measured as one.
  test("the plain-language corpus produces no false advisories", () => {
    const findings = auditCorpus(KNOWN_GOOD);
    const documents = Object.entries(findings.files).filter(([path]) => path !== "SOURCES.md");
    expect(documents).toHaveLength(7);
    const advised = documents.filter(([, file]) => file.violations.length > 0).map(([path]) => path);
    expect(advised).toEqual([]);
  });

  // Every other external document is expected to pass, so nothing measured
  // whether the engine finds real difficulty in real writing. This is the
  // opposite control: public-domain statute, adjudicated before the first run,
  // where silence would be the failure.
  test("published legal prose produces the findings adjudicated in advance", () => {
    const path = join(DIFFICULT, "us-foia-statute.md");
    const text = readFileSync(path, "utf8");
    const lengths: number[] = [];
    for (const block of proseBlocks(text)) {
      for (const sentence of splitSentences(block.lines.join(" "))) {
        const count = wordCount(sentence);
        if (count > 0) lengths.push(count);
      }
    }
    // Counted with a plain splitter before the engine ran: 11, 44, 31, 28.
    expect(lengths).toEqual([11, 44, 31, 28]);
    const found = auditText(text);
    // Re-adjudicated on 2026-08-15 when complex-word was added. The statute
    // says "the methods whereby, the public may obtain information", so the
    // fourth finding is real: the rule did not drift, the rule set grew.
    expect(found.map((violation) => violation.rule).sort())
      .toEqual(["complex-word", "legalese", "sentence-length", "sentence-length"]);
    expect(found.filter((violation) => violation.rule === "sentence-length")
      .map((violation) => violation.detail))
      .toEqual(["44 words (limit 30)", "31 words (limit 30)"]);
    // Four sentences is below the sample floor, so the average must not run.
    expect(lengths.length).toBeLessThan(ENGINE_THRESHOLDS.averageMinimumSentences);
    expect(found.some((violation) => violation.rule === "sentence-average")).toBe(false);
  });

  // The isolated controls prove each rule can fire alone. This fixture adds
  // the composition case: every rule must remain observable when all seventeen
  // occur together in one realistic document.
  test("every rule fires together in one integrated document", () => {
    const text = readFileSync(join(DIFFICULT, "every-rule.md"), "utf8");
    const fired = new Set(auditText(text).map((violation) => violation.rule));
    expect([...fired].sort()).toEqual([...RULES].sort());
  });

  // Round 8, second pass. The first repairs fixed the symptom in one rule
  // rather than the shared parser, so metadata and table cells were still
  // audited as sentences by every other rule.
  test("metadata and table cells are structure, not prose", () => {
    const frontMatter = ["---", "title: Each and Every Shall Policy", "---", "", "Body text here."];
    expect(rulesFor(frontMatter.join(BREAK))).toEqual([]);
    expect(rulesFor(["---", "summary: We will utilise this", "---", "", "Body."].join(BREAK)))
      .toEqual([]);
    // No blank line after the closing marker must not merge metadata with body.
    expect(rulesFor(["---", "title: x", "---", "Certainly! The answer is 42."].join(BREAK)))
      .toContain("filler-opening");

    const pipeless = ["Term | Meaning", "---|---", "Rule | The supplier shall hereby comply."];
    expect(rulesFor(pipeless.join(BREAK))).toEqual([]);
    const piped = ["| Term | Meaning |", "|---|---|", "| Rule | The supplier shall hereby comply. |"];
    expect(rulesFor(piped.join(BREAK))).toEqual([]);
  });

  // Round 9. Both exclusions above were inferred from a neighbouring line, so
  // ordinary prose disappeared from the document with nothing to show for it.
  // Silent removal is worse than a wrong finding, because a reader who sees a
  // wrong finding can dismiss it, and a reader who sees nothing learns nothing.
  test("structure inference never removes prose or headings", () => {
    // A pipe in a heading, a quote or a list is punctuation, not a table.
    const afterHeading = ["## Compare A | B", "The supplier shall respond | today."];
    expect(rulesFor(afterHeading.join(BREAK))).toContain("legalese");
    const afterQuote = ["> Compare A | B", "The supplier shall respond | today."];
    expect(rulesFor(afterQuote.join(BREAK))).toContain("legalese");
    const afterList = ["- Compare A | B", "The supplier shall respond | today."];
    expect(rulesFor(afterList.join(BREAK))).toContain("legalese");

    // Front matter needs a closing marker. Without one the scanners disagreed:
    // prose kept the text while every heading below it vanished.
    const unclosed = ["---", "title: Draft", "##### This heading ends with a full stop."];
    const found = rulesFor(unclosed.join(BREAK));
    expect(found).toContain("heading-depth");
    expect(found).toContain("heading-style");

    // A table still ends where the pipes end, and prose after it is audited.
    const surrounded = [
      "| Term | Meaning |",
      "|---|---|",
      "| Rule | Text. |",
      "",
      "The supplier shall comply.",
    ];
    expect(rulesFor(surrounded.join(BREAK))).toContain("legalese");
  });

  // Round 10. Both structural exclusions were mine, and both lost the reader
  // text. A thematic break joined the sentence below it, so a 30-word
  // sentence became a false 31-word finding and an opening filler stopped
  // being an opening. An indented "---" inside a YAML block scalar closed the
  // front matter early, which left a code fence open and hid the whole body.
  test("rules across the page and YAML scalars are not read as sentences", () => {
    for (const rule of ["---", "***", "___", "- - -"]) {
      expect(rulesFor([rule, "Certainly! The answer is 42."].join(BREAK)), rule)
        .toContain("filler-opening");
    }
    // A break above a sentence must not add a word to it.
    const thirty = Array.from({ length: 30 }, (_unused, index) => `word${index}`).join(" ");
    expect(rulesFor(["---", `${thirty}.`].join(BREAK))).toEqual([]);
    // A setext underline is still a heading, not a break.
    expect(headings(["My Heading", "---", "", "Body text."].join(BREAK))).toHaveLength(1);

    const scalar = [
      "---",
      "description: |",
      "  ```md",
      "  ---",
      "  ```",
      "---",
      "The supplier shall be audited.",
    ];
    expect(rulesFor(scalar.join(BREAK))).toContain("legalese");
  });

  // Round 11. The three scanners each kept their own fence and front matter
  // state, and disagreed. A four-space-indented marker opened a fence that
  // never opened, a tilde run closed a backtick fence, a bare carriage return
  // left the file as one line, and a byte order mark stopped front matter
  // being front matter. Every one of them removed text a reader can see.
  test("code fences, line endings and byte order marks cannot hide text", () => {
    const CARRIAGE_RETURN = String.fromCharCode(13);
    const BYTE_ORDER_MARK = String.fromCharCode(65279);
    const legalese = "The supplier shall hereby comply.";

    // A fence opens with at most three leading spaces.
    expect(rulesFor(["    ```", legalese].join(BREAK))).toContain("legalese");
    // A fence closes only with its own character, at least as long.
    const nested = ["````md", "~~~bash", "example", "````", "", legalese];
    expect(rulesFor(nested.join(BREAK))).toContain("legalese");
    expect(headings(["````md", "~~~bash", "x", "````", "##### Deep."].join(BREAK)))
      .toHaveLength(1);
    // A real fence still hides its contents, closed or not.
    expect(rulesFor(["```", legalese, "```"].join(BREAK))).toEqual([]);
    expect(rulesFor(["```", legalese].join(BREAK))).toEqual([]);
    expect(rulesFor(["```js", "code", "```", "", legalese].join(BREAK))).toContain("legalese");

    // A bare carriage return separates lines, as CRLF already did.
    const bareCR = ["##### Deep heading.", legalese].join(CARRIAGE_RETURN);
    expect(rulesFor(bareCR)).toContain("legalese");
    expect(headings(bareCR)).toHaveLength(1);

    // A byte order mark precedes the opening delimiter in many Windows files.
    const withMark = BYTE_ORDER_MARK
      + ["---", "description: |", "  ```md", "---", legalese].join(BREAK);
    expect(rulesFor(withMark)).toContain("legalese");
  });

  // The block scanners were normalised while three rules still split the text
  // themselves, so the fix reached most of the engine and not all of it. A
  // bare carriage return put the image finding on line 1 rather than line 3,
  // and the table finding vanished. Every encoding must read alike.
  test("line-based rules read the same document as the block scanners", () => {
    const CARRIAGE_RETURN = String.fromCharCode(13);
    const BYTE_ORDER_MARK = String.fromCharCode(65279);
    const document = [
      "[click here](https://example.com)",
      "",
      "![](chart.png)",
      "",
      "| A |  |",
      "| --- | --- |",
    ];
    const expected = [
      ["table-header", 5],
      ["link-text", 1],
      ["image-alt", 3],
    ];
    const found = (text: string): Array<[string, number]> =>
      auditText(text).map((violation) => [violation.rule, violation.line]);
    expect(found(document.join(BREAK))).toEqual(expected);
    expect(found(document.join(CARRIAGE_RETURN))).toEqual(expected);
    expect(found(document.join(CARRIAGE_RETURN + BREAK))).toEqual(expected);
    expect(found(BYTE_ORDER_MARK + document.join(BREAK))).toEqual(expected);

    // They must honour the shared fence rules too, not their own.
    const fenced = ["````", "~~~", "[click here](https://example.com)", "````"];
    expect(auditText(fenced.join(BREAK))).toEqual([]);
  });

  // Round 12. Structure was still being inferred too eagerly in three places.
  // A table claimed lines GitHub would not render as a table at all, a fence
  // indented into a list item was read as text, and the rewired rules skipped
  // only fences, so front matter reached them.
  test("structure is claimed only where a reader would see it", () => {
    const legalese = "The supplier shall hereby comply.";

    // GitHub renders a table only when header and divider agree on columns.
    const mismatched = ["A | B | C", "---|---", "The supplier shall respond | today | now."];
    expect(rulesFor(mismatched.join(BREAK))).toContain("legalese");
    const setext = ["Comparison A | B", "---", "The supplier shall respond | today."];
    expect(rulesFor(setext.join(BREAK))).toContain("legalese");
    // A table that does agree is still structure.
    expect(rulesFor(["| A | B |", "|---|---|", `| x | ${legalese} |`].join(BREAK))).toEqual([]);
    expect(rulesFor(["Term | Meaning", "---|---", `Rule | ${legalese}`].join(BREAK))).toEqual([]);

    // A fence indented into a list item or a quote is still a fence, and its
    // contents are examples rather than advice to give back to the writer.
    const inList = ["1. Example:", "", "    ```md", `    ${legalese}`,
      "    [click here](https://example.com)", "    ![](chart.png)", "    ```"];
    expect(rulesFor(inList.join(BREAK))).toEqual([]);
    const inBullet = ["- Example:", "", "  ```md", `  ${legalese}`, "  ```"];
    expect(rulesFor(inBullet.join(BREAK))).toEqual([]);
    const inQuote = ["> ```", `> ${legalese}`, "> [click here](https://example.com)", "> ```"];
    expect(rulesFor(inQuote.join(BREAK))).toEqual([]);
    // Four spaces at the left margin is indented code, not a fence.
    expect(rulesFor(["    ```", "The supplier shall respond."].join(BREAK))).toContain("legalese");

    // Metadata is metadata for every rule, not only the block scanners.
    const metadata = ["---", "link: [click here](https://example.com)", "image: ![](chart.png)",
      "head: | A |  |", "rule: | --- | --- |", "---", "", "Body text here."];
    expect(rulesFor(metadata.join(BREAK))).toEqual([]);
  });

  // A third reviewer attacked the parser and offered six shapes. Five matched
  // what GitHub renders, so the engine was right about them. This one did not:
  // a line starting with a pipe, with no divider beneath it, is ordinary text.
  test("a pipe alone does not make a line a table row", () => {
    const legalese = "The supplier shall hereby comply.";
    expect(rulesFor(`| Important note: ${legalese}`)).toContain("legalese");
    expect(rulesFor([`| x | ${legalese} |`].join(BREAK))).toContain("legalese");
    // A header with a matching divider is still a table, rows and all.
    expect(rulesFor(["| A | B |", "|---|---|", `| x | ${legalese} |`].join(BREAK))).toEqual([]);
    expect(rulesFor(["Term | Meaning", "---|---", `Rule | ${legalese}`].join(BREAK))).toEqual([]);
  });

  // Round 13. Five more shapes where structure was recognised without the
  // constraints the specifications place on it, and each one removed text.
  test("structure follows the specification, not the first character", () => {
    const legalese = "The supplier shall hereby comply.";

    // A fence can be a list item's first content, marker and all.
    const asContent = ["1. ```md", "   code", "   ```", "##### Visible heading.", legalese];
    expect(rulesFor(asContent.join(BREAK))).toContain("legalese");
    expect(headings(asContent.join(BREAK))).toHaveLength(1);
    // Four spaces before a quote marker is indented code, not a quoted fence.
    expect(rulesFor(["    > ```", legalese].join(BREAK))).toContain("legalese");

    // An ordered list interrupts a paragraph only when it starts at 1, which
    // is what protects a hard-wrapped year.
    expect(rulesFor(["The chronology continues here", `2024. ${legalese}`].join(BREAK)))
      .toContain("legalese");
    expect(rulesFor([`1234567890. ${legalese}`].join(BREAK))).toContain("legalese");
    // A list item is audited, so silence no longer shows where the paragraph
    // ended. The block structure does: a continuation joins the paragraph
    // above it, and an item starts one of its own.
    expect(proseBlocks(["The chronology continues here", "2024. It continued."].join(BREAK)))
      .toHaveLength(1);
    expect(proseBlocks(["The intro continues", "1. A new item."].join(BREAK)))
      .toHaveLength(2);
    expect(rulesFor(["Intro.", "", `2. ${legalese}`].join(BREAK))).toContain("legalese");

    // An escaped pipe is content, so it changes neither column count.
    const escaped = String.raw`| A \| B | C |`;
    expect(rulesFor([escaped, "| --- | --- | --- |",
      "The supplier shall respond | today | now."].join(BREAK))).toContain("legalese");
    expect(rulesFor([escaped, "| --- | --- |", `| x | ${legalese} |`].join(BREAK))).toEqual([]);

    // A table ends where another block begins, and HTML is another block.
    const html = ["Term | Meaning", "---|---", "x | y",
      `<p>${legalese} | today.</p>`, "Ordinary ending."];
    expect(rulesFor(html.join(BREAK))).toContain("legalese");
  });

  // Round 14 swept the constructs the engine relies on against CommonMark and
  // the GitHub table extension, rather than sampling them. Nine differences
  // removed visible text, and each one is a rule the specification states.
  test("the constructs behave as their specifications describe", () => {
    const legalese = "The supplier shall hereby comply.";

    // A table ends at a heading, a break, or indented code, not only at HTML.
    for (const ender of ["### New section | details", "---", "    code | here"]) {
      const table = ["A | B", "---|---", "x | y", ender, `${legalese} | today.`];
      expect(rulesFor(table.join(BREAK)), ender).toContain("legalese");
    }

    // Ten digits cannot make a list marker, and indented code is not a list.
    expect(rulesFor(["1234567890. ```md", legalese].join(BREAK))).toContain("legalese");
    expect(rulesFor(["    - ```md", legalese].join(BREAK))).toContain("legalese");

    // Structure is spelled with ASCII space and tab. A non-breaking space is
    // ordinary text, and copying from a formatted document produces them.
    const NBSP = String.fromCharCode(160);
    expect(rulesFor(`${NBSP}> ${legalese}`)).toContain("legalese");
    expect(rulesFor(`#${NBSP}${legalese}`)).toContain("legalese");
    expect(headings(`#${NBSP}Heading`)).toHaveLength(0);
    // A tab still separates a heading marker from its text.
    expect(headings(`#${String.fromCharCode(9)}Heading`)).toHaveLength(1);

    // Two backslashes escape each other, so the pipe after them is a boundary.
    const parity = [String.raw`| A \\| B | C |`, "| --- | --- |", `${legalese} | today.`];
    expect(rulesFor(parity.join(BREAK))).toContain("legalese");
    // Every divider cell is hyphens, with optional colons.
    const badDivider = ["A | B | C", "--- | : | ---", `${legalese} | x | y`];
    expect(rulesFor(badDivider.join(BREAK))).toContain("legalese");

    // A setext heading is the paragraph above the underline, not its last line.
    const twoLine = [
      "A deliberately lengthy heading first line with seven ordinary words",
      "and another seven ordinary words on its second line",
      "---",
    ];
    expect(rulesFor(twoLine.join(BREAK))).toContain("heading-style");
    expect(headings(twoLine.join(BREAK))).toHaveLength(1);
    // The paragraph starts after whatever precedes it, and never before it.
    const preceded: Array<[string, string]> = [
      ["blank", ""],
      ["list", "- item"],
      ["fence", ["```", "code", "```"].join(BREAK)],
      ["heading", "# Title"],
      ["break", "***"],
      ["indented code", "    code"],
      ["underline", "Other" + BREAK + "==="],
    ];
    for (const [name, before] of preceded) {
      const document = [before, "Heading text", "---", "", legalese].join(BREAK);
      if (name === "list") {
        // A line at the margin below a list item continues that item's
        // paragraph, so "---" underlines nothing and is a thematic break.
        expect(headings(document), name).toEqual([]);
      } else {
        expect(headings(document).at(-1)?.text, name).toBe("Heading text");
      }
      expect(rulesFor(document), name).toContain("legalese");
    }

    // Jekyll closes front matter with dots, and an unclosed block hid the body.
    const dots = ["---", "description: |", "  ```md", "...", legalese];
    expect(rulesFor(dots.join(BREAK))).toContain("legalese");
  });

  // Round 15 re-swept the constructs and named what still blocked release.
  // Two paths lost the reader something: a fence written in indented code
  // inside a list item, and a table read as a heading, which filled a gap in
  // the heading tree and suppressed the advice about it.
  test("boundaries between constructs keep their own rules", () => {
    const legalese = "The supplier shall hereby comply.";

    // Up to four spaces after a marker set the content column, so a fence
    // there is a fence. Five or more make indented code, and a fence written
    // in indented code is text.
    // An unclosed fence ends with the item that holds it, so the paragraph at
    // the margin below is outside the list and is measured either way. The
    // reference parser finds one paragraph in both.
    expect(rulesFor(["-     ```md", legalese].join(BREAK))).toContain("legalese");
    expect(rulesFor(["-    ```md", legalese].join(BREAK))).toContain("legalese");
    // The fence ends with its item, so everything below is measured, not just
    // the first line after it.
    expect(rulesFor(["-    ```md", legalese, legalese].join(BREAK)))
      .toEqual(["legalese", "legalese", "legalese", "legalese"]);

    // A table row cannot be a setext heading's text.
    const crossing = ["# Top", "", "A | B", "--- | ---", "x | y", "---", "### Actual"];
    expect(headings(crossing.join(BREAK)).map((h) => h.level)).toEqual([1, 3]);
    expect(rulesFor(crossing.join(BREAK))).toContain("heading-skip");

    // A heading is reported where its text starts, not where its underline is.
    const multiline = ["First line of it", "second line of it", "---"];
    expect(headings(multiline.join(BREAK))[0]?.line).toBe(1);

    // Only an HTML tag ends a table. A cell reading "< 5" is a measurement.
    const measurement = ["A | B", "--- | ---", `< 5 | ${legalese}`];
    expect(rulesFor(measurement.join(BREAK))).toEqual([]);
  });

  // Two of the four limits the sweep listed as shippable. Both were closed
  // because they misdirect a writer: one gives advice against code, the other
  // reports a gap in the heading tree that is not there, and hides one that is.
  test("indented code is code, and a bare heading holds its level", () => {
    const legalese = "The supplier shall hereby comply.";
    const TAB = String.fromCharCode(9);

    // Four spaces, or a tab, after a blank line is a code block.
    expect(rulesFor(["Intro paragraph.", "", `    ${legalese}`, "", "End."].join(BREAK)))
      .toEqual([]);
    expect(rulesFor(["Intro paragraph.", "", `${TAB}${legalese}`, "", "End."].join(BREAK)))
      .toEqual([]);
    // Code cannot interrupt a paragraph, so this is a wrapped line of prose.
    expect(rulesFor(["Intro paragraph", `    ${legalese}`].join(BREAK)))
      .toContain("legalese");

    // A heading with no text still occupies its level, so it fills a gap.
    expect(headings(["# Top", "", "##", "", "### Third"].join(BREAK)).map((h) => h.level))
      .toEqual([1, 2, 3]);
    expect(rulesFor(["# Top", "", "##", "", "### Third"].join(BREAK)))
      .not.toContain("heading-skip");
    // And it can open one.
    expect(rulesFor(["# Top", "", "###", "", "Body."].join(BREAK)))
      .toContain("heading-skip");
  });

  // Round 17. Containers were stripped in a fixed order, quotes then one list
  // marker, so one nesting order was read and the other was not. Tabs were
  // measured as one column, an alert label split ordinary paragraphs, and a
  // short quoted sentence was mistaken for a term being named.
  test("containers are read in the order they are written", () => {
    const legalese = "The supplier shall hereby comply.";
    const TAB = String.fromCharCode(9);
    const long = "### A heading of far more than twelve ordinary words written for this test";

    // Either nesting order finds the heading.
    for (const order of [`- > ${long}`, `> - ${long}`]) {
      expect(headings(order).map((h) => h.level), order).toEqual([3]);
      expect(rulesFor(order), order).toContain("heading-style");
    }
    // And either order finds the fence, so its contents stay examples.
    expect(rulesFor(["- > ```text", "  > shall hereby", "  > ```"].join(BREAK))).toEqual([]);
    expect(rulesFor(["> - ```text", ">   shall hereby", ">   ```"].join(BREAK))).toEqual([]);

    // A tab is four columns, so a line that starts with one is indented code
    // rather than a fence, and the prose beneath it is still measured.
    expect(rulesFor([`${TAB}\`\`\`text`, legalese].join(BREAK))).toContain("legalese");
    // A tab after a marker is four columns, not one, so the fence opens. The
    // second marker starts a new item, which ends the first item and its
    // fence, so its text is prose.
    expect(rulesFor([`-${TAB}\`\`\`text`, `-${TAB}${legalese}`].join(BREAK)))
      .toContain("legalese");

    // The label opens an alert only as a quotation's first line. Elsewhere it
    // is ordinary text, and treating it as a label split a paragraph in two.
    const six = ["One. Two. Three.", "[!WARNING]", "Four. Five. Six."];
    expect(rulesFor(six.join(BREAK))).toContain("paragraph-length");
    const midQuote = ["> One. Two. Three.", "> [!WARNING]", "> Four. Five. Six."];
    expect(rulesFor(midQuote.join(BREAK))).toContain("paragraph-length");
    expect(auditText(["> [!NOTE]", "> A short note."].join(BREAK))).toEqual([]);
    // Outside a quotation the label is a line of the paragraph, words and all.
    expect(proseBlocks(["One.", "[!WARNING]", "Two."].join(BREAK)))
      .toEqual([{ line: 1, lines: ["One.", "[!WARNING]", "Two."] }]);
  });

  // Eighteen rounds argued about what a document means. This asks the
  // implementation that defines the language, once, and keeps its answers.
  //
  // Three shapes are deliberately read differently, and each is a decision
  // about a reader rather than about Markdown:
  //   - a task marker is a control, not two words a reader hears;
  //   - HTML holds reader-visible prose, so its text is measured;
  //   - a GitHub alert label is a label, and GitHub is where these are read.
  test("block structure matches the CommonMark reference implementation", () => {
    expect(REFERENCE_SHAPES.length).toBeGreaterThanOrEqual(286);
    const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
    expect(readme).toContain(
      `The parser is checked against the CommonMark reference implementation. ${REFERENCE_SHAPES.length}`,
    );
    // Every divergence carries its reason, so none can be added silently.
    for (const shape of REFERENCE_SHAPES) {
      if (shape.differsFromReference !== undefined) {
        expect(shape.differsFromReference.length, shape.name).toBeGreaterThan(20);
      }
    }
    for (const shape of REFERENCE_SHAPES) {
      const document = shape.lines.join(BREAK) + BREAK;
      const paragraphs = proseBlocks(document)
        .map((block) => block.lines.join(" ").replace(/\s+/g, " ").trim());
      expect(paragraphs, shape.name).toEqual(shape.paragraphs);
      const found = headings(document)
        .map((heading) => [heading.level, heading.text.replace(/\s+/g, " ").trim()]);
      expect(found, shape.name).toEqual(shape.headings);
    }
  });

  test("three shapes are read differently, on purpose", () => {
    // A task marker is a control. Counting "[ ]" as two words made a 29-word
    // item report as 31, which is advice about punctuation nobody reads aloud.
    expect(proseBlocks("- [ ] One" + BREAK + "- [x] Two").map((b) => b.lines[0]))
      .toEqual(["One", "Two"]);
    // HTML carries prose a reader reads, so its text is measured.
    expect(rulesFor("<p>The supplier shall respond.</p>")).toContain("legalese");
    // The alert label is a label, and its body is the sentence that matters.
    expect(proseBlocks(["> [!WARNING]", "> Careful."].join(BREAK)).map((b) => b.lines[0]))
      .toEqual(["Careful."]);
  });

  // Round 19, with the reference implementation as the judge rather than
  // either of us. Each of these removed text a reader reads.
  test("precedence between blocks follows the reference", () => {
    const legalese = "The supplier shall hereby comply.";

    // A list marker outranks a table divider: GitHub renders "A | B" above
    // "- | -" as a paragraph and a list, so the sentence below is prose.
    const pseudoTable = ["A | B", "- | -", `${legalese} | x`];
    expect(rulesFor(pseudoTable.join(BREAK))).toContain("legalese");
    // A real divider still makes a table.
    expect(rulesFor(["A | B", "---|---", `x | ${legalese}`].join(BREAK))).toEqual([]);

    // A setext underline outranks a list marker, so a lone "-" under a
    // paragraph underlines it rather than opening an empty item.
    const underlined = ["A heading with thirteen ordinary words that should be checked by the heading rule", "-"];
    expect(headings(underlined.join(BREAK)).map((h) => h.level)).toEqual([2]);
    expect(rulesFor(underlined.join(BREAK))).toContain("heading-style");
    // A marker with nothing after it cannot interrupt a paragraph.
    expect(proseBlocks(["Paragraph", "*"].join(BREAK)).map((b) => b.lines.join(" ")))
      .toEqual(["Paragraph *"]);
    expect(proseBlocks(["Paragraph", "1."].join(BREAK)).map((b) => b.lines.join(" ")))
      .toEqual(["Paragraph 1."]);

    // Front matter must look like YAML. A document opening with a thematic
    // break lost everything down to the next one.
    const hijack = ["---", "Hello world. A reader reads this.", "---", "More text."];
    expect(proseBlocks(hijack.join(BREAK)).length).toBeGreaterThan(0);
    expect(headings(hijack.join(BREAK)).map((h) => h.text))
      .toEqual(["Hello world. A reader reads this."]);
    // A comment interrupts a paragraph, as an HTML block does, so the halves
    // around it stay separate. A link reference definition cannot interrupt
    // one, so it belongs to the paragraph it sits inside.
    expect(proseBlocks(["Text before.", "<!-- note -->", "Text after."].join(BREAK)))
      .toHaveLength(2);
    // Its words belong to that paragraph, which is what the reference reads.
    const insideParagraph = ["Text before.", '[a]: https://example.com "shall hereby"', "Text after."];
    expect(proseBlocks(insideParagraph.join(BREAK))).toHaveLength(1);
    expect(rulesFor(insideParagraph.join(BREAK))).toContain("legalese");
    // At a paragraph's start it is a definition, and invisible.
    expect(rulesFor(['[a]: https://example.com "shall hereby"', "", "Read it."].join(BREAK)))
      .toEqual([]);
    // Real front matter is still metadata.
    expect(rulesFor(["---", "title: Each and Every Shall Policy", "---", "", "Body."].join(BREAK)))
      .toEqual([]);
  });

  // Round 20, judged against the reference implementation. Two reviewers
  // attacked the same repairs and found opposite faults in them: text hidden
  // that a reader sees, and markup measured as words.
  test("markup is recognised by its grammar, not by its first character", () => {
    const legalese = "The supplier shall hereby comply.";

    // A definition needs a destination. Without one it is a sentence.
    expect(rulesFor(`[Question]: ${legalese}`)).toContain("legalese");
    expect(rulesFor(['[policy]: https://example.com "shall hereby"', "", "Read it."].join(BREAK)))
      .toEqual([]);
    // A title on its own line beneath a definition is measured. The state that
    // skipped it survived blank lines and definitions that already had a
    // title, so a quoted sentence after one disappeared. A visible finding on
    // an unusual document beats a sentence leaving in silence.
    expect(rulesFor(["[policy]: https://example.com", '  "shall hereby"'].join(BREAK)))
      .toContain("legalese");
    expect(rulesFor(['[p]: /url "title"', '"The supplier shall comply."'].join(BREAK)))
      .toContain("legalese");
    // A title's delimiters must match, or the line is not a definition.
    expect(rulesFor(`[p]: /url "shall hereby'`)).toContain("legalese");
    // A comment holds a sentence on the same line, and the sentence stays.
    expect(proseBlocks("<!-- hidden --> The supplier shall comply.")
      .map((b) => b.lines[0].trim())).toEqual(["The supplier shall comply."]);
    // An indented comment and a processing instruction are invisible too.
    expect(rulesFor(["  <!--", legalese, "  -->"].join(BREAK))).toEqual([]);
    expect(rulesFor(["<?php", legalese, "?>"].join(BREAK))).toEqual([]);
    // A comment runs until it closes, and every line of it is invisible.
    expect(rulesFor(["<!--", legalese, "-->"].join(BREAK))).toEqual([]);

    // A setext underline cannot be a lazy continuation, so a stray "--" below
    // a list item stays part of the item rather than making it a heading.
    const lazyRule = [`- ${legalese} It continues here.`, "--"];
    expect(headings(lazyRule.join(BREAK))).toEqual([]);
    expect(rulesFor(lazyRule.join(BREAK))).toContain("legalese");

    // The label opens an alert, so it is a label only on the opening line.
    expect(proseBlocks(["> [!WARNING]", "> Careful."].join(BREAK)).map((b) => b.lines[0]))
      .toEqual(["Careful."]);
    expect(proseBlocks(["> First.", ">", "> [!WARNING]", "> Careful."].join(BREAK))
      .map((b) => b.lines.join(" "))).toEqual(["First.", "[!WARNING] Careful."]);

    // A tag is markup; an autolink and a comparison are text a reader reads.
    expect(proseBlocks('A <span class="label">tag</span> here.').map((b) => b.lines[0]))
      .toEqual(["A  tag  here."]);
    expect(proseBlocks("The value is < 5 and > 2 today.").map((b) => b.lines[0]))
      .toEqual(["The value is < 5 and > 2 today."]);
    expect(proseBlocks("Read <https://example.com> today.").map((b) => b.lines[0]))
      .toEqual(["Read <https://example.com> today."]);
    // A heading loses its tags too, so its length is the length a reader sees.
    expect(headings('# A heading <span class="label">wrapped</span> here')[0]?.text)
      .toBe("A heading  wrapped  here");

    // A tag may span lines, and removing tags line by line left the halves
    // behind as words a reader never meets.
    expect(proseBlocks(["<div", 'class="note">', "Visible text."].join(BREAK))
      .map((b) => b.lines.join(" ").trim())).toEqual(["Visible text."]);
    expect(auditText(["<div", 'class="note">The supplier shall comply.</div>'].join(BREAK))
      .find((violation) => violation.rule === "legalese")?.line).toBe(2);
    expect(proseBlocks(["<span", "hidden", "still hidden>", "Visible."].join(BREAK))
      .map((b) => b.lines.join(" ").trim())).toEqual(["Visible."]);

    // CommonMark does not treat a colon as part of an HTML tag name. The
    // source is therefore text a reader sees rather than markup to remove.
    const namespaced = '<svg:path d="M0 0"/> hello there';
    expect(proseBlocks(namespaced).map((b) => b.lines[0].trim())).toEqual([namespaced]);

    // Front matter keys may be quoted, and may be written in any language.
    for (const key of ['"title": Metadata here', "résumé: Metadata here"]) {
      expect(headings(["---", key, "---", "", "Body."].join(BREAK)), key).toEqual([]);
    }
    // A sentence between two rules is still a heading, not metadata.
    expect(headings(["---", "Just a sentence here.", "---", "", "Body."].join(BREAK)))
      .toHaveLength(1);
  });

  test("incomplete tags cannot consume later reader-visible blocks", () => {
    const legalese = "The supplier shall hereby comply.";
    const interrupted = ["Opening <span", "", legalese].join(BREAK);
    expect(proseBlocks(interrupted).map((block) => block.lines.join(" ").trim()))
      .toEqual(["Opening <span", legalese]);
    expect(rulesFor(interrupted)).toContain("legalese");

    const beforeHeading = ["Opening <span", "# A heading", legalese].join(BREAK);
    expect(headings(beforeHeading).map((heading) => heading.text)).toEqual(["A heading"]);
    expect(rulesFor(beforeHeading)).toContain("legalese");

    // A colon makes this a URI autolink, not a namespaced HTML tag.
    const autolink = "Read <urn:isbn:9780141036144> before continuing.";
    expect(proseBlocks(autolink).map((block) => block.lines[0])).toEqual([autolink]);
  });

  test("code spans and escapes protect literal markup", () => {
    for (const literal of [
      "The literal `<!-- shall hereby -->` remains visible.",
      "The literal \\<!-- shall hereby --> remains visible.",
      'The literal `<span title="shall">` remains visible.',
      'The literal \\<span title="shall"> remains visible.',
    ]) {
      expect(proseBlocks(literal).map((block) => block.lines[0]), literal).toEqual([literal]);
    }
    const multiline = [
      "The literal `starts",
      "x <!-- shall hereby --> y",
      "ends` remains visible.",
    ];
    expect(proseBlocks(multiline.join(BREAK))[0]?.lines).toEqual(multiline);
    const afterBlock = "<!-- hidden --> `<!-- named -->` remains visible.";
    expect(proseBlocks(afterBlock)[0]?.lines[0]).toBe("`<!-- named -->` remains visible.");
    expect(proseBlocks("The literal `one `` two` stays visible.")[0]?.lines[0])
      .toBe("The literal `one `` two` stays visible.");

    for (const [source, visible] of [
      ["Text <!-- hidden --> after.", "Text   after."],
      ["Text <?hidden?> after.", "Text   after."],
      ["Text <!DOCTYPE hidden> after.", "Text   after."],
      ["Text <!-- unclosed markup.", "Text <!-- unclosed markup."],
    ]) {
      expect(proseBlocks(source)[0]?.lines[0], source).toBe(visible);
    }
  });

  test("malformed comment openers remain reader-visible prose", () => {
    const legalese = "The supplier shall comply.";
    for (const document of [
      `Text <!--> ${legalese}`,
      `Text <!---> ${legalese}`,
      `<!--> ${legalese}`,
      `<!---> ${legalese}`,
      `Text <!-- hidden --!> ${legalese} -->`,
      `<!-- hidden --!> ${legalese} -->`,
    ]) {
      expect(rulesFor(document), document).toContain("legalese");
      expect(proseBlocks(document)[0]?.lines.join(" "), document).toContain("shall");
      expect(proseBlocks(document)[0]?.lines.join(" "), document).not.toContain("<!--");
    }
  });

  test("processing instructions stop before reader-visible text", () => {
    const legalese = "The supplier shall comply.";
    for (const document of [
      `Text <?hidden > ${legalese} ?>`,
      `<?hidden > ${legalese} ?>`,
    ]) {
      expect(rulesFor(document), document).toContain("legalese");
      const visible = proseBlocks(document)[0]?.lines.join(" ") ?? "";
      expect(visible, document).toContain("shall");
      expect(visible, document).not.toContain("<?");
    }
  });

  test("an invisible block cannot outlive its container", () => {
    const legalese = "The supplier shall hereby comply.";
    for (const document of [
      ["> <!--", legalese],
      ["> <?instruction", legalese],
      ["- <!--", "", legalese],
    ]) {
      expect(rulesFor(document.join(BREAK)), document.join(" / ")).toContain("legalese");
    }
  });

  test("line rules ignore invisible markup but still read its visible tail", () => {
    expect(auditText("<!-- [](https://example.com) ![](image.png) -->")).toEqual([]);
    expect(auditText(["<!--", "[](https://example.com)", "-->", "Body."].join(BREAK)))
      .toEqual([]);

    const tail = "<!-- hidden --> [](https://example.com)";
    expect(rulesFor(tail)).toContain("link-text");
  });

  test("line rules distinguish Markdown examples from working links", () => {
    expect(auditText("Write `[](https://example.com)` as an example.")).toEqual([]);
    expect(auditText("Write `![](image.png)` as an example.")).toEqual([]);
    expect(auditText("Write \\[](https://example.com) as literal text.")).toEqual([]);
    expect(auditText("Read [`state_manager.rs`](https://example.com/source).")).toEqual([]);

    const real = "Example: `[](ignored)` then [](https://example.com).";
    expect(rulesFor(real)).toContain("link-text");

    const multilineCode = ["Example `starts", "[](ignored)", "ends` here."].join(BREAK);
    expect(auditText(multilineCode)).toEqual([]);
    const separateParagraph = ["Opening `", "", "[](https://example.com)", "", "Closing`"].join(BREAK);
    expect(rulesFor(separateParagraph)).toContain("link-text");
  });

  test("visible link-definition lookalikes remain prose", () => {
    for (const visible of [
      "[ ]: /url",
      "[a[b]: /url",
      "[a]: foo)bar",
      "[a]: foo(bar",
      `[${"a".repeat(1000)}]: /url`,
    ]) {
      expect(proseBlocks(visible).map((block) => block.lines[0]), visible).toEqual([visible]);
    }
    // The definition is invalid, while the complete <bar> within it is still
    // HTML markup. The line remains a paragraph after that tag is removed.
    expect(proseBlocks("[a]: <foo<bar>")).toHaveLength(1);
    expect(proseBlocks("[a]: <foo<bar>")[0]?.lines[0]).toContain("[a]: <foo");
    expect(proseBlocks("[a]: /url\t\"title\"")).toHaveLength(1);

    for (const definition of [
      "[a\\]]: <foo\\>bar>",
      "[a]: foo\\(bar\\)",
      "[a]: <foo>",
      "[a]: <>",
      "[a]: /url ",
      "[a]: /url 'title'",
      "[a]: /url (title)",
    ]) {
      expect(proseBlocks(definition), definition).toEqual([]);
    }
    expect(proseBlocks("[a]: <foo")).toHaveLength(1);
    expect(proseBlocks("[a]:")).toHaveLength(1);

    for (const invisible of [
      `[a]: /url "[](https://example.com)"`,
      `[a]: /url "![](image.png)"`,
    ]) {
      expect(auditText(invisible), invisible).toEqual([]);
    }
  });

  // A filler word must survive emphasis and typography, and must not match
  // the start of an ordinary word.
  test("filler openings are matched as words, however they are typed", () => {
    for (const filler of [
      "Certainly! The answer is 42.",
      "**Certainly!** The answer is 42.",
      "*Certainly!* The answer is 42.",
      "I’d be happy to explain.",
      "I'd be happy to explain.",
    ]) {
      expect(rulesFor(filler), filler).toContain("filler-opening");
    }
    for (const ordinary of [
      "Surely the answer is correct.",
      "Sure-fire evidence supports the answer.",
      "Sure_footed evidence supports the answer.",
      "Let meadows grow naturally.",
      "The answer is 42.",
    ]) {
      expect(rulesFor(ordinary), ordinary).not.toContain("filler-opening");
    }
  });

  // Round 8. A technical writer met a dozen findings for ordinary vocabulary,
  // which is the shortest route to switching the hook off. The shipped list
  // stays universal; each project extends it for itself.
  test("a project can name the acronyms it treats as known", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-acronyms-"));
    try {
      expect(rulesFor("The SQL layer changed.")).toContain("acronym-undefined");
      const known = new Set(["SQL"]);
      expect(auditText("The SQL layer changed.", { knownAcronyms: known })).toEqual([]);

      // No config leaves the core list alone.
      expect(projectAcronyms(temp).size).toBe(0);

      mkdirSync(join(temp, ".iso-24495-4"), { recursive: true });
      const config = join(temp, ".iso-24495-4", "acronyms.json");
      writeFileSync(config, JSON.stringify(["sql", " SDK ", "", 7]));
      const loaded = projectAcronyms(temp);
      expect([...loaded].sort()).toEqual(["SDK", "SQL"]);

      // Malformed configuration must never stop a document being audited.
      writeFileSync(config, "{not json");
      expect(projectAcronyms(temp).size).toBe(0);
      writeFileSync(config, JSON.stringify({ allow: ["SQL"] }));
      expect(projectAcronyms(temp).size).toBe(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  // A definition counts wherever a reader can see it. Structural contexts
  // once fell outside the acronym scan, so a visible definition did not count.
  test("an acronym defined in a heading or list counts as defined", () => {
    const use = ["", "The DOM loads first.", ""];
    expect(rulesFor(["## Document Object Model (DOM)", ...use].join("\n")))
      .not.toContain("acronym-undefined");
    expect(rulesFor(["- Document Object Model (DOM)", ...use].join("\n")))
      .not.toContain("acronym-undefined");
    expect(rulesFor([
      "| Term | Meaning |",
      "|---|---|",
      "| Document Object Model (DOM) | tree |",
      ...use,
    ].join("\n")))
      .not.toContain("acronym-undefined");
    expect(rulesFor("The DOM loads first.")).toContain("acronym-undefined");
  });

  // A pull request description has no front matter: GitHub shows a leading "---"
  // block as a rule and a heading, so the audit hid text a reader sees. A file in a
  // repository may carry metadata, so the default reading does not change.
  test("a leading front matter block is metadata by default, and text when told so", () => {
    const description = ["---", "note: The tenant shall pay.", "---", ""].join(BREAK);
    expect(auditText(description)).toEqual([]);
    expect(headings(description)).toEqual([]);
    expect(readDocument(description).hidden(1)).toBe(true);
    const asText = { frontMatter: false };
    expect(auditText(description, asText)).toEqual([
      { rule: "legalese", line: 2, detail: 'banned term "shall"' },
      { rule: "heading-style", line: 2, detail: "heading ends with a full stop" },
    ]);
    expect(headings(description, asText))
      .toEqual([{ level: 2, line: 2, text: "note: The tenant shall pay.", lines: 1, setext: true }]);
    expect(readDocument(description, asText).hidden(1)).toBe(false);
    // The paragraph became the heading's text, so no prose block remains either way.
    expect(proseBlocks(description, asText)).toEqual([]);
    expect(readerProseBlocks(description, asText)).toEqual([]);
    // A block that closes with "..." is metadata too. Read as text, the closing line
    // is no underline, so the line above it stays a paragraph and its word reports.
    const dotted = ["---", "note: The tenant shall pay.", "...", ""].join(BREAK);
    expect(rulesFor(dotted)).toEqual([]);
    expect(auditText(dotted, asText).map((violation) => violation.rule)).toContain("legalese");
    // Every rule reads the same way. Each of these hides behind front matter by
    // default, and reports once the block is read as text.
    for (const [rule, body] of [
      ["acronym-undefined", "note: The IAM endpoint works."],
      ["link-text", "note: [click here](/refunds)"],
      ["image-alt", "note: ![](chart.png)"],
      ["doublet", "note: each and every record"],
      ["wordy-phrase", "note: in order to pay"],
      ["complex-word", "note: utilise the record"],
      ["double-negative", "note: not uncommon"],
      // An indented line is YAML too, and read as text it is the opening prose.
      ["filler-opening", "  Certainly the record is here"],
      ["sentence-length", `note: ${sentenceOf(31)}`],
      ["prose-enumeration", "note: first a, second b, third c"],
    ] as const) {
      const block = ["---", body, "...", ""].join(BREAK);
      expect(rulesFor(block), rule).not.toContain(rule);
      expect(auditText(block, asText).map((violation) => violation.rule), rule).toContain(rule);
    }
    // The option changes nothing for a document without a leading block.
    const plain = ["Body text.", "", "---", "note: The tenant shall pay.", "---"].join(BREAK);
    expect(auditText(plain, asText)).toEqual(auditText(plain));
  });

  // A reader reads a heading, so the rules about words read it too. The rules about
  // sentences stay out, because a heading is not a sentence and heading-style already
  // bounds its length. "## The tenant shall pay" once reported nothing in any document.
  test("the rules about words read headings, and the rules about sentences do not", () => {
    const located = (text: string): Array<[string, number]> =>
      auditText(text).map((violation) => [violation.rule, violation.line]);
    // Each of the five rules, one at a time, on an ATX heading and on a Setext one.
    // A Setext heading over two lines reports on its first line, where it starts.
    for (const [rule, words] of [
      ["legalese", "The tenant shall pay"],
      ["doublet", "Keep each and every record"],
      ["wordy-phrase", "Restart in order to apply"],
      ["complex-word", "Utilise the record"],
      ["double-negative", "Failure is not uncommon"],
    ] as const) {
      expect(auditText(`## ${words}`), rule).toEqual([expect.objectContaining({ rule, line: 1 })]);
      expect(located(["Plain words here.", "", words, "---"].join(BREAK)), rule)
        .toEqual([[rule, 3]]);
      const [first, ...rest] = words.split(" ");
      expect(located(["Plain words here.", "", `${first} ${rest[0]}`, rest.slice(1).join(" "), "==="]
        .join(BREAK)), `${rule} over two lines`).toEqual([[rule, 3]]);
    }
    expect(auditText(["## The tenant shall pay", "", "Plain words here."].join(BREAK)))
      .toEqual([{ rule: "legalese", line: 1, detail: 'banned term "shall"' }]);
    const loaded = "## In order to utilise each and every record, failure is not uncommon";
    expect(rulesFor(loaded).sort())
      .toEqual(["complex-word", "double-negative", "doublet", "wordy-phrase"]);
    // Findings from headings and prose are listed in the order a reader meets them.
    expect(located(["## Utilise one", "", "Utilise two.", "", "## Utilise three"].join(BREAK)))
      .toEqual([["complex-word", 1], ["complex-word", 3], ["complex-word", 5]]);
    // A heading inside a quotation or a list item, and a later heading, carry their own lines.
    expect(located("> ## The tenant shall pay")).toEqual([["legalese", 1]]);
    expect(located("- ## The tenant shall pay")).toEqual([["legalese", 1]]);
    expect(located(["Plain text.", "", "- item", "", "  ### The tenant shall pay"].join(BREAK)))
      .toEqual([["legalese", 5]]);
    // A heading inside a fence is code, and a banned word named in a code span is a
    // mention rather than a use, in a heading as in prose.
    expect(rulesFor(["```", "## The tenant shall pay", "```"].join(BREAK))).toEqual([]);
    const tick = String.fromCharCode(96);
    for (const [term, rule] of [
      ["shall", "legalese"],
      ["each and every", "doublet"],
      ["in order to", "wordy-phrase"],
      ["utilise", "complex-word"],
      ["not uncommon", "double-negative"],
    ] as const) {
      expect(rulesFor(`## Avoid ${tick}${term}${tick}`), rule).toEqual([]);
      expect(rulesFor(`## Avoid "${term}"`), rule).toEqual([]);
    }
    // The rules about sentences leave a heading alone: its length is heading-style's.
    const long = `## ${Array.from({ length: 31 }, (_, index) => `word${index}`).join(" ")}`;
    expect(rulesFor(long)).toEqual(["heading-style"]);
    expect(rulesFor("## First check the logs, second restart it, and third tell the team"))
      .not.toContain("prose-enumeration");
    expect(rulesFor("# Certainly! The guide")).not.toContain("filler-opening");
    // Six short sentences in a heading are heading-style's to report, not a paragraph.
    expect(rulesFor("## One. Two. Three. Four. Five. Six")).toEqual(["heading-style"]);
    // Headings never enter the average. Nine long sentences sit under the sample floor,
    // and a long heading beside them must not lift the count to ten.
    const longSentences = Array.from({ length: 9 }, () => sentenceOf(25)).join(BREAK + BREAK);
    const longHeading = `## ${Array.from({ length: 25 }, (_, word) => `heading${word}`).join(" ")}`;
    expect(rulesFor([longSentences, longHeading].join(BREAK + BREAK)))
      .not.toContain("sentence-average");
    expect(rulesFor([longSentences, sentenceOf(25)].join(BREAK + BREAK)))
      .toContain("sentence-average");
    // An acronym used only in a heading is not reported: the heading is usually the
    // name of the thing, and a use in prose beneath it reports there.
    expect(rulesFor("## The DOM")).toEqual([]);
    expect(rulesFor(["## The DOM", "", "The DOM loads first."].join(BREAK)))
      .toEqual(["acronym-undefined"]);
    // The front matter case, without its full stop, reports when the block is text.
    const description = ["---", "note: We shall pay", "---"].join(BREAK);
    expect(auditText(description, { frontMatter: false }).map((v) => [v.rule, v.line]))
      .toEqual([["legalese", 2]]);
  });

  // A soft line break is a space to the reader, so a definition wrapped across two
  // lines is one definition. The scan read a source line at a time, so "identity and
  // access" and "management (IAM)" on the next line never met, and IAM was reported.
  // Indented code is a specimen, as fenced code is, so the rules that read line by
  // line skip it too. It was left out of prose but still read for links, images and
  // acronym definitions, so a code example drew advice and defined an acronym.
  test("indented code is skipped by the line rules, as fenced code is", () => {
    for (const code of ["    ![](sample.png)", "    [click here](/sample)"]) {
      expect(rulesFor(code), code).toEqual([]);
      expect(rulesFor(["```", code.trim(), "```"].join(BREAK)), code).toEqual([]);
    }
    const defined = ["Identity and access management (IAM)", "", "The IAM endpoint works."];
    expect(auditText(["    " + defined[0], ...defined.slice(1)].join(BREAK))
      .filter((violation) => violation.rule === "acronym-undefined")
      .map((violation) => violation.line)).toEqual([3]);
    // The same line as prose still defines the acronym.
    expect(rulesFor(defined.join(BREAK))).not.toContain("acronym-undefined");
  });

  test("an acronym's definition is found across a wrapped line, and not across a block", () => {
    const use = ["", "The IAM endpoint works."];
    const wrapped = ["The identity and access", "management (IAM) endpoint works."];
    expect(rulesFor(wrapped.join(BREAK))).not.toContain("acronym-undefined");
    expect(rulesFor([...wrapped, ...use].join(BREAK))).not.toContain("acronym-undefined");
    expect(rulesFor(["- The identity and access", "  management (IAM) endpoint works.", ...use]
      .join(BREAK))).not.toContain("acronym-undefined");
    expect(rulesFor(["> The identity and access", "> management (IAM) endpoint works.", ...use]
      .join(BREAK))).not.toContain("acronym-undefined");
    // The words carry across more than one break.
    expect(rulesFor(["The identity", "and access", "management (IAM) works."].join(BREAK)))
      .not.toContain("acronym-undefined");

    // A paragraph break, a list item boundary, a quotation boundary and a heading each
    // end the words that can spell an acronym, as they end the sentence a reader is in.
    for (const document of [
      ["The identity and access", "", "management (IAM) endpoint works."],
      ["- identity and access", "- management (IAM) endpoint works."],
      ["> The identity and access", "", "management (IAM) endpoint works."],
      ["The identity and access", "# management (IAM)", ...use],
    ]) {
      expect(rulesFor(document.join(BREAK)), document.join(" / ")).toContain("acronym-undefined");
    }

    // A setext heading's text can wrap too, and it is one heading to the reader, so a
    // definition wrapped inside it is found. Its words still end with the heading.
    for (const underline of ["===", "---"]) {
      expect(rulesFor(["Identity and access", "management (IAM)", underline, ...use].join(BREAK)),
        underline).not.toContain("acronym-undefined");
      expect(rulesFor(["Identity and access", underline, "", "management (IAM) works.", ...use]
        .join(BREAK)), underline).toContain("acronym-undefined");
    }

    // A use before the wrapped definition is still a use before any definition.
    expect(auditText(["The IAM endpoint works.", "", ...wrapped].join(BREAK))
      .filter((violation) => violation.rule === "acronym-undefined")
      .map((violation) => violation.line)).toEqual([1]);

    // Code and table cells are not a sentence a reader is in, so their words never
    // begin a definition that the next paragraph finishes.
    for (const document of [
      ["```", "identity and access", "```", "management (IAM) endpoint works."],
      ["| Term |", "|---|", "| identity and access |", "", "management (IAM) endpoint works."],
      ["| Term |", "|---|", "| identity and access |", "| management (IAM) |", ...use],
    ]) {
      expect(rulesFor(document.join(BREAK)), document.join(" / ")).toContain("acronym-undefined");
    }
  });

  // Every complex-word suggestion must be no longer than the word it replaces,
  // or taking the advice pushes a sentence at the cap over it.
  test("complex-word advice never creates a longer sentence", () => {
    const padding = Array(27).fill("word").join(" ");
    for (const [word, plain] of COMPLEX_WORDS) {
      expect(plain.split(" ").length, `${word} -> ${plain}`).toBe(1);
    }
    expect(rulesFor(`The clause whereby ${padding}.`)).toEqual(["complex-word"]);
    expect(rulesFor(`The clause how ${padding}.`)).toEqual([]);
  });

  // Round 7 repairs, each a defect an external reviewer found and I reproduced.
  test("the newest rules survive the shapes real documents take", () => {
    // A filler word is only filler when it is a whole word.
    expect(rulesFor("Surely the answer is correct.")).not.toContain("filler-opening");
    expect(rulesFor("Let meadows grow naturally.")).not.toContain("filler-opening");
    expect(rulesFor("Certainly! The answer is 42.")).toContain("filler-opening");

    // Front matter is metadata, not the opening sentence.
    const frontMatter = ["---", "title: Guide", "---", ""];
    expect(rulesFor([...frontMatter, "Certainly! The answer is 42."].join("\n")))
      .toContain("filler-opening");
    expect(rulesFor([...frontMatter, "The answer is 42."].join("\n")))
      .not.toContain("filler-opening");

    // Outer pipes are optional, and the divider may carry colons and padding.
    const tables: Array<[string[], boolean]> = [
      [["Name | ", "---|---", " a | b "], true],
      [["Name | Role", "---|---", " a | b "], false],
      [["| Name | |", "|:---|---:|", "| a | b |"], true],
      [["| Name | |", "| --- | --- |", "| a | b |"], true],
      [["| Name | Role |", "|---|---|", "| a | b |"], false],
    ].map(([rows, expected]) => [(rows as string[]).join("\n"), expected as boolean]);
    for (const [table, expected] of tables) {
      expect(rulesFor(table).includes("table-header"), JSON.stringify(table)).toBe(expected);
    }

    // A word being named is being discussed, not used. Quotation marks and
    // backticks name it; emphasis does not, because a writer emphasises a word
    // they are using. While emphasis counted as naming, a whole sentence in
    // bold escaped every rule that reads words, and documents bold whole
    // sentences constantly.
    expect(rulesFor("We will utilise the service.")).toContain("complex-word");
    for (const named of [
      "Prefer `use` over `utilise` in every case.",
      "The word \"utilise\" is the one to avoid.",
      "The word \u201cutilise\u201d is the one to avoid.",
    ]) {
      expect(rulesFor(named), named).not.toContain("complex-word");
    }
    for (const used of [
      "Prefer use over *utilise* in every case.",
      "Prefer use over **utilise** in every case.",
      "**We will utilise the service.**",
    ]) {
      expect(rulesFor(used), used).toContain("complex-word");
    }
    // The same rule governs the three that learned it later.
    expect(rulesFor("**The supplier shall hereby comply.**")).toContain("legalese");
    expect(rulesFor("Never write `shall` in a contract.")).not.toContain("legalese");
    expect(rulesFor("Write **in order to** as two words fewer.")).toContain("wordy-phrase");
    expect(rulesFor("Write \"in order to\" as two words fewer.")).not.toContain("wordy-phrase");

    // The advice must not create the next violation. "ascertain" suggests
    // "find", which is shorter, so a sentence at the cap stays at the cap.
    const padding = Array(27).fill("word").join(" ");
    expect(rulesFor(`We must ascertain ${padding}.`)).toEqual(["complex-word"]);
    expect(rulesFor(`We must check ${padding}.`)).toEqual([]);

    // One violation per fault, so the advisory line counts honestly.
    expect(auditText("![](diagram.png)")).toHaveLength(1);
    expect(auditText("![   ](diagram.png)")).toHaveLength(1);
  });

  // The corpus was worthless as a measurement while every document sat below
  // the ten-sentence floor, because the average rule was never even evaluated.
  // This document is external prose under the Open Government Licence, and its
  // expected numbers were written down before the engine first read it.
  test("external published prose is measured at the average rule's sample floor", () => {
    const path = join(KNOWN_GOOD, "govuk-universal-credit.md");
    const text = readFileSync(path, "utf8");
    let sentences = 0;
    let words = 0;
    let longest = 0;
    for (const block of proseBlocks(text)) {
      for (const sentence of splitSentences(block.lines.join(" "))) {
        const count = wordCount(sentence);
        if (count === 0) continue;
        sentences += 1;
        words += count;
        longest = Math.max(longest, count);
      }
    }
    // The adjudication, frozen before the first run: ten sentences, an average
    // of 18.0 words, a longest sentence of 26, and nothing to report.
    expect(sentences).toBe(10);
    expect(sentences).toBeGreaterThanOrEqual(ENGINE_THRESHOLDS.averageMinimumSentences);
    expect(Number((words / sentences).toFixed(1))).toBe(18.0);
    expect(longest).toBe(26);
    expect(auditText(text)).toEqual([]);
  });

  test("ATX and Setext headings share the complete heading contract", () => {
    const long = "A Very Long Heading Containing More Than Twelve Words In This Particular Document Today";
    const longSetext = `${long}\n${"-".repeat(80)}`;
    const violations = auditText(longSetext);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("heading-style");
    expect(violations[0].line).toBe(1);
    expect(proseBlocks(longSetext)).toEqual([]);

    const linked = "[Install the service](https://example.com/install)\n==================================================";
    expect(headings(linked)).toEqual([{ level: 1, line: 1, text: "Install the service", lines: 1, setext: true }]);
    const skipped = rulesFor("First heading\n=============\n### Third heading");
    expect(skipped).toContain("heading-skip");

    for (let spaces = 0; spaces <= 3; spaces++) {
      const indent = " ".repeat(spaces);
      expect(headings(`${indent}# ATX heading`), `ATX at ${spaces} spaces`).toHaveLength(1);
      expect(headings(`${indent}Setext heading\n${indent}---`), `Setext at ${spaces} spaces`).toHaveLength(1);
    }
    expect(headings("    # Indented code")).toEqual([]);
    expect(headings("    Setext-like code\n    ----------------")).toEqual([]);
    expect(rulesFor("## **Policy title.**")).toContain("heading-style");

    const negatives = [
      "---",
      "---\ntitle: Draft\n---",
      "```md\nFenced text\n---\n```",
      "Heading text\n\n---",
    ];
    for (const input of negatives) {
      expect(headings(input), input).toEqual([]);
    }
  });

  test("Markdown exclusions and visible prose follow an explicit contract", () => {
    const quoted = "> The supplier shall hereby provide each and every record.";
    const table = [
      "| Term | Explanation |",
      "| --- | --- |",
      `| Record | The supplier shall ${Array(31).fill("word").join(" ")} |`,
    ].join("\n");
    // A quotation is prose a reader reads, and Markdown cannot prove who wrote
    // it. GitHub renders an alert with this syntax, and the plugin's own
    // runbook template asks writers to use one, so silence there would hide
    // the most important sentence in the document.
    expect(auditText(quoted).map((violation) => violation.rule).sort())
      .toEqual(["doublet", "legalese", "legalese"]);
    expect(auditText("> [!WARNING]\n> The supplier shall respond.")
      .map((violation) => violation.rule)).toEqual(["legalese"]);
    // The alert label is not a sentence, and the quote markers are not words:
    // a thirty-word quotation is thirty words, not thirty-two.
    const thirtyWords = Array.from({ length: 30 }, (_u, index) => `word${index}`).join(" ");
    expect(proseBlocks(`> [!WARNING]${BREAK}> ${thirtyWords}.`))
      .toEqual([{ line: 2, lines: [`${thirtyWords}.`] }]);
    expect(rulesFor(`> [!WARNING]${BREAK}> ${thirtyWords}.`)).toEqual([]);
    // The alert label itself is not a sentence.
    expect(auditText("> [!NOTE]\n> A short note.")).toEqual([]);
    // A table stays a grid, quoted or not.
    expect(auditText(table)).toEqual([]);
    expect(auditText(table.split("\n").map((row) => `> ${row}`).join("\n"))).toEqual([]);
    // A nested quotation is its own block, not a continuation of the one
    // around it, so two sentences are not joined into one.
    expect(proseBlocks(["> Outer sentence here.", ">> A nested one."].join(BREAK)))
      .toEqual([
        { line: 1, lines: ["Outer sentence here."] },
        { line: 2, lines: ["A nested one."] },
      ]);
    // A quoted span names a term only when the span is the term. A quoted
    // sentence is prose the writer chose to include, however short it is.
    expect(rulesFor('Never write "shall" in a contract.')).toEqual([]);
    expect(rulesFor('Never write `shall` in a contract.')).toEqual([]);
    expect(rulesFor('The policy says "Staff shall submit requests" today.'))
      .toContain("legalese");
    expect(rulesFor('Write "in order to" as two words fewer.')).toEqual([]);
    expect(rulesFor('The note said "we did this in order to comply".'))
      .toContain("wordy-phrase");

    // A heading is a heading, whatever container holds it.
    expect(headings("# Top\n- ### Nested").map((h) => h.level)).toEqual([1, 3]);
    expect(rulesFor("- ## Nested heading.")).toContain("heading-style");
    // A list item is the writer's own prose, so it is measured. A nested item
    // is its own block, which is why six bullets are not a six-sentence
    // paragraph.
    expect(auditText("- Parent\n  - The supplier shall respond.")
      .map((violation) => violation.rule)).toEqual(["legalese"]);
    const sixItems = Array.from({ length: 6 }, (_unused, index) => `- Item ${index}.`);
    expect(auditText(sixItems.join("\n"))).toEqual([]);
    // An item holds whole blocks, so a second paragraph inside one is measured
    // rather than read as indented code.
    const twoParagraphs = ["-   First paragraph.", "", "    The supplier shall respond.", "", "- Last."];
    expect(rulesFor(twoParagraphs.join("\n"))).toContain("legalese");
    // A line that matches the outer item but not the inner one continues the
    // inner paragraph, which is what CommonMark laziness says and what the
    // reference parser does. Six sentences in one paragraph is a real finding.
    const nested = ["- Parent.", "  - Child one. Child two. Child three.", "  Parent four. Parent five. Parent six."];
    expect(rulesFor(nested.join("\n"))).toContain("paragraph-length");
    // A task marker is a control, not two words.
    const twentyNine = Array.from({ length: 29 }, (_unused, index) => `word${index}`).join(" ");
    expect(rulesFor(`- [ ] ${twentyNine}.`)).toEqual([]);

    const separated = [
      quoted,
      "",
      table,
      "",
      "```text",
      "The supplier shall respond.",
      "```",
      "",
      "- Listed item",
      "",
      "The supplier shall respond.",
    ].join("\n");
    const legalese = auditText(separated).filter((violation) => violation.rule === "legalese");
    // The quotation on line 1 and the paragraph on line 13 are prose. The
    // table and the fenced block between them are not.
    expect(legalese.map((violation) => violation.line)).toEqual([1, 1, 13]);

    expect(proseBlocks("A hard line break stays  \ninside its paragraph.")).toEqual([
      { line: 1, lines: ["A hard line break stays  ", "inside its paragraph."] },
    ]);

    // Footnote bodies and HTML contain reader-visible prose, so their text is
    // audited. The deterministic parser ignores the markup rather than hiding
    // the words from every rule.
    expect(rulesFor("A note.[^1]\n\n[^1]: The supplier shall respond.")).toContain("legalese");
    expect(rulesFor("<p>The supplier shall respond.</p>")).toContain("legalese");
  });

  test("encoding, typography, and English variety do not change advice", () => {
    for (const separator of [" ", "\u00a0"]) {
      const thirty = Array(30).fill("word").join(separator) + ".";
      const thirtyOne = Array(31).fill("word").join(separator) + ".";
      expect(wordCount(thirty), JSON.stringify(separator)).toBe(30);
      expect(rulesFor(thirty)).not.toContain("sentence-length");
      expect(wordCount(thirtyOne), JSON.stringify(separator)).toBe(31);
      expect(rulesFor(thirtyOne)).toContain("sentence-length");
    }

    const lines = Array.from({ length: 50 }, (_, index) =>
      index === 41 ? "The supplier shall respond." : `Line ${index + 1} is short.`);
    const lf = auditText(lines.join("\n"));
    const crlf = auditText(lines.join("\r\n"));
    expect(crlf).toEqual(lf);
    expect(lf.find((violation) => violation.rule === "legalese")?.line).toBe(42);

    const straight = rulesFor("The \"XYZ\" service starts.");
    const smart = rulesFor("The \u201cXYZ\u201d service starts.");
    expect(straight).toEqual(["acronym-undefined"]);
    expect(smart).toEqual(straight);

    const compound = "First review the service, second inspect the contract, and third-party support follows.";
    expect(rulesFor(compound)).not.toContain("prose-enumeration");
    expect(wordCount("café l’école coöperate")).toBe(3);

    for (const pair of [
      ["CHECK COLOR FIRST", "CHECK COLOUR FIRST"],
      ["AUTHORIZE ACCESS NOW", "AUTHORISE ACCESS NOW"],
    ]) {
      expect(auditText(pair[0])).toEqual([]);
      expect(auditText(pair[1])).toEqual(auditText(pair[0]));
    }
  });

  test("rules compose independently and documentation states the capability boundary", () => {
    const tail = Array.from({ length: 23 }, (_, index) => `item${index}`);
    const sentence = `The XYZ service shall keep each and every ${tail.join(" ")}.`;
    expect(wordCount(sentence)).toBe(31);
    expect(rulesFor(sentence).sort()).toEqual([
      "acronym-undefined",
      "doublet",
      "legalese",
      "sentence-length",
    ]);

    const repairs: Array<[string, string]> = [
      [sentence.replace("shall", "must"), "legalese"],
      [sentence.replace("each and every", "each").replace("item22.", "item22 for every reader."), "doublet"],
      [sentence.replace("XYZ", "XYZ (Xylophone Yield Zone)"), "acronym-undefined"],
      [sentence.replace("item10", "item10. Continue"), "sentence-length"],
    ];
    const originalRules = new Set(rulesFor(sentence));
    for (const [repaired, removed] of repairs) {
      const expected = [...originalRules].filter((rule) => rule !== removed).sort();
      expect(rulesFor(repaired).sort(), removed).toEqual(expected);
    }

    const positiveAndNegative: Record<string, [string, string]> = {
      "sentence-length": [sentenceOf(31), sentenceOf(30)],
      "sentence-average": [Array(10).fill(sentenceOf(21)).join(" "), Array(10).fill(sentenceOf(20)).join(" ")],
      "paragraph-length": ["One. Two. Three. Four. Five. Six.", "One. Two. Three. Four. Five."],
      legalese: ["The supplier shall respond.", "The supplier must respond."],
      "heading-depth": ["##### Deep", "#### Permitted"],
      "heading-skip": ["# First\n### Third", "# First\n## Second"],
      "heading-style": ["# One two three four five six seven eight nine ten eleven twelve thirteen", "# One two three four five six seven eight nine ten eleven twelve"],
      "acronym-undefined": ["The XYZ service starts.", "Xylophone Yield Zone (XYZ) starts."],
      doublet: ["Check each and every record.", "Check each record."],
      "prose-enumeration": ["First inspect it, second test it, and third report it.", "First inspect it and second test it."],
      // A listener navigating by links hears only the link text, so "click
      // here" tells them nothing about where it goes.
      "link-text": ["See [click here](https://example.com/refunds).", "See [how to claim a refund](https://example.com/refunds)."],
      // A reader who cannot see the image gets nothing at all from it.
      "image-alt": ["![](diagram.png)", "![Order flow from basket to payment](diagram.png)"],
      // An empty label is the worst case: the listener hears the link
      // announced and is told nothing whatsoever about it.
      "link-text-empty": ["See [](https://example.com/refunds).", "See [the refund policy](https://example.com/refunds)."],
      // The core skill has listed these swaps since the first release and
      // nothing checked them, so the guidance asked for something the engine
      // never looked at.
      "wordy-phrase": ["Restart the service in order to apply the change.", "Restart the service to apply the change."],
      // The skill has always named the plain word; nothing checked it. A word
      // in emphasis is being discussed, so the skill can still name it.
      "complex-word": ["We will utilise the service.", "We will use the service."],
      // The part of positive framing a rule can judge. A blanket check for
      // "do not" was measured and rejected: 58 hits in our own documents, of
      // which three were warnings.
      "double-negative": ["It is not uncommon for the check to fail.", "The check often fails."],
      // The skill's first rule is to open with the answer.
      "filler-opening": ["Certainly! The answer is 42.", "The answer is 42."],
      // A listener hears each cell announced against its column name.
      "table-header": [
        ["| Name | |", "|---|---|", "| a | b |"].join("\n"),
        ["| Name | Role |", "|---|---|", "| a | b |"].join("\n"),
      ],
    };
    const empty = positiveAndNegative["link-text-empty"];
    expect(rulesFor(empty[0]), "an empty link label reports link-text").toContain("link-text");
    expect(rulesFor(empty[1]), "a described link stays clean").not.toContain("link-text");
    delete positiveAndNegative["link-text-empty"];

    // Two phrases in one paragraph, and one nested inside a longer phrase. The
    // longest wins, so "in spite of the fact that" is not also counted as the
    // shorter phrase inside it.
    const wordy = auditText(
      "In spite of the fact that it failed, restart it in order to apply the change.")
      .filter((violation) => violation.rule === "wordy-phrase");
    expect(wordy).toHaveLength(2);
    expect(wordy.map((violation) => violation.detail)).toEqual([
      '"in spite of the fact that" says what "although" says',
      '"in order to" says what "to" says',
    ]);

    expect(Object.keys(positiveAndNegative).sort()).toEqual([...RULES].sort());
    for (const rule of RULES) {
      const [positive, negative] = positiveAndNegative[rule];
      expect(rulesFor(positive), `${rule} positive`).toContain(rule);
      expect(rulesFor(negative), `${rule} negative`).not.toContain(rule);
    }

    const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
    const capability = "They also cover `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, `prose-enumeration`, `link-text`, `image-alt`, `wordy-phrase`, `complex-word`, `double-negative`, `filler-opening`, and `table-header`.";
    // The two rules for readers who cannot see the page must be explained, not
    // merely listed, or nobody knows why they exist.
    expect(readme).toContain("readers who hear or touch a document rather than look at it");
    expect(readme).toContain(capability);
    expect(auditText("The form was approved by the manager.\n\nThe office opened, and the service changed.")).toEqual([]);
    expect(capability).not.toMatch(/active voice|main idea/i);
  });
});

/** Every finding as one comparable line, so two texts can be held to the same result. */
function findingsIn(text: string): string[] {
  return auditText(text).map((v) => `${v.rule} at line ${v.line}: ${v.detail}`);
}

describe("emphasis marks inside or beside a word", () => {
  test("a word rule finds a marked word or phrase exactly as it finds the plain one", () => {
    // The word rules matched their patterns against Markdown source. A mark inside a
    // phrase broke the match, and an underscore beside a word removed the word boundary,
    // so "in **order** to" and "_shall_" were never reported. A reader sees the same words.
    const cases: Array<[rule: string, plain: string, marked: string[]]> = [
      ["wordy-phrase", "We did this in order to finish the work.", [
        "We did this in **order** to finish the work.",
        "We did this in *order* to finish the work.",
        "We did this in _order_ to finish the work.",
        "We did this in __order__ to finish the work.",
        "We did this **in** order to finish the work.",
        "We did this in or*de*r to finish the work.",
        "We did this _in order to_ finish the work.",
        "We did this __in order to__ finish the work.",
        "We did this **in order to** finish the work.",
        "We did this ***in** order* to finish the work.",
      ]],
      ["legalese", "The tenant shall vacate the premises.", [
        "The tenant sh*all* vacate the premises.",
        "The tenant sh**all** vacate the premises.",
        "The tenant **sh**all vacate the premises.",
        "The tenant _shall_ vacate the premises.",
        "The tenant __shall__ vacate the premises.",
        "The tenant **shall** vacate the premises.",
      ]],
      ["complex-word", "Please utilise the tool.", [
        "Please util*ise* the tool.",
        "Please **util**ise the tool.",
        "Please _utilise_ the tool.",
      ]],
      ["double-negative", "This is not uncommon here.", [
        "This is not un*common* here.",
        "This is *not* uncommon here.",
        "This is _not uncommon_ here.",
        "This is __not__ uncommon here.",
      ]],
      ["doublet", "It is null and void today.", [
        "It is null *and* void today.",
        "It is **null** and **void** today.",
        "It is _null and void_ today.",
      ]],
      ["acronym-undefined", "Ask the QZX team.", [
        "Ask the **QZX** team.",
        "Ask the *QZX* team.",
        "Ask the _QZX_ team.",
        "Ask the __QZX__ team.",
        "Ask the *Q*ZX team.",
        "Ask the Q**ZX** team.",
      ]],
      ["acronym-undefined", "Ask the team about QZX.", [
        "Ask the team about **QZX**.",
        "Ask the team about **QZX.**",
        "Ask the team about _QZX_.",
      ]],
      ["prose-enumeration", "First we plan. Second we build. Third we test.", [
        "_First_ we plan. _Second_ we build. _Third_ we test.",
        "__First__ we plan. __Second__ we build. __Third__ we test.",
        "**First** we plan. *Second* we build. _Third_ we test.",
        "Fir*st* we plan. Sec*ond* we build. Thi*rd* we test.",
      ]],
      ["prose-enumeration", "We (1) plan, (2) build and (3) test.", [
        "We **(1)** plan, **(2)** build and **(3)** test.",
        "We _(1)_ plan, _(2)_ build and _(3)_ test.",
      ]],
      ["wordy-phrase", "# We did this in order to finish", [
        "# We did this in **order** to finish",
        "# We did this _in order to_ finish",
      ]],
      ["legalese", "- The tenant shall vacate.", ["- The tenant sh*all* vacate.", "- The tenant _shall_ vacate."]],
      ["legalese", "> The tenant shall vacate.", ["> The tenant sh*all* vacate.", "> The tenant _shall_ vacate."]],
    ];
    for (const [rule, plain, marked] of cases) {
      expect(rulesFor(plain), plain).toContain(rule);
      for (const text of marked) {
        expect(findingsIn(text), text).toEqual(findingsIn(plain));
      }
    }
  });

  test("a marked acronym is defined, and defines, as the plain one does", () => {
    const defined = "The quick zebra xylophone (QZX) is here. Use the QZX.";
    expect(findingsIn(defined)).toEqual([]);
    for (const text of [
      "The quick zebra xylophone (**QZX**) is here. Use the QZX.",
      "The quick zebra xylophone **(QZX)** is here. Use the QZX.",
      "The quick zebra xylophone (_QZX_) is here. Use the QZX.",
      "The **quick zebra xylophone** (QZX) is here. Use the **QZX**.",
      "The **QZX** (quick zebra xylophone) is here. Use the QZX.",
      "The QZX **(quick zebra xylophone)** is here. Use the QZX.",
      // Marks before the definition must not move it after the use beside it.
      "**The** *quick* **zebra** *xylophone* (QZX) is here. Use the QZX.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
    // A mark inside a word of the expansion split the word, so its initial was lost.
    for (const text of [
      "The q*uick* zebra xylophone (QZX) is here. Use the QZX.",
      "The quick **z**ebra xylo*phone* (QZX) is here. Use the QZX.",
      "The ~~quick~~ zebra xylo~~phone~~ (**QZX**) is here. Use the QZX.",
      "| Term | Meaning |" + BREAK + "|---|---|" + BREAK + "| q*uick* zebra xylophone (QZX) | a toy |"
        + BREAK + BREAK + "Use the QZX.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
    // A mark with no partner stays on the page, so the bracket holds more than the acronym.
    const loose = "The quick zebra xylophone (*QZX) is here. Use the QZX.";
    expect(findingsIn(loose)).toEqual(['acronym-undefined at line 1: define acronym "QZX" on first use']);
    // A use before the definition is still reported once, on the line it is on.
    const usedFirst = ["Use the **QZX** first.", "", "The quick zebra xylophone (QZX) is here."];
    expect(findingsIn(usedFirst.join(BREAK)))
      .toEqual(['acronym-undefined at line 1: define acronym "QZX" on first use']);
  });

  test("a finding names the line its phrase starts on, wherever the marks sit", () => {
    const wrapped = ["We restarted the service", "in **order** to apply it.", "It then ran."];
    expect(findingsIn(wrapped.join(BREAK)))
      .toEqual(['wordy-phrase at line 2: "in order to" says what "to" says']);
    // Emphasis that opens on one line and closes on the next is still emphasis.
    const spanning = ["The _tenant", "shall_ vacate the premises."];
    expect(findingsIn(spanning.join(BREAK))).toEqual(['legalese at line 2: banned term "shall"']);
    // A phrase that wraps is reported where it starts.
    const split = ["Lead text here.", "", "We restarted it in **order**", "to apply the change."];
    expect(findingsIn(split.join(BREAK)))
      .toEqual(['wordy-phrase at line 3: "in order to" says what "to" says']);
    const later = ["# Title", "", "Plain words.", "", "- one", "- It is *not* un**common** here."];
    expect(findingsIn(later.join(BREAK)))
      .toEqual(['double-negative at line 6: "not uncommon" makes the reader unpick two negatives']);
  });

  test("an underscore inside a word is not emphasis, so an identifier is not a finding", () => {
    // CommonMark reads an asterisk inside a word as emphasis and an underscore there as a
    // literal character. A reader sees "sh_all_" with its underscores, which is no word.
    for (const text of [
      "Set snake_shall_name before the call.",
      "Set shall_name and name_shall and in_order_to here.",
      "The tenant sh_all_ vacate the premises.",
      "We did this in_order_to finish the work.",
      "Read QZX_LIMIT and MAX_QZX from the file.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
  });

  test("a mark with no partner, an escaped mark and code hide nothing new", () => {
    const SLASH = String.fromCharCode(92);
    for (const text of [
      // No partner, so the reader sees the asterisk.
      "We did this in *order to finish the work.",
      "The tenant sh*all vacate the premises.",
      "We did this in order * to finish, 2 * 3 times.",
      // Escaped, so the reader sees both asterisks.
      `We did this in ${SLASH}*order${SLASH}* to finish the work.`,
      `The tenant sh${SLASH}*all${SLASH}* vacate the premises.`,
      // Code is read as it was before: a span holding the term alone names it.
      "Use the `in order to` phrase here.",
      "Use the `in *order* to` phrase here.",
      "Use the `shall` word and the `sh*all*` form.",
      ["```", "We did this in **order** to finish.", "The tenant sh*all* vacate.", "```"].join(BREAK),
      "    The tenant sh*all* vacate, in **order** to finish.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
    // A sentence in a code span was read before this change, and still is.
    expect(findingsIn("Write `the tenant shall vacate` there."))
      .toEqual(['legalese at line 1: banned term "shall"']);
  });

  test("struck words are still words on the page", () => {
    // A struck word was already reported when the whole of it was struck. A reader still
    // sees it, and a screen reader says it without the strike, so a strike inside a phrase
    // is removed like emphasis. Only the two-tilde form is a strike.
    const wordy = findingsIn("We did this in order to finish the work.");
    const legal = findingsIn("The tenant shall vacate.");
    expect(wordy).toHaveLength(1);
    expect(legal).toHaveLength(1);
    expect(findingsIn("We did this ~~in order to~~ finish the work.")).toEqual(wordy);
    expect(findingsIn("We did this in ~~order~~ to finish the work.")).toEqual(wordy);
    expect(findingsIn("The tenant ~~shall~~ vacate.")).toEqual(legal);
    expect(findingsIn("The tenant sh~~all~~ vacate.")).toEqual(legal);
    expect(findingsIn("We did this in ~order~ to finish the work.")).toEqual([]);
    expect(findingsIn("We did this in ~~order to finish the work.")).toEqual([]);
  });

  test("a term that is quoted is named, with or without emphasis", () => {
    // Quotation marks name a word, and emphasis does not. A word in both is named: the
    // reader sees a quoted word. Before, the marks inside the quotation hid the naming.
    for (const text of [
      'The word "shall" is the one to avoid.',
      'The word "**shall**" is the one to avoid.',
      'The word **"shall"** is the one to avoid.',
      "The word '*shall*' is the one to avoid.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
    expect(rulesFor("**The tenant shall vacate.**")).toContain("legalese");
  });

  test("marks that complete a longer word leave no finding for the shorter one", () => {
    // A reader sees "shall*ow*" as the word "shallow". Before, the mark ended the word
    // early and "shall" was reported.
    expect(findingsIn("The shallow end is safe.")).toEqual([]);
    expect(findingsIn("The shall*ow* end is safe.")).toEqual([]);
    expect(findingsIn("Read the QZX*es* list.")).toEqual(findingsIn("Read the QZXes list."));
  });

  test("removing marks takes time in proportion to the text, whatever the marks", () => {
    // One call for each shape against a fixed budget. The slowest shape took about a
    // quarter of a second at this size. Without its record of failed searches, the
    // pairing searches back from every closer to the start of the text: that took 31
    // seconds on the closers alone.
    const shapes: Array<[name: string, text: string]> = [
      ["pairs", "*a* ".repeat(100_000)],
      ["openers with no closer", "*a ".repeat(100_000)],
      ["closers with no opener", "a* ".repeat(100_000)],
      ["openers, then their closers", "*a ".repeat(50_000) + "a* ".repeat(50_000)],
      ["marks inside words", "a**b*c ".repeat(100_000)],
      ["closers of every kind", "a* b_ c** d__ e~~ ".repeat(100_000)],
      ["one long run", `a${"*".repeat(100_000)}b${"*".repeat(100_000)}`],
      ["strikes", "~~a~~ ".repeat(100_000)],
    ];
    for (const [name, text] of shapes) {
      expect(elapsed(() => withoutEmphasis(text)), name).toBeLessThan(3_000);
    }
    // The audit as a whole, which reads the marks once for the word rules, once for the
    // acronym rule and once for the enumeration rule.
    const closers = "a* ".repeat(100_000);
    expect(elapsed(() => auditText(closers))).toBeLessThan(15_000);
    const nested = "*a ".repeat(50_000) + "a* ".repeat(50_000);
    expect(elapsed(() => auditText(nested))).toBeLessThan(15_000);
  }, HOSTILE_TIMEOUT_MS);

  test("a search that failed for one closer does not stop a search for another", () => {
    const wordy = ['wordy-phrase at line 1: "in order to" says what "to" says'];
    // A closer with no opener is remembered, so a later one like it does not search the
    // same marks again. That record is kept for each length of closer. Two marks may not
    // close one inside a word, and one mark after them may.
    expect(findingsIn("x*y a**b in or*der to go.")).toEqual(wordy);
    // Three marks may close three, though their lengths add up to a multiple of three.
    expect(findingsIn("a***b in or***der to go.")).toEqual(wordy);
  });

  test("a document without marks is read as before", () => {
    const text = [
      "# The tenant shall vacate",
      "",
      "We did this in order to finish. It is not uncommon to utilise the QZX.",
      "It is null and void. First we plan. Second we build. Third we test.",
    ].join(BREAK);
    expect(findingsIn(text)).toEqual([
      "paragraph-length at line 3: 6 sentences (limit 5)",
      'legalese at line 1: banned term "shall"',
      'acronym-undefined at line 3: define acronym "QZX" on first use',
      'doublet at line 4: redundant phrase "null and void"; consider "void"',
      "prose-enumeration at line 3: enumeration ranks 1, 2, 3 in prose; consider a list",
      'wordy-phrase at line 3: "in order to" says what "to" says',
      'complex-word at line 3: "utilise" where "use" would do',
      'double-negative at line 3: "not uncommon" makes the reader unpick two negatives',
    ]);
  });
});

describe("a filler opening and the marks around it", () => {
  const TICK = String.fromCharCode(96);

  // A code span names a term. The rule removed every backtick before it looked,
  // so a sentence about the word "Certainly" was reported as opening with it.
  test("a term in code marks at the opening is not a filler opening", () => {
    for (const named of [
      `${TICK}Certainly${TICK} is a word we avoid.`,
      `${TICK}sure${TICK} thing, the config is fine.`,
      `${TICK}${TICK}Certainly${TICK}${TICK}, the answer is 42.`,
      `**${TICK}Certainly${TICK}** is a word we avoid.`,
    ]) {
      expect(rulesFor(named), named).not.toContain("filler-opening");
    }
  });

  test("a filler in paired emphasis is still a filler opening", () => {
    for (const filler of [
      "**Certainly!** The answer is 42.",
      "*Sure*, the answer is 42.",
      "_Certainly_, the answer is 42.",
      "***Certainly***, the answer is 42.",
      "**Certainly,\nthe answer** is 42.",
      `Certainly, ${TICK}config.json${TICK} is fine.`,
    ]) {
      expect(rulesFor(filler), filler).toContain("filler-opening");
    }
  });
});

describe("a block that may hold a link keeps its emphasis marks", () => {
  // Emphasis marks were paired around links in three ways, and each way reported words
  // that a browser does not show. So a block whose source lines hold "[", "<", "://" or
  // "www." is now read as it was before emphasis was paired at all. No mark is removed there, and a
  // phrase that emphasis splits in such a block is not found. Every expectation in
  // this group is what the code before the pairing gave for the same text.
  const TICK = String.fromCharCode(96);
  const SLASH = String.fromCharCode(92);
  const wordy = (line: number) => [`wordy-phrase at line ${line}: "in order to" says what "to" says`];
  const legal = ['legalese at line 1: banned term "shall"'];

  test("every case the reviews raised is read as written", () => {
    for (const text of [
      // A mark outside a link and a mark in its label. A browser shows both.
      "in *or[der*](u) to go.",
      "We did this in *or[der*](u) to finish the work.",
      "We did this in [*or](u)der* to finish the work.",
      "We did this in **or[der**](u) to finish the work.",
      "We did this in _or[der_](u) to finish the work.",
      "We did this in ~~or[der~~](u) to finish the work.",
      "We did this in *or![der*](chart.png) to finish the work.",
      "The tenant sh*a[ll*](u) vacate the premises.",
      "# We did this in *or[der*](u) to finish",
      "- We did this in *or[der*](u) to finish the work.",
      ["We did this in *or[der*][r] to finish the work.", "", "[r]: https://example.com"].join(BREAK),
      ["We did this in *or[der*] to finish the work.", "", "[der*]: https://example.com"].join(BREAK),
      "We did this in or*[*der](u) to finish the work.",
      "We did this in [or*[der*](u)](v) to finish the work.",
      // A closer outside the link with an opener of its own before the link.
      "*x in [or*](u)der* to go.",
      "**x in [or**](u)der** to go.",
      "_x in [_or](u)der_ to go.",
      "~~x in [or~~](u)der~~ to go.",
      "*x in ![or*](chart.png)der* to go.",
      "# *x in [or*](u)der* to go",
      ["*x in [or*][r]der* to go.", "", "[r]: https://example.com"].join(BREAK),
      "![*x in [or*](u)der* to go](chart.png).",
      "*The tenant [sh*](u)all* vacate.",
      // A mark that stands beside the bracket of a link.
      "in or*[der](u)* to go.",
      "We did this in or*[der](u)* to finish the work.",
      "We did this in or**[der](u)** to finish the work.",
      "We did this in or~~[der](u)~~ to finish the work.",
      "We did this in or*![der](chart.png)* to finish the work.",
      "We did this in *[or](u)*der to finish the work.",
      "# We did this in or*[der](u)* to finish",
      "- We did this in or*[der](u)* to finish the work.",
      ["We did this in or*[der][r]* to finish the work.", "", "[r]: https://example.com"].join(BREAK),
      ["We did this in or*[der]* to finish the work.", "", "[der]: https://example.com"].join(BREAK),
      "The tenant sh**a*[*ll**](u) vacate.",
      // A backtick in a destination, which closed a code span further on. A browser
      // shows the phrase here, and it is missed: the block holds a link.
      `in **[order](u${TICK}x)** to go. ${TICK}tail${TICK}`,
      // A mark in an autolink. A browser shows "in or*der to" after the address.
      "<https://e.com/*> in or*der to go.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
    expect(findingsIn("*The tenant [a*](u) shall* vacate.")).toEqual(legal);
  });

  test("a phrase that emphasis splits beside a link is not found, which is the cost", () => {
    expect(findingsIn("We did this in order to finish the work.")).toEqual(wordy(1));
    for (const text of [
      "We did this in *[order](u)* to finish the work.",
      "We did this in **[order](u)** to finish the work.",
      "We did this *in [order](u)* to finish the work.",
      "We did this in [*or*der](u) to finish the work.",
      "We did this in [or*der*](u) to finish the work.",
      "We did this [**in** order](u) to finish the work.",
      "We did this in [**order**](u) to finish the work.",
      "We did this in [or*de*r](u) to finish the work.",
      "We did this *in [or*de*r](u) to* finish the work.",
      "We did this ~~in [_order_](u) to~~ finish the work.",
      "We did this in [or*de*r](u) to finish the ![*work*](chart.png).",
      "# We did this in [or*de*r](u) to finish",
      "*x [y*z](u) in or*der to go.",
      "The tenant *sh[*a*ll](u) vacate.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
    // Marks that stand outside the phrase split nothing, so it was always found.
    for (const text of [
      "We did this **in [order](u) to** finish the work.",
      "**We did this in [order](u) to finish the work.**",
      "# We did this **in [order](u) to** finish",
      "We did this [the guide](a*b*c) in order to finish the work.",
    ]) {
      expect(findingsIn(text), text).toEqual(wordy(1));
    }
    expect(findingsIn("**The tenant [shall](u) vacate.**")).toEqual(legal);
    expect(findingsIn("[**The tenant** shall](u) vacate.")).toEqual(legal);
  });

  test("a bracket that is no link counts as one, and so does an angle bracket", () => {
    // The test for a link reads two characters and nothing else, so it cannot miss a
    // link. Each of these blocks holds no link, and loses its finding all the same.
    for (const text of [
      "The tenant [sh*all] vac*ate.",
      "The tenant [sh*all][nowhere] vac*ate.",
      ["The tenant [sh*all] vac*ate.", "", "[sh*all]: https://example.com"].join(BREAK),
      "- [ ] We did this in **order** to finish.",
      `We did this in **order** to finish ${TICK}list[0]${TICK}.`,
      `We did this in **order** to finish ${SLASH}[sic${SLASH}].`,
      "We did this in **order** to finish when a < b.",
      "We did this in **order** to finish<br>the work.",
      "We did this in **order** to finish, see <https://example.com>.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
  });

  test("a bare address is a link too, with neither bracket", () => {
    // GitHub links an address written with no bracket at all. A mark inside the address
    // is part of the link there, so "or*der" after it keeps its asterisk and the reader
    // does not see the phrase. Each of these was put to GitHub's own renderer.
    for (const text of [
      "https://e.com/*x in or*der to go.",
      "www.e.com/*x in or*der to go.",
      "http://e.com/_x in or_der to go, as a_b says_.",
      // GitHub strips this one of its link and still shows both asterisks.
      "ftp://e.com/*x in or*der to go.",
      // The mark that ends an address is not part of it, and has no partner here.
      "https://e.com/a*b* in or*der to go.",
      "# www.e.com/*x in or*der to go",
      "- www.e.com/*x in or*der to go.",
      // The address and the phrase on two lines of one paragraph.
      ["See https://e.com/*x for more.", "We did this in or*der to finish."].join(BREAK),
      ["We did this in or*der to finish.", "See https://e.com/x* for more."].join(BREAK),
      // An address alone in its block.
      "https://e.com/in*order*to",
      "www.e.com/sh*all*",
      // Not an address on GitHub, which reads "www." in small letters only. It is
      // read as one all the same: the test for an address asks as little as it can.
      "WWW.e.com/*x in or*der to go.",
    ]) {
      expect(findingsIn(text), text).toEqual([]);
    }
    // The block beside the address is read as before.
    expect(findingsIn(["https://e.com/*x", "", "We did this in **order** to finish."].join(BREAK))).toEqual(wordy(3));
    // Both scans for an acronym keep the marks in such a block.
    expect(findingsIn(["identi*ty and access", "management* (IAM), as www.e.com says. Use IAM."].join(BREAK)))
      .toEqual(['acronym-undefined at line 2: define acronym "IAM" on first use']);
  });

  test("an email address shields no mark, so its block keeps the emphasis fix", () => {
    // GitHub finds an email address in text it has already read for emphasis. So the
    // marks pair across the address, the reader sees the phrase, and it is reported.
    // Each of these was put to GitHub's renderer, which shows "in order to" for all.
    for (const text of [
      "mail a*b@e.com in or*der to go.",
      "mailto:a@e.com/*x in or*der to go.",
      "xmpp:a@e.com/x*y in or*der to go.",
      "Write to a@e.com in **order** to go.",
      // A colon, a slash or a full stop alone makes no address.
      "Note: it ran w.w.w and a/b in **order** to go.",
      "The crowd said awww in **order** to go.",
    ]) {
      expect(findingsIn(text), text).toEqual(wordy(1));
    }
  });

  test("each block is judged alone, by every line it was read from", () => {
    // A link in one block leaves the block beside it as it was.
    expect(findingsIn(["We did this in **order** to finish.", "", "See [the guide](u)."].join(BREAK)))
      .toEqual(wordy(1));
    expect(findingsIn(["See [the guide](u).", "", "We did this in **order** to finish."].join(BREAK)))
      .toEqual(wordy(3));
    expect(findingsIn(["- See [the guide](u).", "- We did this in **order** to finish."].join(BREAK)))
      .toEqual(wordy(2));
    expect(findingsIn(["# We did this in **order** to finish", "", "See [the guide](u)."].join(BREAK)))
      .toEqual(wordy(1));
    expect(findingsIn(["# The guide [there](u)", "", "We did this in **order** to finish."].join(BREAK))
      .filter((finding) => finding.startsWith("wordy"))).toEqual(wordy(3));
    // A link on any line of a block decides for the whole block.
    expect(findingsIn(["We did this in **order**", "to finish, see [the guide](u)."].join(BREAK))).toEqual([]);
    const linked = ["See [the", "guide](https://example.com", "'title') first.",
      "We did this in *or[der*](u) to finish.", "We did this in **order** to finish."];
    expect(findingsIn(linked.join(BREAK))).toEqual([]);
    // A heading over several lines is one line of text, read from all of them.
    expect(findingsIn(["We did this in **order** to", "finish the work", "===="].join(BREAK))).toEqual(wordy(1));
    expect(findingsIn(["We did this in **order** to", "finish [the", "work](u)", "===="].join(BREAK))).toEqual([]);
  });

  test("the acronym, enumeration and filler rules keep the marks as well", () => {
    const undefinedAcronym = ['acronym-undefined at line 1: define acronym "QZX" on first use'];
    expect(findingsIn("Ask the QZX team.")).toEqual(undefinedAcronym);
    expect(findingsIn("**Ask the [QZX](u) team.**")).toEqual(undefinedAcronym);
    expect(findingsIn("Ask the [**QZX**](u) team.")).toEqual([]);
    expect(findingsIn("Ask the Q*Z[X*](u) team.")).toEqual([]);

    const ranked = ["prose-enumeration at line 1: enumeration ranks 1, 2, 3 in prose; consider a list"];
    expect(findingsIn("First we plan. Second we build. Third we test.")).toEqual(ranked);
    expect(findingsIn("First we plan, see [the plan](u). Second we build. Third we test.")).toEqual(ranked);
    expect(findingsIn("[Fi*rs*t](u) we plan. Second we build. Third we test.")).toEqual([]);
    expect(findingsIn("Fi*r[st*](u) we plan. Second we build. Third we test.")).toEqual([]);
    expect(findingsIn("_First_ we plan, see [the plan](u). _Second_ we build. _Third_ we test.")).toEqual([]);

    // The filler rule removed every asterisk, underscore and backtick before emphasis
    // was paired, and does so again in a block that may hold a link. So a term in a
    // code span is reported as the opening there, which a block with no link is spared.
    const filler = ['filler-opening at line 1: opens with "certainly" instead of the answer'];
    expect(findingsIn("Certainly, here it is.")).toEqual(filler);
    expect(findingsIn("[**Certainly**](u), here it is.")).toEqual(filler);
    expect(findingsIn("**Certainly!** The answer is in [the guide](u).")).toEqual(filler);
    expect(findingsIn("*Cert[ainly*](u), here it is.")).toEqual(filler);
    expect(findingsIn(`${TICK}Certainly${TICK} is a word we avoid, as [the guide](u) says.`)).toEqual(filler);
    expect(findingsIn(`${TICK}Certainly${TICK} is a word we avoid, as the guide says.`)).toEqual([]);
  });

  test("marks and labels in great number still take time in proportion to the text", () => {
    const shapes: Array<[name: string, text: string]> = [
      ["a closer in every label", "a [b*](u) ".repeat(50_000)],
      ["an opener outside and a closer inside", "*a [b*](u) ".repeat(50_000)],
      ["a pair in every label", "[*b*](u) ".repeat(50_000)],
      ["closers after many labels", "[*b](u) ".repeat(25_000) + "a* ".repeat(25_000)],
      ["labels inside labels", "[a ".repeat(2_000) + "*b* " + "](u) ".repeat(2_000)],
    ];
    for (const [name, text] of shapes) {
      expect(elapsed(() => auditText(text)), name).toBeLessThan(15_000);
    }
  }, HOSTILE_TIMEOUT_MS);
});

describe("labels nested to great depth", () => {
  // One call at each size against a fixed budget. A flattener that recorded where each
  // label sat once copied those places up through every level, so the work grew with
  // the square of the depth: 8,000 levels took a second to flatten and nine to audit.
  // Nothing records them now, and these hold the cost where it was before.
  const nested = (depth: number): string => "![".repeat(depth) + "Words" + "](u)".repeat(depth);

  test("the text is flattened in proportion to its length", () => {
    for (const depth of [8_000, 16_000]) {
      const text = nested(depth);
      expect(elapsed(() => readerProseBlocks(text)), `${depth} levels`).toBeLessThan(750);
    }
  }, HOSTILE_TIMEOUT_MS);

  test("the audit reads it in proportion to its length", () => {
    for (const depth of [8_000, 16_000]) {
      const text = nested(depth);
      expect(elapsed(() => auditText(text)), `${depth} levels`).toBeLessThan(4_000);
    }
  }, 2 * HOSTILE_TIMEOUT_MS);

  // A check of whether each "](" opened a link scanned forward from every one of them,
  // and the scans shared nothing. Labels nested with an open parenthesis in each
  // destination made every scan run to the end: 16,000 levels took eight seconds, where
  // the audit took one before that check was written.
  test("labels nested with open parentheses are read in proportion to their length", () => {
    const open = (depth: number): string => "[".repeat(depth) + "x" + "](()".repeat(depth) + ")".repeat(depth);
    for (const depth of [8_000, 16_000]) {
      const text = open(depth);
      expect(elapsed(() => auditText(text)), `${depth} levels`).toBeLessThan(4_000);
    }
  }, 2 * HOSTILE_TIMEOUT_MS);

  // These time the reading of links in one block, and nothing else. The whole audit is
  // slow on three of them for reasons older than that reading and outside it, which a
  // budget on the audit would only hide: "<a " many times over, a reference after every
  // label, and many code spans, which the parser itself reads slowly.
  test("the shapes beside that one are read in proportion to their length too", () => {
    const count = 16_000;
    const shapes: Array<[name: string, text: string]> = [
      ["parentheses that never close", "[x](".repeat(count)],
      ["nested labels whose parentheses never close", "[".repeat(count) + "x" + "](".repeat(count)],
      ["closing parentheses with no opener", "[x])".repeat(count)],
      ["nested brackets with no parenthesis at all", "[".repeat(count) + "x" + "]".repeat(count)],
      ["angle brackets that never close", "[x](<a ".repeat(count)],
      ["nested labels whose angle brackets never close", "[".repeat(count) + "x" + "](<a ".repeat(count)],
      ["titles that never close", "[".repeat(count) + "x" + "](u 't ".repeat(count)],
      ["a reference after every label", "[".repeat(count) + "x" + "][r] ".repeat(count)],
      ["a tag holding a bracket after every link", `[x](u) <i title="["> `.repeat(count)],
      ["tags that never close", `<i title="[ `.repeat(count)],
      ["comments that never close", "<!-- [ ".repeat(count)],
      ["instructions and declarations that never close", "<? [ <!D [ <![CDATA[ ".repeat(count)],
      ["a code span holding a bracket after every link", `[x](u) ${String.fromCharCode(96)}[${String.fromCharCode(96)} `.repeat(count)],
      ["a code span of its own length for every label", Array.from({ length: 170 }, (_unused, length) =>
        `[${String.fromCharCode(96).repeat(length + 1)}x${String.fromCharCode(96).repeat(length + 1)}](u) `).join("").repeat(8)],
      ["backticks that close nothing, in every label", `[${String.fromCharCode(96)}x](u) ${String.fromCharCode(96).repeat(2)} `.repeat(count)],
      ["autolinks that never close", "<https://e.com/[ ".repeat(count)],
      ["backticks of every length", "[".repeat(count) + Array.from({ length: 150 }, (_unused, length) => String.fromCharCode(96).repeat(length + 1)).join(" x](u) ")],
    ];
    const none = new Set<string>();
    for (const [name, text] of shapes) {
      expect(elapsed(() => linkSyntaxIn(text, none)), name).toBeLessThan(750);
    }
  }, HOSTILE_TIMEOUT_MS);
});

describe("an acronym definition whose emphasis runs over a line break", () => {
  // The words before "(IAM)" were read one source line at a time, so a mark on one line
  // had no partner and stayed in its word. "identi*ty" then gave two initials and the
  // expansion no longer spelt the acronym. The uses of the acronym were read a block at a
  // time, so the same text on one line was a definition.
  const undefinedAt = (line: number) => [`acronym-undefined at line ${line}: define acronym "IAM" on first use`];

  test("the expansion defines the acronym on two lines as it does on one", () => {
    expect(findingsIn("identi*ty and access management* (IAM). Use IAM.")).toEqual([]);
    for (const lines of [
      ["identi*ty and access", "management* (IAM). Use IAM."],
      ["identi**ty and access", "management** (IAM). Use IAM."],
      ["_identity and access", "management_ (IAM). Use IAM."],
      ["identi~~ty and access", "management~~ (IAM). Use IAM."],
      ["identi*ty", "and access", "management* (IAM). Use IAM."],
      ["i*dentity* and **access", "manage**ment (*IAM*). Use IAM."],
      ["- identi*ty and access", "  management* (IAM). Use IAM."],
      ["> identi*ty and access", "> management* (IAM). Use IAM."],
      ["identi*ty and access", "management* (IAM).", "", "Use IAM."],
    ]) {
      expect(findingsIn(lines.join(BREAK)), lines.join(" / ")).toEqual([]);
    }
  });

  test("the scan for a definition and the scan for a use read a link block alike", () => {
    // The scan for definitions reads source lines and the scan for uses reads blocks.
    // They once paired marks differently around a link, so a definition one of them
    // read was no definition to the other. Both now leave every mark in a block that
    // may hold a link, so "identi*ty" gives two initials to both and defines nothing.
    for (const lines of [
      ["identi*ty and access", "management [*(IAM)](u). Use IAM."],
      ["identi*ty and access", "[management* (IAM)](u). Use IAM."],
      ["identi**ty and access", "management ![**(IAM)](chart.png). Use IAM."],
      ["identi*ty and access", "management [*(IAM)][r]. Use IAM.", "", "[r]: https://example.com"],
      // Marks that a browser pairs, on one side of the link. They stay as well, and
      // the definition is missed: that is the cost of reading the block as written.
      ["identi*ty and access", "management* [(IAM)](u). Use IAM."],
      ["[identi*ty and access", "manage*ment](#) (IAM). Use IAM."],
      ["![identi*ty and access", "management*](#) (IAM). Use IAM."],
      ["identi*ty and access", "[management* (IAM)]. Use IAM."],
    ]) {
      expect(findingsIn(lines.join(BREAK)), lines.join(" / ")).toEqual(undefinedAt(2));
    }
    expect(findingsIn("identi*ty and access management (IAM) [the guide](a*b). Use IAM.")).toEqual(undefinedAt(1));
    // A table row is in no block, so it is judged alone: with a link it keeps its marks.
    expect(findingsIn("| identi*ty and access management (IAM) | [the guide](a*b) |" + BREAK + "|---|---|"
      + BREAK + "| one | two |" + BREAK + BREAK + "Use IAM.")).toEqual(undefinedAt(5));
    const row = (meaning: string) => ["| Term | Meaning |", "|---|---|",
      `| identi*ty* and access management (IAM) | ${meaning} |`, "", "Use IAM."].join(BREAK);
    expect(findingsIn(row("a service"))).toEqual([]);
    expect(findingsIn(row("[a service](u)"))).toEqual(undefinedAt(5));
    // Marks that sit in no word of the expansion change no initial, so the definition
    // is read with them left in.
    expect(findingsIn(["*identity and access", "management [(IAM)](u)*. Use IAM."].join(BREAK))).toEqual([]);
    expect(findingsIn("identity and access management [*(IAM)*](u). Use IAM.")).toEqual([]);
  });

  test("a use is still reported on its own line when the definition comes later", () => {
    expect(findingsIn(["Use IAM first.", "", "identi*ty and access", "management* (IAM)."].join(BREAK)))
      .toEqual(undefinedAt(1));
    expect(findingsIn(["Plain words.", "Use IAM first, then identi*ty and access", "management* (IAM)."].join(BREAK)))
      .toEqual(undefinedAt(2));
    // On the line of the definition, a use ahead of it is ahead of it whatever marks
    // the earlier lines hold.
    expect(findingsIn(["identi*ty and", "access* IAM management (IAM)."].join(BREAK))).toEqual(undefinedAt(2));
    expect(findingsIn(["The *quick", "zebra* xylophone (QZX) is here. Use the QZX."].join(BREAK))).toEqual([]);
  });

  test("marks pair across the lines of one block and never across two blocks", () => {
    // A blank line ends the paragraph, so the two asterisks are in different blocks and
    // neither has a partner. The words before the bracket do not carry across either.
    expect(findingsIn(["identi*ty and access", "", "management* (IAM). Use IAM."].join(BREAK))).toEqual(undefinedAt(3));
    // Within one line of a table, which is in no block, marks pair as before.
    const table = ["| Term | Meaning |", "|---|---|", "| identi*ty* and access management (IAM) | a service |", "", "Use IAM."];
    expect(findingsIn(table.join(BREAK))).toEqual([]);
    // A mark with no partner anywhere in the block still splits its word.
    expect(findingsIn(["identi*ty and access", "management (IAM). Use IAM."].join(BREAK))).toEqual(undefinedAt(2));
  });

  test("a heading that wraps is one block too", () => {
    const heading = ["identi*ty and access", "management* (IAM)", "=================", "", "Use IAM."];
    expect(findingsIn(heading.join(BREAK)).filter((finding) => finding.startsWith("acronym"))).toEqual([]);
  });
});

describe("a link between an expansion and its acronym", () => {
  // The scan for definitions read source lines, where a link is still written out, so
  // the words of its destination counted as words of the expansion. A reader never
  // sees a destination. "[identity and access management](guide) (IAM)" gave the
  // initials AMG, and IAM was reported as undefined on its next use.
  const undefinedAt = (acronym: string, line: number) =>
    [`acronym-undefined at line ${line}: define acronym "${acronym}" on first use`];
  const acronyms = (text: string) => findingsIn(text).filter((finding) => finding.startsWith("acronym"));

  // A review put one emoji before a link. The places of the link were counted in
  // UTF-16 units and dropped by code points, so each place after the emoji was one out:
  // the rule read "[anagement](IAM)" and reported an acronym that was defined.
  test("a character outside the basic plane before a link moves no place after it", () => {
    const face = String.fromCodePoint(0x1f600);
    const defined = [`${face} identity and access [management](guide) (IAM).`, "Use IAM."].join(BREAK);
    expect(acronymReading(defined).blocks[0]?.lines).toEqual([`${face} identity and access management (IAM).`, "Use IAM."]);
    expect(acronyms(defined)).toEqual([]);
    for (const faces of [1, 6, 12, 40]) {
      const line = `${face.repeat(faces)} [x](u) Use IAM.`;
      expect(acronymReading(line).lines, `${faces}`).toEqual([`${face.repeat(faces)} x Use IAM.`]);
      expect(acronyms(line), `${faces}`).toEqual(undefinedAt("IAM", 1));
    }
    // After the link as well, and on the second line of a block.
    const later = [`[identity](one) ${face} and access`, `${face}${face} [management](guide) (IAM). Use IAM.`].join(BREAK);
    expect(acronyms(later)).toEqual([]);
    expect(acronymReading(later).lines).toEqual([`identity ${face} and access`, `${face}${face} management (IAM). Use IAM.`]);
  });

  // A reference label holds at most 999 characters, as CommonMark has it. Of two
  // nested pairs of brackets only one is the link, so the limit decides what is read.
  // A review moved the limit by one and no test failed.
  //
  // The code keeps the limit of CommonMark, 999, which Bun renders as well. The
  // renderer of GitHub accepts one more: asked on 2026-10-08, it took a label of 1,000
  // characters for a reference and refused one of 1,001. That is known and left so.
  test("a reference label of 999 characters is a label, and one of 1,000 is not", () => {
    const nested = (spaces: number): string => {
      const label = " ".repeat(spaces) + "management";
      expect(label).toHaveLength(spaces + 10);
      return [`[identity and access [${label}]](guide) (IAM).`, "Use IAM.", "", `[${label}]: /u`].join(BREAK);
    };
    // At 999 the inner pair is a link to the reference. The outer pair is then text,
    // and "(guide)" stands between the expansion and its acronym.
    for (const spaces of [0, 988, 989]) {
      expect(acronyms(nested(spaces)), `${spaces + 10}`).toEqual(undefinedAt("IAM", 2));
      expect(Bun.markdown.html(nested(spaces)), `${spaces + 10}`).toContain('href="/u"');
    }
    // At 1,000 the inner pair is no label, so the outer pair is the link and its label is read.
    for (const spaces of [990, 991]) {
      expect(acronyms(nested(spaces)), `${spaces + 10}`).toEqual([]);
      expect(Bun.markdown.html(nested(spaces)), `${spaces + 10}`).toContain('href="guide"');
    }
    // The limit alone, with the reference given, so that nothing else can set it.
    const marked = (length: number): number[] => {
      const label = "a".repeat(length);
      const syntax = linkSyntaxIn(`[${label}]`, new Set([label]));
      expect(syntax).toHaveLength(length + 2);
      expect([...syntax.subarray(1, length + 1)].includes(1)).toBe(false);
      return [syntax[0] as number, syntax[length + 1] as number];
    };
    expect([998, 999, 1_000, 1_001].map(marked)).toEqual([[1, 1], [1, 1], [0, 0], [0, 0]]);
  });

  test("a word in a destination is no word of the expansion", () => {
    for (const lines of [
      ["[identity and access management](guide) (IAM).", "Use IAM."],
      ["[identity and access management](#) (IAM).", "Use IAM."],
      ["identity and access [management](the-guide.md) (IAM). Use IAM."],
      ["identity [and](one) access [management](two) (IAM). Use IAM."],
      // A destination and a title that wrap, with the link over three lines.
      ["[identity and", "access management](the-guide", "'a title') (IAM). Use IAM."],
      // A reference that the document defines is a link, and its label is not read.
      ["identity and access [management][guide] (IAM). Use IAM.", "", "[guide]: https://example.com"],
      // A table row and a heading are read by the same scan.
      ["| Term | Meaning |", "|---|---|", "| [identity and access management](guide) (IAM) | a service |", "", "Use IAM."],
      ["# [identity and access management](guide) (IAM)", "", "Use IAM."],
    ]) {
      expect(acronyms(lines.join(BREAK)), lines.join(" / ")).toEqual([]);
    }
  });

  test("brackets that form no link keep their words", () => {
    // "(two three)" is no destination, because it holds a space outside angle brackets,
    // so a page shows it as written and its words stand before the acronym. The scan
    // dropped them with the brackets, and the acronym was read as defined.
    for (const lines of [
      ["identity and access [management](two three) (IAM).", "Use IAM."],
      ["identity [and](one) access [management](two three) (IAM).", "Use IAM."],
      ["identity [and](one two) access [management](guide) (IAM).", "Use IAM."],
      ["identity and access [management](two three 'a title') (IAM).", "Use IAM."],
      // An angle bracket that is never closed, and a parenthesis that is never closed.
      ["identity and access [management](<two) (IAM).", "Use IAM."],
      ["identity and access [management](two(three) (IAM).", "Use IAM."],
      ["identity and access [management](<two < three>) (IAM).", "Use IAM."],
      // A title needs a destination before it, and white space between the two.
      ["identity and access [management]('a title') (IAM).", "Use IAM."],
      ["identity and access [management](<./two three>'a title') (IAM).", "Use IAM."],
      // A title with no space before it, and words after a title.
      ["identity and access [management](two'a title') (IAM).", "Use IAM."],
      ["identity and access [management](two 'a title' three) (IAM).", "Use IAM."],
      // A link inside the label of brackets that form none is still a link.
      ["[identity [and](one) access management](two three) (IAM).", "Use IAM."],
    ]) {
      expect(acronyms(lines.join(BREAK)), lines.join(" / ")).toEqual(undefinedAt("IAM", 2));
    }
    // A destination that wraps holds white space, so it is none.
    const wrapped = ["[identity and", "access management](the", "guide 'a title') (IAM).", "Use IAM."];
    expect(acronyms(wrapped.join(BREAK))).toEqual(undefinedAt("IAM", 4));
  });

  test("a destination and a title in any of their forms are a link", () => {
    for (const lines of [
      ["identity and access [management](two) (IAM).", "Use IAM."],
      ["identity and access [management](<two three>) (IAM).", "Use IAM."],
      ["identity and access [management](<./the guide.md>) (IAM).", "Use IAM."],
      ["identity and access [management](<./the guide.md> 'a title') (IAM).", "Use IAM."],
      ['identity and access [management](two "a title") (IAM).', "Use IAM."],
      ["identity and access [management](two 'a title') (IAM).", "Use IAM."],
      ["identity and access [management](two (a title)) (IAM).", "Use IAM."],
      ["identity and access [management](<two three> 'a title') (IAM).", "Use IAM."],
      ["identity and access [management](two(three)) (IAM).", "Use IAM."],
      // GitHub reads this as a link to "two(three", though the parenthesis never closes.
      ["identity and access [management](two(three 'a title') (IAM).", "Use IAM."],
      ["identity and access [management]( two ) (IAM).", "Use IAM."],
      [`identity and access [management](two${String.fromCharCode(9)}'a title') (IAM).`, "Use IAM."],
      ["identity and access [management]() (IAM).", "Use IAM."],
      ["identity and access [management](two", "'a title') (IAM). Use IAM."],
      ["identity and access ![management](chart.png 'a title') (IAM).", "Use IAM."],
    ]) {
      expect(acronyms(lines.join(BREAK)), lines.join(" / ")).toEqual([]);
    }
  });

  // Whether brackets form a link was decided in text that earlier steps had already
  // changed, and at the call of one of the two scans alone. Each of these was wrong.
  test("a link is decided on the source as written, and both scans read the one result", () => {
    // The two scans counted places in two texts, so the definition was put after the
    // use that follows it.
    expect(acronyms("[guide](two three) identity and access management (IAM). Use IAM.")).toEqual([]);
    expect(acronyms("[guide](two three) Use IAM, the identity and access management (IAM).")).toEqual(undefinedAt("IAM", 1));
    // The escape had become two spaces, so a destination holding one seemed to hold a space.
    const slash = String.fromCharCode(92);
    expect(acronyms([`identity and access [management](foo${slash}_bar) (IAM).`, "Use IAM."].join(BREAK))).toEqual([]);
    expect(acronyms([`identity and access [management](foo${slash}) bar) (IAM).`, "Use IAM."].join(BREAK))).toEqual(undefinedAt("IAM", 2));
    // A destination in angle brackets had gone as a tag, and a title with no destination
    // was allowed for its sake. It is text.
    expect(acronyms(["identity and access [management]( 'a title') (IAM).", "Use IAM."].join(BREAK))).toEqual(undefinedAt("IAM", 2));
    expect(acronyms(["identity and access [management](<two three> 'a title') (IAM).", "Use IAM."].join(BREAK))).toEqual([]);
    expect(acronyms(["identity and access [management](two three) (IAM).", "Use IAM."].join(BREAK))).toEqual(undefinedAt("IAM", 2));
  });

  test("a link inside the label of a link leaves the outer brackets as text", () => {
    // A page shows the inner link alone, and "(guide)" after it as written.
    expect(acronyms(["[identity [and](one) access management](guide) (IAM).", "Use IAM."].join(BREAK))).toEqual(undefinedAt("IAM", 2));
    expect(acronyms(["[identity [and](one) access management](#) (IAM).", "Use IAM."].join(BREAK))).toEqual([]);
    // An image may hold a link, and both are read.
    expect(acronyms(["![identity [and](one) access management](guide.png) (IAM).", "Use IAM."].join(BREAK))).toEqual([]);
  });

  test("a reference is a link where the document defines it, and switches the outer brackets off like any link", () => {
    const defined = ["", "[and]: https://example.com/and"];
    const outer = (inner: string): string[] => [`[identity ${inner} access management](guide) (IAM).`, "Use IAM."];
    // Each inner form is a link, so the outer brackets are text and "(guide)" is shown.
    for (const inner of ["[and]", "[and][]", "[and][and]", "[it][and]", "[and](<)"]) {
      expect(acronyms([...outer(inner), ...defined].join(BREAK)), inner).toEqual(undefinedAt("IAM", 2));
    }
    // None of these is a link, so the outer brackets are one, and its destination is not read.
    // A second pair that names nothing the document defines leaves the first as text too.
    for (const inner of ["[and][1]", "[1]", "[1][]", "[1][2]"]) {
      expect(acronyms([...outer(inner), ...defined].join(BREAK)), inner).toEqual([]);
    }
    expect(acronyms(outer("[and]").join(BREAK)), "with no definition").toEqual([]);
  });

  test("an escape, a code span and the mark of a quotation are read as a renderer reads them", () => {
    const slash = String.fromCharCode(92);
    const tick = String.fromCharCode(96);
    const use = "Use IAM.";
    // A bracket in a code span opens nothing, so the bracket after it closes nothing.
    expect(acronyms([`identity and access ${tick}[${tick}management](guide) (IAM).`, use].join(BREAK))).toEqual(undefinedAt("IAM", 2));
    // A code span closes at the next run of backticks of its own length, and at no other.
    expect(acronyms([`identity and access ${tick}${tick}[${tick}x${tick}${tick} management](guide) (IAM).`, use].join(BREAK)))
      .toEqual(undefinedAt("IAM", 2));
    expect(acronyms([`identity and access ${tick}${tick}1${tick} [management](guide) (IAM).`, use].join(BREAK))).toEqual([]);
    // An escaped exclamation mark makes no image, so a link inside the label switches the brackets off.
    expect(acronyms([`${slash}![identity [and](one) access management](guide) (IAM).`, use].join(BREAK))).toEqual(undefinedAt("IAM", 2));
    // A backslash escapes punctuation alone, so this destination ends at its space.
    expect(acronyms([`identity and access [management](two${slash} three) (IAM).`, use].join(BREAK))).toEqual(undefinedAt("IAM", 2));
    // The mark of a quotation at the start of a line is no part of a title that wraps.
    expect(acronyms(["> identity and access [management](guide", "> 'a title') (IAM).", "", use].join(BREAK))).toEqual([]);
    expect(acronyms(["- identity and access [management](guide", "  'a title') (IAM).", "", use].join(BREAK))).toEqual([]);
  });

  // A code span, an autolink and an HTML tag bind tighter than a link, so each is found
  // first and a bracket inside one opens and closes nothing. Each of these was put to
  // the renderer of GitHub.
  test("a code span, an autolink and an HTML tag are found before a link is", () => {
    const slash = String.fromCharCode(92);
    const tick = String.fromCharCode(96);
    const quote = String.fromCharCode(34);
    const use = "Use IAM.";
    const link = (before: string): string[] => [`identity and access ${before}[management](guide) (IAM).`, use];
    const text = (before: string): string[] => [`identity and access ${before}management](guide) (IAM).`, use];
    // A backslash in a code span escapes nothing, so the span ends at the backtick after it
    // and the link that follows is a link.
    expect(acronyms([`identity and access ${tick}${slash}${tick} [management](guide) ${tick} (IAM).`, use].join(BREAK))).toEqual([]);
    expect(acronyms(link(`${tick}${tick}${slash}${tick}${slash}${tick}${tick} `).join(BREAK))).toEqual([]);
    // A bracket in a tag, in an autolink or in a comment opens nothing, so "](guide)" is shown.
    for (const before of [
      `<i title=${quote}[${quote}>`,
      `<i title=${quote}>[${quote}>`,
      "<i title='['>",
      "<i data-x=[>",
      "</i[>".replace("[", " ") + "<b title='['>",
      "<https://e.com/[>",
      "<!-- [ -->",
      "<?php [ ?>",
      "<![CDATA[ x ]]>",
    ]) {
      expect(acronyms(text(before).join(BREAK)), before).toEqual(undefinedAt("IAM", 2));
    }
    // What only looks like a tag is text, so a link after it is still a link. The text
    // itself holds letters, so the link is looked for and not the acronym.
    for (const before of ["<3 ", "</i ", "< i> ", `<i title=${quote} `, "<i title= > ", "<i/ > ", "<!-- ", "<? ", "<![CDATA[ ", "<!D ", "<a@b ", "<x:y z> "]) {
      const read = acronymReading(link(before).join(BREAK)).blocks[0]?.lines[0] as string;
      expect(read.includes("](guide)"), before).toBe(false);
      expect(read.endsWith("management (IAM)."), before).toBe(true);
    }
    // A link read first keeps what is in its destination out of all this.
    // The backtick in this destination opens no code span, so the two after it are one,
    // and the bracket inside that span opens nothing.
    expect(acronymReading(`[one](<u${tick}v>) ${tick}[${tick}two](three)`).blocks[0]?.lines)
      .toEqual([`one ${tick}[${tick}two](three)`]);
  });

  // The reading once wrote U+FFFF where link syntax stood and then deleted every U+FFFF,
  // the ones the document held as well. A document that holds one must keep it: with
  // it gone, "(I" and "AM)" closed up into a definition that no reader was given.
  test("a character the document holds is never taken for removed link syntax", () => {
    const use = "Use IAM.";
    for (const code of [0xffff, 0xfffe, 0xfffd]) {
      const odd = String.fromCharCode(code);
      const name = `U+${code.toString(16)}`;
      // In an acronym, with and without a link in the block.
      expect(acronyms([`identity and access management (I${odd}AM).`, use].join(BREAK)), name).toEqual(undefinedAt("IAM", 2));
      expect(acronyms([`[identity](u) and access management (I${odd}AM).`, use].join(BREAK)), name).toEqual(undefinedAt("IAM", 2));
      // In a word of the expansion: the two halves are two words.
      expect(acronyms([`[identity](u) and acc${odd}ess management (IAM).`, use].join(BREAK)), name).toEqual(undefinedAt("IAM", 2));
      // In the label of a link, and beside the syntax that is removed.
      expect(acronyms([`identity and access [manage${odd}ment](guide) (IAM).`, use].join(BREAK)), name).toEqual(undefinedAt("IAM", 2));
      expect(acronyms([`identity and access [management${odd}](guide) (${odd}IAM).`, use].join(BREAK)), name).toEqual(undefinedAt("IAM", 2));
      // The character is still in what the rule reads, and the link syntax is not.
      const read = acronymReading(`${odd}[one${odd}](two)${odd}`).lines[0];
      expect(read, name).toBe(`${odd}one${odd}${odd}`);
    }
    // With no such character, each of those is a definition.
    expect(acronyms(["[identity](u) and access [management](guide) (IAM).", use].join(BREAK))).toEqual([]);
  });

  test("what a reader does see between them still counts", () => {
    // A reference with no definition is text, brackets and all, so its second half is
    // a word on the page.
    expect(acronyms("identity and access [management][guide] (IAM). Use IAM.")).toEqual(undefinedAt("IAM", 1));
    // The alternative text of an image is read out where the image stands.
    expect(acronyms("identity and access management ![chart](guide.png) (IAM). Use IAM."))
      .toEqual(undefinedAt("IAM", 1));
    expect(acronyms("identity and access management guide (IAM). Use IAM.")).toEqual(undefinedAt("IAM", 1));
  });

  test("an acronym in a destination defines nothing", () => {
    // "(ABC)" here is the destination of the link. It was read as an acronym in
    // brackets after the words that spell it, so the use below went unreported.
    expect(acronyms(["Use the [alpha beta cat](ABC) now.", "", "ABC is used."].join(BREAK)))
      .toEqual(undefinedAt("ABC", 3));
    expect(acronyms(["Use the alpha beta cat (ABC) now.", "", "ABC is used."].join(BREAK))).toEqual([]);
  });

  test("a definition after a link on its line is placed where the reader meets it", () => {
    // The place of a definition was counted in the source line and the place of a use
    // in the text without its links. A long destination ahead of both put the
    // definition after its own use, and the use was reported.
    expect(acronyms("[See](https://example.com/a/long/address) identity and access management (IAM). Use IAM."))
      .toEqual([]);
    expect(acronyms("[See](https://example.com/a/long/address) the IAM, identity and access management (IAM)."))
      .toEqual(undefinedAt("IAM", 1));
  });
});

// A blank line is a line holding nothing, or only spaces and tabs, as CommonMark has
// it. The parser asked whether a line trimmed to nothing, and trimming takes every
// Unicode space: so a line holding one no-break space ended the paragraph, where Bun
// and GitHub carry it on. Issue 42.
describe("a line that holds only a space Markdown does not count as white space", () => {
  /** Spaces that are text to Markdown, each by its name. */
  const SPACES: Array<[name: string, space: string]> = [
    ["a no-break space", String.fromCodePoint(0xa0)],
    ["three no-break spaces", String.fromCodePoint(0xa0).repeat(3)],
    ["a no-break space between ordinary spaces", ` ${String.fromCodePoint(0xa0)} `],
    ["an en space", String.fromCodePoint(0x2002)],
    ["an ideographic space", String.fromCodePoint(0x3000)],
    ["a form feed", String.fromCodePoint(0xc)],
    ["a line tabulation", String.fromCodePoint(0xb)],
    ["a zero width no-break space", String.fromCodePoint(0xfeff)],
    // This one was never trimmed, and is here to show the others now read as it does.
    ["a zero width space", String.fromCodePoint(0x200b)],
  ];
  const fence = String.fromCharCode(96).repeat(3);
  /** A document of each kind, with a place for one line or one end of a line. */
  const SHAPES: Array<[name: string, made: (held: string) => string[]]> = [
    ["a paragraph", (held) => ["one", held, "two"]],
    ["a list item, indented", (held) => ["- one", `  ${held}`, "  two"]],
    ["a list item, not indented", (held) => ["- one", held, "two"]],
    ["a list item, after a blank line", (held) => ["- one", "", held, "two"]],
    ["a quotation", (held) => ["> one", `> ${held}`, "> two"]],
    ["a table", (held) => ["| a |", "|---|", "| one |", held, "| two |"]],
    ["a list marker with nothing else on its line", (held) => ["one", `- ${held}`, "two"]],
    ["a line that would close a code fence", (held) => [fence, "one", `${fence}${held}`, "two", fence, "three"]],
  ];
  /**
   * Where each block is and which lines are hidden as code, which is the shape of a
   * document. What a line of spaces leaves to read is not compared: it leaves nothing,
   * whichever space it is, because the start of every line of a paragraph is trimmed.
   */
  const shapeOf = (lines: string[]): unknown => {
    const document = lines.join(BREAK);
    const read = readDocument(document);
    return {
      blocks: proseBlocks(document).map((block) => [block.line, block.lines.length]),
      hidden: lines.map((_line, index) => read.hidden(index)),
    };
  };

  test("the case that was reported, and what a page shows for it", () => {
    const document = ["identity and access", String.fromCodePoint(0xa0), "management (IAM).", "Use IAM."].join(BREAK);
    expect(findingsIn(document).filter((finding) => finding.startsWith("acronym"))).toEqual([]);
    expect(proseBlocks(document).map((block) => [block.line, block.lines.length])).toEqual([[1, 4]]);
    expect(Bun.markdown.html(document).match(/<p>/g)).toHaveLength(1);
  });

  test.each(SHAPES)("in %s, such a line is read as a line that holds a letter is read", (_name, made) => {
    const letter = shapeOf(made("x"));
    for (const [name, space] of SPACES) {
      expect(shapeOf(made(space)), name).toEqual(letter);
    }
    // And not as a blank line is read, or the test would hold nothing.
    expect(shapeOf(made(""))).not.toEqual(letter);
  });

  test("a paragraph, a list item and a quotation stay one block, as Bun shows them", () => {
    for (const [name, space] of SPACES) {
      for (const lines of [["one", space, "two"], ["- one", `  ${space}`, "  two"], ["- one", space, "two"], ["> one", `> ${space}`, "> two"]]) {
        const document = lines.join(BREAK);
        expect(proseBlocks(document).map((block) => [block.line, block.lines.length]), `${name} ${lines[0]}`).toEqual([[1, 3]]);
        expect((Bun.markdown.html(document).match(/<p>|<li>/g) ?? []), `${name} ${lines[0]}`).toHaveLength(1);
      }
    }
  });

  test("a line that holds nothing, or only spaces and tabs, still ends a paragraph", () => {
    const tab = String.fromCharCode(9);
    for (const blank of ["", " ", "    ", tab, ` ${tab} `, `${tab}${tab}`]) {
      for (const lines of [["one", blank, "two"], ["- one", blank, "two"], ["> one", blank, "> two"]]) {
        const document = lines.join(BREAK);
        expect(proseBlocks(document).map((block) => [block.line, block.lines.length]), JSON.stringify(lines)).toEqual([[1, 1], [3, 1]]);
      }
      // A blank line does not end a list item, where the next line is indented under it.
      expect(proseBlocks(["- one", blank, "  two", "", "three"].join(BREAK)).map((block) => block.line)).toEqual([1, 3, 5]);
      expect(Bun.markdown.html(["one", blank, "two"].join(BREAK)).match(/<p>/g)).toHaveLength(2);
    }
    // Windows line endings leave nothing on the line either.
    const windows = ["one", "", "two"].join(String.fromCharCode(13, 10));
    expect(proseBlocks(windows).map((block) => block.line)).toEqual([1, 3]);
  });

  test("after a blank line, such a line is outside the list item, so a heading under it is a heading", () => {
    // A blank line keeps a list item open. This line is not blank and is not indented,
    // so the item has ended and the paragraph that the underline makes a heading of
    // is at the root, as Bun and GitHub show it.
    for (const [name, space] of SPACES) {
      const document = ["- one", "", space, "two", "==="].join(BREAK);
      expect(headings(document).map((heading) => [heading.level, heading.line, heading.text.endsWith("two")]), name).toEqual([[1, 3, true]]);
      expect(Bun.markdown.html(document), name).toContain("<h1>");
    }
    expect(headings(["- one", "", "", "two", "==="].join(BREAK)).map((heading) => [heading.line, heading.text])).toEqual([[4, "two"]]);
  });

  test("a code fence closes with only spaces and tabs after it", () => {
    const tab = String.fromCharCode(9);
    for (const after of ["", " ", `  ${tab}`]) {
      expect(proseBlocks([fence, "one", `${fence}${after}`, "two"].join(BREAK)).map((block) => block.lines)).toEqual([["two"]]);
    }
    // With a no-break space after it, it is a line of the code, and the code runs on.
    const open = [fence, "one", `${fence}${String.fromCodePoint(0xa0)}`, "two", fence, "three"].join(BREAK);
    expect(proseBlocks(open).map((block) => block.lines)).toEqual([["three"]]);
    expect(Bun.markdown.html(open)).toContain("<p>three</p>");
    expect(Bun.markdown.html(open)).not.toContain("<p>two</p>");
  });

  test("what is left as it was: the end of hidden markup, and front matter", () => {
    const space = String.fromCodePoint(0xa0);
    // A comment is a block of its own, so what follows it on its line ends with it.
    expect(proseBlocks(["one", `<!-- c -->${space}`, "two"].join(BREAK)).map((block) => block.lines)).toEqual([["one"], ["two"]]);
    expect(Bun.markdown.html(["one", `<!-- c -->${space}`, "two"].join(BREAK)).match(/<p>/g)).toHaveLength(2);
    // A line of front matter that holds only such a space is still a line of it.
    expect(frontMatterRange(["---", "title: a", space, "---", "text"])).toEqual({ start: 0, end: 3 });
  });
});
