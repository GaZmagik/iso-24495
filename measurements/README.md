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
| `PREREGISTRATION.md` | What was to be measured, written before the runs |
| `SPEC.md` | The expression-evaluator task given to each model |
| `hidden.test.ts` | The 25 tests the models never saw |
| `review-replies/` | Six replies about one buggy React component, three per arm |
| `implementations/` | Ninety implementations with their test output, thirty per tool |

## Running them

From the repository root:

```
bun measurements/count-review-replies.ts
python measurements/analyse-implementations.py measurements/implementations/claude Claude
```

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

Nothing else was edited. Several implementations would fail this repository's own style checks,
and the `code-8` run in the Claude arm replaced an earlier attempt that produced no code at all.
Both facts are in the article.
