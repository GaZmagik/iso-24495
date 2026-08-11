---
name: iso-24495-5
description: Provisional sector-specific Plain Language standard for document design (based on ISO/WD 24495-5, under development). Applied when structuring complex documents so readers can find and navigate content through layout, visual hierarchy, and navigation aids.
metadata:
  version: "0.4.0"
  iso-standard: "ISO/WD 24495-5"
  iso-status: "working-draft"
---

# ISO/WD 24495-5 — Plain Language (Document Design) [PROVISIONAL DRAFT]

> **Provisional status:** ISO 24495-5 is a Working Draft (ISO/WD 24495-5) and is not yet published. This skill is original guidance based on the draft's public scope and established information design practice. It does not reproduce ISO text. Expect revision when the standard is published.

Extends ISO 24495-1:2023 for the visual and structural design of complex documents: reports, specifications, guides, contracts presented as documents, and long-form technical or health information. Visual design works together with linguistic cues to help readers find and navigate a document's structure and content.

## Scope & Execution Boundaries

1. **Thinking Block Exemption:**
   - Internal layout planning and structural reasoning within thinking blocks (`<thought>`, `<thinking>`) are **100% exempt** from these constraints.
   - Plan freely within thinking blocks. Apply document design rules strictly to final user-facing documents.

2. **Design as Engineering, Not Decoration:**
   - Base every design decision on a documented reader need (finding, navigating, comparing, acting). Never add visual elements for aesthetic effect alone.

3. **Content Primacy:**
   - Document design must **never** cut or distort content to fit a layout. Accuracy and completeness supersede visual tidiness.

---

## Quantitative Rules & Hard Constraints (User-Facing Documents)

1. **Visual Hierarchy Limits:**
   - Use at most **3 heading levels** below the document title. Flatten deeper nesting into lists or tables.
   - Make headings state the section's message or task, not just its topic (*"Install the dependencies"* rather than *"Dependencies"*).

2. **Navigation Aids:**
   - Add a table of contents or link list to any document with **6 or more sections**.
   - Keep heading wording identical between the table of contents and the section it points to.

3. **Chunking & White Space:**
   - Present one idea per visual chunk (paragraph, list, table, or callout). Separate chunks with blank lines.
   - Never run two unrelated topics together in one paragraph or one table.

4. **Choosing the Right Structure:**
   - **Comparisons:** Use a table when readers must compare 2 or more items across shared attributes.
   - **Sequences:** Use a numbered list for steps that must happen in order.
   - **Options and collections:** Use a bulleted list for unordered sets of 3 or more items.
   - **Warnings and conditions:** Use a distinct callout (e.g. blockquote or bold lead-in) so readers cannot miss them.

5. **Consistent Visual Signalling:**
   - Give each visual device (bold, italics, blockquotes, code formatting, icons) **one meaning** per document and apply it consistently.
   - Never use the same device for two different meanings, or two devices for the same meaning.

---

## Contrastive Examples

### Example 1: Structuring Comparative Information
* ❌ **Not aligned (Buried in Prose):**
  > "The Basic plan costs £5 per month and includes 10 GB of storage but no priority support, whereas the Pro plan is £15 per month with 100 GB and priority support, and the Team plan, at £40 per month, offers 1 TB, priority support, and audit logs."
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
