#!/usr/bin/env bash
# Runs every shipped command in a copy of this repository that has nothing
# installed. scripts/check.sh calls it, as one stage of the gate.
#
# A user installs the plugin and nothing else. The gate itself runs where
# node_modules exists, so a command that imports a package passes every other
# stage and then fails for every user. So this asks the question itself. It
# copies the working tree to a place with no packages, runs each command
# there, and reads its exit code. The copy goes under TMPDIR when that is set
# and clean, and otherwise under the first clean place of a short list, which
# clean_parent gives below. No contributor has to configure anything.
#
# What it establishes: each command listed below loads and runs with nothing
# installed, in each documented mode that can run offline. What it does not:
# that every path through a command does. An import reached only by an input
# not given here, or by a mode that needs the network, is not seen.
#
# The scope, in the words the README uses:
#
# These guards catch accidents. The gate catches a package import written by
# name in shipped code. It also catches any shipped command that fails to load
# or run with nothing installed, in its documented offline modes.
#
# It does not defend against a deliberate evasion, of which there are three
# kinds. A name can be computed while the code runs. A failure can be caught
# and hidden by the code. An edit to the lint configuration can change what a
# rule does without changing its entry, through inline configuration or a
# processor.
#
# The person who reviews the diff covers those, because each is visible in the
# change that introduces it.
set -euo pipefail

cd "$(dirname "$0")/.."

# Where the copy is, once it is made. Clean-up reads it from here. Pasting the
# path into the text of a trap broke on a path that held an apostrophe, and
# the copy was left behind.
COPY_ROOT=""
# How many commands have run and given the exit code required of them.
RUNS=0

main() {
  # Set before the directory exists, so that no way out can miss it.
  trap remove_copy EXIT
  local parent
  parent="$(clean_parent)"
  # Always a new directory of this script's own. Clean-up removes that and
  # nothing else, and never the place it was made in.
  COPY_ROOT="$(mktemp -d "${parent%/}/iso-24495-bare.XXXXXX")"
  local tree="$COPY_ROOT/tree"
  local out="$COPY_ROOT/out"
  echo "    the copy is in $COPY_ROOT"
  mkdir "$tree" "$out"

  # The working tree, not the last commit: what git tracks as it stands on
  # disk, and new files not yet added. A contributor running the gate before
  # committing is tested on what they have. Ignored files stay behind, and
  # node_modules is one of them.
  git ls-files -z --cached --others --exclude-standard | existing_files \
    | tar --null -T - -cf - | tar -xf - -C "$tree"

  cd "$tree"
  # Bun fetches a missing package by itself when it finds no node_modules above
  # the file it is running, which is exactly where this copy sits. That would
  # turn a missing dependency into a pass. The option switches it off, for bun
  # started here and for bun started by a shell script started here.
  export BUN_OPTIONS="--no-install"
  # No command below sends anything. The key is dropped so that none can.
  unset TYPESAFE_API_KEY

  prove_packages_are_absent "$out"
  local probes="$RUNS"

  local part4="skills/iso-24495-4/scripts"
  local answers="skills/iso-24495-4/tests/fixtures/answers.sample.json"
  local text_audit="skills/iso-24495-text-audit/scripts/audit-text-cli.ts"
  local design_audit="skills/iso-24495-design-audit/scripts/design-audit-cli.ts"
  local version
  version="$(bun -e 'console.log(JSON.parse(require("node:fs").readFileSync(".claude-plugin/plugin.json", "utf8")).version)')"

  # Every command a user, a skill or a workflow starts, in every flag and
  # mode its usage text or its skill documents that can run offline. One
  # input for each command was not enough: a review put an import in a branch
  # that only "--json" reaches, and the command still passed.
  #
  # Three modes cannot run here, and are named so that nobody takes them for
  # covered. A send, which is "--send" on the design audit and "--jev --send"
  # on the text audit, with or without "--yes": it needs a key, the network
  # and a person's agreement. The traffic snapshot without "--from-file": it
  # fetches from GitHub with a token. The release preflight where origin
  # answers: the copy is not a repository. Each of those commands loads here
  # in its other modes.

  # A command given nothing prints its usage and stops with code 2.
  run 2 "$out" bun "$part4/audit-corpus-cli.ts"
  run 2 "$out" bun "$part4/audit-evidence-cli.ts"
  run 2 "$out" bun "$part4/score-maturity-cli.ts"
  run 2 "$out" bun "$part4/generate-report-cli.ts"
  run 2 "$out" bun "$text_audit"
  run 2 "$out" bun "$design_audit"
  run 2 "$out" bash scripts/audit-pull-request-text.sh
  run 2 "$out" bun scripts/audit-pull-request-text-cli.ts
  run 2 "$out" bun scripts/traffic-snapshot-cli.ts
  run 2 "$out" bun scripts/release-tag-cli.ts

  # The four Part 4 commands, printing and then writing. The written files
  # feed the report, as their skill orders them.
  run 0 "$out" bun "$part4/audit-corpus-cli.ts" .
  run 0 "$out" bun "$part4/audit-corpus-cli.ts" . --json "$out/findings.json"
  run 0 "$out" bun "$part4/audit-evidence-cli.ts" .
  run 0 "$out" bun "$part4/audit-evidence-cli.ts" . --json "$out/evidence.json"
  run 0 "$out" bun "$part4/score-maturity-cli.ts" "$answers"
  run 0 "$out" bun "$part4/score-maturity-cli.ts" "$answers" --json "$out/maturity.json"
  run 0 "$out" bun "$part4/generate-report-cli.ts" "$out/findings.json" "$out/evidence.json" "$out/maturity.json"
  run 0 "$out" bun "$part4/generate-report-cli.ts" "$out/findings.json" "$out/evidence.json" "$out/maturity.json" --out "$out/report.md"
  run 0 "$out" bun "$part4/generate-report-cli.ts" "$out/findings.json" "$out/evidence.json" "$out/maturity.json" --state "$out/state.json"
  run 0 "$out" bun "$part4/generate-report-cli.ts" "$out/findings.json" "$out/evidence.json" "$out/maturity.json" --state "$out/state.json" --out "$out/report.md"

  # The text audit: a file and a directory, each option alone, then its
  # offline preview of the design checks with each report option.
  run 0 "$out" bun "$text_audit" README.md
  run 0 "$out" bun "$text_audit" README.md --project-dir .
  run 0 "$out" bun "$text_audit" skills --project-dir .
  run 0 "$out" bun "$text_audit" README.md --project-dir . --json "$out/text.json"
  run 0 "$out" bun "$text_audit" README.md --project-dir . --no-front-matter
  run 0 "$out" bun "$text_audit" README.md --project-dir . --jev-preview
  run 0 "$out" bun "$text_audit" README.md --project-dir . --jev-preview --json "$out/text-preview.json"
  run 0 "$out" bun "$text_audit" README.md --project-dir . --jev-preview --include-judged-text --json "$out/text-judged.json"

  # The design audit, as a preview. It is offline, and it loads the client
  # that a send would use.
  run 0 "$out" bun "$design_audit" README.md
  run 0 "$out" bun "$design_audit" README.md --project-dir .
  run 0 "$out" bun "$design_audit" skills --project-dir .
  run 0 "$out" bun "$design_audit" README.md --project-dir . --json "$out/design.json"
  run 0 "$out" bun "$design_audit" README.md --project-dir . --include-judged-text --json "$out/design-judged.json"

  # The combinations both audits document as refused. Each stops with code 2
  # while the arguments are read, and none names a send.
  run 2 "$out" bun "$text_audit" README.md --no-front-matter --no-front-matter
  run 2 "$out" bun "$text_audit" README.md --jev
  run 2 "$out" bun "$text_audit" README.md --yes
  run 2 "$out" bun "$text_audit" README.md --jev-preview --no-front-matter
  run 2 "$out" bun "$text_audit" README.md --jev-preview --jev
  run 2 "$out" bun "$text_audit" README.md --jev-preview --include-judged-text
  run 2 "$out" bun "$design_audit" README.md --no-front-matter
  run 2 "$out" bun "$design_audit" README.md --jev-preview
  run 2 "$out" bun "$design_audit" README.md --yes
  run 2 "$out" bun "$design_audit" README.md --include-judged-text
  run 2 "$out" bun "$design_audit" README.md --project-dir . --project-dir .

  # The pull request text check, through its shell wrapper and directly, and
  # with the summary file a workflow gives it.
  run 0 "$out" bash scripts/audit-pull-request-text.sh README.md
  run 0 "$out" bun scripts/audit-pull-request-text-cli.ts README.md
  GITHUB_STEP_SUMMARY="$out/summary.md" run 0 "$out" bash scripts/audit-pull-request-text.sh README.md
  GITHUB_STEP_SUMMARY="$out/summary-direct.md" run 0 "$out" bun scripts/audit-pull-request-text-cli.ts README.md

  # The traffic snapshot from a fixture: as a dry run, and writing its files.
  mkdir "$out/traffic"
  run 0 "$out" bun scripts/traffic-snapshot-cli.ts --from-file scripts/tests/fixtures/traffic-sample.json --dry-run data
  run 0 "$out" bun scripts/traffic-snapshot-cli.ts --from-file scripts/tests/fixtures/traffic-sample.json "$out/traffic"

  # The tag check, on the declared version and on another.
  run 0 "$out" bun scripts/release-tag-cli.ts "v$version"
  run 1 "$out" bun scripts/release-tag-cli.ts v0.0.0
  # The preflight asks origin for its tags, and this copy is not a repository.
  # So it loads, asks, and stops with the code it documents for that.
  run 2 "$out" bun scripts/release-preflight-cli.ts

  echo "    every shipped command ran with nothing installed, in $((RUNS - probes)) runs"
}

# Removes the copy, on every way out of this script. Does nothing before the
# copy is made.
remove_copy() {
  if [ -n "$COPY_ROOT" ]; then
    rm -rf "$COPY_ROOT"
  fi
}

# Prints a directory under which the copy can be made: one that can be written
# to and has no node_modules in it or in any directory above it. This is the
# one search for such a place. The stage uses it, and so does the test that
# runs the stage, through "--clean-parent".
#
# The candidates, in order, each passed over without a word when it cannot be
# written to or is not clean:
#
# 1. TMPDIR, when it is set.
# 2. The system's temporary directory.
# 3. The directory that holds this repository.
# 4. The root of the drive or file system this repository is on.
# 5. On Windows, the root of the system drive.
# 6. Elsewhere, /var/tmp and /dev/shm, where they exist.
#
# The list is long because the ordinary places fail on an ordinary machine. A
# checkout under a home directory that holds node_modules has it above the
# first three, and a contributor should not have to configure anything.
#
# The path printed is the one the system knows, so that a command given it
# needs no translation: Git Bash translates its own names for a Windows path
# as it starts a program, and gave up on a name that held an apostrophe.
# Stops the script when no candidate is clean, because a package found above
# the copy would be found by the copy.
clean_parent() {
  local parent probe
  while IFS= read -r parent; do
    # Making a directory there is the test of whether it can be written to.
    probe="$(mktemp -d "${parent%/}/iso-24495-bare.XXXXXX" 2>/dev/null)" || continue
    if packages_above "$probe"; then
      rmdir "$probe"
    else
      rmdir "$probe"
      system_path "$parent"
      return 0
    fi
  done < <(candidate_parents)
  echo "No temporary directory is free of a node_modules directory above it." >&2
  echo "Set TMPDIR to a directory with none above it, then run the gate again." >&2
  return 1
}

# Prints each place the copy might go, one to a line, in the order they are
# tried. A place is listed whether or not it exists.
candidate_parents() {
  local here root
  if [ -n "${TMPDIR:-}" ]; then
    echo "$TMPDIR"
  fi
  echo "/tmp"
  (cd .. && pwd)
  # The root is where going up stops. On Windows that is the drive, such as
  # "D:", which needs its slash to name the root and not a place on the drive.
  here="$(system_path .)"
  root="$here"
  while [ "$(dirname "$root")" != "$root" ]; do
    root="$(dirname "$root")"
  done
  echo "${root%/}/"
  if [ -n "${SYSTEMDRIVE:-}" ]; then
    echo "${SYSTEMDRIVE%/}/"
  else
    echo "/var/tmp"
    echo "/dev/shm"
  fi
}

# Succeeds when a directory, or any directory above it, holds node_modules.
# Git Bash shows a Windows path under names of its own, so the walk uses the
# path Windows knows, where the shell can give it.
packages_above() {
  local at above
  at="$(system_path "$1")"
  while true; do
    if [ -e "$at/node_modules" ]; then
      return 0
    fi
    above="$(dirname "$at")"
    if [ "$above" = "$at" ]; then
      return 1
    fi
    at="$above"
  done
}

# Prints the path of a directory as the system knows it. Git Bash can give
# the Windows form. Any other shell gives the path with links resolved.
system_path() {
  (cd "$1" && { pwd -W 2>/dev/null || pwd -P; })
}

# Passes on the names, read from standard input, of files that exist. A
# tracked file deleted from disk and not yet from git is left out, as it is
# missing from what the contributor has.
existing_files() {
  local name
  while IFS= read -r -d '' name; do
    if [ -e "$name" ]; then
      printf '%s\0' "$name"
    fi
  done
}

# Shows that this copy cannot reach a package, so that a pass below means what
# it says. One file imports nothing but a built-in and must run. Then one file
# for each development dependency imports it by name, and must fail to find
# it. A package found here means node_modules is within reach, or that Bun
# fetched it.
prove_packages_are_absent() {
  local out="$1"
  local name probe="scripts/gate-probe.ts"
  printf 'import { sep } from "node:path";\nconsole.log(sep.length);\n' > "$probe"
  run 0 "$out" bun "$probe"
  for name in $(bun -e 'console.log(Object.keys(JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).devDependencies).join(" "))'); do
    printf 'import "%s";\n' "$name" > "$probe"
    run 1 "$out" bun "$probe"
    if ! grep -Eq "Cannot find (package|module)" "$out/stderr"; then
      echo "A file that imports an installed package did not fail for want of it." >&2
      cat "$out/stderr" >&2
      return 1
    fi
  done
  rm "$probe"
  echo "    no development dependency can be reached from the copy"
}

# Runs one command and requires the exit code given first. Its output goes to
# files in the directory given second. On any other code, prints what the
# command wrote to standard error and stops the script.
run() {
  local expected="$1" out="$2" code=0
  shift 2
  "$@" > "$out/stdout" 2> "$out/stderr" || code=$?
  if [ "$code" -ne "$expected" ]; then
    echo "With nothing installed, this command exited with code $code where $expected was expected:" >&2
    echo "    $*" >&2
    cat "$out/stderr" >&2
    return 1
  fi
  RUNS=$((RUNS + 1))
}

# The test that runs this stage asks where a clean place is, so that the
# search exists once.
if [ "${1:-}" = "--clean-parent" ]; then
  clean_parent
  exit 0
fi

main
