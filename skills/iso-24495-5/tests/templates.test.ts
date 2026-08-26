import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditText } from "../../iso-24495-4/scripts/audit-corpus.ts";
import { headings } from "../../iso-24495-4/scripts/lib/parse.ts";

const SKILL_DIR = join(import.meta.dir, "..");
const ASSETS_DIR = join(SKILL_DIR, "assets");
const TEMPLATE_NAMES = ["adr-template.md", "runbook-template.md", "design-doc-template.md"];

function readTemplate(name: string): string {
  return readFileSync(join(ASSETS_DIR, name), "utf8");
}

function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w -]/g, "")
    .replace(/ /g, "-");
}

describe("Part 5 document templates", () => {
  test("ships the ADR, runbook, and design document templates", () => {
    for (const name of TEMPLATE_NAMES) {
      expect(existsSync(join(ASSETS_DIR, name))).toBe(true);
    }
  });

  test("all templates produce zero audit violations", () => {
    for (const name of TEMPLATE_NAMES) {
      expect(auditText(readTemplate(name))).toEqual([]);
    }
  });

  test("no template exceeds level 4 and the design document reaches it once", () => {
    for (const name of TEMPLATE_NAMES) {
      const levels = readTemplate(name)
        .split(/\r?\n/)
        .flatMap((line) => line.match(/^(#{1,6})\s/)?.[1].length ?? []);
      expect(Math.max(...levels)).toBeLessThanOrEqual(4);
      if (name === "design-doc-template.md") {
        expect(levels.filter((level) => level === 4)).toHaveLength(1);
      }
    }
  });

  test("design document contents links resolve to identically worded headings", () => {
    const lines = readTemplate("design-doc-template.md").split(/\r?\n/);
    const headings = new Map(
      lines.flatMap((line) => {
        const match = /^## (.+)$/.exec(line);
        return match && match[1] !== "Contents" ? [[githubSlug(match[1]), match[1]]] : [];
      }),
    );
    const contents = lines.flatMap((line) => {
      const match = /^- \[(.+)\]\(#([^)]+)\)$/.exec(line);
      return match ? [{ text: match[1], anchor: match[2] }] : [];
    });

    expect(contents).toHaveLength(6);
    for (const entry of contents) {
      expect(entry.anchor).toBe(githubSlug(entry.text));
      expect(headings.get(entry.anchor)).toBe(entry.text);
    }
  });

  // Round 10 found every template breaking a rule it exists to demonstrate, and
  // no test able to see it. Round 11 then defeated the first version of these
  // gates by mutating the templates, so each one now tests content, not labels.
  test("every template opens with a title and a filled opening block", () => {
    for (const name of TEMPLATE_NAMES) {
      const lines = readTemplate(name).split("\n").map((line) => line.trimEnd());
      expect(lines[0], `${name} opens with a title`).toMatch(/^# .+/);
      const fields = new Map(
        lines.slice(0, 10)
          .filter((line) => /^- [*][*][A-Za-z ]+:[*][*]/.test(line))
          .map((line) => [line.slice(4, line.indexOf(":**")), line.slice(line.indexOf(":**") + 3).trim()]),
      );
      for (const field of ["Purpose", "For", "Version"]) {
        expect([...fields.keys()], `${name} states ${field}`).toContain(field);
        expect((fields.get(field) ?? "").length, `${name} fills ${field}`).toBeGreaterThan(10);
      }
      const purposeLines = lines.filter((line) => line.startsWith("- **Purpose:**"));
      expect(purposeLines, `${name} keeps purpose to one line`).toHaveLength(1);
      // A continuation line under the purpose would make it two lines in fact.
      const after = lines[lines.indexOf(purposeLines[0] as string) + 1] ?? "";
      expect(after === "" || after.startsWith("- "), `${name} does not continue purpose`).toBe(true);
    }
  });

  test("a template needing an overview asks for all three things an overview keeps", () => {
    for (const name of TEMPLATE_NAMES) {
      const body = readTemplate(name);
      const sections = body.split("\n").filter((line) => /^## /.test(line));
      if (sections.length < 6) continue;
      const summary = body.slice(body.indexOf("## 1."), body.indexOf("## 2."));
      expect(summary.split("\n")[0], `${name} labels its overview`).toMatch(/summary|overview|abstract/i);
      expect(summary, `${name} asks for the conclusion`).toMatch(/outcome|conclusion|recommend/i);
      expect(summary, `${name} asks for the required action`).toMatch(/must do|required action|do next/i);
      expect(summary, `${name} asks for the qualifications`).toMatch(/condition|qualification|caveat/i);
      expect(summary, `${name} does not tell the author to omit them`)
        .not.toMatch(/omit|leave out|deliberately omitted/i);
    }
  });

  test("every template holding a table tells the author to name a width and test it", () => {
    const divider = /^[|\s:-]*[|][\s:-]*-{3,}[\s:-]*[|]?[\s:-]*$/;
    for (const name of TEMPLATE_NAMES) {
      const body = readTemplate(name);
      const hasTable = body.split("\n").some((line) => divider.test(line.trim()) && line.includes("-"));
      if (!hasTable) continue;
      expect(body, `${name} names a target width`).toMatch(/[[]Name the narrowest width/);
      expect(body, `${name} says to read the table back at it`).toMatch(/read (it|them) back at that width/);
      expect(body, `${name} offers the labelled-record fallback`).toMatch(/labelled records/);
      expect(body, `${name} does not negate its width instruction`)
        .not.toMatch(/(do|should|must|shall|can|will|need)( ?n.t| not) (read|use)|never (read|use)/i);
    }
  });

  test("a template that numbers its headings says why, and how to undo it", () => {
    for (const name of TEMPLATE_NAMES) {
      const body = readTemplate(name);
      // Arabic, Roman, "1)", "(1)" and "[1]" all count as numbering.
      const numbered = body.split("\n").filter((line) => /^#{2,4} [([]?([0-9]+|[ivxIVX]+)[.)\]]/.test(line));
      if (numbered.length === 0) continue;
      expect(body, `${name} justifies numbering`).toMatch(/cite these sections by number/);
      // "Do not cite these sections by number" contains the phrase above, so refuse the negation.
      expect(body, `${name} does not negate its own reason`).not.toMatch(/(do|should|must|shall|can|will|need)( ?n.t| not) cite these sections|no need to cite/i);
      // Removing numbers without the contents list breaks the anchors beneath it.
      expect(body, `${name} says to update the contents too`).toMatch(/from this contents list/);
    }
  });

  // Round 17: asserting fragments let a line keep its label while losing its
  // meaning. These are whole lines, so an edit to any part of one turns it red.
  const REQUIRED_LINES: Record<string, string[]> = {
    "adr-template.md": [
      "- **Purpose:** [What the reader can decide or do with this record, and what it covers, in one sentence.]",
      "- **For:** [Who needs this decision, and who must act on it.]",
      "- **Version:** [Version or date.]",
      "- **Status:** [Proposed or accepted. Where deprecated or superseded, name the decision that replaces this one.]",
      "- **Instead of this:** [Link the decision that may suit the reader better and say when to read it, or delete this line.]",
      "[Name the narrowest width this table must survive, then read it back at that width. Where no width is known, use labelled records instead.]",
    ],
    "runbook-template.md": [
      "- **Purpose:** [What the reader will have done by the end, and what the task covers, in one sentence.]",
      "- **For:** [Who runs this task, and when.]",
      "- **Version:** [Version or date.]",
      "- **Instead of this:** [Link the runbook that may suit the reader better and say when to use it, or delete this line.]",
      "> [!CAUTION]",
      "> [Critical risks or conditions, before any step runs.]",
      "> [!NOTE]",
      "> [Expected output for step 2]",
    ],
    "design-doc-template.md": [
      "- **Purpose:** [What the reader can build or review from this, and what it covers, in one sentence.]",
      "- **For:** [Who this design is written for.]",
      "- **Version:** [Version or date.]",
      "- **Instead of this:** [Link the design that may suit the reader better and say when to read it, or delete this line.]",
      "[Reviewers cite these sections by number, which is why they are numbered. Where nobody cites yours, delete the numbers from the headings and from this contents list together.]",
      "[Name the narrowest width each table must survive, then read them back at that width. Where no width is known, use labelled records instead.]",
    ],
  };

  // Round 18 added "## Miscellaneous" and every predicate passed, because a list
  // of required headings says nothing about the ones nobody listed. Round 19 found
  // the scanner reading source lines, so a fenced example would have counted.
  // Round 21 found only the text compared, so a heading could be demoted a level
  // and slip through. The whole sequence is compared, level and text together.
  const HEADING_SEQUENCE: Record<string, { level: number; text: string }[]> = {
    "adr-template.md": [
      { level: 1, text: "[Decision Title]" },
      { level: 2, text: "Context" },
      { level: 2, text: "What each option offers and costs" },
      { level: 2, text: "Decision" },
      { level: 2, text: "Consequences" },
    ],
    "runbook-template.md": [
      { level: 1, text: "[Task Title]" },
      { level: 2, text: "Check these before you start" },
      { level: 2, text: "Run these steps in order" },
      { level: 2, text: "Confirm the task worked" },
    ],
    "design-doc-template.md": [
      { level: 1, text: "[Project Name] Design Document" },
      { level: 2, text: "Contents" },
      { level: 2, text: "1. Summary" },
      { level: 2, text: "2. System Architecture" },
      { level: 3, text: "2.1. What each component is responsible for" },
      { level: 3, text: "2.2. How a request flows through the system" },
      { level: 4, text: "2.2.1. How a sign-in is checked" },
      { level: 2, text: "3. Data Model" },
      { level: 3, text: "3.1. Entities and Relationships" },
      { level: 3, text: "3.2. How data enters, changes and leaves" },
      { level: 2, text: "4. API Design" },
      { level: 3, text: "4.1. Endpoints" },
      { level: 3, text: "4.2. Error Handling" },
      { level: 2, text: "5. Security Model" },
      { level: 3, text: "5.1. Threats and Controls" },
      { level: 3, text: "5.2. Access Control" },
      { level: 2, text: "6. Deployment Plan" },
      { level: 3, text: "6.1. Environments" },
      { level: 3, text: "6.2. How the change ships and how it comes back" },
    ],
  };

  test("every template keeps whole the lines its repairs wrote", () => {
    for (const [name, required] of Object.entries(REQUIRED_LINES)) {
      const present = readTemplate(name).split("\n").map((line) => line.trim());
      for (const line of required) {
        expect(present, `${name} keeps: ${line.slice(0, 40)}`).toContain(line);
      }
    }
  });

  // Round 20: checking which labels appear says nothing about what the reader
  // sees. The block is compared line for line, in the position it occupies.
  const OPENING_BLOCK: Record<string, string[]> = {
    "adr-template.md": [
      "- **Purpose:** [What the reader can decide or do with this record, and what it covers, in one sentence.]",
      "- **For:** [Who needs this decision, and who must act on it.]",
      "- **Status:** [Proposed or accepted. Where deprecated or superseded, name the decision that replaces this one.]",
      "- **Version:** [Version or date.]",
      "- **Instead of this:** [Link the decision that may suit the reader better and say when to read it, or delete this line.]",
    ],
    "runbook-template.md": [
      "- **Purpose:** [What the reader will have done by the end, and what the task covers, in one sentence.]",
      "- **For:** [Who runs this task, and when.]",
      "- **Version:** [Version or date.]",
      "- **Instead of this:** [Link the runbook that may suit the reader better and say when to use it, or delete this line.]",
    ],
    "design-doc-template.md": [
      "- **Purpose:** [What the reader can build or review from this, and what it covers, in one sentence.]",
      "- **For:** [Who this design is written for.]",
      "- **Version:** [Version or date.]",
      "- **Instead of this:** [Link the design that may suit the reader better and say when to read it, or delete this line.]",
    ],
  };

  test("every template keeps its opening block whole and in place", () => {
    for (const name of TEMPLATE_NAMES) {
      const lines = readTemplate(name).split("\n").map((line) => line.trimEnd());
      const expected = OPENING_BLOCK[name] ?? [];
      expect(lines.slice(2, 2 + expected.length), `${name} opens as expected`).toEqual(expected);
      expect(lines[1], `${name} leaves a blank line under its title`).toBe("");
      expect(lines[2 + expected.length], `${name} closes the block`).toBe("");
    }
  });

  test("every template heads its sections exactly as its rules require", () => {
    for (const name of TEMPLATE_NAMES) {
      const found = headings(readTemplate(name))
        .map((heading) => ({ level: heading.level, text: heading.text.trim() }));
      expect(found, `${name} heads its sections as expected`).toEqual(HEADING_SEQUENCE[name] ?? []);
    }
  });

  // Round 21 moved a warning and emptied a procedure while every line assertion
  // held. Round 22 then moved the steps into the wrong section and hollowed the
  // table to a single empty column, and counting alone missed both. These check
  // where a structure sits and what it holds, not merely that it exists.
  //
  // These guard this repository's canonical templates, not runbooks in general. A
  // two-step runbook is perfectly legitimate; this one has three, and a change to
  // that is a deliberate edit.
  test("the runbook warns before its steps, and keeps them in their section", () => {
    const lines = readTemplate("runbook-template.md").split("\n").map((line) => line.trimEnd());
    const caution = lines.indexOf("> [!CAUTION]");
    expect(caution, "the runbook carries a caution").toBeGreaterThan(-1);
    expect(lines[caution + 1], "the caution names the risk")
      .toBe("> [Critical risks or conditions, before any step runs.]");

    const steps = lines.indexOf("## Run these steps in order");
    const confirm = lines.indexOf("## Confirm the task worked");
    expect(caution, "the caution comes before the steps it governs").toBeLessThan(steps);
    expect(steps, "the steps come before the confirmation").toBeLessThan(confirm);

    const inside = lines.slice(steps, confirm).filter((line) => /^[0-9]+[.] /.test(line));
    const outside = lines.filter((line) => /^[0-9]+[.] /.test(line)).length - inside.length;
    expect(inside.length, "the procedure sits inside its own section").toBe(3);
    expect(outside, "no step has wandered out of it").toBe(0);

    const note = lines.findIndex((line) => line.trim() === "> [!NOTE]");
    expect(note, "the note sits between step 2 and step 3").toBeGreaterThan(lines.indexOf("2. [Second action]"));
    expect(note, "the note sits between step 2 and step 3").toBeLessThan(lines.indexOf("3. [Third action]"));
    expect(lines[note + 1].trim(), "the note names its expected output")
      .toBe("> [Expected output for step 2]");
  });

  test("the decision record compares real options across shared attributes", () => {
    const lines = readTemplate("adr-template.md").split("\n").map((line) => line.trim());
    const header = lines.indexOf("| Option | Pros | Cons | Estimated effort |");
    expect(header, "the record keeps its comparison header").toBeGreaterThan(-1);
    expect(lines[header + 1], "a divider follows the header").toMatch(/^[|][\s:|-]*-{3,}[\s:|-]*$/);
    const rows = lines.slice(header + 2).filter((line) => line.startsWith("|") && line.includes("[Option"));
    expect(rows.length, "the record compares at least two options").toBeGreaterThanOrEqual(2);
  });

  test("Part 5 skill references every required template path", () => {
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    for (const name of TEMPLATE_NAMES) {
      expect(skill).toContain(`assets/${name}`);
    }
  });
});
