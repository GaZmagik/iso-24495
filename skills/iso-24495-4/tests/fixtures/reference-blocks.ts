// Block structure for 265 documents, checked against the CommonMark reference
// implementation on 2026-08-16.
//
// Two corpora. The first is a matrix: every container prefix the engine claims
// to understand, applied to every leaf block it claims to find, and the
// transitions between them. The second is generated from a grammar of lines by
// a seeded builder, so it holds shapes nobody thought to choose. Across 486
// generated documents there were no differences beyond the documented ones.
//
// The reference is not a dependency. It was installed outside the repository,
// asked once, and its answers compared. Regenerate the same way when adding a
// shape, and never edit an expectation by hand to make a test pass: an
// expectation that disagrees with the reference needs a reason, and every one
// that has a reason carries it in `differsFromReference`.
//
// Comparing the two needs one adjustment: the reference renders inline markup
// while this engine keeps the source, because its rules read link syntax and
// code spans. The comparison flattens ours; these expectations are the source.
//
// The 22 documented divergences are decisions about a reader rather than about
// Markdown: tables, HTML, front matter, alert labels and task markers.

export interface ReferenceShape {
  name: string;
  lines: string[];
  paragraphs: string[];
  headings: Array<[number, string]>;
  /** Why this engine reads the document differently from CommonMark core. */
  differsFromReference?: string;
}

export const REFERENCE_SHAPES: ReferenceShape[] = [
  {
    "name": "margin / paragraph",
    "lines": [
      "One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "margin / two sentences",
    "lines": [
      "One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "margin / wrapped",
    "lines": [
      "One line",
      "second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "margin / atx",
    "lines": [
      "# Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "margin / atx deep",
    "lines": [
      "#### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "margin / setext",
    "lines": [
      "Heading text",
      "==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "margin / setext dash",
    "lines": [
      "Heading text",
      "---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "margin / fence",
    "lines": [
      "```",
      "code",
      "```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "margin / fence tilde",
    "lines": [
      "~~~",
      "code",
      "~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "margin / unclosed fence",
    "lines": [
      "```",
      "code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "margin / break",
    "lines": [
      "***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "margin / table",
    "lines": [
      "| A | B |",
      "|---|---|",
      "| x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "margin / pipeless table",
    "lines": [
      "A | B",
      "---|---",
      "x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "margin / two paragraphs",
    "lines": [
      "One.",
      "",
      "Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "margin / after break",
    "lines": [
      "One.",
      "",
      "***",
      "",
      "Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "bullet / paragraph",
    "lines": [
      "- One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "bullet / two sentences",
    "lines": [
      "- One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "bullet / wrapped",
    "lines": [
      "- One line",
      "  second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "bullet / atx",
    "lines": [
      "- # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "bullet / atx deep",
    "lines": [
      "- #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "bullet / setext",
    "lines": [
      "- Heading text",
      "  ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "bullet / setext dash",
    "lines": [
      "- Heading text",
      "  ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "bullet / fence",
    "lines": [
      "- ```",
      "  code",
      "  ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet / fence tilde",
    "lines": [
      "- ~~~",
      "  code",
      "  ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet / unclosed fence",
    "lines": [
      "- ```",
      "  code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet / break",
    "lines": [
      "- ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet / table",
    "lines": [
      "- | A | B |",
      "  |---|---|",
      "  | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "bullet / pipeless table",
    "lines": [
      "- A | B",
      "  ---|---",
      "  x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "bullet / two paragraphs",
    "lines": [
      "- One.",
      "  ",
      "  Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "bullet / after break",
    "lines": [
      "- One.",
      "  ",
      "  ***",
      "  ",
      "  Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "ordered / paragraph",
    "lines": [
      "1. One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "ordered / two sentences",
    "lines": [
      "1. One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "ordered / wrapped",
    "lines": [
      "1. One line",
      "   second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "ordered / atx",
    "lines": [
      "1. # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "ordered / atx deep",
    "lines": [
      "1. #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "ordered / setext",
    "lines": [
      "1. Heading text",
      "   ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "ordered / setext dash",
    "lines": [
      "1. Heading text",
      "   ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "ordered / fence",
    "lines": [
      "1. ```",
      "   code",
      "   ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "ordered / fence tilde",
    "lines": [
      "1. ~~~",
      "   code",
      "   ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "ordered / unclosed fence",
    "lines": [
      "1. ```",
      "   code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "ordered / break",
    "lines": [
      "1. ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "ordered / table",
    "lines": [
      "1. | A | B |",
      "   |---|---|",
      "   | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "ordered / pipeless table",
    "lines": [
      "1. A | B",
      "   ---|---",
      "   x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "ordered / two paragraphs",
    "lines": [
      "1. One.",
      "   ",
      "   Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "ordered / after break",
    "lines": [
      "1. One.",
      "   ",
      "   ***",
      "   ",
      "   Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "quote / paragraph",
    "lines": [
      "> One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "quote / two sentences",
    "lines": [
      "> One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "quote / wrapped",
    "lines": [
      "> One line",
      "> second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "quote / atx",
    "lines": [
      "> # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "quote / atx deep",
    "lines": [
      "> #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "quote / setext",
    "lines": [
      "> Heading text",
      "> ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "quote / setext dash",
    "lines": [
      "> Heading text",
      "> ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "quote / fence",
    "lines": [
      "> ```",
      "> code",
      "> ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote / fence tilde",
    "lines": [
      "> ~~~",
      "> code",
      "> ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote / unclosed fence",
    "lines": [
      "> ```",
      "> code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote / break",
    "lines": [
      "> ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote / table",
    "lines": [
      "> | A | B |",
      "> |---|---|",
      "> | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "quote / pipeless table",
    "lines": [
      "> A | B",
      "> ---|---",
      "> x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "quote / two paragraphs",
    "lines": [
      "> One.",
      "> ",
      "> Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "quote / after break",
    "lines": [
      "> One.",
      "> ",
      "> ***",
      "> ",
      "> Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "quote in bullet / paragraph",
    "lines": [
      "- > One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "quote in bullet / two sentences",
    "lines": [
      "- > One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "quote in bullet / wrapped",
    "lines": [
      "- > One line",
      "  > second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "quote in bullet / atx",
    "lines": [
      "- > # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "quote in bullet / atx deep",
    "lines": [
      "- > #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "quote in bullet / setext",
    "lines": [
      "- > Heading text",
      "  > ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "quote in bullet / setext dash",
    "lines": [
      "- > Heading text",
      "  > ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "quote in bullet / fence",
    "lines": [
      "- > ```",
      "  > code",
      "  > ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote in bullet / fence tilde",
    "lines": [
      "- > ~~~",
      "  > code",
      "  > ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote in bullet / unclosed fence",
    "lines": [
      "- > ```",
      "  > code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote in bullet / break",
    "lines": [
      "- > ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote in bullet / table",
    "lines": [
      "- > | A | B |",
      "  > |---|---|",
      "  > | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "quote in bullet / pipeless table",
    "lines": [
      "- > A | B",
      "  > ---|---",
      "  > x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "quote in bullet / two paragraphs",
    "lines": [
      "- > One.",
      "  > ",
      "  > Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "quote in bullet / after break",
    "lines": [
      "- > One.",
      "  > ",
      "  > ***",
      "  > ",
      "  > Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "bullet in quote / paragraph",
    "lines": [
      "> - One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "bullet in quote / two sentences",
    "lines": [
      "> - One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "bullet in quote / wrapped",
    "lines": [
      "> - One line",
      ">   second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "bullet in quote / atx",
    "lines": [
      "> - # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "bullet in quote / atx deep",
    "lines": [
      "> - #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "bullet in quote / setext",
    "lines": [
      "> - Heading text",
      ">   ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "bullet in quote / setext dash",
    "lines": [
      "> - Heading text",
      ">   ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "bullet in quote / fence",
    "lines": [
      "> - ```",
      ">   code",
      ">   ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet in quote / fence tilde",
    "lines": [
      "> - ~~~",
      ">   code",
      ">   ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet in quote / unclosed fence",
    "lines": [
      "> - ```",
      ">   code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet in quote / break",
    "lines": [
      "> - ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "bullet in quote / table",
    "lines": [
      "> - | A | B |",
      ">   |---|---|",
      ">   | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "bullet in quote / pipeless table",
    "lines": [
      "> - A | B",
      ">   ---|---",
      ">   x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "bullet in quote / two paragraphs",
    "lines": [
      "> - One.",
      ">   ",
      ">   Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "bullet in quote / after break",
    "lines": [
      "> - One.",
      ">   ",
      ">   ***",
      ">   ",
      ">   Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "nested bullets / paragraph",
    "lines": [
      "- - One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "nested bullets / two sentences",
    "lines": [
      "- - One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "nested bullets / wrapped",
    "lines": [
      "- - One line",
      "    second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "nested bullets / atx",
    "lines": [
      "- - # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "nested bullets / atx deep",
    "lines": [
      "- - #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "nested bullets / setext",
    "lines": [
      "- - Heading text",
      "    ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "nested bullets / setext dash",
    "lines": [
      "- - Heading text",
      "    ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "nested bullets / fence",
    "lines": [
      "- - ```",
      "    code",
      "    ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "nested bullets / fence tilde",
    "lines": [
      "- - ~~~",
      "    code",
      "    ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "nested bullets / unclosed fence",
    "lines": [
      "- - ```",
      "    code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "nested bullets / break",
    "lines": [
      "- - ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "nested bullets / table",
    "lines": [
      "- - | A | B |",
      "    |---|---|",
      "    | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "nested bullets / pipeless table",
    "lines": [
      "- - A | B",
      "    ---|---",
      "    x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "nested bullets / two paragraphs",
    "lines": [
      "- - One.",
      "    ",
      "    Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "nested bullets / after break",
    "lines": [
      "- - One.",
      "    ",
      "    ***",
      "    ",
      "    Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "deep quote / paragraph",
    "lines": [
      "> > One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "deep quote / two sentences",
    "lines": [
      "> > One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "deep quote / wrapped",
    "lines": [
      "> > One line",
      "> > second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "deep quote / atx",
    "lines": [
      "> > # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "deep quote / atx deep",
    "lines": [
      "> > #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "deep quote / setext",
    "lines": [
      "> > Heading text",
      "> > ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "deep quote / setext dash",
    "lines": [
      "> > Heading text",
      "> > ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "deep quote / fence",
    "lines": [
      "> > ```",
      "> > code",
      "> > ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "deep quote / fence tilde",
    "lines": [
      "> > ~~~",
      "> > code",
      "> > ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "deep quote / unclosed fence",
    "lines": [
      "> > ```",
      "> > code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "deep quote / break",
    "lines": [
      "> > ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "deep quote / table",
    "lines": [
      "> > | A | B |",
      "> > |---|---|",
      "> > | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "deep quote / pipeless table",
    "lines": [
      "> > A | B",
      "> > ---|---",
      "> > x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "deep quote / two paragraphs",
    "lines": [
      "> > One.",
      "> > ",
      "> > Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "deep quote / after break",
    "lines": [
      "> > One.",
      "> > ",
      "> > ***",
      "> > ",
      "> > Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "quote bullet quote / paragraph",
    "lines": [
      "> - > One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "quote bullet quote / two sentences",
    "lines": [
      "> - > One. Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "quote bullet quote / wrapped",
    "lines": [
      "> - > One line",
      ">   > second line."
    ],
    "paragraphs": [
      "One line second line."
    ],
    "headings": []
  },
  {
    "name": "quote bullet quote / atx",
    "lines": [
      "> - > # Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "quote bullet quote / atx deep",
    "lines": [
      "> - > #### Heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        4,
        "Heading"
      ]
    ]
  },
  {
    "name": "quote bullet quote / setext",
    "lines": [
      "> - > Heading text",
      ">   > ==="
    ],
    "paragraphs": [],
    "headings": [
      [
        1,
        "Heading text"
      ]
    ]
  },
  {
    "name": "quote bullet quote / setext dash",
    "lines": [
      "> - > Heading text",
      ">   > ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading text"
      ]
    ]
  },
  {
    "name": "quote bullet quote / fence",
    "lines": [
      "> - > ```",
      ">   > code",
      ">   > ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote bullet quote / fence tilde",
    "lines": [
      "> - > ~~~",
      ">   > code",
      ">   > ~~~"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote bullet quote / unclosed fence",
    "lines": [
      "> - > ```",
      ">   > code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote bullet quote / break",
    "lines": [
      "> - > ***"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "quote bullet quote / table",
    "lines": [
      "> - > | A | B |",
      ">   > |---|---|",
      ">   > | x | y |"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "quote bullet quote / pipeless table",
    "lines": [
      "> - > A | B",
      ">   > ---|---",
      ">   > x | y"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "quote bullet quote / two paragraphs",
    "lines": [
      "> - > One.",
      ">   > ",
      ">   > Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "quote bullet quote / after break",
    "lines": [
      "> - > One.",
      ">   > ",
      ">   > ***",
      ">   > ",
      ">   > Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "lazy after bullet",
    "lines": [
      "- One.",
      "Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "lazy after quote",
    "lines": [
      "> One.",
      "Two."
    ],
    "paragraphs": [
      "One. Two."
    ],
    "headings": []
  },
  {
    "name": "lazy after nested",
    "lines": [
      "- A.",
      "  - B.",
      "  C."
    ],
    "paragraphs": [
      "A.",
      "B. C."
    ],
    "headings": []
  },
  {
    "name": "outdent to sibling",
    "lines": [
      "- A.",
      "  - B.",
      "- C."
    ],
    "paragraphs": [
      "A.",
      "B.",
      "C."
    ],
    "headings": []
  },
  {
    "name": "blank then item content",
    "lines": [
      "- A.",
      "",
      "  B."
    ],
    "paragraphs": [
      "A.",
      "B."
    ],
    "headings": []
  },
  {
    "name": "blank then margin",
    "lines": [
      "- A.",
      "",
      "B."
    ],
    "paragraphs": [
      "A.",
      "B."
    ],
    "headings": []
  },
  {
    "name": "item then heading",
    "lines": [
      "- A.",
      "# Heading"
    ],
    "paragraphs": [
      "A."
    ],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "quote then heading",
    "lines": [
      "> A.",
      "# Heading"
    ],
    "paragraphs": [
      "A."
    ],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "heading then item",
    "lines": [
      "# Heading",
      "- A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": [
      [
        1,
        "Heading"
      ]
    ]
  },
  {
    "name": "fence then item",
    "lines": [
      "```",
      "code",
      "```",
      "- A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": []
  },
  {
    "name": "item holding fence",
    "lines": [
      "- A:",
      "",
      "  ```",
      "  code",
      "  ```",
      "",
      "  B."
    ],
    "paragraphs": [
      "A:",
      "B."
    ],
    "headings": []
  },
  {
    "name": "item holding table",
    "lines": [
      "- A:",
      "",
      "  | A | B |",
      "  |---|---|",
      "  | x | y |",
      "",
      "  B."
    ],
    "paragraphs": [
      "A:",
      "B."
    ],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "tab item",
    "lines": [
      "-\tA."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": []
  },
  {
    "name": "tab code",
    "lines": [
      "\tcode"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "tab in quote",
    "lines": [
      ">\tA."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": []
  },
  {
    "name": "five space item",
    "lines": [
      "-     A."
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "four space item",
    "lines": [
      "-    A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": []
  },
  {
    "name": "ordered ten",
    "lines": [
      "10. A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": []
  },
  {
    "name": "ordered paren",
    "lines": [
      "1) A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": []
  },
  {
    "name": "marker only",
    "lines": [
      "-",
      "A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": []
  },
  {
    "name": "hash only",
    "lines": [
      "#",
      "",
      "A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": [
      [
        1,
        ""
      ]
    ]
  },
  {
    "name": "setext under table",
    "lines": [
      "A | B",
      "---|---",
      "x | y",
      "Heading",
      "---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Heading"
      ]
    ],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
  },
  {
    "name": "break in item",
    "lines": [
      "- A.",
      "  ***",
      "  B."
    ],
    "paragraphs": [
      "A.",
      "B."
    ],
    "headings": []
  },
  {
    "name": "quote break quote",
    "lines": [
      "> A.",
      "> ***",
      "> B."
    ],
    "paragraphs": [
      "A.",
      "B."
    ],
    "headings": []
  },
  {
    "name": "indented code in item",
    "lines": [
      "- A:",
      "",
      "      code",
      "",
      "  B."
    ],
    "paragraphs": [
      "A:",
      "B."
    ],
    "headings": []
  },
  {
    "name": "html in item",
    "lines": [
      "- <p>Text.</p>"
    ],
    "paragraphs": [
      "<p>Text.</p>"
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads, so its text is measured rather than skipped as a block."
  },
  {
    "name": "front matter then item",
    "lines": [
      "---",
      "title: x",
      "---",
      "- A."
    ],
    "paragraphs": [
      "A."
    ],
    "headings": [],
    "differsFromReference": "Front matter is metadata on GitHub and in Jekyll; CommonMark has no such concept and reads it as a heading."
  },
  {
    "name": "crlf paragraph",
    "lines": [
      "A.",
      "B."
    ],
    "paragraphs": [
      "A. B."
    ],
    "headings": []
  },
  {
    "name": "numbered wrap",
    "lines": [
      "Text continues",
      "2024. and on."
    ],
    "paragraphs": [
      "Text continues 2024. and on."
    ],
    "headings": []
  },
  {
    "name": "numbered one wrap",
    "lines": [
      "Text continues",
      "1. a list."
    ],
    "paragraphs": [
      "Text continues",
      "a list."
    ],
    "headings": []
  },
  {
    "name": "generated:   ### Deeper heading / \tText with **bold** inside.",
    "lines": [
      "  ### Deeper heading",
      "\tText with **bold** inside."
    ],
    "paragraphs": [],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: \t- [ ] Task item / * |---|---|",
    "lines": [
      "\t- [ ] Task item",
      "* |---|---|"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated:   - [link](https://example.com) / * ```text",
    "lines": [
      "  - [link](https://example.com)",
      "* ```text"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated:   Text with **bold** inside. / 1. ---|---",
    "lines": [
      "  Text with **bold** inside.",
      "1. ---|---"
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: - > ``` / \t```text",
    "lines": [
      "- > ```",
      "\t```text"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated:   - \\- Escaped marker /   Text with **bold** inside.",
    "lines": [
      "  - \\- Escaped marker",
      "  Text with **bold** inside."
    ],
    "paragraphs": [
      "\\- Escaped marker Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated:   --- /   - |---|---|",
    "lines": [
      "  ---",
      "  - |---|---|"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated:   |---|---| / 1. ```",
    "lines": [
      "  |---|---|",
      "1. ```"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: \t---|--- / \t\\- Escaped marker",
    "lines": [
      "\t---|---",
      "\t\\- Escaped marker"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated:   ---|--- / - > [link](https://example.com)",
    "lines": [
      "  ---|---",
      "- > [link](https://example.com)"
    ],
    "paragraphs": [
      "---|---",
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated: \tText with **bold** inside. / ```text",
    "lines": [
      "\tText with **bold** inside.",
      "```text"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated:   ```text / * Text with **bold** inside.",
    "lines": [
      "  ```text",
      "* Text with **bold** inside."
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated:   - ### Deeper heading / - > ```text",
    "lines": [
      "  - ### Deeper heading",
      "- > ```text"
    ],
    "paragraphs": [],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated:   - ```text / \t- [ ] Task item",
    "lines": [
      "  - ```text",
      "\t- [ ] Task item"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: * One sentence here. / * ---",
    "lines": [
      "* One sentence here.",
      "* ---"
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: One sentence here. / 1. Text with **bold** inside.",
    "lines": [
      "One sentence here.",
      "1. Text with **bold** inside."
    ],
    "paragraphs": [
      "One sentence here.",
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: 1. |---|---| / ```",
    "lines": [
      "1. |---|---|",
      "```"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: \t[link](https://example.com) / \t<p>Inline html.</p>",
    "lines": [
      "\t[link](https://example.com)",
      "\t<p>Inline html.</p>"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated:   ---|--- / \tText with **bold** inside.",
    "lines": [
      "  ---|---",
      "\tText with **bold** inside."
    ],
    "paragraphs": [
      "---|--- Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated:   - [link](https://example.com) / - > ```",
    "lines": [
      "  - [link](https://example.com)",
      "- > ```"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated: - > One sentence here. / * ### Deeper heading",
    "lines": [
      "- > One sentence here.",
      "* ### Deeper heading"
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: - > |---|---| / * ---",
    "lines": [
      "- > |---|---|",
      "* ---"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: - > ### Deeper heading / [link](https://example.com)",
    "lines": [
      "- > ### Deeper heading",
      "[link](https://example.com)"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: - > The supplier shall comply. / ---|---",
    "lines": [
      "- > The supplier shall comply.",
      "---|---"
    ],
    "paragraphs": [
      "The supplier shall comply. ---|---"
    ],
    "headings": []
  },
  {
    "name": "generated:   - The supplier shall comply. /   ```text",
    "lines": [
      "  - The supplier shall comply.",
      "  ```text"
    ],
    "paragraphs": [
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: - > ### Deeper heading / - > One sentence here.",
    "lines": [
      "- > ### Deeper heading",
      "- > One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated:   ```text / - > [link](https://example.com)",
    "lines": [
      "  ```text",
      "- > [link](https://example.com)"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: * \\- Escaped marker / - > |---|---|",
    "lines": [
      "* \\- Escaped marker",
      "- > |---|---|"
    ],
    "paragraphs": [
      "\\- Escaped marker",
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: \t--- / - > ---",
    "lines": [
      "\t---",
      "- > ---"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated:   \\- Escaped marker / 1. ---",
    "lines": [
      "  \\- Escaped marker",
      "1. ---"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: ### Deeper heading / \t\\- Escaped marker",
    "lines": [
      "### Deeper heading",
      "\t\\- Escaped marker"
    ],
    "paragraphs": [],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: * ```text / \\- Escaped marker",
    "lines": [
      "* ```text",
      "\\- Escaped marker"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: * Text with **bold** inside. /   ---",
    "lines": [
      "* Text with **bold** inside.",
      "  ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "Text with **bold** inside."
      ]
    ]
  },
  {
    "name": "generated:   |---|---| / The supplier shall comply.",
    "lines": [
      "  |---|---|",
      "The supplier shall comply."
    ],
    "paragraphs": [
      "|---|---| The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated:   \\- Escaped marker /   ---|---",
    "lines": [
      "  \\- Escaped marker",
      "  ---|---"
    ],
    "paragraphs": [
      "\\- Escaped marker ---|---"
    ],
    "headings": []
  },
  {
    "name": "generated:   [link](https://example.com) / * ---|---",
    "lines": [
      "  [link](https://example.com)",
      "* ---|---"
    ],
    "paragraphs": [
      "[link](https://example.com)",
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: * ---|--- /   ```text",
    "lines": [
      "* ---|---",
      "  ```text"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. --- / 1. ---",
    "lines": [
      "1. ---",
      "1. ---"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: ```text /   One sentence here.",
    "lines": [
      "```text",
      "  One sentence here."
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: Text with **bold** inside. /   - One sentence here.",
    "lines": [
      "Text with **bold** inside.",
      "  - One sentence here."
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: * \\- Escaped marker /   The supplier shall comply.",
    "lines": [
      "* \\- Escaped marker",
      "  The supplier shall comply."
    ],
    "paragraphs": [
      "\\- Escaped marker The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated:   - [link](https://example.com) / One sentence here.",
    "lines": [
      "  - [link](https://example.com)",
      "One sentence here."
    ],
    "paragraphs": [
      "[link](https://example.com) One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: - > ``` / - > ---|---",
    "lines": [
      "- > ```",
      "- > ---|---"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: * Text with **bold** inside. / - > ---",
    "lines": [
      "* Text with **bold** inside.",
      "- > ---"
    ],
    "paragraphs": [
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated:   Text with **bold** inside. / \\- Escaped marker",
    "lines": [
      "  Text with **bold** inside.",
      "\\- Escaped marker"
    ],
    "paragraphs": [
      "Text with **bold** inside. \\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: * One sentence here. / 1. ### Deeper heading",
    "lines": [
      "* One sentence here.",
      "1. ### Deeper heading"
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated:   The supplier shall comply. /   ---",
    "lines": [
      "  The supplier shall comply.",
      "  ---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "The supplier shall comply."
      ]
    ]
  },
  {
    "name": "generated: * |---|---| / |---|---|",
    "lines": [
      "* |---|---|",
      "|---|---|"
    ],
    "paragraphs": [
      "|---|---| |---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: * ``` /   - Text with **bold** inside.",
    "lines": [
      "* ```",
      "  - Text with **bold** inside."
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: \tText with **bold** inside. /   ```",
    "lines": [
      "\tText with **bold** inside.",
      "  ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: ``` / \t\\- Escaped marker",
    "lines": [
      "```",
      "\t\\- Escaped marker"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: One sentence here. /   - [link](https://example.com)",
    "lines": [
      "One sentence here.",
      "  - [link](https://example.com)"
    ],
    "paragraphs": [
      "One sentence here.",
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated: * ``` / 1. ### Deeper heading",
    "lines": [
      "* ```",
      "1. ### Deeper heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated:   One sentence here. /   ### Deeper heading",
    "lines": [
      "  One sentence here.",
      "  ### Deeper heading"
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: * ```text /   - ### Deeper heading",
    "lines": [
      "* ```text",
      "  - ### Deeper heading"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: 1. \\- Escaped marker / * [link](https://example.com)",
    "lines": [
      "1. \\- Escaped marker",
      "* [link](https://example.com)"
    ],
    "paragraphs": [
      "\\- Escaped marker",
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated:   - ```text /   - ---",
    "lines": [
      "  - ```text",
      "  - ---"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: 1. The supplier shall comply. / \t```",
    "lines": [
      "1. The supplier shall comply.",
      "\t```"
    ],
    "paragraphs": [
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: * ---|--- / * The supplier shall comply.",
    "lines": [
      "* ---|---",
      "* The supplier shall comply."
    ],
    "paragraphs": [
      "---|---",
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated:   The supplier shall comply. / 1. The supplier shall comply.",
    "lines": [
      "  The supplier shall comply.",
      "1. The supplier shall comply."
    ],
    "paragraphs": [
      "The supplier shall comply.",
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: 1. One sentence here. / \tText with **bold** inside.",
    "lines": [
      "1. One sentence here.",
      "\tText with **bold** inside."
    ],
    "paragraphs": [
      "One sentence here. Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: * ---|--- / - > ```",
    "lines": [
      "* ---|---",
      "- > ```"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated:   [link](https://example.com) / \t|---|---|",
    "lines": [
      "  [link](https://example.com)",
      "\t|---|---|"
    ],
    "paragraphs": [
      "[link](https://example.com) |---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: * ```text /   - ---",
    "lines": [
      "* ```text",
      "  - ---"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: * ### Deeper heading / * |---|---|",
    "lines": [
      "* ### Deeper heading",
      "* |---|---|"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: * \\- Escaped marker /   - \\- Escaped marker",
    "lines": [
      "* \\- Escaped marker",
      "  - \\- Escaped marker"
    ],
    "paragraphs": [
      "\\- Escaped marker",
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: \t- [ ] Task item /   - \\- Escaped marker",
    "lines": [
      "\t- [ ] Task item",
      "  - \\- Escaped marker"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. ``` / \t---|---",
    "lines": [
      "1. ```",
      "\t---|---"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: * \\- Escaped marker / One sentence here.",
    "lines": [
      "* \\- Escaped marker",
      "One sentence here."
    ],
    "paragraphs": [
      "\\- Escaped marker One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: 1. Text with **bold** inside. / 1. \\- Escaped marker",
    "lines": [
      "1. Text with **bold** inside.",
      "1. \\- Escaped marker"
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated:   - ---|--- / - > Text with **bold** inside.",
    "lines": [
      "  - ---|---",
      "- > Text with **bold** inside."
    ],
    "paragraphs": [
      "---|---",
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: \t```text /   ---|---",
    "lines": [
      "\t```text",
      "  ---|---"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: \tThe supplier shall comply. / * ```text",
    "lines": [
      "\tThe supplier shall comply.",
      "* ```text"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: --- / 1. The supplier shall comply.",
    "lines": [
      "---",
      "1. The supplier shall comply."
    ],
    "paragraphs": [
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: 1. [link](https://example.com) /   ---",
    "lines": [
      "1. [link](https://example.com)",
      "  ---"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated: \tText with **bold** inside. / - > ---",
    "lines": [
      "\tText with **bold** inside.",
      "- > ---"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: - > Text with **bold** inside. /   - Text with **bold** insi",
    "lines": [
      "- > Text with **bold** inside.",
      "  - Text with **bold** inside."
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: \t- [ ] Task item / * \\- Escaped marker",
    "lines": [
      "\t- [ ] Task item",
      "* \\- Escaped marker"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated:   - --- / * ### Deeper heading",
    "lines": [
      "  - ---",
      "* ### Deeper heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: |---|---| / The supplier shall comply.",
    "lines": [
      "|---|---|",
      "The supplier shall comply."
    ],
    "paragraphs": [
      "|---|---| The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: * Text with **bold** inside. / * Text with **bold** inside.",
    "lines": [
      "* Text with **bold** inside.",
      "* Text with **bold** inside."
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: * |---|---| /   - ---",
    "lines": [
      "* |---|---|",
      "  - ---"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: - > --- / - > ---|---",
    "lines": [
      "- > ---",
      "- > ---|---"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: \t[link](https://example.com) / Text with **bold** inside.",
    "lines": [
      "\t[link](https://example.com)",
      "Text with **bold** inside."
    ],
    "paragraphs": [
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: ---|--- / \t---",
    "lines": [
      "---|---",
      "\t---"
    ],
    "paragraphs": [
      "---|--- ---"
    ],
    "headings": []
  },
  {
    "name": "generated: Text with **bold** inside. / \t|---|---|",
    "lines": [
      "Text with **bold** inside.",
      "\t|---|---|"
    ],
    "paragraphs": [
      "Text with **bold** inside. |---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. ```text / 1. ### Deeper heading",
    "lines": [
      "1. ```text",
      "1. ### Deeper heading"
    ],
    "paragraphs": [],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: * [link](https://example.com) / * The supplier shall comply.",
    "lines": [
      "* [link](https://example.com)",
      "* The supplier shall comply."
    ],
    "paragraphs": [
      "[link](https://example.com)",
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated:   ``` / 1. Text with **bold** inside.",
    "lines": [
      "  ```",
      "1. Text with **bold** inside."
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: - > [link](https://example.com) / 1. The supplier shall comp",
    "lines": [
      "- > [link](https://example.com)",
      "1. The supplier shall comply."
    ],
    "paragraphs": [
      "[link](https://example.com)",
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: \tOne sentence here. / 1. ```text",
    "lines": [
      "\tOne sentence here.",
      "1. ```text"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: * ``` / 1. The supplier shall comply.",
    "lines": [
      "* ```",
      "1. The supplier shall comply."
    ],
    "paragraphs": [
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: \\- Escaped marker / - > ---|---",
    "lines": [
      "\\- Escaped marker",
      "- > ---|---"
    ],
    "paragraphs": [
      "\\- Escaped marker",
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. \\- Escaped marker /   - ### Deeper heading",
    "lines": [
      "1. \\- Escaped marker",
      "  - ### Deeper heading"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated:   - --- /   [link](https://example.com)",
    "lines": [
      "  - ---",
      "  [link](https://example.com)"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated:   - One sentence here. /   ---",
    "lines": [
      "  - One sentence here.",
      "  ---"
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: 1. ``` / 1. ---",
    "lines": [
      "1. ```",
      "1. ---"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: * ---|--- / \t---",
    "lines": [
      "* ---|---",
      "\t---"
    ],
    "paragraphs": [],
    "headings": [
      [
        2,
        "---|---"
      ]
    ]
  },
  {
    "name": "generated: The supplier shall comply. /   - One sentence here.",
    "lines": [
      "The supplier shall comply.",
      "  - One sentence here."
    ],
    "paragraphs": [
      "The supplier shall comply.",
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: * ### Deeper heading / * [link](https://example.com)",
    "lines": [
      "* ### Deeper heading",
      "* [link](https://example.com)"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  }
];
