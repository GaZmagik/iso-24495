# Comparing this parser with the CommonMark reference

`../fixtures/reference-blocks.ts` records how this engine reads a corpus of
documents, and how many of them the CommonMark reference implementation reads
the same way. These two scripts are what produced it, so the claim can be
checked rather than believed.

The reference is not a dependency of this project. Install it outside the
repository, run the scripts, and read the counts:

```sh
mkdir /tmp/cmark && cd /tmp/cmark
bun add commonmark
bun /path/to/skills/iso-24495-4/tests/reference/build-shapes.ts
bun /path/to/skills/iso-24495-4/tests/reference/build-generated.ts
```

`build-shapes.ts` walks a matrix: every container prefix the engine claims to
understand, applied to every leaf block it claims to find, and the transitions
between them. `build-generated.ts` builds documents from a grammar of lines
with a seeded generator, so the corpus holds shapes nobody chose.

Each script prints how many documents agree, how many diverge for a documented
reason, and how many differ for no reason at all. **The last number must be
zero.** A difference with no reason is either a defect in the engine or a
divergence that has not been thought about.

One adjustment makes the comparison meaningful. The reference renders inline
markup, while this engine keeps the source, because its rules read link syntax
and code spans. The scripts flatten ours before comparing. Without that, 153
documents looked like disagreements and every one was the comparison's fault.
