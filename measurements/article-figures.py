"""Print every figure the article quotes about the implementations, from the published data.

Run it from the repository root:

    python measurements/article-figures.py

The prose counts come from count-review-replies.ts, which pins the parser and the replies by
content. This script prints everything else: the entry positions, the unit and length medians,
the comment counts, the test totals, and the two files the article names.

It scores each run with `score` from analyse-implementations.py rather than measuring anything
itself. A second definition of "named unit" or "file length" would disagree with the article by
a little, which is worse than not publishing a script at all: it reads as a check while quietly
contradicting the thing it is meant to check.

It exists because a reviewer pointed out that the two analysers between them did not produce
several published numbers, so a reader had to take those on trust.
"""
import importlib.util
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMPLEMENTATIONS = os.path.join(HERE, "implementations")
TOOLS = ["claude", "codex", "gemini"]
ARMS = [("no rules", "control"), ("prose style", "style"), ("style + code", "code")]
PASSES = re.compile(r"(\d+) pass")


def load_scorer():
    """The analyser is the one definition of every implementation measure."""
    path = os.path.join(HERE, "analyse-implementations.py")
    spec = importlib.util.spec_from_file_location("analyse_implementations", path)
    module = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = ["analyse-implementations.py", "", ""]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = saved
    return module.score


score = load_scorer()


def scored(tool, arm):
    for number in range(1, 11):
        directory = os.path.join(IMPLEMENTATIONS, tool, f"{arm}-{number}")
        implementation = os.path.join(directory, "evaluate.ts")
        if os.path.isfile(implementation):
            yield f"{arm}-{number}", directory, score(implementation)


def report_positions():
    print("\nENTRY POSITION, EVERY RUN SORTED (0.00 is the top of the file)")
    for tool in TOOLS:
        for label, arm in ARMS:
            values = [row["entry"] for _, _, row in scored(tool, arm) if row["entry"] is not None]
            if values:
                shown = ", ".join(f"{value:.2f}" for value in sorted(values))
                print(f"  {tool:7s} {label:13s} median {statistics.median(values):.2f}  {shown}")


def report_shape():
    print("\nFILE SHAPE AND CORRECTNESS, MEDIAN ACROSS TEN RUNS")
    for tool in TOOLS:
        for label, arm in ARMS:
            units, longest, lengths, comments, passed, total = [], [], [], [], 0, 0
            for _, directory, row in scored(tool, arm):
                units.append(row["units"])
                longest.append(row["longest_own"])
                lengths.append(row["length"])
                comments.append(row["comments"])
                tests = os.path.join(directory, "tests.txt")
                if os.path.isfile(tests):
                    total += 1
                    found = PASSES.search(open(tests, encoding="utf-8", errors="replace").read())
                    if found and found.group(1) == "25":
                        passed += 1
            if units:
                with_comments = sum(1 for count in comments if count)
                print(f"  {tool:7s} {label:13s} units {statistics.median(units):5.1f}  "
                      f"longest unit {statistics.median(longest):5.1f}  "
                      f"file lines {statistics.median(lengths):6.1f}  "
                      f"comment lines {sum(comments):3d} across {with_comments:2d} files  "
                      f"25 of 25 in {passed} of {total}")


def report_named_files():
    print("\nTHE FILES THE ARTICLE NAMES")
    for tool, arm, run in [("claude", "control", 8), ("claude", "code", 2)]:
        path = os.path.join(IMPLEMENTATIONS, tool, f"{arm}-{run}", "evaluate.ts")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            lines = handle.read().rstrip("\n").split("\n")
        at = next((i for i, line in enumerate(lines) if line.startswith("export function evaluate")), None)
        if at is not None:
            print(f"  {tool} {arm}-{run}: line {at + 1} of {len(lines)}")


def report_openings():
    print("\nTHE TWO OPENINGS THE ARTICLE SHOWS")
    print("  Counted by measurements/count-review-replies.ts, which pins the parser.")
    print("  Without the rules: 68 words over two sentences of 11 and 57.")
    print("  With them: 15 words in one sentence.")
    print("  Their source is implementations/claude/control-*/reply.md and code-*/reply.md.")


if __name__ == "__main__":
    if not os.path.isdir(IMPLEMENTATIONS):
        sys.exit(f"no implementations found at {IMPLEMENTATIONS}")
    report_positions()
    report_shape()
    report_named_files()
    report_openings()
