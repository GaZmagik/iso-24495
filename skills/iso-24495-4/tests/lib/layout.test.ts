import { describe, expect, test } from "bun:test";
import { layoutViolations, normaliseWording, headingIds } from "../../scripts/lib/layout.ts";
import { structure } from "../../scripts/lib/parse.ts";
import { auditCorpus, auditText } from "../../scripts/audit-corpus.ts";
import { selectDocuments } from "../../scripts/lib/jev/audit.ts";
import { auditTarget } from "../../../iso-24495-text-audit/scripts/audit-text.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sections = (count = 6) => Array.from({ length: count }, (_, index) => `## Section ${index + 1}\n\nText.\n`).join("\n");
const rules = (text: string) => layoutViolations(text).map(finding => finding.rule);
describe("layout rules", () => {
  const editionFinding = { rule: "opening-version-date", line: 1, detail: "No version or date was recognised in the opening. Would readers need one to identify the edition or judge how current it is?" };
  test("A6 skips untitled documents", () => {
    for (const text of ["Text only.", "## Section\n\nText.", "> # Quoted title\n\nText.", "- # List title\n\nText."]) expect(layoutViolations(text)).toEqual([]);
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
  for (const [key, value] of [["version", '"0.8.0"'], ["date", "2026-10-03"], ["updated", "Q4 2026"], ["last_updated", "3 October 2026"]]) {
    test(`A6 recognises top-level front matter ${key}`, () => {
      expect(layoutViolations(`---\n${key}: ${value}\n---\n# Title\n\nText.`)).toEqual([]);
    });
  }
  test("A6 preserves recognised unquoted numeric version spelling", () => {
    for (const metadata of ["version: 2.0", '"version": 2.0 # Current edition', "date: 2.0", "version: 2.00"]) expect(layoutViolations(`---\n${metadata}\n---\n# Title\n\nText.`)).toEqual([]);
  });
  test("A6 rejects numeric YAML spellings outside recognised forms", () => {
    for (const metadata of ["version: 1e-2", "version: 0x10", "version: 2"]) expect(layoutViolations(`---\n${metadata}\n---\n# Title\n\nText.`)).toEqual([{ ...editionFinding, line: 4 }]);
  });
  test("A6 keeps unrecognised and nested front matter advisory", () => {
    for (const metadata of ["version: next release", "version: 1", "date: 2026-02-30", "updated: null", "last_updated: [2026-10-03]", "edition:\n  version: 0.8.0", "title: Example", "version: [broken", "# Metadata comment", "- 2026-10-03"]) {
      expect(layoutViolations(`---\n${metadata}\n---\n# Title\n\nText.`)).toEqual([{ ...editionFinding, line: metadata.includes("\n") ? 5 : 4 }]);
    }
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
        expect(Object.keys(findings.files).filter(name => findings.files[name].violations.some(finding => finding.rule === "opening-version-date"))).toEqual(["policy.md"]);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  }
  test("review 1: contents entries follow Markdown blocks rather than blank lines", () => {
    const opening = "# Title\n\nVersion 1.0\n\n";
    expect(rules(opening + "- [Section 1](#section-1)\n\n- [Section 2](#section-2)\n\n### Overview\n\n" + sections())).toEqual([]);
    for (const contents of ["## Contents\n\n", "## Contents\n\n| Section |\n|---|\n\n", "## Contents\n\n### Links\n\n", "## Contents\n\nChoose the section that helps you.\n\n", "## Contents\n\nSee [Section 1](#section-1) for details.\n\n", "## Contents\n\n| [Section 1](#section-1) |\n|---|\n\n"]) {
      expect(rules(opening + contents + "### Overview\n\n" + sections()), contents).toEqual(["contents-list"]);
    }
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
    for (const field of ["Version: v2.1", "Revision 2.1.0-rc.1+build.2", "Date 2024-02-29", "Updated: 29 Feb 2024", "Last updated October 3, 2026", "Reviewed: 03/10/2026", "Date: 12/31/2026", "Date 10/2026", "Date Q4 2026", "![Version: 2.1](badge.svg)", "| Field | Value |\n|---|---|\n| Version | 2.1 |", "| Field | Value |\n|---|---|\n| Date | March 2026 |"])
      expect(rules("# Title\n\n" + field + "\n"), field).toEqual([]);
    expect(rules("# Title (Version: 2.1)\n")).toEqual([]);
    for (const field of ["v2.1", "Requires v2.1", "Updated targets for Q3 2026", "Reviewed the policy in March 2026", "Version 2.1 is required", "Date 2023-02-29", "Date 2026-13-01", "Date 13/2026", "Date 13/13/2026", "Date Q5 2026", "Date 2026-04-31", "Date 00/2026", "Version 2", "Date 3 Smarch 2026", "![Updated targets for Q3 2026](badge.svg)"])
      expect(rules("# Title\n\n" + field + "\n"), field).toEqual(["opening-version-date"]);
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
    for (const overview of ["### Overview", "## **1. Summary**", "Overview\n========", "Overview\n--------"]) expect(rules("# Title\n\nVersion 1.0\n\n" + overview + "\n\n## Contents\n\n- Section 1\n\n" + sections())).toEqual([]);
    for (const overview of ["**Overview**", "> ### Overview", "- ### Overview", "[Overview](#overview)"]) expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- Section 1\n\n" + overview + "\n\n" + sections())).toEqual(["overview-label"]);
    expect(rules("# Title\n\nVersion 1.0\n\n## Contents\n\n- Section 1\n\n" + sections() + "\n### Overview\n")).toEqual(["overview-label"]);
    expect(rules("# Title\n\nVersion 1.0\n\n## First\n\n### Overview\n\n" + sections())).toEqual(["contents-list", "overview-label"]);
  });
  test("retains container metadata without changing heading and prose extraction", () => {
    const parsed = structure("# T\n\n> ## Example\n\n- Item\n  - Child\n    - Grandchild\n\n## Root\n");
    expect(parsed.headings.map(heading => heading.text)).toEqual(["T", "Root"]);
    expect(parsed.items.map(item => item.depth)).toEqual([1, 2, 3]);
  });
});
