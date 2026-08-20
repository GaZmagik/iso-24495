import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditCorpus,
  auditText,
  ENGINE_THRESHOLDS,
  projectAcronyms,
} from "../scripts/audit-corpus.ts";
import { COMPLEX_WORDS } from "../scripts/lib/lexicon.ts";
import { REFERENCE_SHAPES } from "./fixtures/reference-blocks.ts";
import {
  classifyBoundary,
  headings,
  mergedSentences,
  proseBlocks,
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

  test("nested link labels are flattened in one pass, not one scan each", () => {
    // Matching each "[" to its partner by scanning forward would be quadratic, so the
    // partners are matched once for the whole text. Doubling the input must roughly
    // double the work rather than quadruple it.
    const flatten = (size: number): void => {
      readerProseBlocks("Read [outer [inner] text](/uri) here. ".repeat(size));
    };
    flatten(2_000);
    const time = (size: number): number => {
      const started = performance.now();
      flatten(size);
      return performance.now() - started;
    };
    expect(time(4_000) / Math.max(time(2_000), 1)).toBeLessThan(3);

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
      "Read [](/uri) and [outer [inner]] text.",
    ]) {
      expect(readerProseBlocks(literal)[0]?.lines.join(""), literal).toBe(literal);
    }
  });

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

  test("a large document cannot stall the rules that walk it", () => {
    // Three places rebuilt a whole prefix or suffix inside a loop over the same text, so
    // each cost grew with the square of the document. Repairing only the one the review
    // named would have left the shape alive in the other two.
    //
    // The shape is what is measured, not the clock: tripling the input triples linear work
    // and multiplies quadratic work by nine, and that separation holds on any machine.
    const growth = (work: (size: number) => void, size: number): number => {
      const time = (at: number): number => {
        const started = performance.now();
        work(at);
        return performance.now() - started;
      };
      work(size);
      return time(size * 3) / Math.max(time(size), 1);
    };

    // Every acronym rebuilt the entire remaining token list to look three tokens ahead.
    const known = new Set(["AB"]);
    const acronyms = (size: number): void => {
      auditText(Array(size).fill("Alpha Beta (AB)").join(" ") + ".", { knownAcronyms: known });
    };
    expect(growth(acronyms, 1_000)).toBeLessThan(5);

    // Every finding counted the line endings before it from the start of the paragraph.
    const sentence = Array.from({ length: 31 }, (_, index) => `word${index}`).join(" ") + ".";
    const paragraphs = (size: number): void => {
      auditText(Array(size).fill(sentence).join(" "));
    };
    expect(growth(paragraphs, 1_000)).toBeLessThan(5);

    // The findings themselves must survive the repair, not merely arrive sooner.
    const long = Array(500).fill(sentence).join(" ");
    expect(auditText(long).filter((v) => v.rule === "sentence-length")).toHaveLength(500);
  });

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
    expect(headings(linked)).toEqual([{ level: 1, line: 1, text: "Install the service" }]);
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
