// Documents written for the plan pin in `plan-pin.ts`. Each is a shape that
// a change to the structural reading could reach: GitHub alerts of every
// kind, adjacent and apart, alerts in containers and close variants of their
// syntax, and lists whose items hold more than one paragraph.
//
// The pin records what `planDocument` makes of each, so a change to the
// parser that alters a Jev request fails a test that runs without the
// calibration files. Add a specimen here, then run the builder named in
// `plan-pin.ts`. Never change a specimen's text: a changed text needs a new
// name, so the old record cannot be rewritten to fit.

const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

/** One document of the pin, by a name that never changes. */
export interface PlanSpecimen {
  name: string;
  text: string;
}

/** Two alerts of this kind with only a blank line between. */
function adjacentPair(kind: string): string {
  return `# ${kind} guide\n\nOpening sentence.\n\n> [!${kind}]\n> First ${kind.toLowerCase()} body.\n\n> [!${kind}]\n> Second ${kind.toLowerCase()} body.\n\nClosing paragraph.\n`;
}

/** Two alerts of this kind with a paragraph between. */
function separatedPair(kind: string): string {
  return `# ${kind} apart\n\n> [!${kind}]\n> First body.\n\nA paragraph between them.\n\n> [!${kind}]\n> Second body.\n`;
}

/** Every specimen, in a stable order. */
export const PLAN_SPECIMENS: readonly PlanSpecimen[] = [
  ...KINDS.map(kind => ({ name: `alert-adjacent-${kind.toLowerCase()}`, text: adjacentPair(kind) })),
  ...KINDS.map(kind => ({ name: `alert-separated-${kind.toLowerCase()}`, text: separatedPair(kind) })),
  { name: "alert-different-kinds", text: "# Kinds\n\n> [!NOTE]\n> A note.\n\n> [!WARNING]\n> A warning.\n\n> [!TIP]\n> A tip.\n" },
  { name: "alert-three-in-a-row", text: "# Three\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n\n\n\n> [!NOTE]\n> Three.\n" },
  { name: "alert-lower-case", text: "# Case\n\n> [!note]\n> One.\n\n> [!Note]\n> Two.\n" },
  { name: "alert-trailing-text", text: "# Trailing\n\n> [!NOTE] Read this.\n> One.\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-marker-second-line", text: "# Second line\n\n> Lead line.\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-in-list", text: "# In a list\n\n- > [!NOTE]\n  > One.\n\n- > [!NOTE]\n  > Two.\n" },
  { name: "alert-nested-quotation", text: "# Nested\n\n> > [!NOTE]\n> > One.\n>\n> > [!NOTE]\n> > Two.\n" },
  { name: "alert-in-fence", text: "# Fenced\n\n```markdown\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n```\n" },
  { name: "alert-in-html", text: "# HTML\n\n<div>\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n</div>\n" },
  { name: "alert-after-div", text: "# After a div\n\n<div>\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-in-table", text: "# Table\n\n| Kind | Text |\n|---|---|\n| > [!NOTE] | One. |\n" },
  { name: "alert-front-matter", text: "---\ntitle: Alerts\n---\n# Front matter\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-setext-body", text: "# Setext\n\n> [!NOTE]\n> ---\n\n> [!NOTE]\n> Two\n> ===\n" },
  { name: "alert-crlf", text: `# CRLF${CR}\n${CR}\n> [!NOTE]${CR}\n> One.${CR}\n${CR}\n> [!NOTE]${CR}\n> Two.${CR}\n` },
  { name: "alert-tabs", text: `# Tabs\n\n>${TAB}[!NOTE]\n>${TAB}One.\n${TAB}\n> [!NOTE]\n> Two.\n` },
  { name: "alert-non-ascii", text: "# Accents\n\n> [!NOTE]\n> Réglez la vanne.\n\n> [!NOTE]\n> Fermez le robinet à clé.\n" },
  { name: "alert-empty-body", text: "# Empty\n\n> [!NOTE]\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-lazy-line", text: "# Lazy\n\n> [!NOTE]\n> One\ncarried on.\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-comment-between", text: "# Comment\n\n> [!NOTE]\n> One.\n\n<!-- between -->\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-definition-between", text: "# Definition\n\n> [!NOTE]\n> One.\n\n[guide]: guide.md\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-defined-label", text: "# Defined label\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n\n[!NOTE]: https://example.org\n" },
  { name: "alert-break-between", text: "# Break\n\n> [!NOTE]\n> One.\n\n---\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-unclosed-fence", text: "# Fence inside\n\n> [!NOTE]\n> ```\n> code\n\n> [!NOTE]\n> Two.\n" },
  { name: "alert-unknown-kind", text: "# Unknown\n\n> [!DANGER]\n> One.\n\n> [!DANGER]\n> Two.\n" },
  { name: "alert-quote-marker-only", text: "# Marker lines\n\n> [!NOTE]\n> One.\n>\n> [!NOTE]\n> Two.\n" },
  { name: "list-loose", text: "# Loose\n\n- First item.\n\n- Second item.\n\n- Third item.\n" },
  { name: "list-two-paragraphs", text: "# Two paragraphs\n\n- First paragraph of the item.\n\n  Second paragraph of the item.\n- Next item.\n" },
  { name: "list-nested-paragraphs", text: "# Nested\n\n1. Step one.\n\n   Detail of step one.\n\n   - A bullet.\n\n     Its second paragraph.\n2. Step two.\n" },
  { name: "list-code-in-item", text: "# Code\n\n- Run this:\n\n  ```sh\n  make\n  ```\n\n  Then check the log.\n" },
  { name: "list-quote-in-item", text: "# Quote in item\n\n- Item text.\n\n  > A quotation in the item.\n\n  More item text.\n" },
];
