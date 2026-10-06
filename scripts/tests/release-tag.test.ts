import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runTagCheck, tagProblems } from "../release-tag.ts";
import { capture, edit, withCheckout } from "./fixtures/release-checkout.ts";

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
