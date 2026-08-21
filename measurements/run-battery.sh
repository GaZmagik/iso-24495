#!/bin/bash
BASE=./measurements/implementations/claude
LOG=$BASE/run.log
SRC=./measurements
Q="Read SPEC.md in this directory and implement it. Do not use any tools to write files. Output the complete contents of evaluate.ts in one TypeScript code block."
{
  echo "battery start $(date '+%H:%M:%S')  30 runs, 3 arms interleaved"
  fails=0
  for i in $(seq 1 10); do
    for arm in control style code; do
      d="$BASE/$arm-$i"
      rm -rf "$d"; mkdir -p "$d"
      cp "$SRC/hard/SPEC.md" "$d/"
      [ "$arm" = style ] && cp "$SRC/style-body.md" "$d/CLAUDE.md"
      [ "$arm" = code ]  && cp "$SRC/style-plus-code.md" "$d/CLAUDE.md"
      ( cd "$d" && timeout 280 claude -p --model opus --setting-sources project "$Q" < /dev/null ) > "$d/reply.md" 2>&1
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
  echo "battery end $(date '+%H:%M:%S'), runs with no code block: $fails"
  py -3 "$BASE/analyse.py"
} > "$LOG" 2>&1
echo "EXIT:$?" >> "$LOG"
