import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkVersionSites,
  compareVersions,
  preflightProblems,
  releasedVersions,
  remoteTags,
  runPreflight,
  runTagCheck,
  tagProblems,
  type RemoteTags,
} from "../release-versions.ts";

const SKILLS = ["skills/iso-24495-1", "skills/iso-24495-text-audit", "codex-skills/iso-24495-style"];

/**
 * A checkout whose every version site names `version`, written into a fresh
 * directory. None of these tests reads this repository's own release history.
 */
function makeCheckout(version: string): string {
  const root = mkdtempSync(join(tmpdir(), "iso-24495-release-"));
  const write = (path: string, text: string): void => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write(".claude-plugin/plugin.json", JSON.stringify({ name: "plugin", version }));
  write(".codex-plugin/plugin.json", JSON.stringify({ name: "plugin", version }));
  write(".claude-plugin/marketplace.json", JSON.stringify({
    plugins: [{ version, source: { source: "url", ref: `v${version}` } }],
  }));
  for (const skill of SKILLS) {
    write(`${skill}/SKILL.md`, `---\nname: x\nmetadata:\n  version: "${version}"\n---\n\n# Skill\n`);
  }
  write("CHANGELOG.md", `# Changelog\n\n## [${version}] - 2026-09-27\n\n- A change.\n`);
  return root;
}

/** Replaces text in one file of a checkout, and fails if the text is not there. */
function edit(root: string, path: string, from: string, to: string): void {
  const text = readFileSync(join(root, path), "utf8");
  expect(text, `${path} holds ${from}`).toContain(from);
  writeFileSync(join(root, path), text.replace(from, to), "utf8");
}

/** Collects what a command prints, so a test can read it back. */
function capture(): { out: string[]; err: string[]; stdout: (t: string) => void; stderr: (t: string) => void } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (text) => out.push(text), stderr: (text) => err.push(text) };
}

/** What `git ls-remote --tags` prints for these tags, peeled lines included. */
function listing(...tags: string[]): RemoteTags {
  const lines = tags.flatMap((tag, index) => [
    `${String(index).padStart(40, "a")}\trefs/tags/${tag}`,
    `${String(index).padStart(40, "b")}\trefs/tags/${tag}^{}`,
  ]);
  return { ok: true, output: `${lines.join("\n")}\n` };
}

function withCheckout(version: string, body: (root: string) => void): void {
  const root = makeCheckout(version);
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

describe("version ordering", () => {
  test("versions compare as numbers, so 0.10.0 is later than 0.9.0", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.7.1", "0.7.0")).toBeGreaterThan(0);
    expect(compareVersions("0.7.0", "0.7.0")).toBe(0);
  });

  test("only release tags count, and a peeled tag is not a second release", () => {
    expect(releasedVersions(listing("v0.6.2", "v0.10.0", "measurements-2026-08-22g", "v1.0").output))
      .toEqual(["0.6.2", "0.10.0"]);
    expect(releasedVersions("")).toEqual([]);
    expect(releasedVersions("a\trefs/heads/main\r\nb\trefs/tags/v0.1.0\r\n")).toEqual(["0.1.0"]);
  });
});

describe("the release preflight", () => {
  test("a version later than every release, and not yet tagged, is ready", () => {
    expect(preflightProblems("0.10.0", ["0.6.2", "0.9.0"])).toEqual([]);
    withCheckout("0.10.0", (root) => {
      const run = capture();
      expect(runPreflight(root, run.stdout, run.stderr, () => listing("v0.9.0", "v0.6.2"))).toBe(0);
      expect(run.out.join("\n")).toContain("v0.10.0 can be tagged");
      expect(run.err).toEqual([]);
    });
  });

  // "Greater than or equal" would let a forgotten bump through, so the version
  // a released checkout carries is refused as the next release.
  test("the version of a release already tagged fails, though the gate passes it", () => {
    expect(preflightProblems("0.6.2", ["0.6.2"])).toEqual([
      "v0.6.2 is already tagged. Raise the version at every site before releasing.",
      "0.6.2 is not later than the latest release, 0.6.2.",
    ]);
    expect(preflightProblems("0.9.0", ["0.10.0"])).toEqual([
      "0.9.0 is not later than the latest release, 0.10.0.",
    ]);
    // Sorted as text, 0.9.5 would be the latest release and 0.9.9 would pass.
    expect(preflightProblems("0.9.9", ["0.10.0", "0.9.5"])).toEqual([
      "0.9.9 is not later than the latest release, 0.10.0.",
    ]);
    // A version that is not three numbers is named, never quoted.
    expect(preflightProblems("0.x.0", ["1.0.0"])).toEqual([
      "The declared version is not later than the latest release, 1.0.0.",
    ]);
    withCheckout("0.6.2", (root) => {
      expect(checkVersionSites(root).problems).toEqual([]);
      const run = capture();
      expect(runPreflight(root, run.stdout, run.stderr, () => listing("v0.6.1", "v0.6.2"))).toBe(1);
      expect(run.err.join("\n")).toContain("v0.6.2 is already tagged");
      expect(run.out).toEqual([]);
    });
  });

  test("a disagreeing site fails the preflight as it fails the gate", () => {
    withCheckout("0.7.0", (root) => {
      edit(root, ".claude-plugin/marketplace.json", "\"ref\":\"v0.7.0\"", "\"ref\":\"v0.6.2\"");
      const run = capture();
      expect(runPreflight(root, run.stdout, run.stderr, () => listing("v0.6.2"))).toBe(1);
      expect(run.err.join("\n")).toContain("marketplace source.ref");
    });
  });

  // An empty list means the tags were never read, not that nothing has been
  // released, so it stops the preflight rather than passing it.
  test("release history that cannot be read is an operational failure", () => {
    withCheckout("0.7.0", (root) => {
      const failed = capture();
      expect(runPreflight(root, failed.stdout, failed.stderr,
        () => ({ ok: false, reason: "fatal: no remote" }))).toBe(2);
      expect(failed.err.join("\n")).toContain("fatal: no remote");
      expect(failed.out).toEqual([]);

      const empty = capture();
      expect(runPreflight(root, empty.stdout, empty.stderr, () => ({ ok: true, output: "" }))).toBe(2);
      expect(empty.err.join("\n")).toContain("no release tags");

      const noReleases = capture();
      expect(runPreflight(root, noReleases.stdout, noReleases.stderr,
        () => listing("measurements-2026-08-22g"))).toBe(2);
    });
  });

  // Offline: a bare repository on disk stands in for GitHub, so the real git
  // command runs without a network.
  test("the remote's tags are read with git, and a failure is reported, not thrown", () => {
    const workspace = mkdtempSync(join(tmpdir(), "iso-24495-remote-"));
    try {
      // A CI runner has no git identity, and an annotated tag needs one. The
      // machine's own configuration is set aside, so every machine runs this
      // test as the runner does, and the identity is given here.
      const emptyConfig = join(workspace, "empty.gitconfig");
      writeFileSync(emptyConfig, "");
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      };
      const git = (cwd: string, ...args: string[]): void => {
        const run = Bun.spawnSync(["git", ...args], { cwd, env });
        expect(run.exitCode, `git ${args.join(" ")}: ${new TextDecoder().decode(run.stderr)}`).toBe(0);
      };
      const remote = join(workspace, "remote.git");
      const local = join(workspace, "local");
      mkdirSync(local);
      git(workspace, "init", "--quiet", "--bare", remote);
      git(local, "init", "--quiet");
      git(local, "commit", "--quiet", "--allow-empty", "-m", "Start");
      git(local, "tag", "-a", "v0.9.0", "-m", "Release");
      git(local, "tag", "v0.10.0");
      git(local, "remote", "add", "origin", remote);
      git(local, "push", "--quiet", "origin", "--tags");

      const tags = remoteTags(local);
      expect(tags.ok).toBe(true);
      expect(releasedVersions(tags.ok ? tags.output : "").sort()).toEqual(["0.10.0", "0.9.0"]);

      const noRemote = remoteTags(workspace);
      expect(noRemote.ok).toBe(false);
      expect(noRemote.ok ? "" : noRemote.reason).not.toBe("");

      const noDirectory = remoteTags(join(workspace, "missing"));
      expect(noDirectory.ok).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the pushed tag check", () => {
  test("a tag that names the declared version passes, and any other fails", () => {
    expect(tagProblems("v0.7.0", "0.7.0")).toEqual([]);
    expect(tagProblems("v0.7.1", "0.7.0")).toEqual([
      "The pushed tag must name the declared version: expected v0.7.0, got the tag v0.7.1.",
    ]);
    // Text that is not a release tag, or not a version, is described and never quoted.
    expect(tagProblems("0.7.0", "0.7.0")).toEqual([
      "The pushed tag must name the declared version: expected v0.7.0, "
        + "got 5 characters that are not a release tag of the form v1.2.3.",
    ]);
    expect(tagProblems("v0.7.0", "seven")).toEqual([
      "The pushed tag must name the declared version: expected the tag for the declared version, "
        + "got the tag v0.7.0.",
    ]);
    withCheckout("0.7.0", (root) => {
      const matching = capture();
      expect(runTagCheck(["bun", "release-tag-cli.ts", "v0.7.0"], root, matching.stdout, matching.stderr))
        .toBe(0);
      expect(matching.out.join("\n")).toContain("v0.7.0 names the version every site declares");

      const other = capture();
      expect(runTagCheck(["bun", "release-tag-cli.ts", "v0.6.2"], root, other.stdout, other.stderr))
        .toBe(1);
      expect(other.err.join("\n")).toContain("expected v0.7.0, got the tag v0.6.2");
      expect(other.out).toEqual([]);
    });
  });

  test("a tag matching a manifest that disagrees with the rest still fails", () => {
    withCheckout("0.7.0", (root) => {
      edit(root, "skills/iso-24495-1/SKILL.md", "\"0.7.0\"", "\"0.6.2\"");
      const run = capture();
      expect(runTagCheck(["bun", "release-tag-cli.ts", "v0.7.0"], root, run.stdout, run.stderr)).toBe(1);
      expect(run.err.join("\n")).toContain("skills/iso-24495-1/SKILL.md");
    });
  });

  // The command files are never imported, so these run them as a maintainer
  // and the workflow do, from the root of a checkout.
  test("the shipped commands read the checkout they are run in", () => {
    const scripts = join(import.meta.dir, "..");
    const run = (cwd: string, ...command: string[]): number | null =>
      Bun.spawnSync(["bun", ...command], { cwd }).exitCode;
    withCheckout("0.7.0", (root) => {
      expect(run(root, join(scripts, "release-tag-cli.ts"), "v0.7.0")).toBe(0);
      expect(run(root, join(scripts, "release-tag-cli.ts"), "v0.6.2")).toBe(1);
      expect(run(root, join(scripts, "release-tag-cli.ts"))).toBe(2);

      // A checkout with no remote cannot read the release history.
      const git = (...args: string[]): void => {
        expect(Bun.spawnSync(["git", ...args], { cwd: root }).exitCode, args.join(" ")).toBe(0);
      };
      git("init", "--quiet");
      expect(run(root, join(scripts, "release-preflight-cli.ts"))).toBe(2);

      // A bare repository on disk stands in for origin, so this needs no network.
      const remote = `${root}-origin.git`;
      try {
        git("init", "--quiet", "--bare", remote);
        git("remote", "add", "origin", remote);
        git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
          "commit", "--quiet", "--allow-empty", "-m", "Start");
        git("tag", "v0.6.2");
        git("push", "--quiet", "origin", "--tags");
        expect(run(root, join(scripts, "release-preflight-cli.ts"))).toBe(0);
        git("tag", "v0.7.0");
        git("push", "--quiet", "origin", "--tags");
        expect(run(root, join(scripts, "release-preflight-cli.ts"))).toBe(1);
      } finally {
        rmSync(remote, { recursive: true, force: true });
      }
    });
  }, 60_000);

  // The release steps live in the preflight's header. They published the
  // release straight after pushing the tag, and nothing waited for the tag
  // workflow, so a tag that failed it could still be released.
  test("the release steps wait for the tag workflow before publishing", () => {
    const header = readFileSync(join(import.meta.dir, "..", "release-preflight-cli.ts"), "utf8");
    const find = (text: string): number => {
      const at = header.indexOf(text);
      expect(at, `the header names ${text}`).toBeGreaterThan(-1);
      return at;
    };
    const push = find("git push origin v<version>");
    const list = find("gh run list --workflow release-tag.yml --commit");
    const watch = find("gh run watch <run-id> --exit-status");
    const publish = find("gh release create v<version>");
    expect(push).toBeLessThan(list);
    expect(list).toBeLessThan(watch);
    expect(watch).toBeLessThan(publish);
  });

  test("a missing tag is a usage error", () => {
    const run = capture();
    expect(runTagCheck(["bun", "release-tag-cli.ts"], ".", run.stdout, run.stderr)).toBe(2);
    expect(run.err[0]).toStartWith("Usage:");
  });
});
