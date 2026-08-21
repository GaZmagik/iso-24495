"""Score every arm of a battery: wrapper, units, longest own lines, entry position, tests."""
import io, os, re, statistics, sys

FUNC = re.compile(r"^\s*(?:export\s+)?(?:private |public |protected |static )*(?:function\s+)?"
                  r"([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\{")
CLASS = re.compile(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)")
# The arrow body may be an expression rather than a block. Requiring `=> {` made
# `const peek = (): string => expression.charAt(position);` invisible, and the preregistration
# counts a top-level arrow constant whatever its body.
ARROW = re.compile(r"^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*"
                   r"(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>")
SKIP = {"if", "for", "while", "switch", "catch", "else", "try", "do", "return"}


def logical(lines, index, span=4):
    """One line, extended over the next few until its brackets balance.

    A declaration whose parameters wrap was invisible, because `[^)]*` cannot cross a line
    ending. Four such declarations and two expression arrows were missed across the ninety
    published files. Matching is done against this joined text; brace tracking, line numbers
    and every other measure still use the real lines, so nothing else shifts.
    """
    text = lines[index]
    if text.count("(") <= text.count(")"):
        return text
    for extra in range(1, span + 1):
        if index + extra >= len(lines):
            break
        text += " " + lines[index + extra].strip()
        if text.count("(") <= text.count(")"):
            break
    return text


def score(path):
    lines = io.open(path, encoding="utf-8").read().split("\n")
    stack, units, nested, spans = [], 0, 0, []
    for idx, l in enumerate(lines):
        joined = logical(lines, idx)
        f, c, a = FUNC.match(joined), CLASS.match(l), ARROW.match(joined)
        kind = None
        if c:
            kind = "class"
        elif (f and f.group(1) not in SKIP) or a:
            kind = "function"; units += 1; spans.append(idx)
            if next((k for k in reversed(stack) if k in ("function", "class")), None) == "function":
                nested += 1
        for i in range(l.count("{")):
            stack.append(kind if i == 0 and kind else "other")
        for _ in range(l.count("}")):
            if stack: stack.pop()

    def total(i):
        d = 0
        for j in range(i, len(lines)):
            d += lines[j].count("{") - lines[j].count("}")
            if d <= 0 and j > i: return j - i + 1
        return len(lines) - i
    own = [max(1, total(i) - sum(total(j) for j in spans if i < j < i + total(i))) for i in spans]
    entry = next((i for i, l in enumerate(lines) if re.match(r"^export function evaluate", l)), None)
    return dict(wrapper=nested >= 3, units=units,
                longest_own=max(own) if own else 0,
                entry=None if entry is None else entry / max(1, len(lines)),
                # The article quotes a file-length median, so it is measured here rather than
                # counted a second way somewhere else and quietly disagreeing. A file ending in
                # a newline splits into one more element than it has lines, which is why this
                # drops a trailing empty one. The `entry` ratio above keeps the original
                # denominator: correcting it would silently move every published position, and
                # the difference is under a hundredth.
                length=len(lines) - (1 if lines and lines[-1] == "" else 0),
                comments=len([l for l in lines if re.match(r"^\s*(//|/\*|\*)", l)]))


def main(base, label):
    arms = [("A control", "control"), ("B style", "style"),
            ("C code rules", "code"), ("D + iso-5055", "skills")]
    print(f"\n===== {label} =====")
    print(f"{'arm':14s} {'n':>3s} {'wrapper':>8s} {'units':>12s} {'longest own':>13s} "
          f"{'entry pos':>12s} {'comments':>9s} {'25/25':>7s}")
    for name, key in arms:
        rows = []
        for i in range(1, 11):
            p = os.path.join(base, f"{key}-{i}", "evaluate.ts")
            if not os.path.exists(p): continue
            r = score(p)
            t = os.path.join(base, f"{key}-{i}", "tests.txt")
            m = re.search(r"(\d+) pass", io.open(t, encoding="utf-8", errors="ignore").read()) if os.path.exists(t) else None
            r["tests"] = int(m.group(1)) if m else 0
            rows.append(r)
        if not rows:
            print(f"{name:14s}   0   (no files)"); continue
        u = [r["units"] for r in rows]; lo = [r["longest_own"] for r in rows]
        ent = [r["entry"] for r in rows if r["entry"] is not None]
        print(f"{name:14s} {len(rows):3d} {f'{sum(1 for r in rows if r['wrapper'])}/{len(rows)}':>8s} "
              f"{f'{statistics.median(u):.0f} [{min(u)}-{max(u)}]':>12s} "
              f"{f'{statistics.median(lo):.0f} [{min(lo)}-{max(lo)}]':>13s} "
              f"{(f'{statistics.median(ent):.2f}' if ent else 'n/a'):>12s} "
              f"{statistics.median([r['comments'] for r in rows]):9.0f} "
              f"{f'{sum(1 for r in rows if r['tests']==25)}/{len(rows)}':>7s}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
