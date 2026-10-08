import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuditCli, selectDocuments, formatFindings, formatPlan, safeText, type AuditDependencies } from "../../../scripts/lib/jev/audit.ts";
import { MODEL } from "../../../scripts/lib/jev/catalogue.ts";
import { planDocument } from "../../../scripts/lib/jev/engine.ts";
import { runCli as runTextCli } from "../../../../iso-24495-text-audit/scripts/audit-text.ts";
import { runCli as runDesignCli } from "../../../../iso-24495-design-audit/scripts/design-audit.ts";

test("preview is offline; send alone is not consent; explicit terminal agreement sends a frozen plan", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-audit-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\nVersion 1.0\n\nThe supplier shall act.\n");
    let sent = 0;
    const output: string[] = [];
    const dependencies: AuditDependencies = {
      env: { TYPESAFE_API_KEY: "key" }, now: () => new Date("2026-10-03T17:00:00Z"),
      terminal: { inputIsTTY: true, outputIsTTY: true, prompt: async () => "yes" },
      client: { fetch: async (_url, init) => { sent++; const body = JSON.parse(init.body); return Response.json({ model: MODEL, answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, id === "purpose" ? { type: "choice", choice: "neither", confidence: 0.86, probabilities: { both: 0.1, task_only: 0.02, scope_only: 0.02, neither: 0.86 } } : { type: "noul", noul: id === "colour_only" ? 0.17 : 0.5 }])) }); }, clock: { schedule: () => () => {} }, sleep: async () => {} },
      writeLog: record => { expect(record.paths).toEqual([file]); expect(record.disclosureVersion).toBeDefined(); expect(record.timestamp).toBe("2026-10-03T17:00:00.000Z"); },
    };
    const run = (mode: "text" | "design", args: string[]) => runAuditCli(mode, ["bun", "cli", file, "--project-dir", directory, ...args], text => output.push(text), text => output.push(text), dependencies);
    expect(await run("text", ["--jev-preview"])).toBe(0);
    expect(sent).toBe(0);
    expect(output.join("\n")).toContain("companion");
    expect(await run("text", ["--send"])).toBe(2);
    expect(await run("text", ["--jev", "--send"])).toBe(0);
    expect(sent).toBe(3);
    expect(output.join("\n")).toContain("Neither the reader's task nor the document's scope");
    expect(await run("design", ["--send", "--yes", "--json", join(directory, "report.json")])).toBe(0);
    const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
    expect(report.jev.coverage[0].checks.colour.pass).toBe(2);
    expect(report.jev.results.some(result => result.band === "pass")).toBe(false);
    expect(report.jev.results[0].state).toBeUndefined();
    expect(report.jev.results[0].stateHash).toBeDefined();
    expect(report.jev.evidence).toEqual([
      { id: "colour_only:pass", cutOff: "0.83", dependencies: [], clusters: 300, wrong: 0, bound: "0.9900639180555423" },
      { id: "purpose:fail", cutOff: "0.87", dependencies: [], clusters: 187, wrong: 2, bound: "0.9667172820800516" },
      { id: "purpose:diagnosis:neither", cutOff: "0.83", dependencies: ["purpose:fail"], clusters: 60, wrong: 0, bound: "0.9512970866899024" },
    ]);
    expect(report.jev.results[0].diagnosisGate).toEqual({ id: "purpose:diagnosis:neither", score: "0.86", cutOff: "0.83", prerequisite: "purpose:fail" });
    expect(output.join("\n")).toContain("| purpose:diagnosis:neither | 0.83 | purpose:fail | 60 | 0 | 0.9512970866899024 |");
    expect(output.join("\n")).toContain("neither score 0.86, cut-off 0.83, prerequisite purpose:fail");
    const before = sent;
    dependencies.terminal.inputIsTTY = false;
    expect(await run("design", ["--send"])).toBe(2);
    expect(sent).toBe(before);
    expect(await run("design", ["--send", "--yes", "--include-judged-text"])).toBe(2);
    dependencies.terminal.inputIsTTY = true;
    dependencies.terminal.prompt = async () => { writeFileSync(file, "# Changed\n\nText."); return "yes"; };
    expect(await run("design", ["--send"])).toBe(2);
    expect(sent).toBe(before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("both wrappers share offline preview and selection warnings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-selection-"));
  try {
    const docs = join(directory, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "one.md"), "# One\n\nVersion 1.0\n\nWords.");
    writeFileSync(join(docs, "two.md"), "# Two\n\nWords.");
    writeFileSync(join(docs, "plain.txt"), "Words.");
    const link = join(docs, "link");
    symlinkSync(directory, link, "junction");
    const selected = selectDocuments(docs, directory);
    expect(selected.documents).toHaveLength(2);
    expect(selected.skipped).toEqual([link]);
    expect(selectDocuments(link, directory).paths).toEqual([]);
    const blocked = join(docs, "two.md");
    expect(selectDocuments(docs, directory, "text", (path, encoding) => { if (path === blocked) throw new Error(); return readFileSync(path, encoding); }).skipped).toEqual([link, blocked]);
    const output: string[] = [];
    const deps: AuditDependencies = { read: (path, encoding) => { if (path === blocked) throw new Error(); return readFileSync(path, encoding); } };
    expect(await runTextCli(["bun", "cli", docs, "--jev-preview", "--project-dir", directory], text => output.push(text), text => output.push(text), deps)).toBe(0);
    expect(output.join("\n")).toContain("skipped unreadable entry");
    expect(await runDesignCli(["bun", "cli", docs, "--project-dir", directory], text => output.push(text), text => output.push(text), deps)).toBe(0);
    expect(formatPlan(selected)).toContain("two.md");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("argument conflicts and local failures are classified without transmission", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-arguments-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\nWords.");
    let calls = 0;
    const out: string[] = [];
    const dependencies: AuditDependencies = { env: { TYPESAFE_API_KEY: "key" }, terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => { throw new Error(); } }, client: { fetch: async () => { calls++; throw new Error(); }, clock: { schedule: () => () => {} }, sleep: async () => {} }, writeLog: () => {} };
    const run = (args: string[], mode: "text" | "design" = "design") => runAuditCli(mode, ["bun", "cli", file, "--project-dir", directory, ...args], text => out.push(text), text => out.push(text), dependencies);
    for (const args of [["--unknown"], ["--send", "--send"], ["--json"], ["--project-dir", "--send"], ["--yes"], ["--include-judged-text"], ["--no-front-matter"], ["--consent", "file"], ["--jev-preview"]]) expect(await run(args)).toBe(2);
    for (const args of [["--jev"], ["--jev-preview", "--send"], ["--jev-preview", "--jev"], ["--jev", "--send", "--no-front-matter"]]) expect(await run(args, "text")).toBe(2);
    expect(await runAuditCli("design", ["bun", "cli", "--send"], () => {}, () => {}, dependencies)).toBe(2);
    expect(await run(["--json", join(directory, "missing/report.json")])).toBe(1);
    dependencies.client.validate = () => { throw new Error("secret"); };
    expect(await run([])).toBe(3);
    delete dependencies.client.validate;
    dependencies.terminal.inputIsTTY = true;
    dependencies.terminal.outputIsTTY = true;
    expect(await run(["--send"])).toBe(2);
    for (const answer of ["no", "YES", " yes", "yes ", ""]) {
      dependencies.terminal.prompt = async () => answer;
      expect(await run(["--send", "--yes"])).toBe(2);
    }
    expect(calls).toBe(0);
    dependencies.terminal.prompt = async () => "yes";
    dependencies.env.TYPESAFE_API_KEY = "key\n";
    expect(await run(["--send"])).toBe(4);
    dependencies.env.TYPESAFE_API_KEY = "key";
    expect(await run(["--send", "--json", join(directory, "incomplete.json")])).toBe(3);
    const report = JSON.parse(readFileSync(join(directory, "incomplete.json"), "utf8"));
    expect(report.jev.complete).toBe(false);
    expect(report.jev.results).toEqual([]);
    expect(report.jev.coverage[0].checks.purpose.skipped).toBe(1);
    expect(out.join("\n")).not.toContain("secret");
    expect(await runAuditCli("design", ["bun", "cli", join(directory, "missing.md")], () => {}, () => {}, dependencies)).toBe(1);
    const textFile = join(directory, "note.txt");
    writeFileSync(textFile, "The supplier shall act.");
    expect(selectDocuments(textFile, directory, "text").documents[0].plan.candidates).toHaveLength(0);
    expect(() => selectDocuments(textFile, directory)).toThrow("Unsupported");
    expect(safeText("ab\u001b\u202ecd\n")).toBe("ab cd");
    expect(formatPlan(selectDocuments(directory, directory, "text"))).toContain("Selected");
    expect(formatFindings({ complete: true, limitation: "test", evidence: [], results: [], localFindings: [], coverage: [] })).toContain("Only purpose and colour");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("complete exports, local title findings, unsure decisions and log failures stay distinct", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-exports-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\nVersion 1.0\n\nWords.");
    const dependencies: AuditDependencies = { env: { TYPESAFE_API_KEY: "key" }, terminal: { inputIsTTY: false, outputIsTTY: true, prompt: async () => "no" }, client: { fetch: async (_url, init) => { const body = JSON.parse(init.body); return Response.json({ model: MODEL, answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, id === "purpose" ? { type: "choice", choice: "both", confidence: 0.8, probabilities: { both: 0.8, task_only: 0.1, scope_only: 0.05, neither: 0.05 } } : { type: "noul", noul: 0.5 }])) }); }, clock: { schedule: () => () => {} }, sleep: async () => {} } };
    const out: string[] = [];
    const run = (args: string[]) => runAuditCli("text", ["bun", "cli", file, "--project-dir", directory, ...args], text => out.push(text), text => out.push(text), dependencies);
    const reportFile = join(directory, "report.json");
    expect(await run(["--jev", "--send", "--yes", "--json", reportFile, "--include-judged-text"])).toBe(0);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(report.jev.results[0].state).toBeDefined();
    expect(report.jev.results[0].state.opening).toContain("Title");
    expect(report.jev.results[0].band).toBe("unsure");
    expect(report.mechanical.files["doc.md"]).toBeDefined();
    const log = JSON.parse(readFileSync(join(directory, ".iso-24495-4/jev-audit.jsonl"), "utf8").trim());
    expect(log.complete).toBe(true);
    expect(log.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(out.join("\n")).toContain("saves full judged document text locally");
    dependencies.writeLog = () => { throw new Error("private"); };
    expect(await run(["--jev", "--send", "--yes"])).toBe(1);
    delete dependencies.writeLog;
    expect(await run(["--jev", "--send", "--yes", "--json", join(directory, "missing/report.json")])).toBe(1);
    writeFileSync(file, "Words.\n");
    expect(await run(["--jev-preview", "--json", reportFile])).toBe(0);
    expect(JSON.parse(readFileSync(reportFile, "utf8")).jev.localFindings[0].rule).toBe("opening-title");
    dependencies.terminal = { inputIsTTY: true, outputIsTTY: true, prompt: async () => { rmSync(file); return "yes"; } };
    expect(await run(["--jev", "--send"])).toBe(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// Two functions decide what front matter is. The calibrated guard that the plan
// uses accepts a leading "---" block only when each line has a conservative
// shape, and a tab after a YAML colon fails it. The plan then read the metadata
// as prose and queued it for sending.
const TAB_BLOCK = "---\nversion: 1.0\napi_key:\tPRIVATE_SENTINEL\n\n---\n# Tab guide\n\nTab instructions. The supplier shall act.";
const SPACE_BLOCK = "---\nversion: 1.0\napi_key: SPACE_SENTINEL\n\n---\n# Space guide\n\nSpace instructions.";
const NO_BLOCK = "# Plain guide\n\nPlain instructions.";
const REFUSAL = "front matter could not be recognised safely";

/** Dependencies whose transport keeps every request body and answers each one so that it passes. */
function recordingDependencies(bodies: string[]): AuditDependencies {
  return {
    env: { TYPESAFE_API_KEY: "key" }, now: () => new Date("2026-10-06T12:00:00Z"),
    terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
    client: { fetch: async (_url, init) => { bodies.push(init.body); const body = JSON.parse(init.body); return Response.json({ model: MODEL, answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, id === "purpose" ? { type: "choice", choice: "both", confidence: 0.8, probabilities: { both: 0.8, task_only: 0.1, scope_only: 0.05, neither: 0.05 } } : { type: "noul", noul: 0.5 }])) }); }, clock: { schedule: () => () => {} }, sleep: async () => {} },
    writeLog: () => {},
  };
}

test("a leading block the calibrated guard does not recognise is refused in the preview and never sent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-front-matter-"));
  try {
    writeFileSync(join(directory, "tab.md"), TAB_BLOCK);
    writeFileSync(join(directory, "space.md"), SPACE_BLOCK);
    writeFileSync(join(directory, "plain.md"), NO_BLOCK);
    const bodies: string[] = [];
    const out: string[] = [];
    const warnings: string[] = [];
    const dependencies = recordingDependencies(bodies);
    const run = (mode: "text" | "design", args: string[]) => runAuditCli(mode, ["bun", "cli", directory, "--project-dir", directory, ...args], text => out.push(text), text => warnings.push(text), dependencies);

    // Agreement is given on the preview, so the refusal has to be there.
    expect(await run("design", [])).toBe(0);
    expect(out.join("\n")).toContain(`- tab.md: not sent, because its ${REFUSAL}.`);
    expect(out.join("\n")).toContain("Documents not sent: 1 of 3.");
    expect(out.join("\n")).toContain("- space.md: 1 eligible openings, 1 eligible blocks, 2 requests.");
    expect(out.join("\n")).toContain("Total: 4 requests, 8 questions.");
    expect(warnings).toEqual([`warning: not sent: tab.md: ${REFUSAL}`]);
    expect(bodies).toHaveLength(0);

    const selection = selectDocuments(directory, directory);
    expect(selection.documents.map(document => [document.file, document.refusal, document.plan.candidates.length]))
      .toEqual([["plain.md", undefined, 2], ["space.md", undefined, 2], ["tab.md", REFUSAL, 0]]);
    expect(selection.documents[0].plan).toEqual(planDocument(NO_BLOCK));
    expect(selection.documents[1].plan).toEqual(planDocument(SPACE_BLOCK));
    expect(selection.paths).toHaveLength(3);

    const reportFile = join(directory, "report.json");
    out.length = 0;
    expect(await run("design", ["--send", "--yes", "--json", reportFile])).toBe(0);
    expect(bodies).toHaveLength(4);
    const sent = bodies.join("\n");
    expect(sent).toContain("Space instructions.");
    expect(sent).toContain("Plain instructions.");
    for (const withheld of ["PRIVATE_SENTINEL", "api_key", "Tab instructions", "Tab guide", "SPACE_SENTINEL"]) expect(sent).not.toContain(withheld);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(report.jev.notSent).toEqual([{ file: "tab.md", reason: REFUSAL }]);
    expect(report.jev.complete).toBe(true);
    expect(out.join("\n")).toContain("Not sent: `tab.md`, because its " + `${REFUSAL}.`);

    // The mechanical audit sends nothing, so it still reads the refused document.
    out.length = 0;
    expect(await run("text", ["--jev-preview"])).toBe(0);
    expect(out.join("\n")).toContain("| `tab.md` | 8 | legalese | banned term \"shall\" |");
    expect(bodies).toHaveLength(4);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a refused document selected alone completes with nothing sent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-front-matter-alone-"));
  try {
    const file = join(directory, "tab.md");
    writeFileSync(file, TAB_BLOCK);
    const bodies: string[] = [];
    const out: string[] = [];
    const logged: string[][] = [];
    const dependencies = recordingDependencies(bodies);
    dependencies.writeLog = record => { logged.push(record.paths); };
    expect(await runAuditCli("design", ["bun", "cli", file, "--project-dir", directory, "--send", "--yes"], text => out.push(text), text => out.push(text), dependencies)).toBe(0);
    expect(bodies).toHaveLength(0);
    expect(out.join("\n")).toContain("Total: 0 requests, 0 questions.");
    expect(out.join("\n")).toContain("Documents not sent: 1 of 1.");
    expect(logged).toEqual([[file]]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the refusal covers any closed leading block the guard rejects, and nothing else", () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-front-matter-shapes-"));
  try {
    const refusalFor = (text: string, name = "doc.md") => {
      writeFileSync(join(directory, name), text);
      return selectDocuments(join(directory, name), directory, "text").documents[0];
    };
    // Not YAML at all, and still refused: a block someone meant as metadata can be
    // malformed, and a test that needed valid YAML would send exactly that block.
    expect(refusalFor("---\nkey: [unclosed\nsecret here\n---\n# Title\n\nWords.").refusal).toBe(REFUSAL);
    expect(refusalFor("---\nsecret:\tvalue\n...\n# Title\n\nWords.").refusal).toBe(REFUSAL);
    expect(refusalFor("---\r\nsecret:\tvalue\r\n---\r\n# Title\r\n\r\nWords.").refusal).toBe(REFUSAL);
    // The case the wider test costs: a document that opens with a rule and holds another.
    const ruled = refusalFor("---\n\nA paragraph a reader reads.\n\n---\n\n# Title\n\nWords.");
    expect(ruled.refusal).toBe(REFUSAL);
    expect(ruled.plan).toEqual({ candidates: [], findings: [] });

    // One rule with nothing closing it is not a block, so the document is planned as before.
    const opened = "---\n\n# Title\n\nWords.";
    expect(refusalFor(opened).refusal).toBeUndefined();
    expect(refusalFor(opened).plan).toEqual(planDocument(opened));
    // A rule lower down is not a leading block.
    const lower = "# Title\n\nWords.\n\n---\n\nMore words.\n\n---\n";
    expect(refusalFor(lower).refusal).toBeUndefined();
    expect(refusalFor(lower).plan).toEqual(planDocument(lower));
    // A text file is never planned, so there is nothing to refuse.
    expect(refusalFor(TAB_BLOCK, "note.txt").refusal).toBeUndefined();
    expect(refusalFor(TAB_BLOCK, "note.txt").plan.candidates).toHaveLength(0);

    expect(formatFindings({ complete: true, limitation: "test", evidence: [], results: [], localFindings: [], coverage: [], notSent: [{ file: `a${String.fromCharCode(27)}[2Jb.md`, reason: REFUSAL }] }))
      .toContain("Not sent: " + String.fromCharCode(96) + `a${String.fromCharCode(92)}u001b[2Jb.md` + String.fromCharCode(96) + `, because its ${REFUSAL}.`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// This one confirms what the Jev audit already did, so it passed on its first
// run. It is here so the design audit is held to the same test as the others.
test("the Jev audit prints a file name, a finding and an excerpt without control characters", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-unread-"));
  try {
    const [escape, control, override] = [27, 0x9b, 0x202e].map(code => String.fromCharCode(code)) as [string, string, string];
    // Windows refuses an escape character in a file name and allows the other two.
    const name = `gu${override}ide${control}.md`;
    writeFileSync(join(directory, name), `# Title${escape}[2J\n\nUse [here](https://x.invalid/${escape}[2J${control}) for the ${override}guide.\n`);
    const bodies: string[] = [];
    const out: string[] = [];
    const run = (mode: "text" | "design", args: string[]) => runAuditCli(mode, ["bun", "cli", directory, "--project-dir", directory, ...args], text => out.push(text), text => out.push(text), recordingDependencies(bodies));
    expect(await run("text", ["--jev-preview"])).toBe(0);
    expect(await run("text", ["--jev", "--send", "--yes"])).toBe(0);
    expect(await run("design", ["--send", "--yes"])).toBe(0);
    const printed = out.join("\n");
    for (const character of [escape, control, override]) expect(printed).not.toContain(character);
    // The file name is a path, so each character is shown as its code. A finding and an
    // excerpt are quoted wording, where it becomes a space.
    const slash = String.fromCharCode(92);
    const shownName = `gu${slash}u202eide${slash}u009b.md`;
    // In a table the name is a code span. The preview is plain text, and names it bare.
    const tick = String.fromCharCode(96);
    expect(printed).toContain(`| ${tick}${shownName}${tick} | 3 | link-text | link text "here" describes no destination (https://x.invalid/ [2J ) |`);
    expect(printed).toContain(`- ${shownName}: 1 eligible openings, 1 eligible blocks, 2 requests.`);
    expect(printed).toContain("Excerpt: # Title [2J Use [here](https://x.invalid/ [2J ) for the guid |");
    expect(printed).toContain("Excerpt: Use here for the guide. |");
    expect(bodies.length).toBeGreaterThan(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// Four workers share one queue. A worker that meets a failure sets a flag, and
// every worker checks the flag before it takes the next request. Without that
// check the other requests were still sent after the run had already failed,
// and their verdicts were then thrown away.
test("once a reply fails, no request that is still queued is sent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-stop-"));
  try {
    const file = join(directory, "doc.md");
    const paragraphs = Array.from({ length: 20 }, (_, index) => `Paragraph number ${index + 1} of the guide.`);
    writeFileSync(file, `# Title\n\n${paragraphs.join("\n\n")}\n`);
    expect(selectDocuments(file, directory).documents[0].plan.candidates).toHaveLength(21);
    let sent = 0;
    let logged: { complete: boolean; digest: string } | undefined;
    const out: string[] = [];
    const dependencies: AuditDependencies = {
      env: { TYPESAFE_API_KEY: "key" },
      terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
      // HTTP 400 is refused at once and never tried again, so each request is one call.
      client: { fetch: async () => { sent++; return new Response("refused", { status: 400 }); }, clock: { schedule: () => () => {} }, sleep: async () => {} },
      writeLog: record => { logged = record; },
    };
    const reportFile = join(directory, "report.json");
    expect(await runAuditCli("design", ["bun", "cli", file, "--project-dir", directory, "--send", "--yes", "--json", reportFile], text => out.push(text), text => out.push(text), dependencies)).toBe(3);
    // One request for each of the four workers, which all started before any reply arrived.
    expect(sent).toBe(4);
    expect(logged?.complete).toBe(false);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(report.jev.complete).toBe(false);
    expect(report.jev.results).toEqual([]);
    expect(out.join("\n")).toContain("Jev execution is incomplete.");

    // The same document sends all 21 when nothing fails, so the 4 above is the stop and not a limit.
    const bodies: string[] = [];
    expect(await runAuditCli("design", ["bun", "cli", file, "--project-dir", directory, "--send", "--yes"], () => {}, () => {}, recordingDependencies(bodies))).toBe(0);
    expect(bodies).toHaveLength(21);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// A file name was cleaned like quoted wording: a control character became a space and
// each run of spaces became one, so two files could share one printed name. Every line
// below names a file, and each now prints it as a path.
test("every line of the Jev audit that names a file prints it as a path", async () => {
  const slash = String.fromCharCode(92);
  const override = String.fromCharCode(0x202e);
  const name = `a  ${override}b|c.md`;
  const shown = `a  ${slash}u202eb|c.md`;
  const tick = String.fromCharCode(96);
  // A table cell and a line of the report are rendered, so each holds a code span.
  const cell = `${tick}a  ${slash}u202eb${slash}|c.md${tick}`;

  const findings = formatFindings({
    complete: true, limitation: "test", evidence: [],
    notSent: [{ file: name, reason: REFUSAL }],
    localFindings: [{ file: name, line: 1, rule: "missing-title", detail: "No  title." }],
    results: [{ file: name, line: 2, id: "block-1", rule: "purpose", band: "fail", score: "0.9", cutOff: "0.87", detail: "Unclear.", excerpt: "Words.", stateHash: "h" }],
    coverage: [{ file: name, checks: { purpose: { assessed: 1, pass: 0, fail: 1, unsure: 0, skipped: 0 } } }],
  } as never);
  expect(findings).not.toContain(override);
  expect(findings).toContain(`Not sent: ${tick}${shown}${tick}, because its ${REFUSAL}.`);
  // A detail is quoted wording, so its two spaces still become one.
  expect(findings).toContain(`| ${cell} | 1 | local | missing-title | local | | | No title. |`);
  expect(findings).toContain(`| ${cell} | 2 | block-1 | purpose | fail | 0.9 | 0.87 | Unclear. Excerpt: Words. |`);
  expect(findings).toContain(`| ${cell} | purpose | 1 | 0 | 1 | 0 | 0 |`);

  const empty = { candidates: [], findings: [] };
  const plan = formatPlan({
    documents: [{ file: name, path: "p", plan: empty, refusal: REFUSAL }, { file: `${name}2`, path: "q", plan: empty }],
    mechanical: { configHash: "c", files: {}, totals: {} }, skipped: [], paths: [`docs/${name}`],
  } as never, true, `out  ${override}.json`);
  expect(plan).not.toContain(override);
  expect(plan).toContain(`Selected: docs/${shown}`);
  expect(plan).toContain(`- ${shown}: not sent, because its ${REFUSAL}.`);
  expect(plan).toContain(`- ${shown}2: 0 eligible openings, 0 eligible blocks, 0 requests.`);
  expect(plan).toContain(`- ${shown}2: 0 bytes.`);
  expect(plan).toContain(`locally to out  ${slash}u202e.json.`);

  // The warning for a refused document, and the table of mechanical findings, through the command.
  const directory = mkdtempSync(join(tmpdir(), "jev-path-"));
  try {
    const refused = `ta  ${override}b.md`;
    writeFileSync(join(directory, refused), TAB_BLOCK);
    const out: string[] = [];
    const warnings: string[] = [];
    expect(await runAuditCli("text", ["bun", "cli", directory, "--project-dir", directory, "--jev-preview"],
      text => out.push(text), text => warnings.push(text), recordingDependencies([]))).toBe(0);
    expect(warnings).toEqual([`warning: not sent: ta  ${slash}u202eb.md: ${REFUSAL}`]);
    expect(out.join("\n")).toContain(`| ${tick}ta  ${slash}u202eb.md${tick} | 8 | legalese | banned term "shall" |`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
