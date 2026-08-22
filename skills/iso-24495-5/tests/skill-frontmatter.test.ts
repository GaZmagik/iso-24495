/**
 * Parse every skill's frontmatter, because a plugin whose manifest will not load ships silently.
 *
 * v0.6.0 shipped `iso-24495-code` with an unquoted description containing a colon and a space:
 *
 *     description: ... Governs the parts of code a person reads: the order units appear in, ...
 *
 * YAML reads that as the start of a nested mapping, so the loader refused the file with "mapping
 * values are not allowed in this context at line 2 column 123". Column 123 is the colon.
 *
 * The repository gate did not notice, because nothing here had ever parsed a SKILL.md as YAML. It
 * checked the prose inside the file and the files beside it, and took the frontmatter on trust.
 * Every other test in this suite reads these files as text, which is exactly why this one must
 * not.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const ROOTS = ["skills", "codex-skills"];

/** Every SKILL.md in the repository, by its path relative to the root. */
function skillFiles(): string[] {
  const found: string[] = [];
  for (const directory of ROOTS) {
    const base = join(ROOT, directory);
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(base, entry, "SKILL.md");
      try {
        if (statSync(path).isFile()) found.push(`${directory}/${entry}/SKILL.md`);
      } catch {
        // A directory without a SKILL.md is not a skill.
      }
    }
  }
  return found.sort();
}

/** The text between the opening and closing fence, which is what a loader hands to YAML. */
function frontmatter(relativePath: string): string {
  const text = readFileSync(join(ROOT, relativePath), "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) throw new Error(`${relativePath}: no frontmatter fence`);
  return match[1] as string;
}

describe("every skill's frontmatter", () => {
  const files = skillFiles();

  test("there are skills to check", () => {
    // A test that finds nothing passes, and proves nothing. This is the counting guard.
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  test("parses as YAML", () => {
    // The failure this file exists for. An unquoted colon and space breaks the parse.
    const broken: string[] = [];
    for (const file of files) {
      try {
        Bun.YAML.parse(frontmatter(file));
      } catch (error) {
        broken.push(`${file}: ${(error as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("gives a loader the name and description it needs", () => {
    for (const file of files) {
      const parsed = Bun.YAML.parse(frontmatter(file)) as Record<string, unknown>;
      expect(typeof parsed.name, `${file} name`).toBe("string");
      expect(typeof parsed.description, `${file} description`).toBe("string");
      expect((parsed.name as string).length, `${file} name is not empty`).toBeGreaterThan(0);
      expect((parsed.description as string).length, `${file} description is not empty`)
        .toBeGreaterThan(0);
    }
  });

  test("names the skill after the directory holding it", () => {
    for (const file of files) {
      const parsed = Bun.YAML.parse(frontmatter(file)) as Record<string, unknown>;
      const directory = file.split("/")[1];
      expect(parsed.name, file).toBe(directory);
    }
  });

  test("a colon in a description is caught rather than shipped", () => {
    // Proves the parse test can fail, against the exact text v0.6.0 shipped. Without this, a
    // parser that quietly accepted anything would pass the test above for ever.
    const shipped = 'name: iso-24495-code\n'
      + 'description: Governs the parts of code a person reads: the order units appear in.\n';
    expect(() => Bun.YAML.parse(shipped)).toThrow();
    expect(() => Bun.YAML.parse('name: a\ndescription: "reads: the order"\n')).not.toThrow();
  });
});
