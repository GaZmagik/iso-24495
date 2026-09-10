#!/usr/bin/env bash
# Audits one piece of text and decides whether it passes.
#
# The suite audits the documents in this repository. A pull request description
# is text a reader receives too, and it lives on GitHub rather than in the tree,
# so nothing read it until this. Continuous integration calls this file, and so
# can you, on any file: the two routes cannot drift while there is one script.
#
#   bash scripts/audit-pull-request-text.sh <file>
#
# Exit 0 means the text passed, 1 means it has findings or is empty, and 2 means
# the arguments were wrong.
set -euo pipefail

TEXT="${1:-}"
if [ -z "$TEXT" ]; then
  echo "usage: bash scripts/audit-pull-request-text.sh <file>" >&2
  exit 2
fi

# Resolved before the directory changes below, so a relative path still works.
TEXT="$(cd "$(dirname "$TEXT")" 2>/dev/null && pwd)/$(basename "$TEXT")" || true

cd "$(dirname "$0")/.."

# An audit of nothing finds nothing, so an empty description would earn a green
# tick. A reader gets nothing from one either.
if [ ! -s "$TEXT" ]; then
  echo "There is no text to read, so there is nothing for a reader to read."
  exit 1
fi

FINDINGS="$(mktemp)"
trap 'rm -f "$FINDINGS"' EXIT

bun skills/iso-24495-text-audit/scripts/audit-text-cli.ts "$TEXT" --json "$FINDINGS"

# The audit is advisory by design and exits 0 whatever it finds, so the decision
# is made here, and it is made on evidence rather than on silence. The first
# marker says a file was read and was clean, and the second says the run as a
# whole found nothing.
#
# The two cannot disagree about one named file today, because the audit reads
# whatever it is given: a file with an unknown extension and a file with damaged
# bytes were both read rather than skipped. They are read as a pair anyway, so
# that a future change to this report fails the check instead of passing it.
if grep -q '"violations": \[\]' "$FINDINGS" && grep -q '"totals": {}' "$FINDINGS"; then
  echo "==> The text reads plainly against the engine's checks"
  exit 0
fi

echo
echo "The findings above are mechanical proxies, not an ISO judgement."
echo "Edit the text, or say why it suits its readers and purpose."
exit 1
