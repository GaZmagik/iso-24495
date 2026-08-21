#!/bin/bash
# Rerun the 25 hidden tests against all ninety published implementations.
#
# The tests.txt beside each implementation records what happened when the run was made. A record
# is not a rerun, and the article says every implementation passes, so this executes them again
# from the published files. Run it from the repository root:
#
#     bash measurements/rerun-tests.sh
#
# Each implementation is copied into its own scratch directory with the hidden tests, so nothing
# is written into the published evidence. The scratch directory is removed at the end.
#
# Two things this script does deliberately, both learned by getting them wrong first:
#
#   The harness is copied in as `hidden.test.ts`, not `hidden-tests.ts`. `bun test <name>` treats
#   its argument as a filter and only matches files containing `.test`, so the original name ran
#   nothing at all and still exited 0.
#
#   It COUNTS the runs that passed rather than looking for failures. An empty result is not a
#   negative finding: the first version of this script reported no failures across ninety runs
#   that had never executed.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MEASUREMENTS="$ROOT/measurements"
HARNESS="$MEASUREMENTS/task/hidden-tests.ts"
SCRATCH="${TMPDIR:-/tmp}/iso-24495-rerun-$$"

if [ ! -f "$HARNESS" ]; then
  echo "no harness at $HARNESS"
  exit 1
fi

trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH"

total=0
passed=0
failed=""

for tool in claude codex gemini; do
  for arm in control style code; do
    for n in 1 2 3 4 5 6 7 8 9 10; do
      run="$tool/$arm-$n"
      source_file="$MEASUREMENTS/implementations/$run/evaluate.ts"
      if [ ! -f "$source_file" ]; then
        failed="$failed $run(missing)"
        continue
      fi
      directory="$SCRATCH/$tool-$arm-$n"
      mkdir -p "$directory"
      cp "$source_file" "$directory/evaluate.ts"
      cp "$HARNESS" "$directory/hidden.test.ts"
      # bun colours its summary, so the escape codes are stripped before anything is counted.
      out=$(cd "$directory" && bun test ./hidden.test.ts 2>&1 | sed -r "s/\x1B\[[0-9;]*[mK]//g")
      total=$((total + 1))
      if printf '%s' "$out" | grep -qE "^ 25 pass" && printf '%s' "$out" | grep -qE "^ 0 fail"; then
        passed=$((passed + 1))
      else
        failed="$failed $run"
        echo "--- $run did not report 25 pass and 0 fail ---"
        printf '%s\n' "$out" | grep -E "pass|fail|error" | head -4
      fi
    done
  done
done

echo
echo "RERAN:  $total"
echo "PASSED: $passed"
echo "FAILED:${failed:- none}"
[ "$passed" -eq "$total" ] && [ "$total" -eq 90 ]
