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
difference between the arms" is checkable rather than asserted:

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
```

Between them the first two print every figure the article quotes.

`article-figures.py` scores each run with `analyse-implementations.py`'s own `score` rather than
measuring anything itself. A second definition of "named unit" would disagree with the article
by a little. A script that reads as a check while contradicting what it checks is worse than no
script at all.

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
