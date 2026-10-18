// The part of the CommonMark reference implementation that build-fixture.ts
// uses, declared by hand.
//
// The package is deliberately not installed: the fixture is rebuilt outside
// this repository, and the README says the reference is not a dependency. So
// the type check has no package to read, and without this file it stops at
// the import. Leaving build-fixture.ts out of the type check instead would
// also leave its imports from the engine unchecked.
//
// Nothing here was checked against the package. It records what the script
// reads, and a mistake shows when the fixture is next rebuilt.
declare module "commonmark" {
  /** One node of a parsed document. */
  export interface Node {
    /** The kind of node, such as "paragraph", "heading", "text" or "code". */
    type: string;
    /** The depth of a heading, from 1 to 6. */
    level: number;
    /** The text of a text or code node, and null for a node that holds none. */
    literal: string | null;
    /** A walker that visits this node and everything below it. */
    walker(): NodeWalker;
  }

  /** Visits each node of a tree, once on the way in and once on the way out. */
  export interface NodeWalker {
    /** The next step of the walk, or null when the walk is over. */
    next(): { node: Node; entering: boolean } | null;
  }

  /** Parses Markdown as the CommonMark specification describes it. */
  export class Parser {
    /** The root node of the document parsed from `markdown`. */
    parse(markdown: string): Node;
  }
}
