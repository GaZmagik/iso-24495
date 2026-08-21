"""Print every figure the article quotes about the implementations, from the published data.

Run it from the repository root:

    python measurements/article-figures.py

The prose counts come from count-review-replies.ts, which pins the parser and the replies by
content. This script prints everything else: the entry positions, the unit and length medians,
the comment counts, the test totals, and the files the article names.

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


def report_positions_by_run():
    """Every Claude run named beside its entry position, sorted.

    report_positions sorts the values and drops the run names, so its output can show that a 0.21
    and a 0.11 exist without showing which runs produced them. The article names both: code-8 as
    the run nearest the boundary, and control-7 as the earliest control. code-8 is also the
    disclosed rerun, so a mistaken identity there would misreport the deviation itself.
    """
    print("\nCLAUDE ENTRY POSITION, EVERY RUN NAMED AND SORTED")
    for label, arm in ARMS:
        rows = [(row["entry"], name) for name, _, row in scored("claude", arm)
                if row["entry"] is not None]
        if not rows:
            continue
        # Three decimals, because control-7 and control-3 are both 0.11 at two, and the
        # article claims control-7 is strictly the earliest.
        shown = ", ".join(f"{name} {value:.3f}" for value, name in sorted(rows))
        print(f"  {label:13s} {shown}")


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


def report_across_arms():
    """The cross-tool figures the article quotes in prose, over all thirty files of a tool.

    Every other report here is per arm, so the aggregates the article uses when it compares one
    tool with another could not be produced from this script at all. A reader had to take them on
    trust, which is the fault this file exists to remove. The Gemini median is 64.5 rather than 65
    because its middle two values are 64 and 65.
    """
    print("\nACROSS ALL THIRTY FILES OF EACH TOOL")
    for tool in TOOLS:
        longest, comments = [], []
        for _, arm in ARMS:
            for _, _, row in scored(tool, arm):
                longest.append(row["longest_own"])
                comments.append(row["comments"])
        if not longest:
            continue
        with_comments = sum(1 for count in comments if count)
        print(f"  {tool:7s} {len(longest):2d} files  "
              f"longest own unit {summarise(longest):18s}  "
              f"comment lines {sum(comments):3d} across {with_comments:2d} files, "
              f"median {statistics.median(comments):g}")


def report_named_files():
    print("\nTHE FILES THE ARTICLE NAMES")
    # control-7 is the run the code figure shows, so its line number is printed here too.
    for tool, arm, run in [("claude", "control", 7), ("claude", "control", 8), ("claude", "code", 2)]:
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
    print("  Measured by count-review-replies.ts, which holds the parser this project uses.")
    print("  Run: bun measurements/count-review-replies.ts")


def summarise(values):
    """A median with its range beside it, which the preregistration requires.

    The parentheses match the table the article already prints, so a reader comparing the two
    sees the same string rather than the same number in a different dress.
    """
    median = statistics.median(values)
    shown = f"{median:.1f}".rstrip("0").rstrip(".")
    return f"{shown} ({min(values)} to {max(values)})"


def report_preregistered():
    """The preregistered outcomes, all three arms, with the ranges the medians need.

    The five are wrapper structure as the primary outcome, then named units, longest own unit,
    comment lines and hidden tests. File length is printed below them and marked, because it is
    not one of them: a table that mixes the two silently turns an exploratory measure into a
    confirmatory one.

    The report_shape summary above rounds its medians and prints comment lines as a total, so
    neither it nor the analyser could produce the exact figures the article quotes. A median
    without its range also makes overlapping distributions look separated, which is the thing
    the range exists to prevent: named units run 9 to 15 in two of the three arms.
    """
    print("\nPREREGISTERED OUTCOMES, CLAUDE, MEDIAN (RANGE) ACROSS TEN RUNS")
    measures = [("named units", "units"), ("longest own unit", "longest_own"),
                ("comment lines", "comments")]
    columns = {}
    for label, arm in ARMS:
        rows = list(scored("claude", arm))
        if not rows:
            continue
        scores = [row for _, _, row in rows]
        column = {"wrapper files (primary)": f"{sum(1 for r in scores if r['wrapper'])} of 10"}
        for name, key in measures:
            column[name] = summarise([row[key] for row in scores])
        passed = 0
        for _, directory, _ in rows:
            tests = os.path.join(directory, "tests.txt")
            if os.path.isfile(tests):
                found = PASSES.search(open(tests, encoding="utf-8", errors="replace").read())
                if found and found.group(1) == "25":
                    passed += 1
        column["passed 25 of 25"] = f"{passed} of {len(rows)}"
        column["file lines (not preregistered)"] = summarise([row["length"] for row in scores])
        columns[label] = column
    if not columns:
        return
    labels = [label for label, _ in ARMS if label in columns]
    order = (["wrapper files (primary)"] + [name for name, _ in measures]
             + ["passed 25 of 25", "file lines (not preregistered)"])
    print(f"  {'outcome':31s}" + "".join(f"{label:>20s}" for label in labels))
    for name in order:
        print(f"  {name:31s}" + "".join(f"{columns[label][name]:>20s}" for label in labels))


if __name__ == "__main__":
    if not os.path.isdir(IMPLEMENTATIONS):
        sys.exit(f"no implementations found at {IMPLEMENTATIONS}")
    report_positions()
    report_positions_by_run()
    report_shape()
    report_preregistered()
    report_across_arms()
    report_named_files()
    report_openings()
