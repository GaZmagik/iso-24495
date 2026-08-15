// Deterministic corpus audit: mechanical proxies for the Part 1/2 rules.
// Emits counts and locations only. It never judges clarity and its output
// must never be presented as ISO compliance.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  headings,
  mergedSentences,
  proseBlocks,
  readDocument,
  splitSentences,
  wordCount,
} from "./lib/parse.ts";
import {
  COMMON_WORDS,
  COMPLEX_WORDS,
  DOUBLE_NEGATIVES,
  FILLER_OPENINGS,
} from "./lib/lexicon.ts";
import type { Findings, Violation } from "./lib/types.ts";

// Thresholds recalibrated 2026-08-13. Public guidance (Cutts, the Plain
// English Campaign, the Clear English Standard) specifies an AVERAGE of 15 to
// 20 words, not a per-sentence cap. The 30-word cap and the 10-sentence
// minimum sample are this project's own proxy choices, informed by local
// session measurements that are not part of this repository.
export const ENGINE_THRESHOLDS = Object.freeze({
  sentenceWordLimit: 30,
  sentenceAverageLimit: 20,
  averageMinimumSentences: 10,
  paragraphSentenceLimit: 5,
  maximumHeadingLevel: 4,
  headingWordLimit: 12,
  acronymMinimumLetters: 2,
  acronymMaximumLetters: 6,
  acronymDefinitionWindow: 3,
  enumerationMinimumRanks: 3,
});

const SENTENCE_WORD_LIMIT = ENGINE_THRESHOLDS.sentenceWordLimit;
const SENTENCE_AVERAGE_LIMIT = ENGINE_THRESHOLDS.sentenceAverageLimit;
const AVERAGE_MIN_SENTENCES = ENGINE_THRESHOLDS.averageMinimumSentences;
const PARAGRAPH_SENTENCE_LIMIT = ENGINE_THRESHOLDS.paragraphSentenceLimit;
const MAX_HEADING_LEVEL = ENGINE_THRESHOLDS.maximumHeadingLevel;
const HEADING_WORD_LIMIT = ENGINE_THRESHOLDS.headingWordLimit;
// Exported so the hook and the repository's own dogfood guard read the same
// list. While each kept its own copy, a .txt file could ship unaudited.
export const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];

/**
 * Whether this path is a document the engine audits. Every caller must use
 * this rather than its own test: comparing extension lists proved nothing,
 * because one caller lower-cased the extension and another did not, so
 * `notes.TXT` was audited by the hook and skipped by the repository guard.
 */
export function isAuditedDocument(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
const LEGALESE = ["shall", "hereby", "hereinafter", "wherefore", "heretofore", "aforesaid"];

const ACRONYM_ALLOWLIST = new Set([
  "KG", "KM", "CM", "MM", "MB", "GB", "KB", "TB", "PDF", "URL", "HTML", "TV", "PIN",
  "UN", "USA", "ISO", "AI", "API", "CLI", "JSON", "HTTP", "HTTPS", "SSH", "MIT",
  // Everyday words that happen to be capitals. Asking a writer to expand "OK"
  // is advice nobody can act on, and a shouted "DO NOT" is not an initialism.
  // A lone capitalised word is judged on its own. Runs of capitals are judged
  // by lexicon density instead, so no list of shouted words is needed here.
  "OK", "ID", "AM", "PM",
]);

// Numbering words that make a Roman numeral a numeral. Shape alone exempted
// "CI", "MD", "MIX" and "CD", which are ordinary acronyms in ordinary prose.
// "book", "type" and "class" are deliberately absent: they are verbs as often
// as they are labels, and "Book MD appointments" must still report MD.
const NUMBERING_WORDS = new Set([
  "section", "sections", "chapter", "chapters", "part", "parts", "volume",
  "volumes", "appendix", "appendices", "annex", "figure", "figures", "table",
  "tables", "phase", "step", "tier", "page", "article", "articles", "title",
  "titles", "schedule", "schedules", "clause", "clauses", "edition", "act",
  // "form", "round", "group" and "mark" were here and are gone: each is an
  // ordinary noun or verb, and "Open the form and review CI settings" then
  // excused CI. A numbering word has to be one that only numbers things.
  "level", "grade", "stage",
]);

// Titles and events numbered with Roman numerals by convention. Searched a few
// tokens back, because the numeral follows the given name: "Pope Paul VI".
const NAMED_BY_NUMERAL = new Set([
  "King", "Queen", "Pope", "Emperor", "Empress", "Tsar", "Prince", "Princess",
  "Duke", "Earl", "Bowl", "War", "Olympiad", "Cup", "Festival",
]);

// A numeral straight after a capitalised name is a regnal or sequel number:
// "Elizabeth II", "Rocky IV". Requiring the title word meant "Elizabeth II"
// asked for an expansion while "Queen Elizabeth II" did not.
// Five letters or more, because the short capitalised words that open a
// sentence are mostly verbs: "Type CD", "Open VI", "Book MD". A given name
// long enough to carry a regnal number is longer than that.
const CAPITALISED_NAME = /^[A-Z][a-z]{4,}$/;

// A short numeral is ambiguous by nature: two and three letter numerals are
// also common acronyms, and listing them one by one was a list that kept
// growing (DVI, MCC, MMC, DCL, MMI all slipped through). Length decides
// instead. Four letters or more, such as VIII or LVIII, is a numeral.
//
// Four letters is not proof, though: MMIX is Knuth's computer. A long numeral
// still needs evidence when it sits in prose with no numbering context, so
// this length only removes the requirement for repeated numerals in lists.
const NUMERAL_UNAMBIGUOUS_LENGTH = 4;
const NUMERAL_NAMED_EXCEPTIONS = new Set(["MMIX", "MMX", "MMXI", "MIX", "DIM"]);
const ACRONYM_SHAPE = new RegExp(
  `^(?:[A-Z]{${ENGINE_THRESHOLDS.acronymMinimumLetters},${ENGINE_THRESHOLDS.acronymMaximumLetters}}|[A-Z]\\.(?:[A-Z]\\.)+)$`,
);
// Canonical numerals only. Any string of numeral letters also matched "XML",
// "MIX" and "CIVIC", so common acronyms were silently exempt from the rule.
const ROMAN_NUMERAL = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

interface DoubletEntry {
  phrase: string;
  lean?: string;
  legalRegister?: boolean;
}

// Keep every doublet phrase out of LEGALESE so each phrase has one rule owner.
const DOUBLETS: DoubletEntry[] = [
  { phrase: "null and void", lean: "void" },
  { phrase: "cease and desist", legalRegister: true },
  { phrase: "terms and conditions", legalRegister: true },
  { phrase: "each and every", lean: "each" },
  { phrase: "first and foremost", lean: "first" },
  { phrase: "true and correct", lean: "true" },
  { phrase: "full and complete", lean: "complete" },
  { phrase: "revert back", lean: "revert" },
  { phrase: "repeat again", lean: "repeat" },
  { phrase: "free gift", lean: "gift" },
  { phrase: "past history", lean: "history" },
  { phrase: "future plans", lean: "plans" },
  { phrase: "end result", lean: "result" },
  { phrase: "unexpected surprise", lean: "surprise" },
  { phrase: "advance planning", lean: "planning" },
  { phrase: "close proximity", lean: "close" },
  { phrase: "general consensus", lean: "consensus" },
].sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length);

// Wordy phrases with a shorter exact equivalent. The core skill has asked
// writers to make these swaps since the first release, and nothing checked
// them, so the guidance named a rule the engine never applied.
//
// Exact phrases only, like the doublets. Anything needing judgement about
// whether a longer phrase is justified belongs to the writer, not here.
const WORDY_PHRASES: Array<{ phrase: string; lean: string }> = [
  { phrase: "in order to", lean: "to" },
  { phrase: "due to the fact that", lean: "because" },
  { phrase: "in the event that", lean: "if" },
  { phrase: "at this point in time", lean: "now" },
  { phrase: "at this moment in time", lean: "now" },
  { phrase: "in the near future", lean: "soon" },
  { phrase: "for the purpose of", lean: "to" },
  { phrase: "with regard to", lean: "about" },
  { phrase: "with reference to", lean: "about" },
  { phrase: "in relation to", lean: "about" },
  { phrase: "in the absence of", lean: "without" },
  { phrase: "a large number of", lean: "many" },
  { phrase: "a small number of", lean: "a few" },
  { phrase: "the majority of", lean: "most" },
  { phrase: "prior to", lean: "before" },
  { phrase: "subsequent to", lean: "after" },
  { phrase: "in spite of the fact that", lean: "although" },
  { phrase: "notwithstanding the fact that", lean: "although" },
  { phrase: "it is possible that", lean: "may" },
  { phrase: "has the ability to", lean: "can" },
  { phrase: "is able to", lean: "can" },
  { phrase: "make a decision", lean: "decide" },
  { phrase: "provide assistance", lean: "help" },
  { phrase: "take into consideration", lean: "consider" },
].sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length);

const ORDINAL_RANKS = new Map([
  ["first", 1], ["firstly", 1],
  ["second", 2], ["secondly", 2],
  ["third", 3], ["thirdly", 3],
  ["fourth", 4], ["fourthly", 4],
  ["fifth", 5], ["fifthly", 5],
  ["sixth", 6], ["sixthly", 6],
]);

export function configHash(
  thresholds: Readonly<Record<string, number>> = ENGINE_THRESHOLDS,
): string {
  const stable = Object.entries(thresholds)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("|");
  let hash = 5381;
  for (let i = 0; i < stable.length; i++) {
    hash = ((hash * 33) ^ stable.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function lineAtOffset(blockLine: number, text: string, offset: number): number {
  return blockLine + (text.slice(0, offset).match(/\n/g)?.length ?? 0);
}

function acronymFromToken(raw: string): { display: string; key: string } | null {
  let token = raw.replace(/^["'“‘([{<]+/, "").replace(/["'”’\)\]}>,:;!?]+$/, "");
  if (!ACRONYM_SHAPE.test(token) && token.endsWith(".")) token = token.slice(0, -1);
  if (!ACRONYM_SHAPE.test(token)) return null;
  const key = token.replaceAll(".", "");
  if (/\d/.test(token)) return null;
  return { display: token, key };
}

function isAllCaps(raw: string): boolean {
  const stripped = raw.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, "");
  return ACRONYM_SHAPE.test(stripped) || /^[A-Z]{2,}$/.test(stripped);
}

// A numeral is a numeral because of where it sits. Only a numbering word
// immediately before it, coordination with an unambiguous numeral, or a name
// pattern counts as evidence. Words that double as verbs ("book a room",
// "type the command") are deliberately absent from the numbering list.
function isUnambiguousNumeral(word: string): boolean {
  if (NUMERAL_NAMED_EXCEPTIONS.has(word)) return false;
  return word.length >= NUMERAL_UNAMBIGUOUS_LENGTH && ROMAN_NUMERAL.test(word);
}

function hasNumberingEvidence(tokens: Array<{ raw: string }>, index: number): boolean {
  const bare = (raw: string | undefined): string => (raw ?? "").replace(/[^A-Za-z]/g, "");
  const previous = bare(tokens[index - 1]?.raw);
  // "Chapters II, III and IV": the numbering word governs the whole list, not
  // just the numeral touching it, so look back a short way.
  for (let back = index - 1; back >= 0 && back >= index - 3; back--) {
    if (NUMBERING_WORDS.has(bare(tokens[back]?.raw).toLowerCase())) return true;
  }
  // "Pope Paul VI": the title sits before the given name, not before the
  // numeral, so look back a few tokens rather than one.
  for (let back = index - 1; back >= 0 && back >= index - 3; back--) {
    if (NAMED_BY_NUMERAL.has(bare(tokens[back]?.raw))) return true;
  }
  // "Sections II and IV": the neighbour is a numeral no acronym collides with.
  // A short numeral is no evidence, or "CI and CD" would excuse itself.
  // A name, not merely a capital: "The", "Type" and "Open" begin sentences and
  // are ordinary words, so they cannot be evidence of a regnal number.
  if (CAPITALISED_NAME.test(previous)
    && !COMMON_WORDS.has(previous.toLowerCase())
    && !NUMBERING_WORDS.has(previous.toLowerCase())) {
    return true;
  }
  for (const neighbour of [previous, bare(tokens[index + 1]?.raw)]) {
    if (isUnambiguousNumeral(neighbour)) return true;
  }
  if (/^(?:and|or|to|through)$/i.test(previous)) {
    for (let back = index - 2; back >= 0 && back >= index - 4; back--) {
      const candidate = bare(tokens[back]?.raw);
      if (candidate && NUMBERING_WORDS.has(bare(tokens[back - 1]?.raw).toLowerCase())
        && ROMAN_NUMERAL.test(candidate)) {
        return true;
      }
      if (isUnambiguousNumeral(candidate)) return true;
    }
  }
  return false;
}

// Shouted text and a chain of initialisms have the same shape: capitals, of
// similar length, side by side. They differ in one measurable way, which is
// how many of the words are ordinary English. Counting tokens could not tell
// "SAVE DATA FIRST" from "AWS IAM SSO MFA"; asking the lexicon can.
function shoutedPositions(tokens: Array<{ raw: string }>): Set<number> {
  const shouted = new Set<number>();
  const bare = (raw: string): string => raw.replace(/[^A-Za-z]/g, "").toLowerCase();
  const markRun = (start: number, end: number): void => {
    const length = end - start;
    if (length < 2) return;
    const known = tokens.slice(start, end).filter((token) => COMMON_WORDS.has(bare(token.raw))).length;
    // A pair carries almost no evidence, so it must be entirely ordinary words
    // to count as shouting. "ENABLE MFA" is one known word and one acronym, and
    // half of two was enough to silence it. Longer runs can carry a minority of
    // unknown words and still be a shout.
    const enough = length === 2 ? known === 2 : known * 2 >= length;
    if (!enough) return;
    for (let j = start; j < end; j++) shouted.add(j);
  };
  let runStart = 0;
  for (let i = 0; i <= tokens.length; i++) {
    if (i < tokens.length && isAllCaps(tokens[i].raw)) continue;
    markRun(runStart, i);
    runStart = i + 1;
  }
  return shouted;
}

function acronymViolations(text: string, known: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];
  const defined = new Set<string>();
  const seen = new Set<string>();
  // A definition counts wherever the reader can see it. Headings, lists and
  // tables are not audited as prose, so "## Document Object Model (DOM)"
  // followed by ordinary use of DOM was reported as undefined. That is where
  // people naturally define a term, and the complaint was simply wrong.
  for (const match of text.matchAll(/\(([A-Z][A-Z.]{1,5})\)/g)) {
    defined.add(match[1].replaceAll(".", ""));
  }
  for (const block of proseBlocks(text)) {
    const tokens = block.lines.flatMap((line, lineIndex) =>
      line.split(/\s+/).filter(Boolean).map((raw) => ({ raw, line: block.line + lineIndex })),
    );
    const shouted = shoutedPositions(tokens);
    for (let i = 0; i < tokens.length; i++) {
      const acronym = acronymFromToken(tokens[i].raw);
      if (!acronym || ACRONYM_ALLOWLIST.has(acronym.key) || known.has(acronym.key)) continue;
      if (ROMAN_NUMERAL.test(acronym.key)
        && (isUnambiguousNumeral(acronym.key) || hasNumberingEvidence(tokens, i))) {
        continue;
      }
      const inParentheses = tokens[i].raw.includes("(");
      const parenthesisFollows = tokens
        .slice(i + 1, i + 1 + ENGINE_THRESHOLDS.acronymDefinitionWindow)
        .some((token) => token.raw.includes("("));
      if (inParentheses || parenthesisFollows) {
        defined.add(acronym.key);
        continue;
      }
      if (shouted.has(i)) continue;
      // An ordinary English word is never an undefined acronym, even when it
      // sits in a run that is not shouting. "ENABLE MFA" reports MFA alone.
      if (COMMON_WORDS.has(acronym.key.toLowerCase())) continue;
      if (defined.has(acronym.key) || seen.has(acronym.key)) continue;
      seen.add(acronym.key);
      violations.push({
        rule: "acronym-undefined",
        line: tokens[i].line,
        detail: `define acronym "${acronym.display}" on first use`,
      });
    }
  }
  return violations;
}

function doubletViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    // Named rather than used: "*to*, not *in order to*" is the advice itself.
    const paragraph = block.lines.map(withoutQuotedWords).join("\n");
    const occupied: Array<{ start: number; end: number }> = [];
    const matches: Array<{ start: number; end: number; entry: DoubletEntry }> = [];
    for (const entry of DOUBLETS) {
      const pattern = new RegExp(`\\b${entry.phrase.replaceAll(" ", "\\s+")}\\b`, "gi");
      for (const match of paragraph.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (occupied.some((range) => start < range.end && end > range.start)) continue;
        occupied.push({ start, end });
        matches.push({ start, end, entry });
      }
    }
    matches.sort((a, b) => a.start - b.start);
    for (const match of matches) {
      violations.push({
        rule: "doublet",
        line: lineAtOffset(block.line, paragraph, match.start),
        detail: match.entry.legalRegister
          ? `legal-register phrase "${match.entry.phrase}"; review for audience fit`
          : `redundant phrase "${match.entry.phrase}"; consider "${match.entry.lean}"`,
      });
    }
  }
  return violations;
}

// Link text a listener can act on. Someone using a screen reader often moves
// through a document by its links, hearing the link text alone with no
// surrounding sentence, so "click here" and a bare address both say nothing
// about the destination.
const UNINFORMATIVE_LINK = /^(?:click here|here|this|link|this link|read more|more|more info|details|see more|learn more|go|page|website|download)$/i;

function linkTextViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  const { lines, hidden } = readDocument(text);
  for (let i = 0; i < lines.length; i++) {
    if (hidden(i)) continue;
    // Skip image syntax: the alt-text rule owns that.
    for (const match of lines[i].matchAll(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g)) {
      const label = match[1].trim();
      const target = match[2].trim();
      const bare = /^<?(?:https?:\/\/|www\.)/i.test(label);
      if (label.length === 0) {
        violations.push({
          rule: "link-text",
          line: i + 1,
          detail: "link has no text; say where it goes",
        });
      } else if (UNINFORMATIVE_LINK.test(label) || bare) {
        violations.push({
          rule: "link-text",
          line: i + 1,
          detail: `link text "${label}" describes no destination (${target.slice(0, 40)})`,
        });
      }
    }
  }
  return violations;
}

// An image with no alternative text is silence to a reader who cannot see it.
// An empty alt is legitimate for a purely decorative image, so the writer can
// mark that intent explicitly rather than leaving the alt blank by accident.
function imageAltViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  const { lines, hidden } = readDocument(text);
  for (let i = 0; i < lines.length; i++) {
    if (hidden(i)) continue;
    for (const match of lines[i].matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      const alt = match[1].trim();
      if (alt.length > 0) continue;
      // "decorative" as the title marks an image that carries no meaning.
      if (/\bdecorative\b/i.test(match[2])) continue;
      violations.push({
        rule: "image-alt",
        line: i + 1,
        detail: `image has no alternative text (${match[2].slice(0, 40)})`,
      });
    }
  }
  return violations;
}

// A word inside emphasis or code is being discussed, not used. Without this,
// the core skill could not name "utilise" as the word to avoid.
function withoutQuotedWords(line: string): string {
  // Quotation marks and backticks name a word. Emphasis does not: a writer
  // bolds a sentence to stress it, and "The supplier **shall** comply" is a
  // use of the word. Treating emphasis as naming exempted every bolded
  // sentence from every rule that reads words.
  return line
    .replace(/`[^`]*`/g, " ")
    .replace(/[“”"][^“”"]*[“”"]/g, " ");
}

function complexWordViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    for (let i = 0; i < block.lines.length; i++) {
      const line = withoutQuotedWords(block.lines[i]);
      for (const match of line.matchAll(/[A-Za-z']+/g)) {
        const plain = COMPLEX_WORDS.get(match[0].toLowerCase());
        if (!plain) continue;
        violations.push({
          rule: "complex-word",
          line: block.line + i,
          detail: `"${match[0]}" where "${plain}" would do`,
        });
      }
    }
  }
  return violations;
}

function doubleNegativeViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    // Named rather than used: the rule's own description quotes the phrase.
    const paragraph = block.lines.map(withoutQuotedWords).join("\n");
    for (const phrase of DOUBLE_NEGATIVES) {
      const pattern = new RegExp(`\\b${phrase.replaceAll(" ", "\\s+")}\\b`, "gi");
      for (const match of paragraph.matchAll(pattern)) {
        violations.push({
          rule: "double-negative",
          line: lineAtOffset(block.line, paragraph, match.index),
          detail: `"${match[0]}" makes the reader unpick two negatives`,
        });
      }
    }
  }
  return violations;
}

// The skill's first rule is to open with the answer. A filler opening spends
// the reader's first sentence saying nothing, and it is only a fault at the
// very start: "let me know" mid-document is ordinary English.
function fillerOpeningViolations(text: string): Violation[] {
  // Front matter is metadata, not the opening sentence. It arrives as an
  // ordinary prose block, so without this the first real sentence of every
  // templated document escaped the rule entirely.
  const blocks = proseBlocks(text);
  if (blocks.length === 0) return [];
  // Emphasis markers are stripped, not the words inside them: "**Certainly!**"
  // is still a filler opening, and removing the emphasised text hid it. Smart
  // apostrophes are normalised so "I'd" matches however it was typed.
  const opening = (blocks[0].lines[0] ?? "")
    .replace(/[*_`]/g, "")
    .replace(/[‘’]/g, "'")
    .trimStart()
    .toLowerCase();
  for (const filler of FILLER_OPENINGS) {
    if (!opening.startsWith(filler)) continue;
    // The filler must be a whole word. "Surely the answer is correct" begins
    // with the letters of "sure", "Sure-fire evidence" with the same, and
    // "Let meadows grow" with "let me". All are ordinary sentences.
    const next = opening.charAt(filler.length);
    if (next !== "" && !/[\s.,;:!?)\]]/.test(next)) continue;
    return [{
      rule: "filler-opening",
      line: blocks[0].line,
      detail: `opens with "${filler}" instead of the answer`,
    }];
  }
  return [];
}



// A listener hears each cell announced against its column name, so a table
// whose header cells are blank tells them nothing about what they are hearing.
function tableHeaderViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  const { lines, hidden } = readDocument(text);
  for (let i = 0; i < lines.length - 1; i++) {
    if (hidden(i)) continue;
    const row = lines[i].trim();
    const divider = lines[i + 1].trim();
    // Outer pipes are optional in GitHub markdown, and the divider may carry
    // alignment colons and padding. Requiring the tidiest form meant a table
    // written the common way was never checked at all.
    if (!row.includes("|") || !/^\|?[\s:|-]+\|?$/.test(divider) || !divider.includes("-")) continue;
    // Strip the outer pipes only where the row actually has them. Removing a
    // trailing pipe from a row written without outer pipes deletes a real
    // column separator, and the empty column it marks is the whole point.
    const trimmed = row.startsWith("|") ? row.replace(/^\|/, "").replace(/\|$/, "") : row;
    const cells = trimmed.split("|").map((cell) => cell.trim());
    if (cells.every((cell) => cell.length > 0)) continue;
    violations.push({
      rule: "table-header",
      line: i + 1,
      detail: "table header has an empty column name",
    });
  }
  return violations;
}

function wordyPhraseViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    // Named rather than used: "*to*, not *in order to*" is the advice itself.
    const paragraph = block.lines.map(withoutQuotedWords).join("\n");
    const occupied: Array<{ start: number; end: number }> = [];
    for (const entry of WORDY_PHRASES) {
      const pattern = new RegExp(`\\b${entry.phrase.replaceAll(" ", "\\s+")}\\b`, "gi");
      for (const match of paragraph.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        // The longest phrase wins, so "in spite of the fact that" is not also
        // reported as the shorter phrase inside it.
        if (occupied.some((range) => start < range.end && end > range.start)) continue;
        occupied.push({ start, end });
        violations.push({
          rule: "wordy-phrase",
          line: lineAtOffset(block.line, paragraph, start),
          detail: `"${entry.phrase}" says what "${entry.lean}" says`,
        });
      }
    }
  }
  return violations;
}

function proseEnumerationViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    const paragraph = block.lines.join(" ");
    const ranks = new Set<number>();
    // A hyphenated compound is one word, not a rank: "third-party service" is
    // not a third item, and counting it turned ordinary prose into a finding.
    for (const match of paragraph.matchAll(/\b(first|firstly|second|secondly|third|thirdly|fourth|fourthly|fifth|fifthly|sixth|sixthly)\b(?!-)/gi)) {
      ranks.add(ORDINAL_RANKS.get(match[1].toLowerCase())!);
    }
    for (const match of paragraph.matchAll(/(?:^|\s)(?:\(([1-6])\)|([1-6])[.)])(?=\s|$)/g)) {
      ranks.add(Number(match[1] ?? match[2]));
    }
    if (ranks.has(1) && ranks.size >= ENGINE_THRESHOLDS.enumerationMinimumRanks) {
      violations.push({
        rule: "prose-enumeration",
        line: block.line,
        detail: `enumeration ranks ${[...ranks].sort((a, b) => a - b).join(", ")} in prose; consider a list`,
      });
    }
  }
  return violations;
}

/**
 * Acronyms a project treats as known, from `.iso-24495-4/acronyms.json`.
 *
 * The shipped list stays universal on purpose: this plugin targets
 * international English, and baking CSS, SQL and SDK into it would make the
 * core list a software list. But a technical writer met a dozen findings for
 * ordinary vocabulary, which is the shortest route to switching the hook off,
 * so each project extends the list for itself.
 *
 * The file holds an array of strings. Anything unreadable or malformed leaves
 * the core list alone rather than failing the audit, because an advisory tool
 * must never be the reason a document cannot be checked.
 */
export function projectAcronyms(directory: string): ReadonlySet<string> {
  const path = join(directory, ".iso-24495-4", "acronyms.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toUpperCase())
        .filter((entry) => entry.length > 0),
    );
  } catch {
    return new Set();
  }
}

export interface AuditOptions {
  /** Extra acronyms this project treats as known. */
  knownAcronyms?: ReadonlySet<string>;
}

export function auditText(text: string, options: AuditOptions = {}): Violation[] {
  const violations: Violation[] = [];
  const sentenceLengths: number[] = [];
  const mergedLengths: number[] = [];
  for (const block of proseBlocks(text)) {
    const paragraph = block.lines.join(" ");
    const sentences = splitSentences(paragraph);
    for (const sentence of sentences) {
      const words = wordCount(sentence);
      if (words > 0) sentenceLengths.push(words);
      if (words > SENTENCE_WORD_LIMIT) {
        violations.push({
          rule: "sentence-length",
          line: block.line,
          detail: `${words} words (limit ${SENTENCE_WORD_LIMIT})`,
        });
      }
    }
    // Counted from the fewest sentences the paragraph can hold. An unresolved
    // full stop must never manufacture the sentence that breaks the limit.
    const fewest = mergedSentences(paragraph).length;
    for (const sentence of mergedSentences(paragraph)) {
      const words = wordCount(sentence);
      if (words > 0) mergedLengths.push(words);
    }
    if (fewest > PARAGRAPH_SENTENCE_LIMIT) {
      violations.push({
        rule: "paragraph-length",
        line: block.line,
        detail: `${fewest} sentences (limit ${PARAGRAPH_SENTENCE_LIMIT})`,
      });
    }
    for (let i = 0; i < block.lines.length; i++) {
      const line = withoutQuotedWords(block.lines[i]);
      for (const term of LEGALESE) {
        const matches = line.match(new RegExp(`\\b${term}\\b`, "gi"));
        for (let n = 0; n < (matches?.length ?? 0); n++) {
          violations.push({
            rule: "legalese",
            line: block.line + i,
            detail: `banned term "${term}"`,
          });
        }
      }
    }
  }
  // The standards specify an average across the document, not a cap; the cap
  // above only catches genuine sprawl. Small samples are exempt because an
  // average over a handful of sentences is noise, not judgement.
  //
  // Both readings must agree. Taking the longer reading alone let an undecided
  // full stop lift a document over the ten-sentence sample floor and produce a
  // finding the joined-up reading could not, which is the opposite of what
  // abstention is for.
  const readings = [sentenceLengths, mergedLengths].map((lengths) => ({
    count: lengths.length,
    average: lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length,
  }));
  if (readings.every((r) => r.count >= AVERAGE_MIN_SENTENCES && r.average > SENTENCE_AVERAGE_LIMIT)) {
    const reported = readings[0];
    violations.push({
      rule: "sentence-average",
      line: 1,
      detail: `average ${reported.average.toFixed(1)} words across ${reported.count} sentences (limit ${SENTENCE_AVERAGE_LIMIT})`,
    });
  }
  const documentHeadings = headings(text);
  for (let i = 0; i < documentHeadings.length; i++) {
    const heading = documentHeadings[i];
    if (heading.level > MAX_HEADING_LEVEL) {
      violations.push({
        rule: "heading-depth",
        line: heading.line,
        detail: `heading level ${heading.level} (limit ${MAX_HEADING_LEVEL})`,
      });
    }

    // lucid-inspired, reimplemented; proxy choice, not a standard clause.
    const previous = documentHeadings[i - 1];
    if (previous && heading.level > previous.level + 1) {
      violations.push({
        rule: "heading-skip",
        line: heading.line,
        detail: `heading jumps from level ${previous.level} to level ${heading.level}`,
      });
    }

    // lucid-inspired, reimplemented; proxy choice, not a standard clause.
    const headingText = heading.text.replace(/^(?:\d+\.)+\s+/, "");
    const headingWords = wordCount(headingText);
    // Same abstention as the paragraph rule: a heading is only two sentences
    // if it is two even when every doubtful stop is joined up.
    const headingSentences = mergedSentences(headingText);
    if (headingWords > HEADING_WORD_LIMIT) {
      violations.push({
        rule: "heading-style",
        line: heading.line,
        detail: `${headingWords} words (limit ${HEADING_WORD_LIMIT})`,
      });
    } else if (headingSentences.length >= 2) {
      violations.push({
        rule: "heading-style",
        line: heading.line,
        detail: `${headingSentences.length} sentences in heading`,
      });
    } else if (headingText.endsWith(".") && !headingText.endsWith("...")) {
      violations.push({
        rule: "heading-style",
        line: heading.line,
        detail: "heading ends with a full stop",
      });
    }
  }

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...acronymViolations(text, options.knownAcronyms ?? new Set()));

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...doubletViolations(text));

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...proseEnumerationViolations(text));

  // The intended readers of a document include everyone who uses it, whether
  // they see it, hear it or touch it. These two rules are the only ones here
  // that serve a reader who is not looking at the page.
  violations.push(...wordyPhraseViolations(text));
  violations.push(...complexWordViolations(text));
  violations.push(...doubleNegativeViolations(text));
  violations.push(...fillerOpeningViolations(text));
  violations.push(...tableHeaderViolations(text));
  violations.push(...linkTextViolations(text));
  violations.push(...imageAltViolations(text));
  return violations;
}

function walk(
  dir: string,
  out: string[],
  onSkip: ((path: string) => void) | undefined,
  isRoot: boolean,
  readDirectory: typeof readdirSync,
): void {
  let entries: string[];
  try {
    entries = readDirectory(dir);
  } catch (error) {
    // An unreadable root is an error the caller must see: a mistyped corpus
    // path must not read as a clean empty corpus. Below the root, the skip is
    // reported and the walk continues.
    if (isRoot) throw error;
    onSkip?.(dir);
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      // Dangling links and permission failures skip the entry, not the walk.
      // The caller is told, so it can distinguish "skipped" from "gone".
      onSkip?.(full);
      continue;
    }
    if (isDirectory) {
      walk(full, out, onSkip, false, readDirectory);
    } else if (TEXT_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext))) {
      out.push(full);
    }
  }
}

export function listTextFiles(
  dir: string,
  onSkip?: (path: string) => void,
  readDirectory: typeof readdirSync = readdirSync,
): string[] {
  const paths: string[] = [];
  walk(dir, paths, onSkip, true, readDirectory);
  return paths.sort();
}

export function auditCorpus(dir: string, onSkip?: (path: string) => void): Findings {
  const paths = listTextFiles(dir, onSkip);
  // A corpus is audited from its own directory, so the project's acronyms
  // apply to every document in it.
  const knownAcronyms = projectAcronyms(dir);
  const findings: Findings = { configHash: configHash(), files: {}, totals: {} };
  for (const path of paths) {
    const key = relative(dir, path).replaceAll("\\", "/");
    const violations = auditText(readFileSync(path, "utf8"), { knownAcronyms });
    findings.files[key] = { violations };
    for (const v of violations) {
      findings.totals[v.rule] = (findings.totals[v.rule] ?? 0) + 1;
    }
  }
  return findings;
}

export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const dir = argv[2];
  if (!dir) {
    stderr("Usage: bun audit-corpus-cli.ts <corpus-dir> [--json <out-file>]");
    return 2;
  }
  const jsonFlag = argv.indexOf("--json");
  if (jsonFlag !== -1 && !argv[jsonFlag + 1]) {
    stderr("audit-corpus: --json requires an output file");
    return 2;
  }
  try {
    const skipped: string[] = [];
    const findings = auditCorpus(dir, (path) => skipped.push(path));
    for (const path of skipped) {
      stderr(`warning: skipped unreadable entry: ${path}`);
    }
    if (jsonFlag !== -1) {
      writeFileSync(argv[jsonFlag + 1], JSON.stringify(findings, null, 2));
    }
    stdout("| Rule | Violations |");
    stdout("|------|------------|");
    for (const [rule, count] of Object.entries(findings.totals)) {
      stdout(`| ${rule} | ${count} |`);
    }
    const total = Object.values(findings.totals).reduce((a, b) => a + b, 0);
    stdout(`\nTotal: ${total} across ${Object.keys(findings.files).length} files.`);
    return 0;
  } catch (error) {
    stderr(`audit-corpus: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
