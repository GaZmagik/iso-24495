#!/usr/bin/env bash
# Audits one piece of text and reports what the audit found.
#
# The suite audits the documents in this repository. A pull request description
# is text a reader receives too, and it lives on GitHub rather than in the tree,
# so nothing read it until this. Continuous integration calls this file, and so
# can you, on any file: the two routes cannot drift while there is one script.
#
#   bash scripts/audit-pull-request-text.sh <file>
#
# Findings are advice. They are mechanical proxies, not an ISO judgement, and no
# explanation of why a text suits its readers could ever satisfy a check that
# failed on them, so they never block. The check blocks only where there is
# nothing to audit, or where the audit did not do its job:
#
#   0  The audit ran on a description that is not empty. Any findings are
#      listed, as advice. A pass does not mean the description is clear.
#   1  The description is empty, or holds only whitespace.
#   2  The arguments were wrong, which includes naming a file that cannot be
#      read.
#   3  The audit did not run, or its report does not show that it read the file.
#
# The findings are printed here. Where GITHUB_STEP_SUMMARY names a file, as it
# does on a GitHub runner, they are appended to it as well, because the job's
# summary page is where a contributor looks.
set -euo pipefail

TEXT="${1:-}"
if [ -z "$TEXT" ]; then
  echo "usage: bash scripts/audit-pull-request-text.sh <file>" >&2
  exit 2
fi

# The argument is text nobody has read, so no message below prints it, cleaned or
# not. An escape character in it would drive the terminal that shows the message.
# A message names the argument and gives its length instead, as it was given and
# before it is resolved. The length is in characters where the locale reads
# UTF-8, and in bytes where it does not.
GIVEN_LENGTH="${#TEXT}"

# Resolved before the directory changes below, so a relative path still works.
#
# Every name passes a "--" first, because one beginning with a dash otherwise
# arrives as an option. A review named the consequence: "-missing.md" did not
# exist, `dirname` read it as a flag, the failure was swallowed, and the script
# audited a neighbouring file and passed. A checker that passes for the wrong
# target is worse than one that fails, so a resolution failure now stops it.
if ! DIRECTORY="$(cd -- "$(dirname -- "$TEXT")" 2>/dev/null && pwd)"; then
  echo "There is no directory holding the path given as the first argument, which is $GIVEN_LENGTH characters long, so nothing can be read." >&2
  exit 2
fi
TEXT="$DIRECTORY/$(basename -- "$TEXT")"

cd -- "$(dirname -- "$0")/.."

SUMMARY="${GITHUB_STEP_SUMMARY:-}"

# Prints a paragraph, and appends it to the step summary where there is one.
report() {
  echo "$1"
  if [ -n "$SUMMARY" ]; then
    printf '%s\n\n' "$1" >> "$SUMMARY"
  fi
}

# The audit must read the file the caller named. Anything else is a mistake in
# the call rather than a judgement about text, so it exits 2 and says which.
if [ ! -f "$TEXT" ]; then
  echo "The path given as the first argument, $GIVEN_LENGTH characters long, names no file to read." >&2
  exit 2
fi

# The audit must be able to read the file, not merely know it exists. A test of
# permission bits is not enough: a review held a Windows exclusive lock on the
# file, which `-r` still called readable, and every later read failed. So the
# file is read here, and any failure to read it is the exit 2 this header
# promises.
if ! cat -- "$TEXT" > /dev/null 2>&1; then
  echo "The path given as the first argument, $GIVEN_LENGTH characters long, names a file that exists but cannot be read." >&2
  exit 2
fi

if [ -n "$SUMMARY" ]; then
  printf '## Pull request description audit\n\n' >> "$SUMMARY"
fi

# An audit of nothing finds nothing, so an empty description would pass having
# been read by nobody. This tests the Markdown source, not what a page would
# show: a description holding a comment or an image is not empty, and the audit
# reads it. Whitespace is whatever JavaScript's \s matches, which includes the
# no-break space, the other Unicode space characters and the byte order mark,
# so the answer is the same on every platform whatever its locale.
EMPTY_STATUS=0
DESCRIPTION_FILE="$TEXT" bun -e '
  const source = require("node:fs").readFileSync(process.env.DESCRIPTION_FILE, "utf8");
  process.exit(/\S/.test(source) ? 0 : 1);
' || EMPTY_STATUS=$?
if [ "$EMPTY_STATUS" -eq 1 ]; then
  report "The description is empty or holds only whitespace, so there is nothing to audit. Write one: a reader needs to know what the change does and why."
  exit 1
fi
if [ "$EMPTY_STATUS" -ne 0 ]; then
  echo "The path given as the first argument, $GIVEN_LENGTH characters long, names a file that exists but cannot be read." >&2
  exit 2
fi

FINDINGS="$(mktemp)"
TABLE="$(mktemp)"
trap 'rm -f "$FINDINGS" "$TABLE"' EXIT

# A description has no front matter. GitHub shows a leading "---" block as a rule
# and a heading, so the audit is told there is none and reads the block as that
# text, where a file in a repository would have it hidden as metadata. A review
# found a description whose only text sat inside such a block, and it passed.
AUDIT_STATUS=0
bun skills/iso-24495-text-audit/scripts/audit-text-cli.ts "$TEXT" --no-front-matter \
  --json "$FINDINGS" > "$TABLE" || AUDIT_STATUS=$?
if [ "$AUDIT_STATUS" -ne 0 ]; then
  report "The audit did not run to completion (exit $AUDIT_STATUS), so the description was not checked."
  exit 3
fi

# A report must show that the description was read, and nothing else. The audit
# skips a symbolic link rather than following it, and then reports no file at
# all, so an empty report would call a read that never happened a pass. A search
# for the text "violations": stood in for this, and a review broke it both ways,
# so scripts/description-report.ts parses the report and says what it requires.
# It prints the number of findings when the report is sound.
FINDING_COUNT=0
if ! FINDING_COUNT="$(bun scripts/description-report-cli.ts "$FINDINGS" "$TEXT")"; then
  report "The audit's report does not show that it read the description, so the description was not checked."
  exit 3
fi

cat "$TABLE"
echo
if [ -n "$SUMMARY" ]; then
  cat "$TABLE" >> "$SUMMARY"
  printf '\n' >> "$SUMMARY"
fi

if [ "$FINDING_COUNT" -eq 1 ]; then
  report "The audit reported 1 finding. It is advice, and does not block this pull request. Edit the text if the finding points at a real problem for its readers."
elif [ "$FINDING_COUNT" -gt 1 ]; then
  report "The audit reported $FINDING_COUNT findings. They are advice, and do not block this pull request. Edit the text where a finding points at a real problem for its readers."
else
  report "The audit reported no findings."
fi
# General advice, printed on every pass. The script does not detect a description
# holding only a comment or an image; that would need a renderer, and the audit
# reads Markdown as written.
report "A pass means the audit ran on a description that is not empty. It is not a judgement that the description is clear, and a description holding only a comment or an image gives it little to read."
exit 0
