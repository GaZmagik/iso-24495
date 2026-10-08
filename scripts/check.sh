#!/usr/bin/env bash
# The one gate for this repository. Continuous integration runs this file and
# nothing else, so a contributor reproduces a failed build with a single local
# command. Add a check here, never in the workflow, or the two routes drift.
set -euo pipefail

cd "$(dirname "$0")/.."

# The type check and the linter are development dependencies, and nothing a
# user of the plugin runs needs them. A frozen install fails when bun.lock and
# package.json disagree, so the gate never runs a version nobody reviewed.
echo "==> Development dependencies, exactly as locked"
bun install --frozen-lockfile

# Each tool is called by its path. "bun run typecheck" once fell through to a
# different compiler on PATH, in a clone where nothing was installed.
echo "==> Type check"
node_modules/.bin/tsc --noEmit

echo "==> Lint"
node_modules/.bin/eslint .

echo "==> Test suite with coverage thresholds"
# Tests that start a shell script, or read the whole repository, overran the
# 5-second default whenever the machine was busy. They check behaviour, not
# speed, and the timing guards set their own budgets. bunfig.toml cannot set
# this: a "timeout" key under [test] is ignored, which a probe confirmed.
bun test --timeout 60000

# The suite imports the library modules directly, so a broken entry shim passes
# it. This runs a shipped command through the same entry file users receive.
echo "==> Shipped audit entry point against this repository"
bun skills/iso-24495-4/scripts/audit-corpus-cli.ts .

# Same reasoning as above: the suite tests the module, so this runs the shipped
# entry file. The fixture keeps the gate offline and free of a token.
echo "==> Traffic snapshot entry point against a fixture"
bun scripts/traffic-snapshot-cli.ts --from-file scripts/tests/fixtures/traffic-sample.json --dry-run data

echo "==> All gates passed"
