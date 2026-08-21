# This is a record of what was run, not a script to run.
#
# The paths below are the ones the battery used, with the home directory replaced. Running it
# would need those directories, the three agent command-line tools, and a great deal of time.
# It is published so the prompt, the arms and the placement of the instruction files can be
# read, not so a reader can repeat forty hours of generation.
#!/bin/bash
BASE=<home>/.agent-runs/codestyle-codex
LOG=$BASE/run.log
SRC=<home>/.claude/jobs/7035b099/tmp/t3
export CODEX_HOME=<home>/.claude/jobs/7035b099/tmp/cxhome
Q="Read SPEC.md in this directory and implement it. Do not use any tools to write files. Output the complete contents of evaluate.ts in one TypeScript code block."
{
  echo "codex battery start $(date '+%H:%M:%S')  30 runs, model gpt-5.6-sol, isolated CODEX_HOME"
  fails=0
  for i in $(seq 1 10); do
    for arm in control style code; do
      d="$BASE/$arm-$i"
      rm -rf "$d"; mkdir -p "$d"
      cp "$SRC/hard/SPEC.md" "$d/"
      [ "$arm" = style ] && cp "$SRC/style-body.md" "$d/AGENTS.md"
      [ "$arm" = code ]  && cp "$SRC/style-plus-code.md" "$d/AGENTS.md"
      ( cd "$d" && timeout 280 codex exec --skip-git-repo-check -m gpt-5.6-sol "$Q" < /dev/null ) > "$d/reply.md" 2>&1
      if py -3 "$BASE/extract.py" "$d/reply.md" "$d/evaluate.ts"; then
        cp "$SRC/hard/hidden.test.ts" "$d/"
        ( cd "$d" && timeout 120 bun test hidden.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' ) > "$d/tests.txt"
        pass=$(grep -oE "[0-9]+ pass" "$d/tests.txt" | head -1 | grep -oE "^[0-9]+")
        echo "  $(date '+%H:%M:%S')  $arm-$i  ok  tests=${pass:-0}/25"
      else
        fails=$((fails+1))
        echo "  $(date '+%H:%M:%S')  $arm-$i  NO CODE BLOCK"
      fi
    done
    echo "-- round $i of 10 complete --"
  done
  echo "codex battery end $(date '+%H:%M:%S'), runs with no code block: $fails"
  py -3 "$BASE/analyse.py"
} > "$LOG" 2>&1
echo "EXIT:$?" >> "$LOG"
