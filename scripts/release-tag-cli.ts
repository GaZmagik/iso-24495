// Pushed tag check. `.github/workflows/release-tag.yml` runs it on every pushed
// tag that begins with "v", and a maintainer can run the same command from the
// repository root:
//
//   bun scripts/release-tag-cli.ts v1.2.3
//
// Installs pin to the tag the marketplace `ref` names, so a tag whose files
// declare another version ships the wrong release. Exit 0 means the tag names
// the version every site declares. Exit 1 means it does not, or the sites
// disagree. Exit 2 means no tag was given. The logic lives in the module beside
// this file.

import { runTagCheck } from "./release-versions.ts";

process.exit(runTagCheck(process.argv, process.cwd(), console.log, console.error));
