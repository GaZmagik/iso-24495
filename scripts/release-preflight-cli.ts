// Release preflight: run by hand before a release is tagged. The logic lives in
// `release-preflight.ts`, and `release-versions.ts` says where this stage sits
// among the three.
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
//   5. Tag `v<version>` from `origin/main`, and push the tag:
//
//        git tag v<version> origin/main
//        git push origin v<version>
//
//   6. Wait for the tag workflow to pass on that tag's commit. Nothing else
//      waits for it, and a release published first ships whatever the tag
//      holds. The run takes a few seconds to appear, so repeat the list until
//      it prints a run ID, then watch that run:
//
//        gh run list --workflow release-tag.yml --commit "$(git rev-list -n 1 v<version>)" \
//          --event push --json databaseId,headBranch \
//          --jq '.[] | select(.headBranch == "v<version>") | .databaseId'
//        gh run watch <run-id> --exit-status
//
//   7. Only when the watch exits 0, publish the release:
//
//        gh release create v<version>
//
//      If the run fails, nothing has been published. Delete the tag on origin
//      and locally, fix the cause, and start again from step 1.
//
// It reads the release tags on origin with `git ls-remote --tags origin`, so it
// needs the network. Exit 0 means the tag can be created. Exit 1 means the
// checkout is not ready: a site disagrees, or the version is not later than
// every release. Exit 2 means the release history could not be read, which
// never counts as a pass.

import { runPreflight } from "./release-preflight.ts";

process.exit(runPreflight(process.cwd(), console.log, console.error));
