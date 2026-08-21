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
#
#   It reads bun's EXIT STATUS, captured before the output is filtered, AND requires the junit
#   report bun writes after the run. Two false passes were demonstrated against earlier versions.
#   One printed ` 25 pass` and ` 0 fail` of its own accord while bun exited 1 having failed all
#   25 tests. The next called `process.exit(0)` during import, so bun exited 0 before any test
#   ran. The report answers both, because bun writes it only after the run completes.
#   Piping bun into sed hid the status, because a pipeline reports its LAST command.
#
# WHAT THIS DOES NOT DO. It reproduces fixed, published inputs. It is not a sandbox for hostile
# code. An implementation determined to lie shares this process and could forge any marker inside
# it; only process isolation and an outside witness would settle that. None of the ninety files
# published here contains a `process.exit`, an `exitCode`, a console call or a runtime API, which
# is checkable rather than asserted. The same goes for the tools themselves: a forged `bun` on
# the path could fake everything above, and hashing it from inside the same environment would
# prove nothing. This script trusts its shell, its bun and its operating system.
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

# One run's verdict, so the loop below and the test that attacks this predicate exercise the
# same code. A test that reimplements the check proves only that the copy agrees with itself.
check_run() {
  local directory="$1"
  local out status report
  out=$(cd "$directory" && bun test ./hidden.test.ts \
    --reporter=junit --reporter-outfile=result.xml 2>&1)
  status=$?
  # bun colours its summary, so the escape codes are stripped before anything is read.
  out=$(printf '%s' "$out" | sed -r "s/\x1B\[[0-9;]*[mK]//g")
  report="$directory/result.xml"
  CHECK_OUTPUT="$out"
  CHECK_STATUS="$status"
  [ "$status" -eq 0 ] && [ -f "$report" ] \
    && grep -q 'tests="25"' "$report" \
    && grep -q 'failures="0"' "$report" \
    && grep -q 'skipped="0"' "$report"
}

# `rerun-tests.sh --check-one <directory>` judges one prepared directory and says so. The
# directory must already hold evaluate.ts and hidden.test.ts.
if [ "${1:-}" = "--check-one" ]; then
  if [ -z "${2:-}" ] || [ ! -d "$2" ]; then
    echo "usage: rerun-tests.sh --check-one <directory>"
    exit 2
  fi
  if check_run "$2"; then
    echo "PASS"
    exit 0
  fi
  echo "FAIL (bun exited $CHECK_STATUS)"
  exit 1
fi

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
      total=$((total + 1))
      if check_run "$directory"; then
        passed=$((passed + 1))
      else
        failed="$failed $run"
        echo "--- $run did not pass: bun exited $CHECK_STATUS ---"
        [ -f "$directory/result.xml" ] \
          || echo "    no result.xml: the tests did not run to completion"
        printf '%s\n' "$CHECK_OUTPUT" | grep -E "pass|fail|error" | head -4
      fi
    done
  done
done

echo
echo "bun $(bun --version)"
echo "RERAN:  $total"
echo "PASSED: $passed"
echo "FAILED:${failed:- none}"

# The saved output must carry the verdict, not only the counts, so a reader of the recorded file
# sees what the script decided rather than inferring it.
if [ "$passed" -eq "$total" ] && [ "$total" -eq 90 ]; then
  echo "EXIT: 0"
  exit 0
fi
echo "EXIT: 1"
exit 1
