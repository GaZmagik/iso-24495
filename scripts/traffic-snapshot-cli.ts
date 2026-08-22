// Entry point for the traffic snapshot. Everything testable lives in the
// module beside this file; this shim only reaches the network and the disk.
//
// The token must be a fine-grained personal access token with Administration
// (read) on this repository. The built-in GITHUB_TOKEN cannot be granted that
// permission, because the workflow permissions block has no administration
// key, so the traffic endpoints reject it.

import { readFileSync, writeFileSync } from "node:fs";
import { runCli, type Deps } from "./traffic-snapshot.ts";

const repository = process.env.REPOSITORY ?? "GaZmagik/iso-24495";
const token = process.env.GITHUB_TRAFFIC_TOKEN ?? "";

async function get(path: string): Promise<unknown> {
  const response = await fetch("https://api.github.com/repos/" + repository + path, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "user-agent": "iso-24495-traffic-snapshot",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(
      (path === "" ? "/" : path) + " returned HTTP " + response.status + " " + response.statusText,
    );
  }
  return await response.json();
}

const deps: Deps = {
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeText: (path, text) => writeFileSync(path, text, "utf8"),
  fetchSnapshot: async () => ({
    clones: await get("/traffic/clones"),
    views: await get("/traffic/views"),
    referrers: await get("/traffic/popular/referrers"),
    repo: await get(""),
  }),
  today: () => new Date().toISOString().slice(0, 10),
};

process.exit(await runCli(process.argv, console.log, console.error, deps));
