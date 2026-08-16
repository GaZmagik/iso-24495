# Comparing this parser with the CommonMark reference

`../fixtures/reference-blocks.ts` records how this engine reads a corpus of
documents, and how many of them the CommonMark reference implementation reads
the same way. `build-fixture.ts` produced it, so the claim can be checked
rather than believed.

The reference is not a dependency of this project. Install it outside the
repository and run one command:

```sh
mkdir /tmp/cmark && cd /tmp/cmark
bun add commonmark
bun /path/to/skills/iso-24495-4/tests/reference/build-fixture.ts
```

It prints the counts and rewrites the fixture in place. Nothing else is
needed, and no intermediate file has to exist first.

`shapes.ts` holds the corpus, in two parts. One is a matrix: every container
prefix the engine claims to understand, applied to every leaf block it claims
to find, and the transitions between them. The other is built from a grammar
of lines by a seeded generator, so the corpus holds shapes nobody chose. The
seed is fixed, so the corpus is the same every time.

**A difference the engine cannot explain stops the run.** `reasonFor` decides
whether this engine reads a document differently on purpose. It decides from
what the document contains, not from a word in its name. An earlier version
classified by name, which would have let an unrelated defect wear an
unrelated excuse.

One adjustment makes the comparison meaningful. The reference renders inline
markup, while this engine keeps the source, because its rules read link syntax
and code spans. The comparison flattens ours. Without that, 153 documents
looked like disagreements and every one was the comparison's fault.
