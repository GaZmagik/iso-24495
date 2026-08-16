// Block structure for 166 documents, checked against the CommonMark reference
// implementation on 2026-08-16.
//
// The shapes are a matrix: every container prefix the engine claims to
// understand, applied to every leaf block it claims to find, plus the
// transitions between them. Each row records what this engine produces, and
// 143 of them were confirmed identical to commonmark 0.31.
//
// The reference is not a dependency. It was installed outside the repository,
// asked once, and its answers compared. Regenerate the same way when adding a
// shape, and never edit an expectation by hand to make a test pass: an
// expectation that disagrees with the reference needs a reason, and every one
// that has a reason carries it in `differsFromReference`.
//
// The 23 documented divergences are decisions about a reader rather than about
// Markdown. Tables are the largest group, because the reference implements
// CommonMark core and GitHub's table extension is what people actually write.

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
    "name": "quote holding table",
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
  }
];
