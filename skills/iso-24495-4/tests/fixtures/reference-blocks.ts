// Block structure as the CommonMark reference implementation reads it.
//
// Generated on 2026-08-16 by running commonmark 0.31 over each document and
// recording the paragraphs and headings it found. The reference is not a
// dependency of this project: it was installed outside the repository, asked
// once, and its answers written here. Regenerate the same way if a shape needs
// adding, and never edit an expectation by hand to make a test pass.
//
// Eighteen review rounds argued about what these documents mean. This file
// ends the argument by asking the implementation that defines the language.

export interface ReferenceShape {
  name: string;
  lines: string[];
  paragraphs: string[];
  headings: Array<[number, string]>;
}

export const REFERENCE_SHAPES: ReferenceShape[] = [
  {
    "name": "plain",
    "lines": [
      "A sentence here."
    ],
    "paragraphs": [
      "A sentence here."
    ],
    "headings": []
  },
  {
    "name": "two paragraphs",
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
    "name": "wrapped",
    "lines": [
      "One line",
      "continues here."
    ],
    "paragraphs": [
      "One line continues here."
    ],
    "headings": []
  },
  {
    "name": "atx",
    "lines": [
      "# Title",
      "",
      "Body."
    ],
    "paragraphs": [
      "Body."
    ],
    "headings": [
      [
        1,
        "Title"
      ]
    ]
  },
  {
    "name": "atx closed",
    "lines": [
      "## Title ##",
      "",
      "Body."
    ],
    "paragraphs": [
      "Body."
    ],
    "headings": [
      [
        2,
        "Title"
      ]
    ]
  },
  {
    "name": "bare hash",
    "lines": [
      "#",
      "",
      "Body."
    ],
    "paragraphs": [
      "Body."
    ],
    "headings": [
      [
        1,
        ""
      ]
    ]
  },
  {
    "name": "setext",
    "lines": [
      "Title",
      "===",
      "",
      "Body."
    ],
    "paragraphs": [
      "Body."
    ],
    "headings": [
      [
        1,
        "Title"
      ]
    ]
  },
  {
    "name": "setext two line",
    "lines": [
      "Title one",
      "title two",
      "---",
      "",
      "Body."
    ],
    "paragraphs": [
      "Body."
    ],
    "headings": [
      [
        2,
        "Title one title two"
      ]
    ]
  },
  {
    "name": "bullet",
    "lines": [
      "- One",
      "- Two"
    ],
    "paragraphs": [
      "One",
      "Two"
    ],
    "headings": []
  },
  {
    "name": "ordered",
    "lines": [
      "1. One",
      "2. Two"
    ],
    "paragraphs": [
      "One",
      "Two"
    ],
    "headings": []
  },
  {
    "name": "nested bullets",
    "lines": [
      "- One",
      "  - Two",
      "    - Three"
    ],
    "paragraphs": [
      "One",
      "Two",
      "Three"
    ],
    "headings": []
  },
  {
    "name": "item two paragraphs",
    "lines": [
      "- One.",
      "",
      "  Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "lazy list",
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
    "name": "lazy quote",
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
    "name": "quote",
    "lines": [
      "> Quoted."
    ],
    "paragraphs": [
      "Quoted."
    ],
    "headings": []
  },
  {
    "name": "nested quote",
    "lines": [
      "> One.",
      ">> Two."
    ],
    "paragraphs": [
      "One.",
      "Two."
    ],
    "headings": []
  },
  {
    "name": "quote in list",
    "lines": [
      "- > Quoted."
    ],
    "paragraphs": [
      "Quoted."
    ],
    "headings": []
  },
  {
    "name": "list in quote",
    "lines": [
      "> - Item."
    ],
    "paragraphs": [
      "Item."
    ],
    "headings": []
  },
  {
    "name": "quote in list in quote",
    "lines": [
      "> - > Deep."
    ],
    "paragraphs": [
      "Deep."
    ],
    "headings": []
  },
  {
    "name": "fence",
    "lines": [
      "```",
      "code",
      "```",
      "",
      "After."
    ],
    "paragraphs": [
      "After."
    ],
    "headings": []
  },
  {
    "name": "fence in item",
    "lines": [
      "- Item:",
      "",
      "  ```",
      "  code",
      "  ```"
    ],
    "paragraphs": [
      "Item:"
    ],
    "headings": []
  },
  {
    "name": "fence in quote",
    "lines": [
      "> ```",
      "> code",
      "> ```"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "unclosed fence",
    "lines": [
      "```",
      "code"
    ],
    "paragraphs": [],
    "headings": []
  },
  {
    "name": "unclosed fence in item",
    "lines": [
      "- Item:",
      "",
      "  ```",
      "  code",
      "",
      "After."
    ],
    "paragraphs": [
      "Item:",
      "After."
    ],
    "headings": []
  },
  {
    "name": "indented code",
    "lines": [
      "Para.",
      "",
      "    code",
      "",
      "After."
    ],
    "paragraphs": [
      "Para.",
      "After."
    ],
    "headings": []
  },
  {
    "name": "indent continues",
    "lines": [
      "Para",
      "    continues."
    ],
    "paragraphs": [
      "Para continues."
    ],
    "headings": []
  },
  {
    "name": "break",
    "lines": [
      "One.",
      "",
      "---",
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
    "name": "break forms",
    "lines": [
      "***",
      "One.",
      "___",
      "Two.",
      "- - -",
      "Three."
    ],
    "paragraphs": [
      "One.",
      "Two.",
      "Three."
    ],
    "headings": []
  },
  {
    "name": "tab item",
    "lines": [
      "-\tItem."
    ],
    "paragraphs": [
      "Item."
    ],
    "headings": []
  },
  {
    "name": "tab code",
    "lines": [
      "\tcode",
      "",
      "After."
    ],
    "paragraphs": [
      "After."
    ],
    "headings": []
  },
  {
    "name": "ordered mid paragraph",
    "lines": [
      "Para",
      "2. Not a list."
    ],
    "paragraphs": [
      "Para 2. Not a list."
    ],
    "headings": []
  },
  {
    "name": "one mid paragraph",
    "lines": [
      "Para",
      "1. A list."
    ],
    "paragraphs": [
      "Para",
      "A list."
    ],
    "headings": []
  },
  {
    "name": "deep item outdent",
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
    "name": "quote then margin",
    "lines": [
      "> A.",
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
    "name": "blank in item",
    "lines": [
      "- A.",
      "",
      "  B.",
      "",
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
    "name": "five space marker",
    "lines": [
      "-     Deep."
    ],
    "paragraphs": [],
    "headings": []
  }
];
