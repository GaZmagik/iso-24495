import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuditCli, selectDocuments, formatFindings, formatPlan, safeText, type AuditDependencies } from "../../../scripts/lib/jev/audit.ts";
import { MODEL } from "../../../scripts/lib/jev/catalogue.ts";
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
