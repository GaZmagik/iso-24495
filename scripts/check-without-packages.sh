#!/usr/bin/env bash
# Runs every shipped command in a copy of this repository that has nothing
# installed. scripts/check.sh calls it, as one stage of the gate.
#
# A user installs the plugin and nothing else. The gate itself runs where
# node_modules exists, so a command that imports a package passes every other
# stage and then fails for every user. A rule about how an import is spelt
# cannot close that: a name can be computed, or reached through a file the rule
# does not read. So this asks the question itself. It copies the working tree
# to a place with no packages, runs each command there, and reads its exit code.
#
# What it establishes: each command listed below loads and runs with nothing
# installed, on the input given here. What it does not: that every path through
# a command does. An import reached only by another input is not seen.
set -euo pipefail

cd "$(dirname "$0")/.."

main() {
  local root
  root="$(clean_directory)"
  # The one line that removes the copy, on every way out of this script.
  trap "rm -rf '$root'" EXIT
  local tree="$root/tree"
  local out="$root/out"
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

  local part4="skills/iso-24495-4/scripts"
  local version
  version="$(bun -e 'console.log(JSON.parse(require("node:fs").readFileSync(".claude-plugin/plugin.json", "utf8")).version)')"

  # Every command a user, a skill or a workflow starts. The four Part 4
  # commands run in the order their skill gives, each reading the last one's
  # output.
  run 0 "$out" bun "$part4/audit-corpus-cli.ts" . --json "$out/findings.json"
  run 0 "$out" bun "$part4/audit-evidence-cli.ts" . --json "$out/evidence.json"
  run 0 "$out" bun "$part4/score-maturity-cli.ts" skills/iso-24495-4/tests/fixtures/answers.sample.json --json "$out/maturity.json"
  run 0 "$out" bun "$part4/generate-report-cli.ts" "$out/findings.json" "$out/evidence.json" "$out/maturity.json" --state "$out/state.json" --out "$out/report.md"
  run 0 "$out" bun skills/iso-24495-text-audit/scripts/audit-text-cli.ts README.md --project-dir .
  # A preview. It is offline, and it loads the client that a send would use.
  run 0 "$out" bun skills/iso-24495-design-audit/scripts/design-audit-cli.ts README.md --project-dir .
  run 0 "$out" bash scripts/audit-pull-request-text.sh README.md
  run 0 "$out" bun scripts/audit-pull-request-text-cli.ts README.md
  run 0 "$out" bun scripts/traffic-snapshot-cli.ts --from-file scripts/tests/fixtures/traffic-sample.json --dry-run data
  run 0 "$out" bun scripts/release-tag-cli.ts "v$version"
  # The preflight asks origin for its tags, and this copy is not a repository.
  # So it loads, asks, and stops with the code it documents for that.
  run 2 "$out" bun scripts/release-preflight-cli.ts

  echo "    every shipped command ran with nothing installed"
}

# Makes a new directory with no node_modules in it or in any directory above
# it, and prints its path. The system's temporary directory is tried first,
# then the directory that holds this repository. Stops the script when neither
# is clean, because a package found above the copy would be found by the copy.
clean_directory() {
  local parent candidate
  for parent in "${TMPDIR:-/tmp}" "$(cd .. && pwd)"; do
    candidate="$(mktemp -d "$parent/iso-24495-bare.XXXXXX")" || continue
    if packages_above "$candidate"; then
      rm -rf "$candidate"
    else
      echo "$candidate"
      return 0
    fi
  done
  echo "No temporary directory is free of a node_modules directory above it." >&2
  echo "Set TMPDIR to a directory with none above it, then run the gate again." >&2
  return 1
}

# Succeeds when a directory, or any directory above it, holds node_modules.
# Git Bash shows a Windows path under names of its own, so the walk uses the
# path Windows knows, where the shell can give it.
packages_above() {
  local at above
  at="$(cd "$1" && { pwd -W 2>/dev/null || pwd -P; })"
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
}

main
