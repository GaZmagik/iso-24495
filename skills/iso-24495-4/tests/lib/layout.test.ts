import { describe, expect, spyOn, test } from "bun:test";
import { emptySignpostViolations, layoutViolations, normaliseWording, headingIds } from "../../scripts/lib/layout.ts";
import * as layoutModule from "../../scripts/lib/layout.ts";
import { structure } from "../../scripts/lib/parse.ts";
import { auditCorpus, auditText } from "../../scripts/audit-corpus.ts";
import { selectDocuments } from "../../scripts/lib/jev/audit.ts";
import { auditTarget } from "../../../iso-24495-text-audit/scripts/audit-text.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sections(count = 6): string {
  return Array.from({ length: count }, (slot, index) => `## Section ${index + 1}\n\nText.\n`).join("\n");
}
function rules(text: string): string[] {
  return layoutViolations(text).map(finding => finding.rule);
}
describe("layout rules", () => {
  const editionFinding = { rule: "opening-version-date", line: 1, detail: "No version or date was recognised in the opening. Would readers need one to identify the edition or judge how current it is?" };
  for (const depth of ["root", "metadata"]) {
    for (const key of ["version", "date", "updated", "last_updated"]) {
      test(`A7 accepts declared ${key} at ${depth} without format validation`, () => {
        for (const value of ["banana", '"  next release  "', "0", "-2", "1e2", "0x10", "2026-02-30"]) {
          const field = `${key}: ${value}`;
          const source = depth === "root" ? field : `metadata: {${field}}`;
          expect(layoutViolations(`---\n${source}\n---\n# Guide\n\nInstructions.`)).toEqual([]);
        }
      });
    }
    test(`A7 resolves numeric aliases at ${depth}`, () => {
      const field = "version: *release";
      const source = `release: &release 1.0\n${depth === "root" ? field : `metadata: {${field}}`}`;
      expect(layoutViolations(`---\n${source}\n---\n# Guide\n\nInstructions.`)).toEqual([]);
    });
    for (const value of ["true", "false", "~", '""', '"   "', "[1]", "{a: 1}", ".inf", "-.inf", ".nan"]) {
      test(`A7 rejects ${value} at ${depth}`, () => {
        const source = depth === "root" ? `version: ${value}` : `metadata: {version: ${value}}`;
        expect(layoutViolations(`---\n${source}\n---\n# Guide\n\nInstructions.`)).toEqual([{ ...editionFinding, line: 4 }]);
      });
    }
    test(`A7 accepts parser-resolved dates at ${depth}`, () => {
      const fields = { date: new Date("2026-10-04T00:00:00Z") };
      const parser = spyOn(Bun.YAML, "parse").mockImplementation(() => depth === "root" ? fields : { metadata: fields });
      try {
        expect(layoutViolations("---\ndate: 2026-10-04\n---\n# Guide\n\nInstructions.")).toEqual([]);
      } finally {
        parser.mockRestore();
      }
    });
    for (const form of ["next-line", "comment", "flow", "tab"]) {
      test(`A7 retains ${form} declarations at ${depth}`, () => {
        const field = form === "next-line" ? "version:\n  1.0" : form === "comment" ? "version: # Edition\n  # Current\n  1.0" : form === "tab" ? "version:\t1.0" : "{version: 1.0}";
        const source = depth === "root" ? field : form === "flow" ? `metadata: ${field}` : `metadata:\n  ${field.replaceAll("\n", "\n  ")}`;
        expect(layoutViolations(`---\n${source}\n---\n# Guide\n\nInstructions.`)).toEqual([]);
      });
    }
  }
  test("A7 ignores nested release history before a declared metadata version", () => {
    const history = Array.from({ length: 16 }, (slot, index) => `  edition${index}: {version: 1.0}`).join("\n");
    expect(layoutViolations(`---\nhistory:\n${history}\nmetadata: {version: 2.0}\n---\n# Guide\n\nInstructions.`)).toEqual([]);
  });
  test("A7 rejects unrelated and deeper declarations", () => {
    for (const source of ["count: 3", "metadata: {edition: {version: banana}}", "edition: {metadata: {version: banana}}", "Metadata: {version: banana}", "metadata: banana", "metadata: [banana]", "metadata: null", 'description: "version: banana"', "description: |\n  version: banana"]) {
      expect(layoutViolations(`---\n${source}\n---\n# Guide\n\nInstructions.`)).toEqual([{ ...editionFinding, line: source.split("\n").length + 3 }]);
    }
  });
  test("A7 rejects malformed, absent and non-mapping front matter", () => {
    for (const source of ["version: [broken", "null", "- banana", '"banana"', "# Comment", ""]) {
      expect(layoutViolations(`---\n${source}\n---\n# Guide\n\nInstructions.`)).toEqual([{ ...editionFinding, line: 4 }]);
    }
    expect(layoutViolations("---\nversion: 1.0\n# Guide\n\nInstructions.")).toEqual([{ ...editionFinding, line: 3 }]);
  });
  test("A7 parses front matter exactly once, including large documents", () => {
    const unrelated = Array.from({ length: 5000 }, (slot, index) => `k${index}: 1.0`).join("\n");
    for (const source of ["version: 1.0", "release: &release 1.0\nmetadata: {version: *release}", `version: 1\n${unrelated}`]) {
      const parser = spyOn(Bun.YAML, "parse");
      try {
        const findings = layoutViolations(`---\n${source}\n---\n# Guide\n\nInstructions.`);
        expect(parser.mock.calls.length).toBe(1);
        expect(findings).toEqual([]);
      } finally {
        parser.mockRestore();
      }
    }
  });
  test("A7 leaves visible-opening format recognition strict", () => {
    for (const opening of ["# Guide\n\nVersion: banana", "# Guide (Version: banana)", "# Guide\n\n| Field | Value |\n|---|---|\n| Version | banana |", "# Guide\n\n![Version: banana](badge.svg)"]) {
      expect(layoutViolations(opening)).toEqual([editionFinding]);
    }
  });
  for (const fileName of ["PULL_REQUEST_TEMPLATE", "pull_request_template.markdown", "D:/docs/nested/.github/PULL_REQUEST_TEMPLATE.md"]) {
    test(`A6 correction exempts template ${fileName}`, () => {
      expect(layoutViolations("# Title\n\nText.", { fileName })).toEqual([]);
      expect(layoutViolations("# Title\n\nText.", { fileName: "PULL_REQUEST_TEMPLATE-copy.md" })).toEqual([editionFinding]);
    });
  }
  test("A6 skips untitled documents", () => {
    for (const text of ["Text only.", "## Section\n\nText.", "> # Quoted title\n\nText.", "- # List title\n\nText."]) {
      expect(layoutViolations(text)).toEqual([]);
    }
  });
  for (const base of ["README", "CONTRIBUTING", "SECURITY"]) {
    for (const name of [base, base.toLowerCase(), `${base}.markdown`, `${base.toLowerCase()}.MARKDOWN`]) {
      test(`A6 exempts file name ${name}`, () => {
        expect(layoutViolations("# Title\n\nText.", { fileName: `D:\\docs\\${name}` })).toEqual([]);
      });
    }
  }
  test("A6 exempts titled pull request text without front matter", () => {
    expect(layoutViolations("# Title\n\nText.", { frontMatter: false })).toEqual([]);
    expect(auditText("# Title\n\nText.", { markdown: true, frontMatter: false })).toEqual([]);
  });
  test("A6 retains a neutral finding for titled ordinary documents", () => {
    expect(layoutViolations("# Title\n\nText.", { fileName: "policy.md" })).toEqual([editionFinding]);
    expect(layoutViolations("# Title\n\nText.", { fileName: "README-copy.md" })).toEqual([editionFinding]);
    expect(auditText(editionFinding.detail)).toEqual([]);
  });
  for (const route of ["corpus", "text", "jev-preview"]) {
    test(`A6 file-name scope reaches the ${route} route`, () => {
      const directory = mkdtempSync(join(tmpdir(), "iso-a6-scope-"));
      try {
        for (const name of ["readme.md", "CONTRIBUTING.markdown", "SECURITY.md", "policy.md"]) {
          writeFileSync(join(directory, name), "# Title\n\nText.");
        }
        const findings = route === "corpus" ? auditCorpus(directory) : route === "text" ? auditTarget(directory, directory) : selectDocuments(directory, directory, "text").mechanical;
        expect(findings.totals["opening-version-date"]).toBe(1);
        expect(Object.entries(findings.files).filter(([, file]) => file.violations.some(finding => finding.rule === "opening-version-date")).map(([name]) => name)).toEqual(["policy.md"]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
  test("review 1: contents entries follow Markdown blocks rather than blank lines", () => {
    const opening = "# Title\n\nVersion 1.0\n\n";
    expect(rules(opening + "- [Section 1](#section-1)\n\n- [Section 2](#section-2)\n\n### Overview\n\n" + sections())).toEqual([]);
    for (const contents of ["## Contents\n\n", "## Contents\n\n| Section |\n|---|\n\n","## Contents\n\nChoose the section that helps you.\n\n", "## Contents\n\nSee [Section 1](#section-1) for details.\n\n", "## Contents\n\n| [Section 1](#section-1) |\n|---|\n\n"]) {
      expect(rules(opening + contents + "### Overview\n\n" + sections()), contents).toEqual(["contents-list"]);
    }
    // A heading is not an entry. This one is an empty signpost as well.
    expect(rules(opening + "## Contents\n\n### Links\n\n### Overview\n\n" + sections())).toEqual(["empty-signpost", "contents-list"]);
    expect(rules(opening + "[Section 1](#section-1)\n\n[Section 2](#section-2)\n\n### Overview\n\n" + sections())).toEqual(["contents-list"]);
    expect(rules(opening + "Read [Section 1](#section-1) and [Section 2](#section-2) for details.\n\n### Overview\n\n" + sections())).toEqual(["contents-list"]);
    expect(rules(opening + "- [Section 1](#section-1)\n\nExplanation.\n\n- [Section 2](#section-2)\n\n### Overview\n\n" + sections())).toEqual(["contents-list"]);
  });
  test("review 2: literal punctuation and code survive wording recognition", () => {
    expect(normaliseWording("Over_view_ foo_bar_baz \\*literal\\* `*literal* &amp;`" )).toBe("Over_view_ foo_bar_baz *literal* *literal* &amp;");
    expect(headingIds(["foo_bar_baz"])).toEqual(["foo_bar_baz"]);
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- Section 1\n\n## Over_view_\n\n" + sections(4))).toEqual(["overview-label"]);
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n[Incorrect](#foo_bar_baz)\n\n### Overview\n\n## foo_bar_baz\n\n" + sections(4))).toEqual(["contents-list"]);
  });
  test("a contents link whose fragment cannot be decoded is passed over", () => {
    const passedOver = ["Add contents or navigation for six or more root H2 sections."];
    for (const fragment of ["#%", "#%E0%A4%A"]) {
      expect(layoutViolations(`# Title\n\nVersion 1.0\n\n## Contents\n\n[Incorrect](${fragment})\n\n### Overview\n\n## foo_bar_baz\n\n` + sections(4)).map(finding => finding.detail), fragment).toEqual(passedOver);
    }
  });
  test("review 3: metadata requires a parsed table and correct cell boundaries", () => {
    expect(rules("# Title\n\nVersion | 2.1\n")).toEqual(["opening-version-date"]);
    expect(rules("# Title\n\nVersion | 2.1\n--- | ---\nDate | 2026-10-03\n")).toEqual([]);
    expect(rules("# Title\n\n| Field | Value |\n|---|---|\n| Version\\|other | 2.1 |\n")).toEqual(["opening-version-date"]);
  });
  test("review 4: raw HTML code blocks do not supply structural headings or bullets", () => {
    for (const tag of ["pre", "script", "style", "textarea"]) {
      expect(rules("# Title\n\nVersion 1.0\n\n<" + tag + ">\n\n" + sections() + "\n- One\n  - Two\n    - Three\n</" + tag + ">\n"), tag).toEqual([]);
    }
    expect(rules("# Title\n\nVersion 1.0\n\n<pre>\n" + sections() + "</pre>\n\n" + sections())).toEqual(["contents-list", "overview-label"]);
    expect(rules("# Title\n\nVersion 1.0\n\n<PRE class=example>code</PRE>\n")).toEqual([]);
    expect(rules("# Title\n\nVersion 1.0\n\n> <pre>\n> ## Quoted\n\n" + sections())).toEqual(["contents-list", "overview-label"]);
    expect(rules("# Title\n\nVersion 1.0\n\n<pre>\n" + sections())).toEqual([]);
  });
  test("review 6: layout rules exclude quoted overviews and count only unordered ancestry", () => {
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- Section 1\n\n> ## Overview\n\n" + sections(5))).toEqual(["overview-label"]);
    expect(layoutViolations("# Title\n\nVersion 1.0\n\n> - One\n>   - Two\n>     - Three\n")).toEqual([{ rule: "bullet-depth", line: 7, detail: "Unordered bullet depth 3 (limit 2). Flatten this item." }]);
    expect(layoutViolations("# Title\n\nVersion 1.0\n\n1. Parent\n   - One\n     1. Ordered\n        - Two\n          - Three\n")).toEqual([{ rule: "bullet-depth", line: 9, detail: "Unordered bullet depth 3 (limit 2). Flatten this item." }]);
  });
  test("counts root H2 sections only and applies contents wording only at six", () => {
    expect(rules("# Title\n\nVersion 1.0\n\n" + sections(5))).toEqual([]);
    expect(rules("# Title\n\nVersion 1.0\n\n" + sections())).toEqual(["contents-list", "overview-label"]);
    expect(rules("# Title\n\nDate 2026-10-03\n\n" + sections(3) + "### Child\n\n### Other\n\n> ## Quote\n\n- ## List\n")).toEqual([]);
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- [Wrong](#section-1)\n\n" + sections(4))).toEqual([]);
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- [Wrong](#section-1)\n\n### Overview\n\n" + sections(5))).toEqual(["contents-list"]);
  });
  test("recognises partial, paragraph, table, opening and reference navigation", () => {
    for (const navigation of ["## Contents\n\n- Section 1\n", "## Table of contents\n\n[Section 1](#section-1)\n", "## TOC\n\n| Links |\n|---|\n| [Section 1](#section-1) |\n", "## Key sections\n\n[Section 1][one]\n\n[one]: #section-1\n", "[Section 1](#section-1) [Section 2](#section-2)\n", "- [Section 1](#section-1)\n- [Section 2](#section-2)\n"]) {
      expect(rules("# Title\n\nVersion 1.0\n\n" + navigation + "\n### Summary\n\n" + sections())).toEqual([]);
    }
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n[Custom](#custom)\n\n### Overview\n\n" + sections())).toEqual([]);
    expect(rules("# Title\n\nVersion 1.0\n\n[Outside](https://example.org)\n\n### Overview\n\n" + sections())).toEqual(["contents-list"]);
    expect(rules("# Title\n\nVersion 1.0\n\n> [Section 1](#section-1) [Section 2](#section-2)\n\n### Overview\n\n" + sections())).toEqual(["contents-list"]);
  });
  test("resolves deterministic Unicode and duplicate heading IDs", () => {
    expect(headingIds(["A!", "A!", "A-1", "A!", "École _name_"])).toEqual(["a", "a-1", "a-1-1", "a-2", "école-name"]);
    expect(normaliseWording("**A &amp; [B](#b)**\ntext")).toBe("A & B text");
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n[A!](#a-1)\n\n### Overview\n\n## A!\n\n## A!\n\n" + sections(3))).toEqual([]);
  });
  test("requires version or calendar-valid date in a document field in the opening", () => {
    for (const field of ["Version: v2.1", "Revision 2.1.0-rc.1+build.2", "Date 2024-02-29", "Updated: 29 Feb 2024", "Last updated October 3, 2026", "Reviewed: 03/10/2026", "Date: 12/31/2026", "Date 10/2026", "Date Q4 2026", "![Version: 2.1](badge.svg)", "| Field | Value |\n|---|---|\n| Version | 2.1 |", "| Field | Value |\n|---|---|\n| Date | March 2026 |"]) {
      expect(rules("# Title\n\n" + field + "\n"), field).toEqual([]);
    }
    expect(rules("# Title (Version: 2.1)\n")).toEqual([]);
    for (const field of ["v2.1", "Requires v2.1", "Updated targets for Q3 2026", "Reviewed the policy in March 2026", "Version 2.1 is required", "Date 2023-02-29", "Date 2026-13-01", "Date 13/2026", "Date 13/13/2026", "Date Q5 2026", "Date 2026-04-31", "Date 00/2026", "Version 2", "Date 3 Smarch 2026", "![Updated targets for Q3 2026](badge.svg)"]) {
      expect(rules("# Title\n\n" + field + "\n"), field).toEqual(["opening-version-date"]);
    }
    expect(rules("---\nversion: 2.1\n---\n# Title\n\n## Footer\n\nDate 2026-10-03\n")).toEqual([]);
  });
  test("counts unordered ancestry alone, including task items and mixed containers", () => {
    const text = "# Title\n\nVersion 1.0\n\n- One\n  1. Ordered\n     - Two\n       > - [x] Three\n\n- Next\n\n```\n- one\n  - two\n    - three\n```\n";
    expect(layoutViolations(text)).toEqual([{ rule: "bullet-depth", line: 8, detail: "Unordered bullet depth 3 (limit 2). Flatten this item." }]);
    expect(normaliseWording("&#65; &#x41; &unknown; &#0;")).toBe("A A &unknown; \ufffd");
    expect(rules("# T\n\nVersion 1.0\n\n- One\n\t- Two\n\t\t- Three\n")).toEqual(["bullet-depth"]);
    expect(rules("# T\n\nVersion 1.0\n\n1. One\n   10. Two\n       - Bullet\n")).toEqual([]);
  });
  test("requires an overview heading before the first content H2, at any root heading level", () => {
    for (const overview of ["### Overview", "## **1. Summary**", "Overview\n========", "Overview\n--------"]) {
      expect(rules("# Title\n\nVersion 1.0\n\n" + overview + "\n\n## Contents\n\n- Section 1\n\n" + sections())).toEqual([]);
    }
    for (const overview of ["**Overview**", "> ### Overview", "- ### Overview", "[Overview](#overview)"]) {
      expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- Section 1\n\n" + overview + "\n\n" + sections())).toEqual(["overview-label"]);
    }
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- Section 1\n\n" + sections() + "\n### Overview\n")).toEqual(["overview-label"]);
    expect(rules("# Title\n\nVersion 1.0\n\n## First\n\n### Overview\n\n" + sections())).toEqual(["contents-list", "overview-label"]);
  });
  test("retains container metadata without changing heading and prose extraction", () => {
    const parsed = structure("# T\n\n> ## Example\n\n- Item\n  - Child\n    - Grandchild\n\n## Root\n");
    expect(parsed.headings.map(heading => heading.text)).toEqual(["T", "Root"]);
    expect(parsed.items.map(item => item.depth)).toEqual([1, 2, 3]);
  });
  // The definition check takes any character but a space or a tab as part of
  // a destination. Reading the destination back by trimming took a no-break
  // space, U+FEFF and a form feed for space and found none. That first threw,
  // and once guarded it left the name free, so a later duplicate replaced the
  // first definition. Each character is built from its code, so that none
  // sits unseen in this file. A form feed is an ASCII control character, which
  // CommonMark refuses in a destination outside angle brackets, so the bare
  // form feed is a paragraph and is tested below with the other controls.
  test("the first definition of a name keeps it, whatever character its destination is", () => {
    for (const code of [0xa0, 0xfeff, 0x2028, 0x3000]) {
      const character = String.fromCharCode(code);
      const label = `U+${code.toString(16)}`;
      expect(structure(`[a]: ${character}\n[a]: #later\n`).destinations.get("a"), label).toBe(character);
    }
    for (const code of [0xa0, 0xfeff, 0x0c, 0x2028, 0x3000]) {
      const character = String.fromCharCode(code);
      const label = `U+${code.toString(16)}`;
      expect(structure(`[a]: <${character}>\n[a]: #later\n`).destinations.get("a"), label).toBe(character);
    }
    expect(structure("[a]: <>\n[a]: #later\n").destinations.get("a")).toBe("");

    // With the name left free, "[a]" resolved to "#a", the line of links read
    // as a contents list, and the missing contents went unreported.
    const document = "# Title\n\nVersion 1.0\n\n[A][a] | [B][b]\n\n"
      + `[a]: ${String.fromCharCode(0xa0)}\n[a]: #a\n[b]: #b\n\n`
      + ["A", "B", "C", "D", "E", "F"].map(name => `## ${name}\n\nWords.`).join("\n\n");
    expect(auditText(document, { markdown: true }).map(finding => finding.rule))
      .toEqual(["contents-list", "overview-label"]);
  });

  // A label may hold an escaped bracket, so "]:" can sit inside it. The
  // destination was read from the first "]:" on the line, and here that
  // recorded "b]:" in place of "/url".
  test("a destination is read from the end of the label, not from the first \"]:\" on the line", () => {
    expect([...structure("[a\\]:b]: /url\n").destinations]).toEqual([["a]:b", "/url"]]);
    expect([...structure("[a\\]:b]: <x y> \"t\"\n").destinations]).toEqual([["a]:b", "x y"]]);
    expect([...structure("[a\\]: b]: /url\n").destinations]).toEqual([["a]: b", "/url"]]);
  });

  // CommonMark 0.31.2 refuses an ASCII control character, U+0000 to U+001F or
  // U+007F, in a destination outside angle brackets. Such a line is a
  // paragraph a reader sees, so it must stay in the text the audit reads.
  // Between angle brackets only a line ending, "<" or ">" is refused, so there
  // the line is still a definition. Characters are built from their codes, so
  // that none sits unseen in this file.
  test("a bare destination holding an ASCII control character is not a definition", () => {
    for (const code of [0x01, 0x0b, 0x0c, 0x1f, 0x7f]) {
      const character = String.fromCharCode(code);
      const label = `U+${code.toString(16)}`;
      for (const line of [`[a]: ${character}`, `[a]: x${character}y`, `[a]: x${character} "title"`]) {
        const parsed = structure(`${line}\n`);
        expect(parsed.lines[0], label).toBe(line);
        expect(parsed.destinations.has("a"), label).toBe(false);
      }
      expect(structure(`[a]: <${character}>\n`).destinations.get("a"), label).toBe(character);
      // The paragraph stays open, and a definition cannot interrupt one.
      expect(structure(`[a]: ${character}\n[a]: #later\n`).destinations.has("a"), label).toBe(false);
    }
  });

  // CommonMark replaces U+0000 with U+FFFD before it reads a line, and U+FFFD
  // may stand in a bare destination. So a line whose destination is U+0000 is
  // a definition there, and stays one here. The C1 controls, U+0080 to
  // U+009F, are not ASCII control characters, so they may stand there too.
  test("U+0000 and the C1 controls are still accepted in a bare destination", () => {
    for (const code of [0x00, 0x80, 0x85, 0x9f]) {
      const character = String.fromCharCode(code);
      const label = `U+${code.toString(16)}`;
      const parsed = structure(`[a]: ${character}\n`);
      expect(parsed.lines[0], label).toBe("");
      expect(parsed.destinations.get("a"), label).toBe(character);
    }
  });
});

describe("what a heading identifier keeps", () => {
  // The interface comment said a wording with no letter or digit gives an empty
  // identifier. It does not: hyphens and underscores are kept. Each line here is a
  // sentence of the corrected comment, so the comment and the function cannot part again.
  test("hyphens and underscores are kept, so a wording made of them is its own identifier", () => {
    expect(headingIds(["---"])).toEqual(["---"]);
    expect(headingIds(["_"])).toEqual(["_"]);
    expect(headingIds(["--", "- -", "a - b"])).toEqual(["--", "---", "a---b"]);
  });

  test("only a wording with none of the kept characters gives an empty identifier", () => {
    expect(headingIds(["!!!"])).toEqual([""]);
    expect(headingIds([" "])).toEqual([""]);
    expect(headingIds([""])).toEqual([""]);
    expect(headingIds(["!!!", "", "???"])).toEqual(["", "-1", "-2"]);
    expect(headingIds([])).toEqual([]);
  });

  test("letters, numbers and combining marks are kept, and each space left becomes a hyphen", () => {
    const acute = String.fromCharCode(0x301);
    expect(headingIds([`Cafe${acute} 5!`, "x_y z"])).toEqual([`cafe${acute}-5`, "x_y-z"]);
    // Removing the ampersand leaves the space on each side of it.
    expect(headingIds(["a & b"])).toEqual(["a--b"]);
  });

  test("an identifier already given takes a suffix, whatever wording gave it", () => {
    expect(headingIds(["a b", "A  B", "a-b"])).toEqual(["a-b", "a-b-1", "a-b-2"]);
  });
});

describe("the structural reading lists code blocks and prose blocks", () => {
  test("a fenced block gives its contents without the fences, the info string or the fence's indentation", () => {
    expect(structure("Text.\n\n```js\nconst a = 1;\n  kept  as  written\n```\n").code).toEqual([{ line: 3, text: "const a = 1;\n  kept  as  written" }]);
    expect(structure("   ```\n   a\n  b\n c\nd\n   ```\n").code).toEqual([{ line: 1, text: "a\nb\nc\nd" }]);
    expect(structure("~~~~\nx\n~~~\n~~~~\n").code).toEqual([{ line: 1, text: "x\n~~~" }]);
  });

  test("a block inside a list item or a quotation loses the container's markers", () => {
    expect(structure("- Item\n\n  ```\n  inside\n  ```\n").code).toEqual([{ line: 3, text: "inside" }]);
    expect(structure("> ```\n> quoted\n> ```\n").code).toEqual([{ line: 1, text: "quoted" }]);
    expect(structure("> ```\n> quoted\n\nAfter.\n").code).toEqual([{ line: 1, text: "quoted" }]);
  });

  test("an unclosed fence runs to the end of the text, and the end after a final line break is no line", () => {
    expect(structure("```\nunclosed\n").code).toEqual([{ line: 1, text: "unclosed" }]);
    expect(structure("```\nunclosed\n\n").code).toEqual([{ line: 1, text: "unclosed\n" }]);
    expect(structure("```\nunclosed").code).toEqual([{ line: 1, text: "unclosed" }]);
  });

  test("indented code loses four columns, and keeps the blank lines between its lines", () => {
    expect(structure("Para.\n\n    code one\n\n    code two\n\nAfter.\n").code).toEqual([{ line: 3, text: "code one\n\ncode two" }]);
    expect(structure("    a\n\n\n      b\nPara\n").code).toEqual([{ line: 1, text: "a\n\n\n  b" }]);
    expect(structure("    a\nPara\n\n    b\n").code).toEqual([{ line: 1, text: "a" }, { line: 4, text: "b" }]);
    expect(structure("    a\n\n-     b\n").code).toEqual([{ line: 1, text: "a" }, { line: 3, text: "b" }]);
    expect(structure("\tTabbed\n").code).toEqual([{ line: 1, text: "Tabbed" }]);
  });

  test("front matter, a paragraph's indented continuation and a raw HTML block are not code", () => {
    expect(structure("---\ntitle: x\n---\n\n```\nfm\n```\n").code).toEqual([{ line: 5, text: "fm" }]);
    expect(structure("Para\n    continues\n").code).toEqual([]);
    expect(structure("<pre>\ncode\n</pre>\n").code).toEqual([]);
  });

  test("an empty block is listed with no contents", () => {
    expect(structure("```\n```\n").code).toEqual([{ line: 1, text: "" }]);
  });

  test("the prose blocks leave out a raw HTML code block, so prose straight after one is its own paragraph", () => {
    expect(structure("<pre>\ncode\n</pre>\nThe prose stays.\n").paragraphs).toEqual([{ line: 4, lines: ["The prose stays."] }]);
    expect(structure("One.\nTwo.\n\n- Item\n").paragraphs).toEqual([{ line: 1, lines: ["One.", "Two."] }, { line: 4, lines: ["Item"] }]);
  });
});

/** The empty-signpost findings alone, as line and detail. */
function signposts(text: string, frontMatter?: boolean): Array<{ line: number; detail: string }> {
  return layoutViolations(text, frontMatter === undefined ? {} : { frontMatter })
    .filter(finding => finding.rule === "empty-signpost")
    .map(finding => ({ line: finding.line, detail: finding.detail }));
}
/** The finding for a signpost heading with this wording, on this line. */
function emptyAt(line: number, wording = "See also"): { line: number; detail: string } {
  return { line, detail: `The "${wording}" heading has nothing beneath it. List where else to go beneath it, or remove the heading when nothing else exists.` };
}

describe("empty-signpost: a referral heading with nothing beneath it", () => {
  test("a signpost section at the end of the document, with nothing after its heading", () => {
    expect(signposts("# Guide\n\nText.\n\n## See also\n")).toEqual([emptyAt(5)]);
    expect(signposts("# Guide\n\nText.\n\n## See also")).toEqual([emptyAt(5)]);
    expect(signposts("# Guide\n\nText.\n\n## See also\n\n\n\n")).toEqual([emptyAt(5)]);
  });

  test("a signpost followed by a heading at its own level or above, with nothing between", () => {
    expect(signposts("## See also\n\n## Install\n\nText.\n")).toEqual([emptyAt(1)]);
    expect(signposts("## Part\n\nText.\n\n### See also\n\n# Next\n\nText.\n")).toEqual([emptyAt(5)]);
  });

  test("a deeper heading is not content, but what sits beneath it is", () => {
    expect(signposts("## See also\n\n### Guides\n\n## Next\n\nText.\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n\n### Guides\n\n- [Install](install.md)\n\n## Next\n\nText.\n")).toEqual([]);
    // The deeper heading is a signpost too, and holds nothing of its own.
    expect(signposts("## See also\n\n### Related\n\n## Next\n")).toEqual([emptyAt(1), emptyAt(3, "Related")]);
  });

  test("a list, a paragraph, a quotation, a table or an HTML image beneath the heading clears it", () => {
    expect(signposts("## See also\n\n- [Install](install.md)\n")).toEqual([]);
    expect(signposts("## See also\n\nAsk the help desk.\n")).toEqual([]);
    expect(signposts("## See also\n\n| Guide | Use |\n|---|---|\n| [Install](install.md) | Setting up |\n")).toEqual([]);
    expect(signposts("## See also\n> Ask the help desk.\n")).toEqual([]);
    expect(signposts("## See also\n\n<img src=\"map.png\" alt=\"Map of the related guides\">\n")).toEqual([]);
  });

  test("code beneath the heading clears it, because a reader sees it", () => {
    expect(signposts("## See also\n\n```\nman install\n```\n")).toEqual([]);
    expect(signposts("## See also\n\n    man install\n")).toEqual([]);
    expect(signposts("## See also\n\n```\n```\n")).toEqual([]);
  });

  test("a comment, a link definition, a thematic break or an empty marker is not content", () => {
    expect(signposts("## See also\n\n<!-- Add the related guides. -->\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n<!--\nAdd the related guides.\n-->\n\n## Next\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n\n[install]: install.md\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n\n---\n\n## Next\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n\n* * *\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n\n- \n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n\n>\n")).toEqual([emptyAt(1)]);
  });

  test("a raw HTML code block is blanked by the structural reading, so it does not clear the heading", () => {
    expect(signposts("## See also\n\n<pre>\nman install\n</pre>\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See also\n\n```\nman install\n```\n")).toEqual([]);
  });

  test("front matter is metadata unless the text has none, when its block can become a heading", () => {
    expect(signposts("---\ntitle: See also\n---\n\n# Guide\n\nText.\n")).toEqual([]);
    expect(signposts("---\nrelated:\n---\n\n## Next\n")).toEqual([]);
    expect(signposts("---\nrelated:\n---\n\n## Next\n", false)).toEqual([emptyAt(2, "related:")]);
    // A block whose lines are not keys and values is not front matter at all.
    expect(signposts("---\nSee also\n---\n\n## Next\n")).toEqual([emptyAt(2)]);
  });

  test("a setext heading is read like an ATX heading, from the line its text starts on", () => {
    expect(signposts("See also\n--------\n\n## Next\n")).toEqual([emptyAt(1)]);
    expect(signposts("See also\n========\n")).toEqual([emptyAt(1)]);
    expect(signposts("See also\n--------\n- [Install](install.md)\n")).toEqual([]);
    expect(signposts("Further\nreading\n-------\n\n## Next\n")).toEqual([emptyAt(1, "Further reading")]);
  });

  test("Windows line endings give the same findings", () => {
    const text = "# Guide\n\nText.\n\n## See also\n\n<!-- none -->\n\nSee also\n--------\n\n## Resources\n\n- [Install](install.md)\n";
    expect(signposts(text.replaceAll("\n", "\r\n"))).toEqual(signposts(text));
    expect(signposts(text)).toEqual([emptyAt(5), emptyAt(9)]);
  });

  test("the wording is read whole, after numbering, symbols at either end and letter case", () => {
    for (const wording of ["Related", "Related documents", "Related links", "Related pages", "Related reading", "Related resources", "Related topics",
      "See also", "Resources", "Additional resources", "Further reading", "Other languages", "External links", "Useful links", "Links"]) {
      expect(signposts(`## ${wording}\n`), wording).toEqual([emptyAt(1, wording)]);
    }
    expect(signposts("## SEE ALSO\n")).toEqual([emptyAt(1, "SEE ALSO")]);
    expect(signposts("## See also:\n")).toEqual([emptyAt(1, "See also:")]);
    expect(signposts("## 7. See also\n")).toEqual([emptyAt(1, "7. See also")]);
    expect(signposts("## 🔗 Useful links\n")).toEqual([emptyAt(1, "🔗 Useful links")]);
    expect(signposts("## *See also*\n")).toEqual([emptyAt(1, "See also")]);
    expect(signposts("## See also ##\n")).toEqual([emptyAt(1)]);
    expect(signposts("## See  also\n")).toEqual([emptyAt(1)]);
  });

  test("other wording is not a signpost, even when it holds a signpost word", () => {
    for (const wording of ["References", "Next steps", "Learn more", "Human resources", "See also the install guide", "Resources used", "Relatedness"]) {
      expect(signposts(`## ${wording}\n`), wording).toEqual([]);
    }
  });

  test("a heading inside a list or a quotation, an HTML heading and a bold line are not read", () => {
    expect(signposts("- ## See also\n")).toEqual([]);
    expect(signposts("> ## See also\n")).toEqual([]);
    expect(signposts("<h2>See also</h2>\n")).toEqual([]);
    expect(signposts("**See also**\n")).toEqual([]);
    expect(signposts("```\n## See also\n```\n")).toEqual([]);
    // A heading in a list is content for the signpost above it.
    expect(signposts("## See also\n\n- ## Install\n")).toEqual([]);
  });

  test("it reports in a document with six or more sections, beside the contents rule", () => {
    const text = `# Guide\n\nVersion 1.0\n\n## Overview\n\nText.\n\n${sections(5)}\n## See also\n`;
    expect(rules(text)).toEqual(["empty-signpost", "contents-list"]);
  });

  test("the full audit reports it for Markdown only", () => {
    expect(auditText("## See also\n", { markdown: true }).filter(finding => finding.rule === "empty-signpost")).toEqual([{ rule: "empty-signpost", ...emptyAt(1) }]);
    expect(auditText("## See also\n").filter(finding => finding.rule === "empty-signpost")).toEqual([]);
  });

  test("the scan takes less time than the parse it reads, so it does not grow with the square of the text", () => {
    // A heading checked against every later heading or every code block grew
    // with the square of their number. The parse of the same text is the
    // baseline, so a slower or busier machine slows both.
    const text = "## See also\n\n```\nx\n```\n\n### Resources\n\n".repeat(20_000);
    let started = performance.now();
    const parsed = structure(text);
    const parse = performance.now() - started;
    started = performance.now();
    const found = emptySignpostViolations(parsed);
    const scan = performance.now() - started;
    expect(found).toHaveLength(20_000);
    expect(scan).toBeLessThan(parse);
  }, 60_000);

  test("the full audit takes every layout finding however many there are, without spreading them into a call", () => {
    // A spread of 700,000 arguments into one call threw a RangeError on
    // Windows. A real document that long takes over a minute to audit, so the
    // layout rules are stubbed to give two million findings at once.
    const many = Array.from({ length: 2_000_000 }, (slot, index) => ({ rule: "empty-signpost", line: index + 1, detail: "Empty." }));
    const stub = spyOn(layoutModule, "layoutViolations").mockImplementation(() => many);
    try {
      const found = auditText("Text.\n", { markdown: true });
      expect([found.length, found.at(-1)?.line]).toEqual([2_000_000, 2_000_000]);
    } finally {
      stub.mockRestore();
    }
  }, 30_000);
});
