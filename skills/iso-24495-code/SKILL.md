---
name: iso-24495-code
description: Plain language applied to source code (ISO 24495-1:2023 principles). Governs the parts of code a person reads: the order units appear in, their names, comments, and error messages. Applied when writing or restructuring code, not when explaining it.
metadata:
  version: "0.6.0"
  iso-standard: "ISO 24495-1:2023"
  iso-status: "published, applied by analogy to source code"
---

# Plain language in code

Extends ISO 24495-1 to source code. Code is read far more often than it is written, so the
person reading it is the reader the standard is about.

**Scope**. This skill governs what a reader reads: the order units appear in, what they are
called, what the comments say, and what an error tells the person who hits it.

It does not govern correctness, performance, or system design. It makes one structural demand,
in rule 2, and only because a reader cannot reach a helper without reading its container first.
For maintainability weaknesses such as complexity and dead code, use a code quality skill built
on ISO/IEC 5055.

**This is an interpretation of ISO 24495-1 applied by analogy, not a conformance claim.**

## The four principles, in code

| Principle | In prose | In code |
|---|---|---|
| Findable | The reader can find what they need | The public entry point appears first |
| Understandable | The reader understands it | Names say what the thing is, in the reader's words |
| Relevant | The reader gets what they need | Comments say why, never what |
| Usable | The reader can act on it | An error names the problem and shows the value |

## Rules

### 1. Front-load the main path

**Put the public entry point at the top of the file**, before the helpers it calls. A reader
opening the file meets the thing it does, then the detail, in that order. This is the code form
of leading with the outcome.

Where a language forces declarations before use, put a short delegating entry point first and
the implementation below it.

> Measured on 30 generated implementations of one specification. Without this rule the public
> function landed anywhere in the file, and in half the files it was the last thing in it.
> With the rule it sat in the first fifth of the file every time.
>
> The measure was chosen after those runs rather than before them, and the effect appeared in
> one model family but not in the two others tested. Treat it as a hypothesis with a clean
> separation, not a settled result.

### 2. One job per unit

A function does one thing that its name describes. **Split any function you need the word "and"
to describe.**

Helpers belong at the top level or as members of a class, rather than buried as closures inside
the function they serve. A reader cannot reach a closure without reading its container first.

### 3. Name for the reader

- A name says what the thing **is** or **does**, in the vocabulary of someone who knows the
  domain but not this file.
- **Use one name for one concept throughout.** If it is a `token` here it is not a `lexeme`
  three functions later. Elegant variation confuses code exactly as it confuses prose.
- Prefer a longer name that reads to a shorter one that must be decoded. `remainingBudget`
  beats `rb`.

### 4. A comment says why, never what

The code already says what it does. A comment earns its place when it records a reason a reader
cannot recover from the code: a constraint, a rejected alternative, a bug it guards against.

**Delete a comment that restates the line beneath it.** Delete commented-out code.

### 5. An error message serves the person who hits it

An error names the problem, shows the offending value, and where it helps, says what to do
instead. Write it in the words its reader would use, so it can be acted on without opening the
source.

**Never put a secret in an error.** A credential, token, key, password, session identifier or
personal detail must not appear in a message, because messages reach logs, telemetry and screens.
Name the field and describe the fault instead: `API token rejected: expected 32 characters, got 8`.
Where you cannot show a value safely, show its shape.

```
Bad:   throw new Error("invalid input")
Good:  throw new TypeError(`Duration "${input}" must be a number followed by ms, s, m, h or d`)
```

### 6. Prefer the plain construction

Where two constructions are equally correct, use the one a competent reader understands
without pausing. Cleverness that needs a comment to explain it has already failed.

## What this skill does not do

- It does not require comments. A file with no comments and clear names is fine.
- It does not set a line count for a function. Use `iso-5055-code-quality` for size and
  complexity thresholds, which are measurable.
- It does not apply to generated code, vendored code, or code whose layout a formatter owns.

## Applying it to existing code

Change the reading order and the language. Do not restructure behaviour in the same pass, and
never move code and change it at once, because the diff stops being reviewable.
