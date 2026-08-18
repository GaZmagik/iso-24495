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

  test("Part 5 skill references every required template path", () => {
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    for (const name of TEMPLATE_NAMES) {
      expect(skill).toContain(`assets/${name}`);
    }
  });
});
