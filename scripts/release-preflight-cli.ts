// Release preflight: run by hand before a release is tagged. The logic lives in
// the module beside this file, which says where this stage sits among the three.
//
// A release goes in this order:
//
//   1. Raise the version at every site together: `.claude-plugin/plugin.json`,
//      `.codex-plugin/plugin.json`, the marketplace entry's `version` and the
//      `ref` in its source object, and every skill's `metadata.version`.
//   2. Give the version its own entry in CHANGELOG.md.
//   3. Have the branch reviewed independently until the review passes, then
//      merge it.
//   4. Check out `origin/main` and run this from the repository root:
//
//        bun scripts/release-preflight-cli.ts
//
//   5. Tag `v<version>` from `origin/main`, push the tag, and run
//      `gh release create`. The tag workflow then checks the pushed tag.
//
// It reads the release tags on origin with `git ls-remote --tags origin`, so it
// needs the network. Exit 0 means the tag can be created. Exit 1 means the
// checkout is not ready: a site disagrees, or the version is not later than
// every release. Exit 2 means the release history could not be read, which
// never counts as a pass.

import { runPreflight } from "./release-versions.ts";

process.exit(runPreflight(process.cwd(), console.log, console.error));
