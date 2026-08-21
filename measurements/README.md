# Measurements

The evidence behind the article about what this plugin does to a coding agent. It is here so a
reader can check the figures rather than take them on trust, which is the whole point.

Every number in that article was wrong at least once. An adversarial review recounted them from
these files and found figures no script could reproduce, so the scripts are now published beside
the data they read.

## What is here

| Path | What it holds |
|---|---|
| `count-review-replies.ts` | Counts the prose in the six code-review replies |
| `analyse-implementations.py` | Scores the ninety implementations |
| `article-figures.py` | Prints every implementation figure the article quotes |
| `rerun-tests.sh` | Reruns the 25 hidden tests against all ninety implementations |
| `rerun-tests.txt` | What that rerun printed |
| `superseded/` | The earlier draft of the article, the one its corrections are about |
| `PREREGISTRATION.md` | What was to be measured, written before the runs |
| `task/` | The specification given to each model, and the 25 tests it never saw |
| `instructions/` | The two instruction files, one per treated arm |
| `runners/` | The three batteries as run, one per tool, including the exact prompt |
| `run.log` | What the battery recorded as it went, including the one failure |
| `review-replies/` | Six replies about one buggy React component, three per arm |
| `implementations/` | Ninety replies, implementations and test outputs, thirty per tool |

## The instruction files are the whole treatment

`instructions/style.md` went to the `style` arm and `instructions/style-and-code.md` to the
`code` arm. The `control` arm received no instruction file at all.

Every tool received the same two files, byte for byte, so "the instruction file was the only
difference between the arms" is checkable rather than asserted.

`instructions/per-run.txt` lists what each of the ninety runs received. It comes to a clean
three-way split: thirty runs with no instruction file, thirty with the style, and thirty with
the style and the code rules.

```
4d5ca09ebf34fd0a1ecbc198b8844a4a2e2213a94a88edac3acc9218826f223b  instructions/style.md
f44cc2379f604526dfb547f08a63af789c9955d97eed45cfe901e953292143e2  instructions/style-and-code.md
```

`runners/` shows how they were placed and what each model was asked, one script per tool.

**Those scripts are a record, not a recipe.** They carry the paths the batteries actually used,
with the home directory replaced, and they will not run here. An earlier version of this
directory rewrote those paths to look runnable, which pointed a `rm -rf` at the published
evidence: following the instructions would have deleted it. A record of what happened is more
use than a script that looks runnable and is not.

## Running them

From the repository root:

```
bun measurements/count-review-replies.ts
python measurements/article-figures.py
python measurements/analyse-implementations.py measurements/implementations/claude Claude
bash measurements/rerun-tests.sh
```

Between them the first two print every measured figure the article quotes. Four kinds of claim
are checked another way, and saying so is the point:

- **The hidden tests.** `bash measurements/rerun-tests.sh` reruns all 25 tests against all ninety
  published implementations and prints how many passed. `rerun-tests.txt` holds its output.
- **The code extracts.** The ten-line and eight-line functions in the article's code figure are
  read from `implementations/claude/control-7` and `code-2`, which are published whole.
- **The earlier draft.** The article confesses to getting several figures wrong: 52 per cent, and
  the counts 513, 417, 35 and 26. Those come from `superseded/medium-post-v1.md`, kept here so a
  reader can see the version being corrected rather than take the correction on trust.
- **The judgements about the reviews.** That all six replies found three named bugs, and that the
  shorter reply drops four minor observations, are readings rather than measurements. No script
  produces them. The six replies are in `review-replies/`, so a reader can disagree with me.

`article-figures.py` prints the preregistered outcomes as a three-arm table, with the range beside
every median. It was extended to do that after a reviewer found the article reporting medians
alone, and never reporting the primary outcome at all. The third command summarises one arm and
rounds its medians, so it is the wrong place to check a figure like 26.5.

`article-figures.py` scores each run with `analyse-implementations.py`'s own `score` rather than
measuring anything itself. A second definition of "named unit" would disagree with the article
by a little. A script that reads as a check while contradicting what it checks is worse than no
script at all.

## What "named unit" was taken to mean

The preregistration says "top-level functions, top-level arrow constants, and class methods". Two
readings of that were left to the code until a reviewer asked, so they are written down here.

- **A constructor counts as a class method.** It is a named member of the class and the wording
  does not exclude it. Excluding it would take one unit off every file that has one, which is most
  of them, and would not change any comparison.
- **An arrow constant counts whether its body is a block or an expression**, and a declaration
  counts whether or not its parameters fit on one line.

Those last two were not decisions at first. They were blind spots: the scorer matched one line at
a time, so `const peek = (): string => text.charAt(at);` and any declaration whose parameters
wrapped were invisible. Ten units across six of the ninety files went uncounted.

Correcting it left the primary outcome untouched, at 3, 3 and 1 wrapper files. Four other figures
moved. The prose-style median for named units went from 12.5 to 13, and that arm's longest own
unit from 27 to 26.5. Two range floors rose by one.

`tests/scorer.test.ts` now holds the scorer to these definitions on hand-counted fixtures, one per
construct. It runs in the repository gate. It cannot prove the hand counts match what the
preregistration meant, which is why the readings above are stated rather than left implied.

One wart is worth knowing. The entry-position ratio divides by a line count that includes the
empty element a trailing newline produces, so it is a hundredth or so low. It is left alone
because correcting it after seeing the results would move every published position, and the
file-length median beside it uses the true count.

The counting script refuses to run against a different engine or a changed reply. It hashes
`parse.ts`, `lexicon.ts` and `types.ts`, and the six replies, before it reads anything. Two
earlier versions of that check were defeated in review: one named a version rather than a file,
and one hashed a different path from the one it imported.

## The three arms

Each tool ran the same task ten times under three conditions:

- `control`: no instruction file.
- `style`: the plugin's writing skills.
- `code`: the writing skills plus the code rules that became `iso-24495-code`.

A fourth arm added a draft ISO 5055 skill. It is not published here and no figure in the article
comes from it. I once read it as the `style` arm by mistake and drew a reversed conclusion, which
is the sort of thing publishing the data makes findable.

## What was changed, and what was not

The replies and implementations are verbatim model output. One change was made: in some replies a
model wrote its own absolute working directory into a link, so that prefix is now relative. The
counts are identical before and after, because the engine reads a link's label rather than its
destination.

A tool also echoed its own working directory into some transcripts, and those prefixes are
relative or `<home>` now. Nothing a model said about the code was touched.

Nothing else was edited. Several implementations would fail this repository's own style checks.

## The run that failed

`run.log` line 32 records it:

```
17:38:58  code-8  NO CODE BLOCK
```

The preregistration says such a run is a failure of its arm rather than something to drop
quietly, so it is here rather than tidied away. That run was repeated and the repeat is the
`code-8` file published above. It is also the run nearest the boundary in the article's entry
position figures, so the one result that had to be redone is the weakest of its ten.

The original failing reply was overwritten by the repeat and is not recoverable. The log entry
is the only record of it, which is a weakness of how the battery was written.
