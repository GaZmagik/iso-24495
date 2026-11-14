import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAuditCli, selectDocuments, formatFindings, formatPlan, safeText, DISCLOSURE_VERSION, type AuditDependencies, type JevReport, type Selection } from "../../../scripts/lib/jev/audit.ts";
import { MODEL, sha256 } from "../../../scripts/lib/jev/catalogue.ts";
import { planDocument } from "../../../scripts/lib/jev/engine.ts";
import { safePath } from "../../../scripts/lib/safe-text.ts";
import { runCli as runTextCli } from "../../../../iso-24495-text-audit/scripts/audit-text.ts";
import { runCli as runDesignCli } from "../../../../iso-24495-design-audit/scripts/design-audit.ts";

/** Dependencies whose environment, terminal and client a test goes on to change. */
type WiredDependencies = AuditDependencies & Required<Pick<AuditDependencies, "env" | "terminal" | "client">>;

test("preview is offline; send alone is not consent; explicit terminal agreement sends a frozen plan", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-audit-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\nVersion 1.0\n\nThe supplier shall act.\n");
    let sent = 0;
    const output: string[] = [];
    const dependencies: WiredDependencies = {
      env: { TYPESAFE_API_KEY: "key" }, now: () => new Date("2026-10-03T17:00:00Z"),
      terminal: { inputIsTTY: true, outputIsTTY: true, prompt: async () => "yes" },
      client: { fetch: async (url, init) => {
        sent++;
        const body = JSON.parse(init.body);
        return Response.json({ model: MODEL, answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, id === "purpose" ? { type: "choice", choice: "neither", confidence: 0.86, probabilities: { both: 0.1, task_only: 0.02, scope_only: 0.02, neither: 0.86 } } : { type: "noul", noul: id === "colour_only" ? 0.17 : 0.5 }])) });
      }, clock: { schedule: () => () => {} }, sleep: async () => {} },
      writeLog: record => {
        expect(record.paths).toEqual([file]);
        expect(record.disclosureVersion).toBeDefined();
        expect(record.timestamp).toBe("2026-10-03T17:00:00.000Z");
      },
    };
    const run = auditRunner(file, directory, output, output, () => dependencies);
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
    expect(report.jev.results.some((result: { band: string }) => result.band === "pass")).toBe(false);
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
    dependencies.terminal.prompt = async () => {
      writeFileSync(file, "# Changed\n\nText.");
      return "yes";
    };
    expect(await run("design", ["--send"])).toBe(2);
    expect(sent).toBe(before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    expect(selectDocuments(docs, directory, "text", (path, encoding) => {
      if (path === blocked) throw new Error();
      return readFileSync(path, encoding);
    }).skipped).toEqual([link, blocked]);
    const output: string[] = [];
    const deps: AuditDependencies = { read: (path, encoding) => {
      if (path === blocked) throw new Error();
      return readFileSync(path, encoding);
    } };
    expect(await runTextCli(["bun", "cli", docs, "--jev-preview", "--project-dir", directory], text => output.push(text), text => output.push(text), deps)).toBe(0);
    expect(output.join("\n")).toContain("skipped unreadable entry");
    expect(await runDesignCli(["bun", "cli", docs, "--project-dir", directory], text => output.push(text), text => output.push(text), deps)).toBe(0);
    expect(formatPlan(selected)).toContain("two.md");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("argument conflicts and local failures are classified without transmission", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-arguments-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\nWords.");
    let calls = 0;
    const out: string[] = [];
    const dependencies: WiredDependencies = { env: { TYPESAFE_API_KEY: "key" }, terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => {
      throw new Error();
    } }, client: { fetch: async () => {
      calls++;
      throw new Error();
    }, clock: { schedule: () => () => {} }, sleep: async () => {} }, writeLog: () => {} };
    const run = designByDefaultRunner(file, directory, out, dependencies);
    for (const args of [["--unknown"], ["--send", "--send"], ["--json"], ["--project-dir", "--send"], ["--yes"], ["--include-judged-text"], ["--no-front-matter"], ["--consent", "file"], ["--jev-preview"]]) {
      expect(await run(args)).toBe(2);
    }
    for (const args of [["--jev"], ["--jev-preview", "--send"], ["--jev-preview", "--jev"], ["--jev", "--send", "--no-front-matter"]]) {
      expect(await run(args, "text")).toBe(2);
    }
    expect(await runAuditCli("design", ["bun", "cli", "--send"], () => {}, () => {}, dependencies)).toBe(2);
    expect(await run(["--json", join(directory, "missing/report.json")])).toBe(1);
    dependencies.client.validate = () => {
      throw new Error("secret");
    };
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
    expect(selectDocuments(textFile, directory, "text").documents[0]?.plan.candidates).toHaveLength(0);
    expect(() => selectDocuments(textFile, directory)).toThrow("Unsupported");
    expect(safeText("ab\u001b\u202ecd\n")).toBe("ab cd");
    expect(formatPlan(selectDocuments(directory, directory, "text"))).toContain("Selected");
    expect(formatFindings({ complete: true, limitation: "test", evidence: [], results: [], localFindings: [], coverage: [] })).toContain("Only purpose and colour");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("complete exports, local title findings, unsure decisions and log failures stay distinct", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-exports-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\nVersion 1.0\n\nWords.");
    const dependencies: AuditDependencies = { env: { TYPESAFE_API_KEY: "key" }, terminal: { inputIsTTY: false, outputIsTTY: true, prompt: async () => "no" }, client: { fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      return Response.json({ model: MODEL, answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, id === "purpose" ? { type: "choice", choice: "both", confidence: 0.8, probabilities: { both: 0.8, task_only: 0.1, scope_only: 0.05, neither: 0.05 } } : { type: "noul", noul: 0.5 }])) });
    }, clock: { schedule: () => () => {} }, sleep: async () => {} } };
    const out: string[] = [];
    const run = textRunner(file, directory, out, dependencies);
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
    dependencies.writeLog = () => {
      throw new Error("private");
    };
    expect(await run(["--jev", "--send", "--yes"])).toBe(1);
    delete dependencies.writeLog;
    expect(await run(["--jev", "--send", "--yes", "--json", join(directory, "missing/report.json")])).toBe(1);
    writeFileSync(file, "Words.\n");
    expect(await run(["--jev-preview", "--json", reportFile])).toBe(0);
    expect(JSON.parse(readFileSync(reportFile, "utf8")).jev.localFindings[0].rule).toBe("opening-title");
    dependencies.terminal = { inputIsTTY: true, outputIsTTY: true, prompt: async () => {
      rmSync(file);
      return "yes";
    } };
    expect(await run(["--jev", "--send"])).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Two functions decide what front matter is. The calibrated guard that the plan
// uses accepts a leading "---" block only when each line has a conservative
// shape, and a tab after a YAML colon fails it. The plan then read the metadata
// as prose and queued it for sending.
const TAB_BLOCK = "---\nversion: 1.0\napi_key:\tPRIVATE_SENTINEL\n\n---\n# Tab guide\n\nTab instructions. The supplier shall act.";
const SPACE_BLOCK = "---\nversion: 1.0\napi_key: SPACE_SENTINEL\n\n---\n# Space guide\n\nSpace instructions.";
const NO_BLOCK = "# Plain guide\n\nPlain instructions.";
const REFUSAL = "front matter could not be recognised safely";
/** The first lines of the mechanical findings table that both audits print. */
const MECHANICAL_HEADING = "Mechanical findings\n| File | Line | Rule | Finding |\n";

/** Dependencies whose transport keeps every request body and answers each one so that it passes. */
function recordingDependencies(bodies: string[]): AuditDependencies {
  return {
    env: { TYPESAFE_API_KEY: "key" }, now: () => new Date("2026-10-06T12:00:00Z"),
    terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
    client: { fetch: async (url, init) => {
      bodies.push(init.body);
      const body = JSON.parse(init.body);
      return Response.json({ model: MODEL, answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, id === "purpose" ? { type: "choice", choice: "both", confidence: 0.8, probabilities: { both: 0.8, task_only: 0.1, scope_only: 0.05, neither: 0.05 } } : { type: "noul", noul: 0.5 }])) });
    }, clock: { schedule: () => () => {} }, sleep: async () => {} },
    writeLog: () => {},
  };
}

/**
 * Makes a function that runs the Jev audit command on one target with a
 * project directory. What the command prints goes to the two lists given, and
 * the dependencies are made afresh for each run.
 *
 * @returns The function, which resolves to the command's exit code.
 */
function auditRunner(target: string, directory: string, out: string[], err: string[], dependencies: () => AuditDependencies): (mode: "text" | "design", args: string[]) => Promise<number> {
  return (mode, args) => runAuditCli(mode, ["bun", "cli", target, "--project-dir", directory, ...args], text => out.push(text), text => err.push(text), dependencies());
}

/**
 * Makes a function that runs the Jev audit command on one file with a project
 * directory, as a design audit unless told otherwise. Everything the command
 * prints goes to one list.
 *
 * @returns The function, which resolves to the command's exit code.
 */
function designByDefaultRunner(file: string, directory: string, out: string[], dependencies: AuditDependencies): (args: string[], mode?: "text" | "design") => Promise<number> {
  return (args: string[], mode: "text" | "design" = "design") => runAuditCli(mode, ["bun", "cli", file, "--project-dir", directory, ...args], text => out.push(text), text => out.push(text), dependencies);
}

/**
 * Makes a function that runs the Jev audit command as a text audit on one file
 * with a project directory. Everything the command prints goes to one list.
 *
 * @returns The function, which resolves to the command's exit code.
 */
function textRunner(file: string, directory: string, out: string[], dependencies: AuditDependencies): (args: string[]) => Promise<number> {
  return (args: string[]) => runAuditCli("text", ["bun", "cli", file, "--project-dir", directory, ...args], text => out.push(text), text => out.push(text), dependencies);
}

/**
 * Makes a function that writes a text to a document in the directory given,
 * named "doc.md" unless told otherwise, and selects it for a text audit. The
 * function throws an `Error` when the selection holds no document.
 *
 * @returns The function, which returns the selected document.
 */
function documentSelector(directory: string): (text: string, name?: string) => Selection["documents"][number] {
  return (text: string, name = "doc.md") => {
    writeFileSync(join(directory, name), text);
    const [document] = selectDocuments(join(directory, name), directory, "text").documents;
    if (document === undefined) throw new Error("the selection holds no document");
    return document;
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
    const run = auditRunner(directory, directory, out, warnings, () => dependencies);

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
    expect(selection.documents[0]?.plan).toEqual(planDocument(NO_BLOCK));
    expect(selection.documents[1]?.plan).toEqual(planDocument(SPACE_BLOCK));
    expect(selection.paths).toHaveLength(3);

    const reportFile = join(directory, "report.json");
    out.length = 0;
    expect(await run("design", ["--send", "--yes", "--json", reportFile])).toBe(0);
    expect(bodies).toHaveLength(4);
    const sent = bodies.join("\n");
    expect(sent).toContain("Space instructions.");
    expect(sent).toContain("Plain instructions.");
    for (const withheld of ["PRIVATE_SENTINEL", "api_key", "Tab instructions", "Tab guide", "SPACE_SENTINEL"]) {
      expect(sent).not.toContain(withheld);
    }
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(report.jev.notSent).toEqual([{ file: "tab.md", reason: REFUSAL }]);
    expect(report.jev.complete).toBe(true);
    expect(out.join("\n")).toContain("Not sent: `tab.md`, because its " + `${REFUSAL}.`);

    // The mechanical audit sends nothing, so both audits still read the refused document.
    for (const mode of ["text", "design"] as const) {
      out.length = 0;
      expect(await run(mode, mode === "text" ? ["--jev-preview"] : [])).toBe(0);
      expect(out.join("\n"), mode).toContain("| `tab.md` | 8 | legalese | banned term \"shall\" |");
    }
    expect(bodies).toHaveLength(4);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    dependencies.writeLog = record => {
      logged.push(record.paths);
    };
    expect(await runAuditCli("design", ["bun", "cli", file, "--project-dir", directory, "--send", "--yes"], text => out.push(text), text => out.push(text), dependencies)).toBe(0);
    expect(bodies).toHaveLength(0);
    expect(out.join("\n")).toContain("Total: 0 requests, 0 questions.");
    expect(out.join("\n")).toContain("Documents not sent: 1 of 1.");
    expect(logged).toEqual([[file]]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the refusal covers any closed leading block the guard rejects, and nothing else", () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-front-matter-shapes-"));
  try {
    const refusalFor = documentSelector(directory);
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    const run = auditRunner(directory, directory, out, out, () => recordingDependencies(bodies));
    expect(await run("text", ["--jev-preview"])).toBe(0);
    expect(await run("text", ["--jev", "--send", "--yes"])).toBe(0);
    expect(await run("design", ["--send", "--yes"])).toBe(0);
    const printed = out.join("\n");
    for (const character of [escape, control, override]) {
      expect(printed).not.toContain(character);
    }
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Four workers share one queue. A worker that meets a failure sets a flag, and
// every worker checks the flag before it takes the next request. Without that
// check the other requests were still sent after the run had already failed,
// and their verdicts were then thrown away.
test("once a reply fails, no request that is still queued is sent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-stop-"));
  try {
    const file = join(directory, "doc.md");
    const paragraphs = Array.from({ length: 20 }, (slot, index) => `Paragraph number ${index + 1} of the guide.`);
    writeFileSync(file, `# Title\n\n${paragraphs.join("\n\n")}\n`);
    expect(selectDocuments(file, directory).documents[0]?.plan.candidates).toHaveLength(21);
    let sent = 0;
    let logged: { complete: boolean; digest: string } | undefined;
    const out: string[] = [];
    const dependencies: AuditDependencies = {
      env: { TYPESAFE_API_KEY: "key" },
      terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
      // HTTP 400 is refused at once and never tried again, so each request is one call.
      client: { fetch: async () => {
        sent++;
        return new Response("refused", { status: 400 });
      }, clock: { schedule: () => () => {} }, sleep: async () => {} },
      writeLog: record => {
        logged = record;
      },
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A reply whose Choice summed to exactly 0.99 failed the client's check and was never
// sent again, so the run discarded every verdict and exited 3. The calibration left
// such a request for a later run. The client now sends it again, up to six attempts.
test("a request whose first reply fails its checks and whose second passes completes the run", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-resend-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\n---\n");
    expect(selectDocuments(file, directory).documents[0]?.plan.candidates).toHaveLength(1);
    const bodies: string[] = [];
    const dependencies: AuditDependencies = {
      env: { TYPESAFE_API_KEY: "key" },
      terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
      client: { fetch: async (url, init) => {
        bodies.push(init.body);
        const probabilities = bodies.length === 1 ? { both: 0.33, task_only: 0.33, scope_only: 0.33, neither: 0 } : { both: 0.1, task_only: 0.02, scope_only: 0.02, neither: 0.86 };
        return Response.json({ model: MODEL, answers: { purpose: { type: "choice", choice: "neither", confidence: 0.86, probabilities }, reader: { type: "noul", noul: 0.5 } } });
      }, clock: { schedule: () => () => {} }, sleep: async () => {} },
      writeLog: () => {},
    };
    const reportFile = join(directory, "report.json");
    const out: string[] = [];
    expect(await runAuditCli("design", ["bun", "cli", file, "--project-dir", directory, "--send", "--yes", "--json", reportFile], text => out.push(text), text => out.push(text), dependencies)).toBe(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(report.jev.complete).toBe(true);
    expect(report.jev.results.map((result: { band: string; diagnosis?: string }) => [result.band, result.diagnosis])).toEqual([["fail", "neither"]]);
    expect(out.join("\n")).not.toContain("incomplete");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

  // The formatter is given a rule name and coverage the type does not admit,
  // to show that whatever reaches it still prints safely.
  const report: unknown = {
    complete: true, limitation: "test", evidence: [],
    notSent: [{ file: name, reason: REFUSAL }],
    localFindings: [{ file: name, line: 1, rule: "missing-title", detail: "No  title." }],
    results: [{ file: name, line: 2, id: "block-1", rule: "purpose", band: "fail", score: "0.9", cutOff: "0.87", detail: "Unclear.", excerpt: "Words.", stateHash: "h" }],
    coverage: [{ file: name, checks: { purpose: { assessed: 1, pass: 0, fail: 1, unsure: 0, skipped: 0 } } }],
  };
  const findings = formatFindings(report as JevReport);
  expect(findings).not.toContain(override);
  expect(findings).toContain(`Not sent: ${tick}${shown}${tick}, because its ${REFUSAL}.`);
  // A detail is quoted wording, so its two spaces still become one.
  expect(findings).toContain(`| ${cell} | 1 | local | missing-title | local | | | No title. |`);
  expect(findings).toContain(`| ${cell} | 2 | block-1 | purpose | fail | 0.9 | 0.87 | Unclear. Excerpt: Words. |`);
  expect(findings).toContain(`| ${cell} | purpose | 1 | 0 | 1 | 0 | 0 |`);

  const empty = { candidates: [], findings: [] };
  const selection: Selection = {
    documents: [{ file: name, path: "p", plan: empty, refusal: REFUSAL }, { file: `${name}2`, path: "q", plan: empty }],
    mechanical: { configHash: "c", files: {}, totals: {} }, skipped: [], paths: [`docs/${name}`],
  };
  const plan = formatPlan(selection, true, `out  ${override}.json`);
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Stopping at a hole ended the options early, so the command ran and exited 0
// with an option it would have refused still unread.
test("a hole in the argument list is refused, and so is what follows it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-argument-hole-"));
  try {
    const file = join(directory, "guide.md");
    writeFileSync(file, NO_BLOCK);
    const holed: string[] = ["bun", "design-audit-cli.ts", file];
    holed.length = 4;
    const trailing = [...holed];
    trailing.length = 4;
    holed.push("--unknown");
    for (const argv of [holed, trailing]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      expect(await runAuditCli("design", argv, (text) => stdout.push(text), (text) => stderr.push(text))).toBe(2);
      expect(stderr).toHaveLength(1);
      expect(stderr[0]).toStartWith("Invalid audit arguments.");
      expect(stdout).toEqual([]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the preview says, after its totals, that a request may be sent up to six times and charged again", () => {
  const selection: Selection = {
    documents: [{ file: "doc.md", path: "p", plan: { candidates: [], findings: [] } }],
    mechanical: { configHash: "c", files: {}, totals: {} }, skipped: [], paths: ["doc.md"],
  };
  const lines = formatPlan(selection).split("\n");
  const total = lines.indexOf("Total: 0 requests, 0 questions.");
  expect(total).toBeGreaterThan(0);
  expect(lines.slice(total + 1, total + 3)).toEqual([
    "This preview counts requests, not attempts, and each request may be sent up to six times.",
    "A request sent again for any reason may be charged again.",
  ]);
});

test("the disclosure version names the text that says a request may be sent again and charged again", () => {
  expect(DISCLOSURE_VERSION).toBe("0.8.0-r3");
  const selection: Selection = { documents: [], mechanical: { configHash: "c", files: {}, totals: {} }, skipped: [], paths: [] };
  expect(formatPlan(selection).split("\n")[0]).toBe(`Transmission preview: TypeSafe, model ${MODEL}, disclosure 0.8.0-r3.`);
});

// The preview said the send log held the digest, the paths and the time, and left out
// the disclosure version and whether execution completed. The record a real send
// writes decides the words, so a field added to the log fails this test until the
// preview names it.
test("the preview names every field a real send writes to the send log, and no other", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-log-fields-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\nThe supplier shall act.\n");
    const records: object[] = [];
    const dependencies = recordingDependencies([]);
    dependencies.env = { TYPESAFE_API_KEY: "sk-test-not-real" };
    dependencies.writeLog = record => {
      records.push(record);
    };
    expect(await runAuditCli("design", ["bun", "cli", file, "--project-dir", directory, "--send", "--yes"], () => {}, () => {}, dependencies)).toBe(0);
    expect(records).toHaveLength(1);
    const words: Record<string, string> = {
      disclosureVersion: "the disclosure version",
      digest: "a digest of the payloads sent",
      paths: "the selected paths",
      timestamp: "the timestamp",
      complete: "whether execution completed",
    };
    expect(records.map(record => Object.keys(record).sort())).toEqual([Object.keys(words).sort()]);
    const selection: Selection = { documents: [], mechanical: { configHash: "c", files: {}, totals: {} }, skipped: [], paths: [] };
    const line = formatPlan(selection).split("\n").find(text => text.startsWith("A local send log records"));
    expect(line).toBe("A local send log records the disclosure version, a digest of the payloads sent, the selected paths, the timestamp and whether execution completed. It records transmission; it does not prove agreement.");
    for (const phrase of Object.values(words)) {
      expect(line).toContain(phrase);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A failed send printed only "Jev execution is incomplete", so a rejected key, a busy
// service and a wrong model all looked the same. Each cause now prints its own fixed
// words, and never the service's reply, the key or the message of an unexpected error.
const FAKE_KEY = "sk-test-not-real";
const CANARY = "LEAK-CANARY-123";
const REFUSED_KEY = "The API key was not accepted or lacks permission.";
const BUSY = "Jev was rate limited or unavailable, with HTTP status 429 or 5xx, and six attempts gave no answer.";
const UNEXPECTED = "The audit stopped on an unexpected error. Its message is not shown, because it may name a path or hold a value.";
/** A Choice whose three options at 0.33 sum to 0.99, which fails the value check. */
const INVALID_PURPOSE = { type: "choice", choice: "both", confidence: 0.33, probabilities: { both: 0.33, task_only: 0.33, scope_only: 0.33, neither: 0 } };

/** One way a send can fail, the stand-ins that cause it, and the words the audit must print. */
interface FailureCause { name: string; words: string; fetch: () => Promise<Response>; sleep?: () => Promise<void>; cancelled?: boolean }
const CAUSES: FailureCause[] = [
  { name: "HTTP 401", words: `Jev refused the request with HTTP status 401. ${REFUSED_KEY}`, fetch: async () => new Response(CANARY, { status: 401 }) },
  { name: "HTTP 403", words: `Jev refused the request with HTTP status 403. ${REFUSED_KEY}`, fetch: async () => new Response(CANARY, { status: 403 }) },
  { name: "HTTP 400", words: "Jev refused the request with HTTP status 400.", fetch: async () => new Response(CANARY, { status: 400 }) },
  { name: "HTTP 429 six times", words: BUSY, fetch: async () => new Response(CANARY, { status: 429 }) },
  { name: "HTTP 503 six times", words: BUSY, fetch: async () => new Response(CANARY, { status: 503 }) },
  { name: "no connection six times", words: "Jev did not answer after six transport attempts.", fetch: async () => {
    throw new Error(`${CANARY} ${FAKE_KEY}`);
  } },
  { name: "an invalid answer six times", words: "Jev did not give a valid answer after six attempts.", fetch: async () => Response.json({ model: MODEL, note: CANARY, answers: { purpose: INVALID_PURPOSE, reader: { type: "noul", noul: 0.5 } } }) },
  { name: "a reply naming another model", words: "Jev returned a wrong or missing model. Expected jev-1.13.0.", fetch: async () => Response.json({ model: CANARY, answers: {} }) },
  { name: "a reply that is not JSON", words: "Jev returned malformed JSON.", fetch: async () => new Response(`${CANARY} is not JSON`) },
  { name: "a cancelled send", words: "Jev execution was cancelled.", fetch: async () => new Response(CANARY), cancelled: true },
  // The wait between attempts sits outside the client's own catch, so its error reaches the audit as it was thrown.
  { name: "an error that is not Jev's", words: UNEXPECTED, fetch: async () => new Response(CANARY, { status: 503 }), sleep: async () => {
    throw new Error(`${CANARY} at C:/private/${FAKE_KEY}.md`);
  } },
];

/** What one failed send printed and wrote, as text. */
interface FailedSend { code: number; stdout: string; stderr: string[]; json: string }

/**
 * Runs a send of one opening through the design audit command or the text
 * audit's `--jev` mode, with stand-ins that make it fail as the cause says.
 *
 * @returns The exit code, what was printed to each stream and the report file.
 */
async function sendFailing(cause: FailureCause, mode: "text" | "design"): Promise<FailedSend> {
  const directory = mkdtempSync(join(tmpdir(), "jev-failure-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, "# Title\n\n---\n");
    const reportFile = join(directory, "report.json");
    const controller = new AbortController();
    if (cause.cancelled === true) controller.abort();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dependencies: AuditDependencies = {
      env: { TYPESAFE_API_KEY: FAKE_KEY },
      terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
      client: { fetch: async (url, init) => {
        expect(init.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
        return cause.fetch();
      }, clock: { schedule: () => () => {} }, sleep: cause.sleep ?? (async () => {}), signal: controller.signal },
      writeLog: () => {},
    };
    const argv = ["bun", "cli", file, "--project-dir", directory, ...(mode === "text" ? ["--jev"] : []), "--send", "--yes", "--json", reportFile];
    // Each command is called by its own name. A test that called runAuditCli in
    // text mode let the text audit drop its Failure line unseen.
    let code: number;
    if (mode === "text") {
      code = await runTextCli(argv, text => stdout.push(text), text => stderr.push(text), dependencies);
    } else {
      code = await runDesignCli(argv, text => stdout.push(text), text => stderr.push(text), dependencies);
    }
    return { code, stdout: stdout.join("\n"), stderr, json: readFileSync(reportFile, "utf8") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const cause of CAUSES) {
  test(`a send that fails on ${cause.name} says why in fixed words, and prints nothing the service or the error held`, async () => {
    for (const mode of ["design", "text"] as const) {
      const result = await sendFailing(cause, mode);
      expect(result.code, mode).toBe(3);
      expect(result.stdout, mode).toContain(`Execution: incomplete.\nFailure: ${cause.words}\n`);
      // The stderr line below says the mechanical findings remain, so both audits print them.
      expect(result.stdout, mode).toStartWith(MECHANICAL_HEADING);
      expect(result.stderr, mode).toEqual([`Jev execution is incomplete. ${cause.words} Jev verdicts were discarded; mechanical findings remain available.`]);
      const report = JSON.parse(result.json);
      expect(report.mechanical.files["doc.md"], mode).toBeDefined();
      expect(report.jev.complete, mode).toBe(false);
      expect(report.jev.failure, mode).toBe(cause.words);
      expect(report.jev.results, mode).toEqual([]);
      for (const secret of [CANARY, FAKE_KEY]) {
        for (const written of [result.stdout, result.stderr.join("\n"), result.json]) {
          expect(written, `${mode} ${secret}`).not.toContain(secret);
        }
      }
    }
  });
}

test("each cause of a failed send has words of its own, and only the two busy statuses share them", () => {
  const byWords = new Map<string, string[]>();
  for (const cause of CAUSES) {
    byWords.set(cause.words, [...(byWords.get(cause.words) ?? []), cause.name]);
  }
  expect([...byWords.values()].filter(names => names.length > 1)).toEqual([["HTTP 429 six times", "HTTP 503 six times"]]);
});

// Four requests are in flight when the first fails. The other three still end, later
// and for another cause, and the failure they report must not replace the first.
test("the failure shown is the first one, not one that ends later", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-first-failure-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, `# Title\n\n${Array.from({ length: 8 }, (slot, index) => `Paragraph ${index + 1}.`).join("\n\n")}\n`);
    let calls = 0;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dependencies: AuditDependencies = {
      env: { TYPESAFE_API_KEY: FAKE_KEY },
      terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
      client: { fetch: async () => {
        calls++;
        return new Response(CANARY, { status: calls === 1 ? 401 : 503 });
      }, clock: { schedule: () => () => {} }, sleep: async () => {} },
      writeLog: () => {},
    };
    const reportFile = join(directory, "report.json");
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--send", "--yes", "--json", reportFile], text => stdout.push(text), text => stderr.push(text), dependencies)).toBe(3);
    // The first request's one attempt, and six for each of the three others already started.
    expect(calls).toBe(19);
    const refused = `Jev refused the request with HTTP status 401. ${REFUSED_KEY}`;
    expect(JSON.parse(readFileSync(reportFile, "utf8")).jev.failure).toBe(refused);
    expect(stdout.join("\n")).toContain(`Failure: ${refused}`);
    expect(stderr.join("\n")).not.toContain(BUSY);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a complete report has no failure line and no failure in its JSON", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-no-failure-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, NO_BLOCK);
    const out: string[] = [];
    const reportFile = join(directory, "report.json");
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--send", "--yes", "--json", reportFile], text => out.push(text), text => out.push(text), recordingDependencies([]))).toBe(0);
    expect(out.join("\n")).not.toContain("Failure:");
    expect(JSON.parse(readFileSync(reportFile, "utf8")).jev).not.toHaveProperty("failure");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The design audit printed no mechanical findings, so a document with a banned
// term or a long sentence passed it silently. It now runs the whole text audit
// first, through the same code as the text audit, and prints the same table.
const MIXED_DOCUMENT = "# Title\n\nThe supplier shall act.\n\nA second paragraph for the reader.\n";
const FINDING_ROW = "| `doc.md` | 3 | legalese | banned term \"shall\" |";

test("the design audit prints the full text audit's findings, exactly as the text audit does", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-design-mechanical-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, MIXED_DOCUMENT);
    const design: string[] = [];
    const text: string[] = [];
    // No key is given, so neither preview can send.
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory], line => design.push(line), line => design.push(line), { env: {} })).toBe(0);
    expect(await runTextCli(["bun", "cli", file, "--project-dir", directory, "--jev-preview"], line => text.push(line), line => text.push(line), { env: {} })).toBe(0);
    expect(design[0]).toStartWith(MECHANICAL_HEADING);
    expect(design[0]).toContain(FINDING_ROW);
    expect(design[0]).toBe(text[0]);

    const designReport = join(directory, "design.json");
    const textReport = join(directory, "text.json");
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--json", designReport], () => {}, () => {}, { env: {} })).toBe(0);
    expect(await runTextCli(["bun", "cli", file, "--project-dir", directory, "--jev-preview", "--json", textReport], () => {}, () => {}, { env: {} })).toBe(0);
    const mechanical = JSON.parse(readFileSync(designReport, "utf8")).mechanical;
    expect(mechanical.totals.legalese).toBe(1);
    expect(mechanical.files["doc.md"].violations.length).toBeGreaterThan(0);
    expect(mechanical).toEqual(JSON.parse(readFileSync(textReport, "utf8")).mechanical);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The test above checks previews only. A successful send writes its report in
// another place, and another test checks only that it names the file. So a send
// could keep the file's name, drop its findings and totals, and no test fail.
// The text audit's preview is the reference: its report is written apart from
// the send, so it still holds the findings if the send's report loses them.
test("a successful design send writes the same mechanical findings to its JSON as the text audit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-design-send-mechanical-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, MIXED_DOCUMENT);
    const designReport = join(directory, "design.json");
    const textReport = join(directory, "text.json");
    const bodies: string[] = [];
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--send", "--yes", "--json", designReport], () => {}, () => {}, recordingDependencies(bodies))).toBe(0);
    expect(bodies).toHaveLength(3);
    expect(await runTextCli(["bun", "cli", file, "--project-dir", directory, "--jev-preview", "--json", textReport], () => {}, () => {}, { env: {} })).toBe(0);
    const report = JSON.parse(readFileSync(designReport, "utf8"));
    expect(report.jev.complete).toBe(true);
    expect(report.mechanical.totals.legalese).toBe(1);
    expect(report.mechanical.files["doc.md"].violations.length).toBeGreaterThan(0);
    const reference = JSON.parse(readFileSync(textReport, "utf8")).mechanical;
    expect(report.mechanical.files).toEqual(reference.files);
    expect(report.mechanical.totals).toEqual(reference.totals);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Recorded from both audits at 5bfba04, before the design audit ran the text
// audit: the digest of the sorted request bodies, and the send log's digest.
const BODIES_BEFORE = "cc53a0c041d28f4deaee12e1979e0f36a347577d4c0ea9358777c8792563b171";
const LOG_DIGEST_BEFORE = "349811b2efdc7372f8c2cb884ababa763efcb6599139b51e293414eff9baf3eb";

test("running the text audit inside the design audit changes nothing that is sent or logged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-design-unchanged-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, MIXED_DOCUMENT);
    for (const mode of ["design", "text"] as const) {
      const bodies: string[] = [];
      const digests: string[] = [];
      const out: string[] = [];
      const dependencies = recordingDependencies(bodies);
      dependencies.writeLog = record => {
        digests.push(record.digest);
      };
      expect(await runAuditCli(mode, ["bun", "cli", file, "--project-dir", directory, ...(mode === "text" ? ["--jev"] : []), "--send", "--yes"], line => out.push(line), line => out.push(line), dependencies), mode).toBe(0);
      expect(bodies, mode).toHaveLength(3);
      expect(sha256(JSON.stringify([...bodies].sort())), mode).toBe(BODIES_BEFORE);
      expect(digests, mode).toEqual([LOG_DIGEST_BEFORE]);
      expect(out[0], mode).toContain(FINDING_ROW);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A preview of a document with no title wrote the local opening-title finding to its
// JSON report and printed it nowhere, so a user who only previewed never saw it. A
// send printed it, with the Jev findings. The preview now prints it in a block of its
// own, between the mechanical findings and the disclosure.
const NO_TITLE = "Plain instructions for the reader.\n\nA second paragraph.\n";
const LOCAL_BLOCK = [
  "Local findings",
  "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
  "|------|------|------|-------|------|-------|---------|---------|",
  "| `doc.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "Local findings are made on this machine and are never sent.",
].join("\n");
// Recorded at 785094f, before a preview printed local findings. Each stdout digest
// is of the printed text with the file's path replaced by "<file>", because the
// disclosure names the full path of each selected file.
const TITLED_PREVIEW_BEFORE = "40440cc44d7d275feaaa1482e80aa3331e08d765df5cf83cd8a5196a9b78f1c3";
const NO_TITLE_PREVIEW_BEFORE = "cda38615d7dfc37a28a12622d97cee996bff9c2b824b0437e3e6db57a8ea9344";
const NO_TITLE_SEND_BEFORE = "f09d0c6f0eaba71a3289ba9c49adb715e52387469e344aa1fcd47543383e719e";
const NO_TITLE_PREVIEW_JSON_BEFORE = "aaa36ebb767b04dc1b8078dfd2cfaf7c9a6ea5e19e4a83c3da20b3b6292c42b1";
const NO_TITLE_BODIES_BEFORE = "a7cbaf21c2f26888b27b828be090bb7ce0eb7a996f6a8d1cc3d708805443f68c";
const NO_TITLE_LOG_DIGEST_BEFORE = "bfca057c543a67dff65f26fce00ec30afde49d0d3ec36624a6e6c9e83a8bd491";

/**
 * What a command printed, joined by line breaks, with the file's full path
 * replaced by "<file>".
 *
 * @returns The text. A test fails here when the path was never printed, so a
 *     digest of the text cannot pass because nothing was replaced.
 */
function printedWithoutPath(out: string[], file: string): string {
  const shown = safePath(resolve(file));
  const joined = out.join("\n");
  expect(joined).toContain(`Selected: ${shown}`);
  return joined.replaceAll(shown, "<file>");
}

/** How many times `rule` appears in `text`. */
function occurrences(text: string, rule: string): number {
  return text.split(rule).length - 1;
}

/**
 * Checks that the Part 5 checklist reading follows the mechanical findings,
 * as the second thing printed, and removes it from `out`. What is left is
 * what the command printed before the reading was added.
 */
function dropReading(out: string[]): void {
  expect(out[1]).toStartWith("Part 5 checklist reading: ");
  expect(out[1]).toEndWith("This reading shows what the audit reads. It does not measure the document.");
  out.splice(1, 1);
}

test("a design preview of a document with no title prints its title finding once, between the mechanical findings and the disclosure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-title-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, NO_TITLE);
    const bodies: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory], text => out.push(text), text => err.push(text), recordingDependencies(bodies))).toBe(0);
    dropReading(out);
    expect(bodies).toHaveLength(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[0]).toStartWith(MECHANICAL_HEADING);
    expect(out[0]).toEndWith("Mechanical findings are proxies, not an ISO judgement.");
    expect(out[1]).toBe(LOCAL_BLOCK);
    expect(out[2]).toBe(formatPlan(selectDocuments(file, directory)));
    expect(occurrences(out.join("\n"), "opening-title")).toBe(1);
    // Without the new block, the preview prints exactly what it printed before.
    expect(sha256(printedWithoutPath(out.filter((chunk, index) => index !== 1), file))).toBe(NO_TITLE_PREVIEW_BEFORE);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a design preview of a titled document prints exactly what it printed before", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-titled-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, NO_BLOCK);
    const out: string[] = [];
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory], text => out.push(text), text => out.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(formatPlan(selectDocuments(file, directory)));
    expect(out.join("\n")).not.toContain("Local findings");
    expect(sha256(printedWithoutPath(out, file))).toBe(TITLED_PREVIEW_BEFORE);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the text audit's Jev preview prints the title finding as the design preview does", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-text-preview-title-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, NO_TITLE);
    const out: string[] = [];
    expect(await runTextCli(["bun", "cli", file, "--project-dir", directory, "--jev-preview"], text => out.push(text), text => out.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(LOCAL_BLOCK);
    expect(occurrences(out.join("\n"), "opening-title")).toBe(1);
    writeFileSync(file, NO_BLOCK);
    const titled: string[] = [];
    expect(await runTextCli(["bun", "cli", file, "--project-dir", directory, "--jev-preview"], text => titled.push(text), text => titled.push(text), { env: {} })).toBe(0);
    dropReading(titled);
    expect(titled).toHaveLength(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A preview of several documents must print the title finding of every titleless one,
// not just the first. The documents are written out of order, and the titled one
// sorts between the two titleless ones, so a preview that kept only the first one or
// two documents, or kept creation order, prints a different block.
const SEVERAL_LOCAL_BLOCK = [
  "Local findings",
  "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
  "|------|------|------|-------|------|-------|---------|---------|",
  "| `a.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "| `c.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "Local findings are made on this machine and are never sent.",
].join("\n");

/** Writes `c.md` and `a.md` with no title, then `b.md` with one, into `directory`. */
function writeSeveralDocuments(directory: string): void {
  writeFileSync(join(directory, "c.md"), NO_TITLE);
  writeFileSync(join(directory, "a.md"), NO_TITLE);
  writeFileSync(join(directory, "b.md"), NO_BLOCK);
}

test("a design preview of a directory prints the title finding of each titleless document, in file order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-several-"));
  try {
    writeSeveralDocuments(directory);
    expect(selectDocuments(directory, directory).documents.map(document => document.file)).toEqual(["a.md", "b.md", "c.md"]);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runDesignCli(["bun", "cli", directory, "--project-dir", directory], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(SEVERAL_LOCAL_BLOCK);
    expect(out[2]).toBe(formatPlan(selectDocuments(directory, directory)));
    expect(occurrences(out.join("\n"), "opening-title")).toBe(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the text audit's Jev preview of a directory prints the title finding of each titleless document, in file order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-text-preview-several-"));
  try {
    writeSeveralDocuments(directory);
    expect(selectDocuments(directory, directory, "text").documents.map(document => document.file)).toEqual(["a.md", "b.md", "c.md"]);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runTextCli(["bun", "cli", directory, "--project-dir", directory, "--jev-preview"], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(SEVERAL_LOCAL_BLOCK);
    expect(out[2]).toBe(formatPlan(selectDocuments(directory, directory, "text")));
    expect(occurrences(out.join("\n"), "opening-title")).toBe(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A file and a folder can share a name, as "a.md" and "a" do here. The audit sorts
// the full paths it finds by UTF-16 code unit. "." (0x2E) comes before both "/"
// (0x2F) and "\" (0x5C), so "a.md" comes before "a/z.md" on Windows and on Linux.
// NTFS lists the folder "a" before the file "a.md", so a preview that did not sort
// would print "a/z.md" first on Windows. The nested file also shows that the
// block names a file by its path from the project, not by its name alone.
const SHARED_NAME_LOCAL_BLOCK = [
  "Local findings",
  "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
  "|------|------|------|-------|------|-------|---------|---------|",
  "| `a.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "| `a/z.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "Local findings are made on this machine and are never sent.",
].join("\n");

/** Writes `a/z.md`, then `a.md`, both with no title, into `directory`. */
function writeSharedNameDocuments(directory: string): void {
  mkdirSync(join(directory, "a"));
  writeFileSync(join(directory, "a", "z.md"), NO_TITLE);
  writeFileSync(join(directory, "a.md"), NO_TITLE);
}

test("a design preview prints a file before the folder that shares its name", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-shared-name-"));
  try {
    writeSharedNameDocuments(directory);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runDesignCli(["bun", "cli", directory, "--project-dir", directory], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(SHARED_NAME_LOCAL_BLOCK);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the text audit's Jev preview prints a file before the folder that shares its name", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-text-preview-shared-name-"));
  try {
    writeSharedNameDocuments(directory);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runTextCli(["bun", "cli", directory, "--project-dir", directory, "--jev-preview"], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(SHARED_NAME_LOCAL_BLOCK);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The audit sorts full paths by UTF-16 code unit, so a capital letter comes before
// every small one. These three paths share the directory prefix and first differ
// at their first letter: "C" (0x43), "a" (0x61), "b" (0x62). No separator is ever
// compared, so the order is the same on Windows and on Linux. The names differ by
// more than case, so they are three files on a case-insensitive file system too.
// Each other plausible order prints differently. Comparing by locale gives "a/z.md",
// "b.md", "C.md", as does NTFS when nothing sorts. Comparing names alone, or
// listing files before folders, gives "C.md", "b.md", "a/z.md".
const MIXED_CASE_LOCAL_BLOCK = [
  "Local findings",
  "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
  "|------|------|------|-------|------|-------|---------|---------|",
  "| `C.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "| `a/z.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "| `b.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "Local findings are made on this machine and are never sent.",
].join("\n");

/** Writes `b.md`, then `a/z.md`, then `C.md`, all with no title, into `directory`. */
function writeMixedCaseDocuments(directory: string): void {
  writeFileSync(join(directory, "b.md"), NO_TITLE);
  mkdirSync(join(directory, "a"));
  writeFileSync(join(directory, "a", "z.md"), NO_TITLE);
  writeFileSync(join(directory, "C.md"), NO_TITLE);
}

test("a design preview orders title findings by the full path's character codes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-mixed-case-"));
  try {
    writeMixedCaseDocuments(directory);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runDesignCli(["bun", "cli", directory, "--project-dir", directory], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(MIXED_CASE_LOCAL_BLOCK);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the text audit's Jev preview orders title findings by the full path's character codes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-text-preview-mixed-case-"));
  try {
    writeMixedCaseDocuments(directory);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runTextCli(["bun", "cli", directory, "--project-dir", directory, "--jev-preview"], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(MIXED_CASE_LOCAL_BLOCK);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A refused document gets a plan with no findings, so it adds no row to the block,
// even when it has no title. Its refusal is printed as a warning and in the
// disclosure instead. The refused document sorts first, so a preview that stopped
// at it would print no block at all.
const AFTER_REFUSED_LOCAL_BLOCK = [
  "Local findings",
  "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
  "|------|------|------|-------|------|-------|---------|---------|",
  "| `b.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "Local findings are made on this machine and are never sent.",
].join("\n");

/** Writes `a.md`, refused for its leading block and with no title, then `b.md` with no title, into `directory`. */
function writeRefusedThenTitleless(directory: string): void {
  writeFileSync(join(directory, "a.md"), `---\nkey:\tprivate\n---\n${NO_TITLE}`);
  writeFileSync(join(directory, "b.md"), NO_TITLE);
}

test("a design preview prints the title finding of a document that follows a refused one", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-after-refused-"));
  try {
    writeRefusedThenTitleless(directory);
    expect(selectDocuments(directory, directory).documents.map(document => [document.file, document.refusal])).toEqual([["a.md", REFUSAL], ["b.md", undefined]]);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runDesignCli(["bun", "cli", directory, "--project-dir", directory], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual(["warning: not sent: a.md: front matter could not be recognised safely"]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(AFTER_REFUSED_LOCAL_BLOCK);
    expect(out[2]).toContain("\n- a.md: not sent, because its front matter could not be recognised safely.\n- b.md: 0 eligible openings, 2 eligible blocks, 2 requests.\n");
    expect(occurrences(out.join("\n"), "opening-title")).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the text audit's Jev preview prints the title finding of a document that follows a refused one", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-text-preview-after-refused-"));
  try {
    writeRefusedThenTitleless(directory);
    expect(selectDocuments(directory, directory, "text").documents.map(document => [document.file, document.refusal])).toEqual([["a.md", REFUSAL], ["b.md", undefined]]);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runTextCli(["bun", "cli", directory, "--project-dir", directory, "--jev-preview"], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual(["warning: not sent: a.md: front matter could not be recognised safely"]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(AFTER_REFUSED_LOCAL_BLOCK);
    expect(out[2]).toContain("\n- a.md: not sent, because its front matter could not be recognised safely.\n- b.md: 0 eligible openings, 2 eligible blocks, 2 requests.\n");
    expect(occurrences(out.join("\n"), "opening-title")).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The block names a file by its path from the project, with "/" between folders on
// every host, as the mechanical findings table does.
const NESTED_LOCAL_BLOCK = [
  "Local findings",
  "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
  "|------|------|------|-------|------|-------|---------|---------|",
  "| `sub/doc.md` | 1 | local | opening-title | local | | | Add a level-1 document title. Purpose assessment is skipped without one. |",
  "Local findings are made on this machine and are never sent.",
].join("\n");

/** Writes `sub/doc.md`, with no title, into `directory`. */
function writeNestedDocument(directory: string): void {
  mkdirSync(join(directory, "sub"));
  writeFileSync(join(directory, "sub", "doc.md"), NO_TITLE);
}

test("a design preview names a nested document by its path from the project", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-nested-"));
  try {
    writeNestedDocument(directory);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runDesignCli(["bun", "cli", directory, "--project-dir", directory], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(NESTED_LOCAL_BLOCK);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the text audit's Jev preview names a nested document by its path from the project", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-text-preview-nested-"));
  try {
    writeNestedDocument(directory);
    const out: string[] = [];
    const err: string[] = [];
    expect(await runTextCli(["bun", "cli", directory, "--project-dir", directory, "--jev-preview"], text => out.push(text), text => err.push(text), { env: {} })).toBe(0);
    dropReading(out);
    expect(err).toEqual([]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(NESTED_LOCAL_BLOCK);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("printing the title finding leaves a preview's JSON report as it was", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-preview-title-json-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, NO_TITLE);
    const reportFile = join(directory, "report.json");
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--json", reportFile], () => {}, () => {}, { env: {} })).toBe(0);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(Object.keys(report).at(-1)).toBe("checklist");
    delete report.checklist;
    // Without the checklist key, the report is what it was before.
    const json = JSON.stringify(report, null, 2);
    expect(JSON.parse(json).jev.localFindings).toEqual([{ file: "doc.md", line: 1, rule: "opening-title", detail: "Add a level-1 document title. Purpose assessment is skipped without one." }]);
    expect(sha256(json)).toBe(NO_TITLE_PREVIEW_JSON_BEFORE);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A send already printed the title finding with the Jev findings. The preview's new
// block is left out of a send, so the finding is not printed twice.
test("a design send of a document with no title sends, logs and prints exactly what it did before", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-send-title-"));
  try {
    const file = join(directory, "doc.md");
    writeFileSync(file, NO_TITLE);
    const bodies: string[] = [];
    const digests: string[] = [];
    const out: string[] = [];
    const dependencies = recordingDependencies(bodies);
    dependencies.writeLog = record => {
      digests.push(record.digest);
    };
    expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--send", "--yes"], text => out.push(text), text => out.push(text), dependencies)).toBe(0);
    dropReading(out);
    expect(bodies).toHaveLength(2);
    expect(sha256(JSON.stringify([...bodies].sort()))).toBe(NO_TITLE_BODIES_BEFORE);
    expect(digests).toEqual([NO_TITLE_LOG_DIGEST_BEFORE]);
    expect(out.join("\n")).not.toContain("Local findings");
    expect(occurrences(out.join("\n"), "opening-title")).toBe(1);
    expect(sha256(printedWithoutPath(out, file))).toBe(NO_TITLE_SEND_BEFORE);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
