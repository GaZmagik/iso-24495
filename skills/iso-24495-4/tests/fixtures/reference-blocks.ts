// Block structure for 286 documents, checked against the CommonMark
// reference implementation.
//
// Rebuild this file with `build-fixture.ts` beside it, which reads the corpus
// from `shapes.ts`, asks the reference, and refuses to write a difference it
// cannot explain. See the README for the two commands.
//
// 226 documents are read identically. 60 differ, for 4 reasons, and every
// reason is a decision about a reader rather than about Markdown.
//
// Never edit an expectation by hand to make a test pass.

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
      "Text."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
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
    "differsFromReference": "Front matter is metadata on GitHub and in Jekyll; CommonMark has no such concept."
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
    "name": "generated: * - [ ] Task item / |---|---|",
    "lines": [
      "* - [ ] Task item",
      "|---|---|"
    ],
    "paragraphs": [
      "Task item |---|---|"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated: 1. Text with **bold** inside. / [link](https://example.com)",
    "lines": [
      "1. Text with **bold** inside.",
      "[link](https://example.com)"
    ],
    "paragraphs": [
      "Text with **bold** inside. [link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated:   - ``` / \t### Deeper heading",
    "lines": [
      "  - ```",
      "\t### Deeper heading"
    ],
    "paragraphs": [],
    "headings": []
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
    "name": "generated: - > ---|--- / 1. <p>Inline html.</p>",
    "lines": [
      "- > ---|---",
      "1. <p>Inline html.</p>"
    ],
    "paragraphs": [
      "---|---",
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated:   - |---|---| /   The supplier shall comply.",
    "lines": [
      "  - |---|---|",
      "  The supplier shall comply."
    ],
    "paragraphs": [
      "|---|---| The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: 1. ### Deeper heading / - > ---",
    "lines": [
      "1. ### Deeper heading",
      "- > ---"
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
    "name": "generated: * ---|--- / * - [ ] Task item",
    "lines": [
      "* ---|---",
      "* - [ ] Task item"
    ],
    "paragraphs": [
      "---|---",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated: ---|--- /   - \\- Escaped marker",
    "lines": [
      "---|---",
      "  - \\- Escaped marker"
    ],
    "paragraphs": [
      "---|---",
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: \t--- /   Text with **bold** inside.",
    "lines": [
      "\t---",
      "  Text with **bold** inside."
    ],
    "paragraphs": [
      "Text with **bold** inside."
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
    "name": "generated: * ### Deeper heading /   - The supplier shall comply.",
    "lines": [
      "* ### Deeper heading",
      "  - The supplier shall comply."
    ],
    "paragraphs": [
      "The supplier shall comply."
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: - > --- /   - - [ ] Task item",
    "lines": [
      "- > ---",
      "  - - [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated:   - <p>Inline html.</p> / \t[link](https://example.com)",
    "lines": [
      "  - <p>Inline html.</p>",
      "\t[link](https://example.com)"
    ],
    "paragraphs": [
      "Inline html. [link](https://example.com)"
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated: --- /   - The supplier shall comply.",
    "lines": [
      "---",
      "  - The supplier shall comply."
    ],
    "paragraphs": [
      "The supplier shall comply."
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
    "name": "generated:   [link](https://example.com) / 1. \\- Escaped marker",
    "lines": [
      "  [link](https://example.com)",
      "1. \\- Escaped marker"
    ],
    "paragraphs": [
      "[link](https://example.com)",
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: The supplier shall comply. /   [link](https://example.com)",
    "lines": [
      "The supplier shall comply.",
      "  [link](https://example.com)"
    ],
    "paragraphs": [
      "The supplier shall comply. [link](https://example.com)"
    ],
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
    "name": "generated: * |---|---| / * <p>Inline html.</p>",
    "lines": [
      "* |---|---|",
      "* <p>Inline html.</p>"
    ],
    "paragraphs": [
      "|---|---|",
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated:   - ---|--- / ```",
    "lines": [
      "  - ---|---",
      "```"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated:   - ---|--- / 1. ```text",
    "lines": [
      "  - ---|---",
      "1. ```text"
    ],
    "paragraphs": [
      "---|---"
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
    "name": "generated: \t---|--- / ```text",
    "lines": [
      "\t---|---",
      "```text"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: \t``` / * - [ ] Task item",
    "lines": [
      "\t```",
      "* - [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: 1. \\- Escaped marker /   - Text with **bold** inside.",
    "lines": [
      "1. \\- Escaped marker",
      "  - Text with **bold** inside."
    ],
    "paragraphs": [
      "\\- Escaped marker",
      "Text with **bold** inside."
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
    "name": "generated: - [ ] Task item / - > ```",
    "lines": [
      "- [ ] Task item",
      "- > ```"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated:   ```text / 1. |---|---|",
    "lines": [
      "  ```text",
      "1. |---|---|"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated:   --- / * ---|---",
    "lines": [
      "  ---",
      "* ---|---"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: - > - [ ] Task item / * ### Deeper heading",
    "lines": [
      "- > - [ ] Task item",
      "* ### Deeper heading"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated:   - \\- Escaped marker /   - Text with **bold** inside.",
    "lines": [
      "  - \\- Escaped marker",
      "  - Text with **bold** inside."
    ],
    "paragraphs": [
      "\\- Escaped marker",
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: * One sentence here. / \t### Deeper heading",
    "lines": [
      "* One sentence here.",
      "\t### Deeper heading"
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
    "name": "generated: - > ---|--- / \t- [ ] Task item",
    "lines": [
      "- > ---|---",
      "\t- [ ] Task item"
    ],
    "paragraphs": [
      "---|---",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated:   - ---|--- /   ### Deeper heading",
    "lines": [
      "  - ---|---",
      "  ### Deeper heading"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ]
  },
  {
    "name": "generated: \tOne sentence here. / 1. One sentence here.",
    "lines": [
      "\tOne sentence here.",
      "1. One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
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
    "name": "generated: - > - [ ] Task item / * <p>Inline html.</p>",
    "lines": [
      "- > - [ ] Task item",
      "* <p>Inline html.</p>"
    ],
    "paragraphs": [
      "Task item",
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated:   - <p>Inline html.</p> /   - <p>Inline html.</p>",
    "lines": [
      "  - <p>Inline html.</p>",
      "  - <p>Inline html.</p>"
    ],
    "paragraphs": [
      "Inline html.",
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated: - > ``` / \t|---|---|",
    "lines": [
      "- > ```",
      "\t|---|---|"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated:   - ```text / [link](https://example.com)",
    "lines": [
      "  - ```text",
      "[link](https://example.com)"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
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
    "name": "generated: \t``` / * Text with **bold** inside.",
    "lines": [
      "\t```",
      "* Text with **bold** inside."
    ],
    "paragraphs": [
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: - > One sentence here. / * - [ ] Task item",
    "lines": [
      "- > One sentence here.",
      "* - [ ] Task item"
    ],
    "paragraphs": [
      "One sentence here.",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: \t|---|---| / \tText with **bold** inside.",
    "lines": [
      "\t|---|---|",
      "\tText with **bold** inside."
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
    "name": "generated: * ``` / - > Text with **bold** inside.",
    "lines": [
      "* ```",
      "- > Text with **bold** inside."
    ],
    "paragraphs": [
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated:   - Text with **bold** inside. / - > - [ ] Task item",
    "lines": [
      "  - Text with **bold** inside.",
      "- > - [ ] Task item"
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: 1. The supplier shall comply. / - > Text with **bold** insid",
    "lines": [
      "1. The supplier shall comply.",
      "- > Text with **bold** inside."
    ],
    "paragraphs": [
      "The supplier shall comply.",
      "Text with **bold** inside."
    ],
    "headings": []
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
    "name": "generated: ---|--- /   - ---|---",
    "lines": [
      "---|---",
      "  - ---|---"
    ],
    "paragraphs": [
      "---|---",
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. |---|---| /   ### Deeper heading",
    "lines": [
      "1. |---|---|",
      "  ### Deeper heading"
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
    "name": "generated:   - <p>Inline html.</p> /   ```",
    "lines": [
      "  - <p>Inline html.</p>",
      "  ```"
    ],
    "paragraphs": [
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
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
    "name": "generated:   - --- / - [ ] Task item",
    "lines": [
      "  - ---",
      "- [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: [link](https://example.com) / - > ```text",
    "lines": [
      "[link](https://example.com)",
      "- > ```text"
    ],
    "paragraphs": [
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated: --- / * - [ ] Task item",
    "lines": [
      "---",
      "* - [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: 1. [link](https://example.com) /   |---|---|",
    "lines": [
      "1. [link](https://example.com)",
      "  |---|---|"
    ],
    "paragraphs": [
      "[link](https://example.com) |---|---|"
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
    "name": "generated:   - ``` / - > ---|---",
    "lines": [
      "  - ```",
      "- > ---|---"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. ### Deeper heading / - > ```text",
    "lines": [
      "1. ### Deeper heading",
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
    "name": "generated: - > ```text /   ---|---",
    "lines": [
      "- > ```text",
      "  ---|---"
    ],
    "paragraphs": [
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated: > > |---|---| / \tThe supplier shall comply.",
    "lines": [
      "> > |---|---|",
      "\tThe supplier shall comply."
    ],
    "paragraphs": [
      "|---|---| The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: - > ### Deeper heading / - [ ] Task item",
    "lines": [
      "- > ### Deeper heading",
      "- [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [
      [
        3,
        "Deeper heading"
      ]
    ],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated: * \\- Escaped marker / \t```",
    "lines": [
      "* \\- Escaped marker",
      "\t```"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. --- / \t<p>Inline html.</p>",
    "lines": [
      "1. ---",
      "\t<p>Inline html.</p>"
    ],
    "paragraphs": [
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated:   - |---|---| / * <p>Inline html.</p>",
    "lines": [
      "  - |---|---|",
      "* <p>Inline html.</p>"
    ],
    "paragraphs": [
      "|---|---|",
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated:   --- / 1. One sentence here.",
    "lines": [
      "  ---",
      "1. One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
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
    "name": "generated:   --- / - > - [ ] Task item",
    "lines": [
      "  ---",
      "- > - [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated:   - The supplier shall comply. / * [link](https://example.co",
    "lines": [
      "  - The supplier shall comply.",
      "* [link](https://example.com)"
    ],
    "paragraphs": [
      "The supplier shall comply.",
      "[link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated: \t--- / - [ ] Task item",
    "lines": [
      "\t---",
      "- [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated:   - \\- Escaped marker / - > <p>Inline html.</p>",
    "lines": [
      "  - \\- Escaped marker",
      "- > <p>Inline html.</p>"
    ],
    "paragraphs": [
      "\\- Escaped marker",
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated: * ### Deeper heading / * ---",
    "lines": [
      "* ### Deeper heading",
      "* ---"
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
    "name": "generated: * ### Deeper heading / \tOne sentence here.",
    "lines": [
      "* ### Deeper heading",
      "\tOne sentence here."
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
    "name": "generated: - > Text with **bold** inside. /   - ---|---",
    "lines": [
      "- > Text with **bold** inside.",
      "  - ---|---"
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "---|---"
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
    "name": "generated:   |---|---| /   - The supplier shall comply.",
    "lines": [
      "  |---|---|",
      "  - The supplier shall comply."
    ],
    "paragraphs": [
      "|---|---|",
      "The supplier shall comply."
    ],
    "headings": []
  },
  {
    "name": "generated: - > |---|---| /   - ---",
    "lines": [
      "- > |---|---|",
      "  - ---"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
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
    "name": "generated: 1. The supplier shall comply. / [link](https://example.com)",
    "lines": [
      "1. The supplier shall comply.",
      "[link](https://example.com)"
    ],
    "paragraphs": [
      "The supplier shall comply. [link](https://example.com)"
    ],
    "headings": []
  },
  {
    "name": "generated: \\- Escaped marker /   ```text",
    "lines": [
      "\\- Escaped marker",
      "  ```text"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: - > - [ ] Task item / - > - [ ] Task item",
    "lines": [
      "- > - [ ] Task item",
      "- > - [ ] Task item"
    ],
    "paragraphs": [
      "Task item",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: 1. - [ ] Task item / - > ```text",
    "lines": [
      "1. - [ ] Task item",
      "- > ```text"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated: ---|--- / * One sentence here.",
    "lines": [
      "---|---",
      "* One sentence here."
    ],
    "paragraphs": [
      "---|---",
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: 1. Text with **bold** inside. / - > ---|---",
    "lines": [
      "1. Text with **bold** inside.",
      "- > ---|---"
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "---|---"
    ],
    "headings": []
  },
  {
    "name": "generated:   - The supplier shall comply. /   - [ ] Task item",
    "lines": [
      "  - The supplier shall comply.",
      "  - [ ] Task item"
    ],
    "paragraphs": [
      "The supplier shall comply.",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated: * [link](https://example.com) /   - Text with **bold** insid",
    "lines": [
      "* [link](https://example.com)",
      "  - Text with **bold** inside."
    ],
    "paragraphs": [
      "[link](https://example.com)",
      "Text with **bold** inside."
    ],
    "headings": []
  },
  {
    "name": "generated: * One sentence here. / - [ ] Task item",
    "lines": [
      "* One sentence here.",
      "- [ ] Task item"
    ],
    "paragraphs": [
      "One sentence here.",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: 1. The supplier shall comply. / \t\\- Escaped marker / \t- [ ] ",
    "lines": [
      "1. The supplier shall comply.",
      "\t\\- Escaped marker",
      "\t- [ ] Task item"
    ],
    "paragraphs": [
      "The supplier shall comply. \\- Escaped marker",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated:   ```text / - > ### Deeper heading",
    "lines": [
      "  ```text",
      "- > ### Deeper heading"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "generated: - > One sentence here. / - > - [ ] Task item",
    "lines": [
      "- > One sentence here.",
      "- > - [ ] Task item"
    ],
    "paragraphs": [
      "One sentence here.",
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
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
    "name": "generated: * --- /   - |---|---|",
    "lines": [
      "* ---",
      "  - |---|---|"
    ],
    "paragraphs": [
      "|---|---|"
    ],
    "headings": []
  },
  {
    "name": "generated: * ---|--- / 1. <p>Inline html.</p>",
    "lines": [
      "* ---|---",
      "1. <p>Inline html.</p>"
    ],
    "paragraphs": [
      "---|---",
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated: * --- /   [link](https://example.com)",
    "lines": [
      "* ---",
      "  [link](https://example.com)"
    ],
    "paragraphs": [
      "[link](https://example.com)"
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
    "name": "generated: 1. \\- Escaped marker /   ---",
    "lines": [
      "1. \\- Escaped marker",
      "  ---"
    ],
    "paragraphs": [
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated: \tThe supplier shall comply. / * - [ ] Task item",
    "lines": [
      "\tThe supplier shall comply.",
      "* - [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: - > ``` / 1. One sentence here.",
    "lines": [
      "- > ```",
      "1. One sentence here."
    ],
    "paragraphs": [
      "One sentence here."
    ],
    "headings": []
  },
  {
    "name": "generated: \t|---|---| /   - - [ ] Task item",
    "lines": [
      "\t|---|---|",
      "  - - [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: \tOne sentence here. / * - [ ] Task item",
    "lines": [
      "\tOne sentence here.",
      "* - [ ] Task item"
    ],
    "paragraphs": [
      "Task item"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated: - > - [ ] Task item /   - [link](https://example.com)",
    "lines": [
      "- > - [ ] Task item",
      "  - [link](https://example.com)"
    ],
    "paragraphs": [
      "Task item",
      "[link](https://example.com)"
    ],
    "headings": [],
    "differsFromReference": "A task marker is a control a reader hears as a checkbox, not two words."
  },
  {
    "name": "generated:   - |---|---| / \t|---|---|",
    "lines": [
      "  - |---|---|",
      "\t|---|---|"
    ],
    "paragraphs": [],
    "headings": [],
    "differsFromReference": "GitHub renders a table; the reference implements CommonMark core, which has no table extension."
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
    "name": "generated: 1. ```text /   <p>Inline html.</p>",
    "lines": [
      "1. ```text",
      "  <p>Inline html.</p>"
    ],
    "paragraphs": [
      "Inline html."
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
  },
  {
    "name": "generated:   - Text with **bold** inside. / - > \\- Escaped marker",
    "lines": [
      "  - Text with **bold** inside.",
      "- > \\- Escaped marker"
    ],
    "paragraphs": [
      "Text with **bold** inside.",
      "\\- Escaped marker"
    ],
    "headings": []
  },
  {
    "name": "generated:   One sentence here. / \t```text",
    "lines": [
      "  One sentence here.",
      "\t```text"
    ],
    "paragraphs": [
      "One sentence here. ```text"
    ],
    "headings": []
  },
  {
    "name": "generated: 1. <p>Inline html.</p> /   [link](https://example.com)",
    "lines": [
      "1. <p>Inline html.</p>",
      "  [link](https://example.com)"
    ],
    "paragraphs": [
      "Inline html. [link](https://example.com)"
    ],
    "headings": [],
    "differsFromReference": "HTML carries prose a reader reads; its tags are markup and its text is measured."
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
    "name": "generated:   ``` / * ---",
    "lines": [
      "  ```",
      "* ---"
    ],
    "paragraphs": [],
    "headings": []
  }
];
