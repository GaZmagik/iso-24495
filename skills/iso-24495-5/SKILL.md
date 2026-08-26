---
name: iso-24495-5
description: Provisional sector-specific Plain Language standard for document design (based on ISO/WD 24495-5, under development). Applied when structuring complex documents so readers can find and navigate content through layout, visual hierarchy, and navigation aids.
metadata:
  version: "0.6.2"
  iso-standard: "ISO/WD 24495-5"
  iso-status: "working-draft"
---

# ISO/WD 24495-5 - Plain Language (Document Design) [PROVISIONAL DRAFT]

> **Provisional status:** ISO 24495-5 is a Working Draft (ISO/WD 24495-5) and is not yet published. This skill is original guidance based on the draft's public scope and established information design practice. It does not reproduce ISO text. Expect revision when the standard is published.

> **Sources:** several rules here paraphrase the Document design pattern library, version 0.6, June 2025. That library is by Waller, van der Waarde, Schriver, Slabbert, Cheek and Linsky, for the International Plain Language Federation. The wording in this skill is ours, and no substantial wording is copied from it. Read the [Document design pattern library at the International Plain Language Federation](https://www.iplfederation.org/wp-content/uploads/2025/06/ISOpatternlibrary06.pdf) for the original.

Extends ISO 24495-1:2023 for the structural design of complex documents: reports, specifications, guides, contracts presented as documents, and long-form technical or health information. Design works together with linguistic cues to help readers find and navigate a document's structure and content.

**Design for readers who are not looking at the page.** The intended readers include everyone who uses the document. Some see it, some hear it through a screen reader, and some read it by touch.

A listener has no visual hierarchy. Their structure is the heading tree, the link text and the reading order. Every rule below is written to hold when the document is heard.

## Scope & Execution Boundaries

1. **Thinking Block Exemption:**
   - Internal layout planning and structural reasoning within thinking blocks (`<thought>`, `<thinking>`) are **100% exempt** from these constraints.
   - Plan freely within thinking blocks. Apply document design rules strictly to final user-facing documents.

2. **Design as Engineering, Not Decoration:**
   - Base every design decision on a documented reader need (finding, navigating, comparing, acting). Never add visual elements for aesthetic effect alone.

3. **Content Primacy:**
   - Document design must **never** cut or distort content to fit a layout. Accuracy and completeness supersede visual tidiness.

---

## Required Templates

Read the matching template before writing any of these document types:

- **Architecture decision record (ADR):** Read the template file at `assets/adr-template.md`.
- **Runbook:** Read the template file at `assets/runbook-template.md`.
- **Design document:** Read the template file at `assets/design-doc-template.md`.

## Restructure an Existing Document

When asked to restructure an existing document:

1. Identify the reader tasks, current hierarchy, and navigation needs.
2. Preserve every prose passage and content item.
3. Change headings, list types, table structure and visual formatting. You may also move a whole sentence or a whole block to another position, unchanged.
4. Build the opening block, the overview label and the signposts from sentences the document already holds, or from wording the author gives you in the request. Promote a sentence only when it states the field directly and stays true away from the paragraph it came from.
5. Where nothing serves, leave a marked slot such as `[Author needed: purpose]` and report it as a gap. Never supply the missing wording yourself.
6. Check the result against the hierarchy, navigation, structure, and signalling rules below.

Do not rewrite prose, change tone, or remove content. Those changes belong to Parts 1 to 3, and so does rewording a sentence to make it fit a slot. A wrong purpose sends a reader confidently in the wrong direction, which is worse than no purpose at all.

---

## Quantitative Rules & Hard Constraints (User-Facing Documents)

1. **Visual Hierarchy Limits:**
   - Use at most **3 heading levels** below the document title. Flatten deeper nesting into lists or tables.
   - Make headings state the section's message or task, not just its topic (*"Install the dependencies"* rather than *"Dependencies"*).
   - Reject a heading that jokes, puns or plays with words. Reject one built on a term the document has not yet explained, because a reader skimming meets the heading first.

2. **Navigation Aids:**
   - Add a table of contents or link list to any document with **6 or more sections**.
   - Keep heading wording identical between the table of contents and the section it points to.
   - Number headings when a reader must cite one by its identifier, and never below the depth limit above.

3. **Chunking & White Space:**
   - Present one idea per visual chunk (paragraph, list, table, or callout). Separate chunks with blank lines.
   - Never run two unrelated topics together in one paragraph or one table.

4. **Choosing the Right Structure:**
   - **Comparisons:** Use a table when readers must compare 2 or more items across shared attributes. Name the narrowest presentation the table must survive, then read it back at that width. Where nobody has named one, give a single-column alternative rather than assume the table holds.
   - **Sequences:** Use a numbered list for steps that must happen in order. Keep it an ordered list rather than numbers typed into a paragraph, so the sequence survives when the document is heard.
   - **Options and collections:** Use a bulleted list for unordered sets of 3 or more items. Keep each bullet to one paragraph carrying one idea, and nest no deeper than 2 levels. Promote longer material to a subsection.
   - **Branching routes:** When a procedure forks, use a decision table or a labelled set of conditions rather than one numbered list. A decision table with labelled routes is already the written form. Add prose only where the routes are drawn as a picture.
   - **Warnings and conditions:** Reserve a callout for a warning or condition that changes what the reader does. Merge adjacent callouts serving one purpose, and give each a word naming what it is.

5. **Consistent Visual Signalling:**
   - Give each visual device (bold, italics, blockquotes, code formatting, icons) **one meaning** per document and apply it consistently.
   - Never use the same device for two different meanings, or two devices for the same meaning.
   - **Never let a visual device carry meaning on its own.** Bold, colour, an icon and a position on the page are all silent to a listener. State the meaning in words as well. "Required fields are marked in red" fails; "Required fields are marked with the word required" works.

6. **Reaching Readers Who Cannot See the Page:**
   - **Link text names its destination.** A screen reader can list every link in a document, read aloud without the sentence around it. "Click here" and a bare web address tell that reader nothing.
   - **Every image that carries meaning has alternative text** describing what it shows, not what it is. An image that carries no meaning is decorative and may say so.
   - **Tables carry a header row**, because a listener hears each cell announced against its column name.
   - **The reading order is the document order.** A sidebar or a floating callout only makes sense out of sequence, so give each one its own heading in the flow.

7. **The Opening Block:**
   - Open every document with its title, a one-line statement of its purpose, and its version or date.
   - Name the intended reader in that block. Part 1 decides who that reader is; this rule decides where the answer appears.

8. **Layering the Detail:**
   - Label the overview explicitly, in any document long enough to need one, so a reader who stops there knows what they hold. It keeps the document's conclusion, the action required, and any essential qualification.
   - Give that label a heading or a word, never a visual treatment alone.
   - Move detail that only some readers need into footnotes, an appendix, or a collapsible block, and keep it reachable from the main path.
   - Use at most **3 levels**: overview, main body, and optional detail. Part 3 governs how a technical explanation is worded across them.

9. **Readers Who Have the Wrong Document:**
   - Tell a reader who needs something else where to go. Link the related documents, the other language versions, or a person to ask.
   - Put that signpost where a reader will look on realising the document is wrong. Near the top works, or at the end of the opening section.
   - Leave it out when no alternative exists, rather than shipping an empty heading.

---

## Contrastive Examples

### Example 1: Structuring Comparative Information
* ❌ **Not aligned (Buried in Prose):**
  ```text
  The Basic plan costs £5 per month and includes 10 GB of storage but no
  priority support, whereas the Pro plan is £15 per month with 100 GB and
  priority support, and the Team plan, at £40 per month, offers 1 TB,
  priority support, and audit logs.
  ```
* ✅ **ISO 24495-5 (Draft) Aligned:**
  > Choose a plan based on storage and support needs:
  >
  > | Plan | Price / month | Storage | Priority support | Audit logs |
  > |------|---------------|---------|------------------|------------|
  > | Basic | £5 | 10 GB | No | No |
  > | Pro | £15 | 100 GB | Yes | No |
  > | Team | £40 | 1 TB | Yes | Yes |

---

## Pre-Output Self-Audit Checklist

Before outputting a complex document, audit against these checks:
- [ ] **Hierarchy depth:** Are there 3 or fewer heading levels below the title?
- [ ] **Navigation:** Does a document with 6 or more sections have a table of contents?
- [ ] **Structure fit:** Are comparisons in tables, sequences in numbered lists, and sets in bullets?
- [ ] **Signal consistency:** Does each visual device carry exactly one meaning?
- [ ] **Evidence over aesthetics:** Does every design element serve a reader need?
- [ ] **Provisional label:** Is the draft status of this standard acknowledged where the document cites it?
- [ ] **Opening block:** Does the document state its purpose, its reader, and its version or date?
- [ ] **Overview:** Is it labelled in words, and does it hold if the detail is removed?
- [ ] **Never invented:** On a restructure, did every promoted sentence already exist in the document?
- [ ] **Signposting:** Can a reader who needs a different document tell where to go?
- [ ] **List restraint:** Is every bullet one paragraph on one idea, nested no deeper than 2 levels?
