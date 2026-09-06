---
name: iso-24495-3
description: Sector-specific Plain Language standard for science and technical writing (ISO 24495-3:2026). Applied during software documentation, architecture specs, and technical analysis.
metadata:
  version: "0.7.0"
  iso-standard: "ISO 24495-3:2026"
  iso-status: "published"
---

# ISO 24495-3:2026 - Plain Language (Science and Technical Communication)

Extends ISO 24495-1:2023 for software architecture, technical documentation, algorithm explanations, code reviews, and scientific analysis.

## Scope & Execution Boundaries

1. **Thinking Block Exemption:**
   - Internal architectural analysis, code reasoning, and mental trace blocks (`<thought>`, `<thinking>`) are **100% exempt** from plain language constraints.
   - Reason freely within thinking blocks. Apply plain language rules strictly to final user-facing technical text.

2. **Code & Data Preservation Immunity:**
   - Code blocks, stack traces, abstract syntax tree (AST) dumps, terminal commands, and exact line quotes are **completely immune** to sentence length and simplification constraints. Never alter, abbreviate, or mangle working code or logs to fit text constraints.

3. **Document Design Applies Here Too:**
   - A technical document is a document, so `iso-24495-5` loads alongside this skill. Part 5 governs headings, navigation, chunking, signalling, and readers who cannot see the page.
   - It loads for a document, not for every explanation. A code review comment and a chat answer are explanations, and the rules below still govern them.
   - Where the two appear to conflict, follow the resolution named in the rules below.

---

## Quantitative Rules & Hard Constraints (User-Facing Output)

1. **Progressive Disclosure Ordering:**
   Structure all technical explanations in three strict sequential stages:
   1. **System Purpose:** High-level operational intent (1 sentence).
   2. **Architecture & Data Flow:** Diagram (Mermaid) or summary table, each with a text alternative.
   3. **Implementation Detail:** Concrete code snippet with exact file citations.

   These stages order an explanation, and Part 5's three levels order a document. They are different axes rather than two versions of one, so they do not map one to one. Where the explanation is a document:
   - The purpose sentence supplies Part 5's opening block, and opens its overview. That overview also keeps the conclusion, the action required and any essential qualification, which one sentence does not.
   - Stages 2 and 3 sit in the main body, in that order.
   - Part 5's optional detail holds what a reader can skip and still act on. No stage covers it, so nothing is demoted there by default.

2. **File & Code Citation Standard:**
   - Quote exact file locations using markdown links with line numbers: `[filename](file:///path/to/file#L10-L20)`.
   - Never describe code changes or logic without citing the exact file and line range.

3. **Terminology & Acronym Standardisation:**
   - Define every acronym or domain-specific term upon first use in parentheses (e.g. *"Abstract Syntax Tree (AST)"*).
   - Use consistent symbol names across text, code snippets, and diagrams.

4. **Diagrams and Their Alternatives:**
   - Give every diagram a text alternative saying what it shows, not what it is. Part 5 requires that of any image carrying meaning, and stage 2 above mandates a diagram, so this rule says where the alternative goes.
   - A Mermaid diagram reaches a listener as its source text, which is not an explanation. So the alternative is prose beside the diagram, never the diagram's own labels.

---

## Contrastive Examples

### Example 1: Concurrency Control Explanation
* ❌ **Not aligned (Dense & Abstract):**
  ```text
  In order to prevent race conditions during concurrent state mutations
  within the execution pipeline, a mutex lock mechanism is introduced prior
  to updating the shared buffer allocation in memory.
  ```
* ✅ **ISO 24495-3 Aligned:**
  > **Concurrency Control:**
  > Acquire a Mutex Lock to prevent data corruption during concurrent writes.
  > 
  > **Implementation:**
  > The locking logic is implemented in [`state_manager.rs:L45-L52`](file:///src/state_manager.rs#L45-L52):
  > ```rust
  > let _guard = self.mutex.lock().unwrap();
  > self.buffer.update(data);
  > ```

---

## Pre-Output Self-Audit Checklist

Before outputting technical text, audit against these checks:
- [ ] **Progressive structure:** Is system purpose stated before architecture and code?
- [ ] **Exact citations:** Are code citations backed by `file:///` links and line numbers?
- [ ] **Acronym definitions:** Are acronyms and specialized terms defined upon first use?
- [ ] **Visual aids:** Are diagrams or tables used to explain multi-step flows?
- [ ] **Code immunity:** Are code snippets and commands intact and un-mangled?
- [ ] **Text alternatives:** Does every diagram carry prose saying what it shows?
- [ ] **Layering:** Where the explanation is a document, do the stages sit in Part 5's levels as rule 1 says?
- [ ] **Design applied:** Did `iso-24495-5` run over the document as well as this skill?
