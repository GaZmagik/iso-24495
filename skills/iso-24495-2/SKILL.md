---
name: iso-24495-2
description: Sector-specific Plain Language standard for legal communication (ISO 24495-2:2025). Applied during contract drafting, license review, and legal/compliance writing.
metadata:
  version: "0.7.0"
  iso-standard: "ISO 24495-2:2025"
  iso-status: "published"
---

# ISO 24495-2:2025 - Plain Language (Legal Communication)

Extends ISO 24495-1:2023 for legal documents, contractual provisions, licenses, and regulatory compliance.

## Scope & Execution Boundaries

1. **Thinking Block Exemption:**
   - Internal reasoning and legal analysis within thinking blocks (`<thought>`, `<thinking>`) are **100% exempt** from plain language constraints.
   - Reason exhaustively within thinking blocks. Apply plain language rules strictly to final user-facing legal text.

2. **Legal Enforceability Primacy:**
   - Plain language simplification must **never** alter legal rights, liabilities, or contractual enforceability. If a term of art is legally required to avoid ambiguity, retain it and provide a plain explanation.

3. **Document Design Applies Here Too:**
   - A legal document is a document, so `iso-24495-5` loads alongside this skill. Part 5 governs headings, navigation, chunking, signalling, and readers who cannot see the page.
   - This skill adds only what Part 5 leaves uncovered: defined terms, cross-references, clause identifiers, and the summary layer.
   - Where the two appear to conflict, follow the resolution named in the rules below.

---

## Quantitative Rules & Hard Constraints (User-Facing Output)

1. **Modal Verb Standardisation:**
   - Use **must** for mandatory obligations (*"The User must pay..."*).
   - Use **must not** for prohibitions (*"The User must not copy..."*).
   - Use **may** for discretionary permissions, as in "the User may end the agreement".
   - **Banned Words:** Never use *"shall"*, *"should"*, *"hereby"*, *"hereinafter"*, *"wherefore"*, or *"parties of the first part"*.

2. **Explicit Subject Actor Identification:**
   - Every obligation sentence MUST explicitly name the subject actor (*"The Licensee must notify..."* rather than *"Notice must be provided..."*).

3. **Conditional Clause Formatting:**
   - Format multi-condition legal clauses as structured itemised lists:
     - **Trigger / Prerequisite:** What condition initiates the rule.
     - **Obligation / Action:** What action must or may be taken.
     - **Consequence:** What occurs upon non-compliance.

4. **Defined Terms:**
   - Define each term once, and use it unchanged everywhere after. Two words for one concept invite an argument that they mean two things.
   - Put the definition where the reader first meets the term. Where a term runs throughout, collect the definitions in one section and point the first use at it.
   - Write a term out in full where the document uses it once, rather than defining it.
   - Say in words that a term is defined, and where. Capital letters are silent to a listener, so **Confidential Information** on its own tells them nothing.

5. **Cross-References:**
   - Name what the referenced clause says, alongside its identifier. Write *"the notice deadline in clause 4.2"* rather than *"clause 4.2"*.
   - Keep that wording identical to the referenced clause's own heading or opening line.
   - Point at the clause carrying the obligation, never at one that only points somewhere else.

6. **Clause Identifiers:**
   - Number every operative clause, because a reader, a court and a counterparty must all cite the same thing.
   - Write the identifier into the clause text rather than as list markup. Markdown numbers an ordered list 1, 2, 3, so a compound identifier such as 4.2.1 survives only when it is written in the text.
   - This is the one place a legal document departs from Part 5's rule that a sequence stays an ordered list.
   - A clause identifier is neither a heading nor list numbering. So it does not count against Part 5's heading limit, and Part 5's rule on numbering headings does not govern it.
   - Keep an identifier for the life of the document. An amendment adds a clause, or marks one deleted, and leaves every existing number where it is, because filings, correspondence and other contracts cite those numbers.

7. **The Summary Layer:**
   - Place a plain summary of the terms the reader must act on directly after Part 5's opening block. Cover what they must do, what they must pay, when the agreement ends, and how to leave it.
   - The summary **must** state that the operative text governs, and **must** name where that text starts. A summary a reader could mistake for the agreement changes their rights, which the enforceability boundary above forbids.
   - The summary **must not** add, qualify or remove an obligation. Where a term cannot be stated plainly without qualifying it, leave it out and point to its clause.
   - Map the document onto Part 5's three levels of detail. The summary is the overview, the operative terms are the main body, and the schedules are the optional detail.
   - A contract's section names are the reference case Part 5 already allows, and not a new exception. A reader jumps to Payment, Termination or Liability by subject, so each keeps its subject as its name.

---

## Contrastive Examples

### Example 1: Contractual Obligation
* ❌ **Not aligned (Archaic Legalese):**
  ```text
  The Licensee shall hereinafter hold harmless and indemnify the Licensor
  from and against any and all claims wherefore notice has not been provided
  within thirty (30) days.
  ```
* ✅ **ISO 24495-2 Aligned:**
  > **Indemnification Notice Requirement:**
  > 1. **Notice deadline:** The Licensee must notify the Licensor of any claim within 30 days.
  > 2. **Consequence:** If the Licensee fails to meet this deadline, the Licensee must cover all resulting losses and legal costs incurred by the Licensor.

### Example 2: The Summary Layer
* ❌ **Not aligned (no governing text named, and an obligation stated without its qualification):**
  ```text
  Summary: You can cancel at any time and we will refund the current month.
  ```
* ✅ **ISO 24495-2 Aligned:**
  > **Summary of your main terms**
  >
  > This summary helps you find your obligations. The agreement itself, starting at clause 1, is what governs.
  >
  > - **What you pay:** £15 each month, in advance. Clause 3 covers late payment.
  > - **What you must do:** Keep your account details current. Clause 5 lists your other obligations.
  > - **When it ends:** After 12 months, unless you renew. Clause 6 has the renewal terms.
  > - **How to leave:** You may cancel, giving the notice set out in clause 7.

---

## Pre-Output Self-Audit Checklist

Before outputting legal text, audit against these checks:
- [ ] **No legalese:** Are terms like *"shall"*, *"hereinafter"*, and *"hereby"* eliminated?
- [ ] **Modal verbs:** Are obligations expressed using only *must*, *must not*, or *may*?
- [ ] **Explicit subjects:** Is every obligation attached to a clearly named actor?
- [ ] **Structured clauses:** Are complex conditions presented as itemised lists?
- [ ] **Legal accuracy:** Is legal enforceability preserved?
- [ ] **Defined terms:** Is each term defined once, used unchanged, and reachable from its first use?
- [ ] **Cross-references:** Does each name what the clause says, as well as its identifier?
- [ ] **Identifiers:** Is every operative clause numbered, with existing numbers untouched by amendment?
- [ ] **Summary:** Does it name the governing text, and add, qualify and remove nothing?
- [ ] **Design applied:** Did `iso-24495-5` run over the document as well as this skill?
