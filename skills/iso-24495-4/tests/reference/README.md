# Comparing this parser with the CommonMark reference

`../fixtures/reference-blocks.ts` records how this engine reads a corpus of documents, and how many of them the CommonMark reference implementation reads the same way. `build-fixture.ts` produced it, so the claim can be checked rather than believed.

The reference is not a dependency of this project. Install it outside the repository and run one command:

```sh
mkdir /tmp/cmark && cd /tmp/cmark
bun add commonmark
bun /path/to/skills/iso-24495-4/tests/reference/build-fixture.ts
```

It prints the counts and rewrites the fixture in place. Nothing else is needed, and no intermediate file has to exist first.

`shapes.ts` holds the corpus, in two parts. One is a matrix: every container prefix the engine claims to understand, applied to every leaf block it claims to find, and the transitions between them. The other is built from a grammar of lines by a seeded generator, so the corpus holds shapes nobody chose. The seed is fixed, so the corpus is the same every time.

**A difference the engine cannot explain stops the run.** `reasonFor` decides whether this engine reads a document differently on purpose. It decides from what the document contains, not from a word in its name. An earlier version classified by name, which would have let an unrelated defect wear an unrelated excuse.

One adjustment makes the comparison meaningful. The reference renders inline markup, while this engine keeps the source, because its rules read link syntax and code spans. The comparison flattens ours. Without that, 153 documents looked like disagreements and every one was the comparison's fault.

## Image titles

`build-image-titles.ts` records how the reference shows the one image in each document of `../fixtures/image-title-documents.ts`, in `../fixtures/image-title-renderings.ts`. `../image-title-renderer.test.ts` holds the image-alt rule against that record and against Bun's renderer. Install the reference outside the repository as above, then tell Bun where it is:

```sh
NODE_PATH="$PWD/node_modules" bun /path/to/skills/iso-24495-4/tests/reference/build-image-titles.ts
```

## The HTML text record

`../fixtures/html-text-renderings.ts` records whether the reference shows the value of each document in `../fixtures/html-text-documents.ts` whole: 154,906 documents, built from every ordered pair of a list of markup fragments in a range of blocks and containers, with 20,000 seeded random compositions beside them. commonmark.js renders each document and parse5, an HTML tree builder, builds the page a browser would. `../lib/html-text.test.ts` requires the value search's reading of HTML text to hold every value the record shows.

Install both outside the repository, then tell Bun where they are:

```sh
mkdir /tmp/html-text-ref && cd /tmp/html-text-ref
bun add commonmark@0.31.2 parse5@7.3.0
NODE_PATH="$PWD/node_modules" bun /path/to/skills/iso-24495-4/tests/reference/build-html-text.ts
```

## The plan pin

`../fixtures/plan-pin.ts` records what `planDocument` makes of 348 documents: the specimens in `../fixtures/plan-specimens.ts` and the 302 documents of `../fixtures/reference-blocks.ts`. For each it holds a digest of the whole plan, and the state of every Jev request in it. A test in `../lib/jev/engine.test.ts` fails when the two disagree. It needs no calibration file, so it runs in the gate, unlike the calibration tests beside it.

`build-plan-pin.ts` rewrites the record, and needs nothing installed:

```sh
bun skills/iso-24495-4/tests/reference/build-plan-pin.ts
```

Run it only for a change meant to alter a Jev request. A parser edit for an offline rule should leave the record as it is.
