#!/usr/bin/env bash
# The one gate for this repository. Continuous integration runs this file and
# nothing else, so a contributor reproduces a failed build with a single local
# command. Add a check here, never in the workflow, or the two routes drift.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Test suite with coverage thresholds"
bun test

# The suite imports the library modules directly, so a broken entry shim passes
# it. This runs a shipped command through the same entry file users receive.
echo "==> Shipped audit entry point against this repository"
bun skills/iso-24495-4/scripts/audit-corpus-cli.ts .

# Same reasoning as above: the suite tests the module, so this runs the shipped
# entry file. The fixture keeps the gate offline and free of a token.
echo "==> Traffic snapshot entry point against a fixture"
bun scripts/traffic-snapshot-cli.ts --from-file scripts/tests/fixtures/traffic-sample.json --dry-run data

echo "==> All gates passed"
