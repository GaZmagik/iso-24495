import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditText } from "../../iso-24495-4/scripts/audit-corpus.ts";

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
        .not.toMatch(/(do|should|must|shall|can|will)( ?n.t| not) (read|use)|never (read|use)/i);
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
      expect(body, `${name} does not negate its own reason`).not.toMatch(/(do|should|must|shall|can|will)( ?n.t| not) cite these sections/i);
      // Removing numbers without the contents list breaks the anchors beneath it.
      expect(body, `${name} says to update the contents too`).toMatch(/from this contents list/);
    }
  });

  // Round 13 asked for a gate on the heading repairs themselves, and on the
  // meanings the opening block fields must carry. Both were reversible while green.
  test("the heading repairs cannot be reverted unnoticed", () => {
    const runbook = readTemplate("runbook-template.md").split("\n");
    const headings = runbook.filter((line) => /^## /.test(line)).map((line) => line.trim());
    for (const topic of ["## Prerequisites", "## Execution steps", "## Verification"]) {
      expect(headings, `runbook no longer uses ${topic}`).not.toContain(topic);
    }
    expect(headings.length, "runbook still has its sections").toBeGreaterThanOrEqual(3);
    const adr = readTemplate("adr-template.md");
    expect(adr, "the ADR names the publication its headings come from")
      .toMatch(/Documenting Architecture Decisions/);
    expect(adr, "the ADR does not head its own addition with a topic")
      .not.toContain("## Options considered");
    // A subsection of a sequential explanation cannot claim the reference case,
    // so these five carry their message. Reverting one went unnoticed once.
    const design = readTemplate("design-doc-template.md");
    for (const topic of ["Component Diagram", "Interaction Flow", "Authentication Sequence",
                         "Data Lifecycle", "Rollout and Rollback"]) {
      expect(design, `the design document no longer heads a sequence "${topic}"`).not.toContain(topic);
    }
  });

  test("the opening block fields carry their required meanings", () => {
    for (const name of TEMPLATE_NAMES) {
      const body = readTemplate(name);
      const purpose = body.split("\n").find((line) => line.startsWith("- **Purpose:**")) ?? "";
      expect(purpose, `${name} purpose names the reader's task`).toMatch(/reader|review|build|decide|do/i);
      expect(purpose, `${name} purpose names the scope`).toMatch(/covers|scope|solve/i);
      const referral = body.split("\n").find((line) => line.startsWith("- **Instead of this:**")) ?? "";
      expect(referral, `${name} referral says when to use it`).toMatch(/when to/i);
    }
  });

  test("Part 5 skill references every required template path", () => {
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    for (const name of TEMPLATE_NAMES) {
      expect(skill).toContain(`assets/${name}`);
    }
  });
});
