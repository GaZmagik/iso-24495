# Pre-registration: does an explicit code section change code structure?

Written 2026-08-20, **before** the runs, so the measures cannot be tuned to the result.

## Question

Adding a code section to the ISO 24495 output style changed how Claude structured a parser in
a three-run pilot. Does that hold at ten runs per arm?

## Arms

All three receive the same `SPEC.md` and the same prompt. User configuration is excluded with
`--setting-sources project`, so the only difference is the `CLAUDE.md` placed in the run directory.

| Arm | CLAUDE.md in the run directory |
|---|---|
| A control | none |
| B style | the shipped output style body, byte for byte |
| C style plus code | the same, plus 19 lines extending the principles to code |

Ten runs per arm, Claude Opus 5, one prompt, one task.

## Primary outcome, fixed now

**WRAPPER, a binary per file.** A file is wrapper-style when **three or more** of its named units
are declared inside the body of another function, that is, as closures, rather than at the top
level or as members of a class.

- A named unit is a function declaration, a class method, or a const arrow function.
- The enclosing scope is found by tracking brace depth and recording whether each open brace was
  opened by a function, a class, or neither.
- A class with many methods is therefore decomposed, not wrapper-style, which is the distinction
  under test.
- Files that fail to parse are recorded as `UNPARSED` and reported, never dropped silently.

The prediction under test: arm C produces fewer wrapper-style files than arms A and B.

**Disclosure: this measure replaced an earlier one, before any of the 30 runs.** The first draft
called a file monolithic when its largest top-level unit spanned 70 per cent of the file. Run
against the three-run pilot it classified a class of ten short methods as monolithic, which is the
opposite of the distinction it was meant to capture. The replacement was validated on the pilot,
where it scores arm A at 2 of 3 wrapper-style, arm B at 2 of 3, and arm C at 0 of 3. Because the
pilot informed the revision, the pilot cannot also be evidence for the result. Only the 30 new runs
count.

## Secondary outcomes, also fixed now

1. **Named units per file.** Top-level functions, top-level arrow constants, and class methods.
2. **Longest unit by own lines**, excluding the lines of units nested inside it.
3. **Comment lines per file.**
4. **Hidden tests passed**, out of 25. Any arm that loses correctness invalidates its result,
   however good its structure looks.

## Rules for reporting

- Every one of the 30 files is counted. A run that produces no code block is reported as a
  failure of that arm, never quietly excluded.
- Ranges are reported alongside medians, because three-run ranges overlapped in the pilot.
- The comparison is descriptive. Ten runs per arm does not license a significance claim.
