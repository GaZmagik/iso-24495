import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  preflightProblems,
  releasedVersions,
  remoteTags,
  runPreflight,
  type RemoteTags,
} from "../release-preflight.ts";
import { checkVersionSites } from "../release-versions.ts";
import { capture, edit, withCheckout } from "./fixtures/release-checkout.ts";

/** What `git ls-remote --tags` prints for these tags, peeled lines included. */
function listing(...tags: string[]): RemoteTags {
  const lines = tags.flatMap((tag, index) => [
    `${String(index).padStart(40, "a")}\trefs/tags/${tag}`,
    `${String(index).padStart(40, "b")}\trefs/tags/${tag}^{}`,
  ]);
  return { ok: true, output: `${lines.join("\n")}\n` };
}

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
      expect(noRemote.ok ? "" : noRemote.reason).toMatch(
        /^git exited with code [1-9]\d* when asked for the tags on origin\. Run "git ls-remote --tags origin" in the checkout to see its reason\.$/,
      );

      const noDirectory = remoteTags(join(workspace, "missing"));
      expect(noDirectory.ok).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 60_000);

  // The runtime's message for a command it cannot start quotes the directory
  // it was given, so the reason names the kind of failure and nothing more.
  test("git that cannot be started is described in fixed words", () => {
    const missing = remoteTags("checkout", () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, uv_spawn 'hunter2'"), { code: "ENOENT" });
    });
    expect(missing).toEqual({ ok: false, reason: "git could not be started: no such file or directory" });

    const refused = remoteTags("checkout", () => {
      throw new TypeError("The property 'options.cwd' must be a string. Received \"hunter2\"");
    });
    expect(refused).toEqual({ ok: false, reason: "git could not be started: an unexpected TypeError" });
  });

  // Git writes its complaint from the remote address in the checkout's
  // configuration, which can hold a user name and a password. One version of
  // git removing them is no promise about the next, so none of it is passed on.
  test("git that runs and fails is described in fixed words, never in its own", () => {
    const marker = "https://user:hunter2@host.invalid/owner/repo.git";
    const encoder = new TextEncoder();
    const failing = (): { exitCode: number; stdout: Uint8Array; stderr: Uint8Array } => ({
      exitCode: 128,
      stdout: encoder.encode(`listing for ${marker}`),
      stderr: encoder.encode(`fatal: unable to access '${marker}/': Could not resolve host: host.invalid`),
    });
    const reason = "git exited with code 128 when asked for the tags on origin. "
      + "Run \"git ls-remote --tags origin\" in the checkout to see its reason.";
    expect(remoteTags("checkout", failing)).toEqual({ ok: false, reason });

    const run = capture();
    expect(runPreflight("checkout", run.stdout, run.stderr, (root) => remoteTags(root, failing))).toBe(2);
    expect(run.err).toEqual([`release preflight: the release tags on origin could not be listed: ${reason}`]);
    expect(run.out).toEqual([]);
    for (const leaked of ["hunter2", "host.invalid", "fatal", "resolve"]) {
      expect(run.err.join(" ")).not.toContain(leaked);
    }

    // Empty stderr used to be the only case given in fixed words.
    const silent = remoteTags("checkout", () => ({ exitCode: 1, stdout: new Uint8Array(), stderr: new Uint8Array() }));
    expect(silent.ok ? "" : silent.reason).toStartWith("git exited with code 1 when asked");
  });
});
