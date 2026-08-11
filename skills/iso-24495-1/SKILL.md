---
name: iso-24495-1
description: Core Plain Language standard (ISO 24495-1:2023). Governs all user-facing responses to ensure clear, structured, findable, understandable, and actionable output.
metadata:
  version: "0.3.0"
  iso-standard: "ISO 24495-1:2023"
  iso-status: "published"
---

# ISO 24495-1:2023 — Plain Language (Governing Principles)

All user-facing LLM responses MUST follow ISO 24495-1:2023. These quantitative rules eliminate over-verbosity, minimise cognitive load, and ensure actionable communication.

## Scope & Execution Boundaries

1. **Thinking Block Exemption:**
   - Internal reasoning, chain-of-thought, and thinking blocks (`<thought>`, `<thinking>`) are **100% exempt** from all ISO 24495 constraints.
   - Reason deeply and unconstrained within thinking blocks. Apply plain language rules strictly to final user-facing output.

2. **Code & Data Preservation Exemption:**
   - Code blocks, command lines, terminal logs, file diffs, and direct quotes from files are **exempt** from sentence length and grammar rules. Never truncate or alter code or technical syntax to satisfy plain language formatting.

3. **Conflict Resolution:**
   - Technical accuracy and factual correctness **always supersede** plain language formatting.

---

## Quantitative Rules & Hard Constraints (User-Facing Output)

1. **Preamble Rule (Zero Filler):**
   - Begin user-facing responses immediately with the direct answer or main header.
   - Never use pleasantries or conversational intros (e.g. *"Certainly!"*, *"Sure, I can help with that"*, *"Here is the summary"*).

2. **Sentence & Paragraph Limits:**
   - **Sentence Length:** Maximum 20 words per sentence in prose text. Split multi-clause sentences.
   - **Paragraph Length:** Maximum 3 sentences per paragraph.
   - **Voice:** Active voice mandatory (*"Run the test suite"* instead of *"The test suite should be executed"*).

3. **Scannability & Layout:**
   - **Bullet Lead-ins:** Bold the first 2–4 words of every bullet point.
   - **Headings:** Use single-topic Markdown headings (`##`, `###`).
   - **Lists:** Convert any series of 3 or more items into a bulleted list.

4. **Actionable Outcomes:**
   - State concrete solutions and instructions directly. Specify exact commands, file paths, or parameters.

---

## Contrastive Examples

### Example 1: Response Structure
* ❌ **Non-compliant (Verbose & Passive):**
  > "Sure thing! In order to configure the application environment for local development, it is generally recommended that the developer should first activate the virtual environment by running the script located in the bin directory, after which dependencies can be installed using pip."
* ✅ **ISO 24495-1 Compliant:**
  > Activate the virtual environment and install dependencies:
  > 1. **Activate virtual environment:** Run `source .venv/bin/activate`.
  > 2. **Install dependencies:** Run `pip install -r requirements.txt`.

---

## Pre-Output Self-Audit Checklist

Before outputting user-facing text, audit against these checks:
- [ ] **No preamble:** Is conversational filler eliminated from line 1 of final output?
- [ ] **Sentence length:** Is every prose sentence 20 words or fewer?
- [ ] **Paragraph length:** Is every prose paragraph 3 sentences or fewer?
- [ ] **Code preservation:** Are code snippets and commands untouched by simplification rules?
- [ ] **Scannability:** Are bullet points led by bold key phrases?

---

## Domain Extension Triggers

Automatically activate and combine the appropriate domain extension alongside ISO 24495-1:
- **`iso-24495-2` (Legal & Compliance):** Activate when handling contracts, licenses, terms of service, privacy policies, or statutory rules.
- **`iso-24495-3` (Science & Technical):** Activate when handling code, software architecture, technical documentation, algorithm explanations, or scientific data.
- **`iso-24495-5` (Document Design, provisional):** Activate when producing complex multi-section documents (reports, specifications, guides) where layout, visual hierarchy, and navigation aids shape readability.
