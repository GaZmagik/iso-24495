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
# Exit 0 means the text passed. Exit 1 means it has findings, or holds no text.
# Exit 2 means the arguments were wrong, which includes naming a file that
# cannot be read.
set -euo pipefail

TEXT="${1:-}"
if [ -z "$TEXT" ]; then
  echo "usage: bash scripts/audit-pull-request-text.sh <file>" >&2
  exit 2
fi

# Resolved before the directory changes below, so a relative path still works.
#
# Every name passes a "--" first, because one beginning with a dash otherwise
# arrives as an option. A review named the consequence: "-missing.md" did not
# exist, `dirname` read it as a flag, the failure was swallowed, and the script
# audited a neighbouring file and passed. A checker that passes for the wrong
# target is worse than one that fails, so a resolution failure now stops it.
if ! DIRECTORY="$(cd -- "$(dirname -- "$TEXT")" 2>/dev/null && pwd)"; then
  echo "There is no directory holding $TEXT, so nothing can be read." >&2
  exit 2
fi
TEXT="$DIRECTORY/$(basename -- "$TEXT")"

cd -- "$(dirname -- "$0")/.."

# The audit must read the file the caller named. Anything else is a mistake in
# the call rather than a judgement about text, so it exits 2 and says which.
if [ ! -f "$TEXT" ]; then
  echo "There is no file to read at $TEXT." >&2
  exit 2
fi

# The audit must be able to read the file, not merely know it exists. A test of
# permission bits is not enough: a review held a Windows exclusive lock on the
# file, which `-r` still called readable, and the content check below then
# failed to read it and reported "no text" with exit 1. So the file is read
# here, and any failure to read it is the exit 2 this header promises.
if ! cat -- "$TEXT" > /dev/null 2>&1; then
  echo "The file at $TEXT exists but cannot be read." >&2
  exit 2
fi

# An audit of nothing finds nothing, so a description holding no text would earn
# a green tick. A reader gets nothing from one either.
#
# The file passes when it holds one visible character that is not Unicode
# whitespace or a NUL byte. Perl decodes the file as UTF-8, and its \s class
# covers every Unicode space, the non-breaking, em, thin and ideographic spaces
# among them. HTML comments and zero-width characters are removed before the
# visible-text check because a reader sees nothing from them.
# An earlier version deleted a list of known whitespace bytes with `tr`, and a
# file of em spaces passed because nobody had listed them.
#
# Perl exits 0 for text and 1 for none. Any other status means the file could
# not be read after all, which is exit 2 rather than a judgement about text.
TEXT_STATUS=0
perl -e '
  open(my $file, "<:encoding(UTF-8)", $ARGV[0]) or exit 2;
  local $/;
  my $text = <$file>;
  exit 1 if $text !~ /[^\s\x{0}\x{FEFF}]/;
  $text =~ s/<!--.*?-->//gs;
  $text =~ s/[\x{200B}\x{200C}\x{200D}\x{FEFF}\x{2060}]//g;
  exit($text =~ /[^\s\x{0}]/ ? 0 : 1)
' -- "$TEXT" 2>/dev/null || TEXT_STATUS=$?
if [ "$TEXT_STATUS" -eq 1 ]; then
  echo "There is no text to read, so there is nothing for a reader to read."
  exit 1
fi
if [ "$TEXT_STATUS" -ne 0 ]; then
  echo "The file at $TEXT exists but cannot be read." >&2
  exit 2
fi

FINDINGS="$(mktemp)"
trap 'rm -f "$FINDINGS"' EXIT

bun skills/iso-24495-text-audit/scripts/audit-text-cli.ts "$TEXT" --json "$FINDINGS"

# The audit is advisory by design and exits 0 whatever it finds, so the decision
# is made here, and it is made on evidence rather than on silence. The first
# marker says a file was read and was clean, and the second says the run as a
# whole found nothing.
#
# Both are read, because they can disagree. A review selected a symbolic link:
# the audit skips those rather than following them, so it reported empty totals
# with no file entry at all. Totals alone would have called that a pass. The
# pair is what distinguishes a clean read from a read that never happened.
if grep -q '"violations": \[\]' "$FINDINGS" && grep -q '"totals": {}' "$FINDINGS"; then
  echo "==> The text reads plainly against the engine's checks"
  exit 0
fi

echo
echo "The findings above are mechanical proxies, not an ISO judgement."
echo "Edit the text, or say why it suits its readers and purpose."
exit 1
