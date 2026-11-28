import { describe, expect, test } from "bun:test";
import { blocksInDoubt } from "../../scripts/lib/block-doubt.ts";

// The two documents of issue 93. commonmark.js renders their See also lines as code.
const COMMENT_THEN_FENCE = "# T\n\n<!-- c -->~~~\n\n~~~\n\n## 1. A\n## 2. B\n\n## See also\n";
const FENCE_IN_FRONT_MATTER = "---\nnote: |\n  ~~~\n---\n\n# T\n\n## 1. A\n## 2. B\n\n## See also\n";

describe("a document whose blocks parse.ts and CommonMark may read differently", () => {
  test("is one where a fence follows the end of a comment, instruction or declaration", () => {
    const doubtful = [
      COMMENT_THEN_FENCE,
      "<!-- c -->```\n",
      "<!-- c --> \t~~~~\n",
      "<!-->~~~\n",
      "<?x?>~~~\n",
      "<?x>~~~\n",
      "<?x\n>~~~\n",
      "<!-- c --!>~~~\n",
      "<!--\nc --!>~~~\n",
      "<!X>~~~\n",
      "<!doctype x>```\n",
      "<!--\nc -->~~~\n",
      "<!X\n>~~~\n",
      "<!X\ntext\n> ~~~\n",
      "> <!-- c -->~~~\n",
      "- <!-- c -->~~~\n",
    ];
    for (const text of doubtful) {
      expect(blocksInDoubt(text)).toBe(true);
    }
  });

  test("is one whose front matter holds a line shaped like a fence, when front matter is read", () => {
    const doubtful = [
      FENCE_IN_FRONT_MATTER,
      "---\nnote: |\n  ```\n---\n",
      "---\nnote: |\n\t~~~\n...\n",
      "---\nnote: |\n  ~~~\n  x\n  ~~~\n---\n",
    ];
    for (const text of doubtful) {
      expect(blocksInDoubt(text)).toBe(true);
      expect(blocksInDoubt(text, { frontMatter: true })).toBe(true);
      expect(blocksInDoubt(text, { frontMatter: false })).toBe(false);
    }
  });

  test("is not one that holds comments, fences and front matter apart", () => {
    const agreed = [
      "",
      "# T\n\n<!-- c -->\n\n~~~\ncode\n~~~\n",
      "# T\n\n<!-- c --> text ~~ not a fence\n",
      "> ~~~\n> code\n> ~~~\n",
      "> ~~~\n\n<!X>\n",
      "a ?> b\n\n~~~\n",
      "---\ntitle: T\n---\n\n~~~\ncode\n~~~\n",
      "---\ntitle: a ~~~ b\n---\n",
      "---\nnot front matter\n  ~~~\n---\n",
    ];
    for (const text of agreed) {
      expect(blocksInDoubt(text)).toBe(false);
    }
  });

  test("reads a hostile line once", () => {
    for (const line of ["<!A".repeat(200_000), "<?".repeat(300_000), ">".repeat(600_000), `-->${" ".repeat(600_000)}x`, `<!A${"> ".repeat(300_000)}`]) {
      const started = performance.now();
      expect(blocksInDoubt(line)).toBe(false);
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});
