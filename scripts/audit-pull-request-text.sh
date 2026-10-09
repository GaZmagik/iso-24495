#!/usr/bin/env bash
# Audits one piece of text and reports what the audit found.
#
#   bash scripts/audit-pull-request-text.sh <file>
#
# Continuous integration calls this file for a pull request description, and so
# can you, on any file: the two routes cannot drift while there is one script.
#
# This file only starts the program that does the work, which is
# scripts/audit-pull-request-text.ts. It reads nothing and writes nothing
# itself. That program reads the file once, and its own header says what it
# checks and why. The exit code is the program's:
#
#   0  The audit ran on a description that is not empty. Any findings are
#      listed, as advice. A pass does not mean the description is clear.
#   1  The description is empty, or holds nothing a reader can see.
#   2  The arguments were wrong, which includes naming a file that cannot be
#      read, a directory or a symbolic link.
#   3  The audit did not run.
#
# Where GITHUB_STEP_SUMMARY names a file, as it does on a GitHub runner, the
# program adds the result to it as well.
set -euo pipefail

exec bun "$(dirname -- "$0")/audit-pull-request-text-cli.ts" "$@"
