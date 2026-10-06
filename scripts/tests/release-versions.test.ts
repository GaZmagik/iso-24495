import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTagCheck } from "../release-tag.ts";
import { checkVersionSites } from "../release-versions.ts";
import { edit, SKILLS, withCheckout } from "./fixtures/release-checkout.ts";

describe("checkVersionSites, which the normal gate runs", () => {
  test("a consistent checkout passes, whether or not its version is released", () => {
    withCheckout("0.6.2", (root) => {
      expect(checkVersionSites(root)).toEqual({
        version: "0.6.2",
        skills: SKILLS.map((skill) => `${skill}/SKILL.md`).sort(),
        problems: [],
      });
    });
  });

  // Each of these once reached users, or nearly did: the 0.6.1 release left
  // the Codex manifest a version behind, and a forgotten ref pins installs to
  // the previous release.
  test("one stale site fails, and the problem names it", () => {
    const stale: Array<[string, string, string, string]> = [
      [".codex-plugin/plugin.json", "\"0.7.0\"", "\"0.6.2\"", ".codex-plugin/plugin.json version"],
      [".claude-plugin/marketplace.json", "\"version\":\"0.7.0\"", "\"version\":\"0.6.2\"", "marketplace version"],
      [".claude-plugin/marketplace.json", "\"ref\":\"v0.7.0\"", "\"ref\":\"v0.6.2\"", "marketplace source.ref"],
      ["skills/iso-24495-text-audit/SKILL.md", "\"0.7.0\"", "\"0.6.2\"", "skills/iso-24495-text-audit/SKILL.md"],
      ["codex-skills/iso-24495-style/SKILL.md", "\"0.7.0\"", "\"0.6.2\"", "codex-skills/iso-24495-style/SKILL.md"],
      ["CHANGELOG.md", "## [0.7.0]", "## [0.6.2]", "CHANGELOG.md"],
    ];
    for (const [path, from, to, named] of stale) {
      withCheckout("0.7.0", (root) => {
        edit(root, path, from, to);
        const { problems } = checkVersionSites(root);
        expect(problems, `${path}: ${from}`).toHaveLength(1);
        expect(problems[0]).toContain(named);
      });
    }
  });

  test("a version that is not three numbers fails", () => {
    withCheckout("0.7", (root) => {
      expect(checkVersionSites(root).problems).toEqual([
        ".claude-plugin/plugin.json version must have the form 1.2.3; it states 3 characters that are not a version.",
      ]);
    });
    withCheckout("0.7.0", (root) => {
      edit(root, ".claude-plugin/plugin.json", "\"version\":\"0.7.0\"", "\"version\":7");
      expect(checkVersionSites(root).problems[0])
        .toBe(".claude-plugin/plugin.json version must have the form 1.2.3; it states a value of type number.");
    });
    withCheckout("0.7.0", (root) => {
      edit(root, ".claude-plugin/plugin.json", ",\"version\":\"0.7.0\"", "");
      expect(checkVersionSites(root).problems[0])
        .toBe(".claude-plugin/plugin.json version must have the form 1.2.3; it states nothing.");
    });
  });

  // A version that failed the check holds whatever the file held, so no problem
  // quotes it: not at its own site, and not as what another site should state.
  test("a malformed version is described by its shape and never quoted", () => {
    withCheckout("0.7.0", (root) => {
      edit(root, ".claude-plugin/plugin.json", "\"0.7.0\"", "\"seven\"");
      const declared = "not what .claude-plugin/plugin.json declares.";
      expect(checkVersionSites(root).problems).toEqual([
        ".claude-plugin/plugin.json version must have the form 1.2.3; it states 5 characters that are not a version.",
        `.codex-plugin/plugin.json version states "0.7.0", ${declared}`,
        `.claude-plugin/marketplace.json marketplace version states "0.7.0", ${declared}`,
        `.claude-plugin/marketplace.json marketplace source.ref states "v0.7.0", ${declared}`,
        `codex-skills/iso-24495-style/SKILL.md metadata.version states "0.7.0", ${declared}`,
        `skills/iso-24495-1/SKILL.md metadata.version states "0.7.0", ${declared}`,
        `skills/iso-24495-text-audit/SKILL.md metadata.version states "0.7.0", ${declared}`,
        "CHANGELOG.md has no entry headed with the declared version.",
      ]);
    });
  });

  test("a site that is missing, unreadable or malformed fails rather than throwing", () => {
    withCheckout("0.7.0", (root) => {
      rmSync(join(root, ".codex-plugin", "plugin.json"));
      writeFileSync(join(root, ".claude-plugin", "marketplace.json"), "{ not json", "utf8");
      edit(root, "skills/iso-24495-1/SKILL.md", "  version: \"0.7.0\"\n", "");
      rmSync(join(root, "CHANGELOG.md"));
      const { problems } = checkVersionSites(root);
      expect(problems.some((problem) => problem.includes(".codex-plugin/plugin.json cannot be read")))
        .toBe(true);
      expect(problems.some((problem) => problem.includes("marketplace.json is not valid JSON")))
        .toBe(true);
      expect(problems.some((problem) => problem.includes("skills/iso-24495-1/SKILL.md metadata.version")))
        .toBe(true);
      expect(problems.some((problem) => problem.includes("CHANGELOG.md cannot be read"))).toBe(true);
    });
    withCheckout("0.7.0", (root) => {
      rmSync(join(root, "codex-skills"), { recursive: true });
      expect(checkVersionSites(root).problems).toEqual(["codex-skills cannot be listed."]);
    });
  });

  // A pattern over the whole front matter took the first "version:" line it
  // met, wherever it sat. A review hid one inside a description and left
  // metadata.version stale, and every stage passed. So the front matter is
  // read as YAML, and only metadata.version counts.
  test("a skill's version is metadata.version, read as YAML, and nothing else", () => {
    const SKILL = "skills/iso-24495-1/SKILL.md";
    const problemsFor = (frontMatter: string[], body = "\n# Skill\n"): string[] => {
      let problems: string[] = [];
      withCheckout("0.7.0", (root) => {
        writeFileSync(join(root, SKILL), ["---", ...frontMatter, "---", body].join("\n"), "utf8");
        problems = checkVersionSites(root).problems;
      });
      return problems;
    };
    const stale = `${SKILL} metadata.version states "0.6.2", not "0.7.0".`;

    // Version-like text inside a description, above a stale metadata.version.
    expect(problemsFor([
      "description: |",
      "  Audit selected text.",
      "  version: \"0.7.0\"",
      "metadata:",
      "  version: \"0.6.2\"",
    ])).toEqual([stale]);
    // Another nested field named version, above a stale metadata.version.
    expect(problemsFor([
      "other:",
      "  version: \"0.7.0\"",
      "metadata:",
      "  iso-standard: \"ISO 24495-1:2023\"",
      "  version: \"0.6.2\"",
    ])).toEqual([stale]);
    // A stale metadata.version on its own.
    expect(problemsFor(["name: x", "metadata:", "  version: \"0.6.2\""])).toEqual([stale]);

    // Missing metadata, and metadata missing its version.
    expect(problemsFor(["name: x", "version: \"0.7.0\""]))
      .toEqual([`${SKILL} metadata.version states nothing, not "0.7.0".`]);
    expect(problemsFor(["name: x", "metadata:", "  iso-standard: \"ISO 24495-1:2023\""]))
      .toEqual([`${SKILL} metadata.version states nothing, not "0.7.0".`]);
    // An unquoted version that YAML reads as a number is not the string declared.
    expect(problemsFor(["name: x", "metadata:", "  version: 7"]))
      .toEqual([`${SKILL} metadata.version states a value of type number, not "0.7.0".`]);
    // Text that is not a version is counted, never quoted, and an empty field states nothing.
    expect(problemsFor(["name: x", "metadata:", "  version: \"latest\""]))
      .toEqual([`${SKILL} metadata.version states 6 characters that are not a version, not "0.7.0".`]);
    expect(problemsFor(["name: x", "metadata:", "  version:"]))
      .toEqual([`${SKILL} metadata.version states nothing, not "0.7.0".`]);

    // Front matter that is not YAML, or is not there at all.
    expect(problemsFor(["name: [unclosed", "metadata:", "  version: \"0.7.0\""]))
      .toEqual([`${SKILL} front matter is not valid YAML.`]);
    expect(problemsFor(["- a list", "- not a mapping"]))
      .toEqual([`${SKILL} metadata.version states nothing, not "0.7.0".`]);
    let noFrontMatter: string[] = [];
    withCheckout("0.7.0", (root) => {
      writeFileSync(join(root, SKILL), "# Skill\n\nmetadata:\n  version: \"0.7.0\"\n", "utf8");
      noFrontMatter = checkVersionSites(root).problems;
    });
    expect(noFrontMatter).toEqual([`${SKILL} has no front matter.`]);

    // Sound front matter passes, whatever sits around the version, and a "---"
    // inside a value or in the body below does not end the front matter.
    expect(problemsFor([
      "name: x",
      "description: \"One --- two\"",
      "metadata:",
      "  version: \"0.7.0\"",
      "  iso-standard: \"ISO 24495-1:2023\"",
    ], "\n# Skill\n\n---\n\nversion: \"0.6.2\"\n")).toEqual([]);
  });
});

describe("a skill directory nobody has read", () => {
  // The skill names come from a directory listing, and a problem is printed.
  // The list of skills is data, so it keeps each name as the listing gave it.
  test("a control character or a direction mark in its name is not printed in a problem", () => {
    withCheckout("0.7.0", (root) => {
      const control = String.fromCharCode(0x9b);
      const override = String.fromCharCode(0x202e);
      const name = `iso-24495-x${override}[2J${control}y`;
      mkdirSync(join(root, "skills", name));
      const report = checkVersionSites(root);
      expect(report.problems).toEqual(["skills/iso-24495-x [2J y/SKILL.md cannot be read."]);
      expect(report.skills).toContain(`skills/${name}/SKILL.md`);

      writeFileSync(join(root, "skills", name, "SKILL.md"), "no front matter\n");
      expect(checkVersionSites(root).problems).toEqual(["skills/iso-24495-x [2J y/SKILL.md has no front matter."]);

      writeFileSync(join(root, "skills", name, "SKILL.md"), "---\nmetadata:\n  version: \"0.6.0\"\n---\n");
      expect(checkVersionSites(root).problems)
        .toEqual(["skills/iso-24495-x [2J y/SKILL.md metadata.version states \"0.6.0\", not \"0.7.0\"."]);
    });
  });
});

describe("a manifest that is valid JSON of the wrong shape", () => {
  // JSON.parse was trusted to return an object. A manifest holding the text
  // null made the check read a property of null, and the command printed the
  // runtime's TypeError.
  const MANIFESTS = [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/marketplace.json"];
  const SHAPES: Array<[text: string, held: string]> = [
    ["null", "null"],
    ["[]", "a list"],
    ["\"0.7.0\"", "a value of type string"],
    ["7", "a value of type number"],
    ["true", "a value of type boolean"],
  ];

  test("each manifest gives a problem, never an exception", () => {
    for (const manifest of MANIFESTS) {
      for (const [text, held] of SHAPES) {
        withCheckout("0.7.0", (root) => {
          writeFileSync(join(root, manifest), text, "utf8");
          const { problems } = checkVersionSites(root);
          expect(problems[0], `${manifest}: ${text}`).toBe(`${manifest} must hold a JSON object; it holds ${held}.`);
          expect(problems.length, `${manifest}: ${text}`).toBeGreaterThan(1);
        });
      }
    }
  });

  test("the pushed tag check prints the problem and exits 1", () => {
    withCheckout("0.7.0", (root) => {
      writeFileSync(join(root, ".codex-plugin", "plugin.json"), "null", "utf8");
      const stdout: string[] = [];
      const stderr: string[] = [];
      expect(runTagCheck(["bun", "cli", "v0.7.0"], root, (text) => stdout.push(text), (text) => stderr.push(text))).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([
        "release tag: .codex-plugin/plugin.json must hold a JSON object; it holds null.",
        "release tag: .codex-plugin/plugin.json version states nothing, not \"0.7.0\".",
      ]);
    });
  });

  // All but one of these passed before the change, because optional chaining
  // happened to absorb them. The one that failed is an object with a key named
  // 0, which was read as the first entry of a list.
  test("a marketplace entry of the wrong shape states nothing", () => {
    const nothing = [
      ".claude-plugin/marketplace.json marketplace version states nothing, not \"0.7.0\".",
      ".claude-plugin/marketplace.json marketplace source.ref states nothing, not \"v0.7.0\".",
    ];
    for (const text of ["{}", "{\"plugins\":\"0.7.0\"}", "{\"plugins\":7}", "{\"plugins\":[]}", "{\"plugins\":[null]}", "{\"plugins\":[\"x\"]}", "{\"plugins\":{\"0\":{\"version\":\"0.7.0\"}}}"]) {
      withCheckout("0.7.0", (root) => {
        writeFileSync(join(root, ".claude-plugin", "marketplace.json"), text, "utf8");
        expect(checkVersionSites(root).problems, text).toEqual(nothing);
      });
    }
    for (const source of ["null", "\"v0.7.0\"", "[\"v0.7.0\"]"]) {
      withCheckout("0.7.0", (root) => {
        writeFileSync(join(root, ".claude-plugin", "marketplace.json"), `{"plugins":[{"version":"0.7.0","source":${source}}]}`, "utf8");
        expect(checkVersionSites(root).problems, source).toEqual([nothing[1] as string]);
      });
    }
  });
});
