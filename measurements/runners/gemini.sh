# A record of what was run, not a script to run.
#
# Every line below is a comment, so nothing here can execute under any shell. Two weaker
# attempts came before this one. A warning comment did not stop `bash runners/claude.sh`, and
# the redaction left `BASE` empty, which turned the `rm -rf` inside into one aimed at the root.
# Wrapping the body in a here-document fed to `:` was then defeated by aliasing `:` before
# sourcing the file.
#
# The paths are the ones the battery used, with the home directory written as <home>.
#
# sleep 3
# export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
# AGY="$HOME/.local/bin/agy"
# BASE=/mnt<home>/.agent-runs/codestyle-agy
# LOG=$BASE/run.log
# SRC=/mnt<home>/.claude/jobs/7035b099/tmp/t3
# SPEC="$(cat "$SRC/hard/SPEC.md")"
# TASK="Implement the specification below. Do not use any tools. Output the complete contents of evaluate.ts in one TypeScript code block.
#
# $SPEC"
# {
#   echo "agy battery start $(date '+%H:%M:%S')  30 runs, gemini-3.7-flash-medium, WSL clean home"
#   echo "rules via project GEMINI.md plus --add-dir; spec inlined so no tool permission is needed"
#   for i in $(seq 1 10); do
#     for arm in control style code; do
#       d="$BASE/$arm-$i"
#       rm -rf "$d"; mkdir -p "$d"
#       cp "$SRC/hard/SPEC.md" "$d/"
#       [ "$arm" = style ] && cp "$SRC/style-body.md" "$d/GEMINI.md"
#       [ "$arm" = code ]  && cp "$SRC/style-plus-code.md" "$d/GEMINI.md"
#       P="$TASK"
#       ( cd "$d" && timeout 280 "$AGY" --model gemini-3.7-flash-medium --add-dir "$d" --print-timeout 4m --print="$P" ) > "$d/reply.md" 2>&1
#       n=$(grep -c '```' "$d/reply.md" 2>/dev/null)
#       echo "  $(date '+%H:%M:%S')  $arm-$i  reply $(wc -w < "$d/reply.md") words, ${n:-0} fence lines"
#     done
#     echo "-- round $i of 10 complete --"
#   done
#   echo "agy battery end $(date '+%H:%M:%S')"
# } > "$LOG" 2>&1
# echo "EXIT:$?" >> "$LOG"
#
