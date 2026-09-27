import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRequest, formatReport, ITEMS_PATH, MAX_STATE_CHARACTERS, parseItems,
  parseLabels, parseResults, readOptionalFile, report, run, runCli, SKILLS,
  type Deps, type Item,
} from "../jev-routing.ts";

const ITEM: Item = {
  id: "trial-001", request: "Explain this in a short chat reply.",
  text: "A queue serves the oldest entry first.", source: "Synthetic trial material",
  licence: "MIT", synthetic: true, author: "codex gpt-6-astra",
};
const STAMP = "2026-09-27T12:00:00.000Z";

function reply(probability = 0.7): object {
  return {
    model: "jev-1.13.0",
    answers: Object.fromEntries(SKILLS.map((skill) => [skill, { type: "noul", noul: probability }])),
    usage: { input_tokens: 100, output_tokens: 4 },
  };
}

function fixture(items: object[] = [ITEM]) {
  const files = new Map<string, string>([[ITEMS_PATH, items.map((row) => JSON.stringify(row)).join("\n")]]);
  const fetcher = mock(async (_url: string, _init: RequestInit) => Response.json(reply()));
  const sleeps: number[] = [];
  const deps: Deps = {
    readText: (path) => files.get(path) ?? null,
    appendLine: (path, line) => files.set(path, (files.get(path) ?? "") + line),
    fetch: fetcher,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    now: () => STAMP,
  };
  return { files, fetcher, sleeps, deps };
}

function result(id: string, probability: number) {
  return {
    id, model: "jev-1.13.0", probabilities: Object.fromEntries(SKILLS.map((s) => [s, probability])),
    usage: { input_tokens: 100, output_tokens: 4 }, timestamp: STAMP, fingerprint: "a".repeat(64),
  };
}

function label(id: string, yes: boolean | null) {
  return { id, ...Object.fromEntries(SKILLS.map((s) => [s, yes])), labeller: yes === null ? "" : "tester" };
}

describe("Jev shadow trial", () => {
  test("builds four self-contained questions and sends only the request and text", () => {
    const body = buildRequest(ITEM);
    expect(body.model).toBe("jev-latest");
    expect(body.state).toEqual({ request: ITEM.request, text: ITEM.text });
    expect(Object.keys(body.questions)).toEqual(SKILLS);
    for (const skill of SKILLS) {
      expect(body.questions[skill].type).toBe("noul");
      expect(body.questions[skill].instructions).toContain("`request`");
      expect(body.questions[skill].instructions).toContain("`text`");
      expect(body.questions[skill].criteria.true.length).toBeGreaterThan(30);
      expect(body.questions[skill].criteria.false.length).toBeGreaterThan(30);
    }
    expect(body.questions.legal.instructions).toContain("iso-24495-2");
    expect(body.questions.technical.instructions).toContain("iso-24495-3");
    expect(body.questions.organisational.criteria.false).toContain("individual document");
    expect(body.questions.document_design.criteria.true).toContain("legal");
    expect(body.questions.document_design.criteria.true).toContain("technical");
    expect(body.questions.document_design.criteria.false).toContain("chat");
    expect(body.questions.legal.instructions).toContain("untrusted");
  });

  test("enforces a conservative budget on serialised state including Unicode and escaping", () => {
    const empty = { ...ITEM, text: "" };
    const overhead = JSON.stringify({ request: empty.request, text: "" }).length;
    expect(buildRequest({ ...empty, text: "x".repeat(MAX_STATE_CHARACTERS - overhead) })).toBeDefined();
    for (const text of ["x".repeat(MAX_STATE_CHARACTERS), "é".repeat(MAX_STATE_CHARACTERS / 2), "\n".repeat(MAX_STATE_CHARACTERS)]) {
      expect(() => buildRequest({ ...ITEM, text })).toThrow("state budget");
    }
  });

  test("accepts sourced or attributed synthetic items, refusing malformed or labelled input", () => {
    expect(parseItems("\n" + JSON.stringify(ITEM) + "\r\n")).toEqual([ITEM]);
    const publicItem = { ...ITEM, synthetic: false, source: "https://example.org/public", author: undefined };
    expect(parseItems(JSON.stringify(publicItem))).toHaveLength(1);
    for (const entry of [null, [], {}, { ...ITEM, id: "../secret" }, { ...ITEM, request: "" },
      { ...ITEM, text: 3 }, { ...ITEM, licence: "" }, { ...ITEM, source: "" },
      { ...ITEM, synthetic: "yes" }, { ...ITEM, author: "" }, { ...publicItem, source: "private" },
      { ...ITEM, legal: true }, { ...ITEM, borderline_note: 2 }]) {
      expect(() => parseItems(JSON.stringify(entry))).toThrow();
    }
    expect(() => parseItems("{")).toThrow("JSONL");
    expect(() => parseItems("")).toThrow("No items");
    expect(() => parseItems([ITEM, ITEM].map((row) => JSON.stringify(row)).join("\n"))).toThrow("Duplicate");
  });

  test("runs one request per item, records raw results and resumes without another call", async () => {
    const f = fixture([ITEM, { ...ITEM, id: "trial-002" }]);
    expect(await run("out.jsonl", "secret-key", f.deps)).toEqual({ written: 2, skipped: 0 });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = f.fetcher.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({ Authorization: "Bearer secret-key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(buildRequest(ITEM));
    const rows = parseResults(f.files.get("out.jsonl") as string);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: ITEM.id, model: "jev-1.13.0", timestamp: STAMP,
      probabilities: { legal: 0.7, technical: 0.7, organisational: 0.7, document_design: 0.7 },
      usage: { input_tokens: 100, output_tokens: 4 } });
    expect(await run("out.jsonl", "secret-key", f.deps)).toEqual({ written: 0, skipped: 2 });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    f.files.set(ITEMS_PATH, JSON.stringify({ ...ITEM, text: "Changed" }));
    await expect(run("out.jsonl", "secret-key", f.deps)).rejects.toThrow("changed");
  });

  test("resumes after interruption and preserves a complete final row without a newline", async () => {
    const f = fixture([ITEM, { ...ITEM, id: "trial-002" }]);
    f.fetcher.mockImplementationOnce(async () => Response.json(reply(0)));
    f.fetcher.mockImplementationOnce(async () => new Response("", { status: 401 }));
    await expect(run("out", "key", f.deps)).rejects.toThrow("HTTP 401");
    const first = f.files.get("out") as string;
    expect(parseResults(first)).toHaveLength(1);
    f.files.set("out", first.trimEnd());
    expect(await run("out", "key", f.deps)).toEqual({ written: 1, skipped: 1 });
    const rows = parseResults(f.files.get("out") as string);
    expect(rows.map((row) => row.id)).toEqual([ITEM.id, "trial-002"]);
    expect(rows[0].probabilities.legal).toBe(0);
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });

  test("preflights all input and refuses missing keys, protected outputs and corrupt resumes", async () => {
    const f = fixture();
    for (const key of [undefined, "", "  "]) await expect(run("out", key, f.deps)).rejects.toThrow("TYPESAFE_API_KEY");
    await expect(run(ITEMS_PATH, "key", f.deps)).rejects.toThrow("output");
    await expect(run(ITEMS_PATH.replace("items.jsonl", "labels.template.jsonl"), "key", f.deps)).rejects.toThrow("output");
    f.files.delete(ITEMS_PATH);
    await expect(run("out", "key", f.deps)).rejects.toThrow("items.jsonl");
    f.files.set(ITEMS_PATH, [ITEM, { ...ITEM, id: "trial-002", text: "x".repeat(MAX_STATE_CHARACTERS) }].map((row) => JSON.stringify(row)).join("\n"));
    await expect(run("out", "key", f.deps)).rejects.toThrow("state budget");
    f.files.set(ITEMS_PATH, JSON.stringify(ITEM));
    f.files.set("out", "{");
    await expect(run("out", "key", f.deps)).rejects.toThrow("JSONL");
    f.files.set("out", JSON.stringify(result("unknown", 0.5)) + "\n");
    await expect(run("out", "key", f.deps)).rejects.toThrow("changed");
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  test("retries only 429 and 529 with bounded exponential backoff", async () => {
    const f = fixture();
    f.fetcher.mockImplementationOnce(async () => new Response("", { status: 429 }));
    f.fetcher.mockImplementationOnce(async () => new Response("", { status: 529 }));
    await run("out", "key", f.deps);
    expect(f.sleeps).toEqual([1000, 2000]);
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    for (const status of [401, 422, 500, 429, 529]) {
      const failure = fixture();
      failure.fetcher.mockImplementation(async () => new Response("secret-key", { status }));
      await expect(run("out", "secret-key", failure.deps)).rejects.toThrow(`HTTP ${status}`);
      expect(failure.fetcher).toHaveBeenCalledTimes([429, 529].includes(status) ? 5 : 1);
      expect(failure.sleeps).toEqual([429, 529].includes(status) ? [1000, 2000, 4000, 8000] : []);
      expect(failure.files.has("out")).toBe(false);
    }
  });

  test("sanitises transport errors and refuses malformed API responses before appending", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async () => { throw new Error("secret-key"); });
    await expect(run("out", "secret-key", f.deps)).rejects.toThrow("request failed");
    for (const payload of [null, {}, { ...reply(), model: "" }, { ...reply(), answers: {} },
      { ...reply(), usage: { input_tokens: -1, output_tokens: 1 } },
      { ...reply(), usage: { input_tokens: 1, output_tokens: 1.5 } },
      { ...reply(), answers: { legal: { type: "choice", noul: 0.5 } } }, reply(1.1), reply(-0.1)]) {
      f.fetcher.mockImplementation(async () => Response.json(payload));
      await expect(run("out", "key", f.deps)).rejects.toThrow("response");
    }
    f.fetcher.mockImplementation(async () => new Response("not json"));
    await expect(run("out", "key", f.deps)).rejects.toThrow("response");
    expect(f.files.has("out")).toBe(false);
  });

  test("validates result and label files, including blanks, duplicates and partial labels", () => {
    expect(parseResults("")).toEqual([]);
    expect(parseLabels("")).toEqual([]);
    const good = result("one", 0);
    for (const bad of [null, {}, { ...good, probabilities: {} }, { ...good, timestamp: "bad" },
      { ...good, fingerprint: "bad" }, { ...good, model: 2 }, { ...good, usage: null }]) {
      expect(() => parseResults(JSON.stringify(bad))).toThrow();
    }
    expect(() => parseResults([good, good].map((row) => JSON.stringify(row)).join("\n"))).toThrow("Duplicate");
    expect(parseLabels(JSON.stringify(label("one", null)))).toHaveLength(1);
    for (const bad of [null, {}, { ...label("one", true), legal: "yes" },
      { ...label("one", true), technical: undefined }, { ...label("one", true), labeller: "" },
      { ...label("one", null), labeller: 2 }]) {
      expect(() => parseLabels(JSON.stringify(bad))).toThrow();
    }
    expect(() => parseLabels([label("one", true), label("one", false)].map((row) => JSON.stringify(row)).join("\n"))).toThrow("Duplicate");
  });

  test("computes confusion counts, precision, recall and calibration at exact boundaries", () => {
    const rows = parseResults([result("a", 1), result("b", 0.5), result("c", 0.1), result("d", 0)].map((row) => JSON.stringify(row)).join("\n"));
    const labels = parseLabels([label("a", true), label("b", false), label("c", true), label("d", false)].map((row) => JSON.stringify(row)).join("\n"));
    const r = report(rows, labels, 0.8);
    expect(r.totalResults).toBe(4);
    expect(r.missingLabels).toBe(0);
    for (const skill of SKILLS) {
      expect(r.skills[skill].thresholds).toEqual([
        { threshold: 0.5, tp: 1, fp: 1, tn: 1, fn: 1, precision: 0.5, recall: 0.5 },
        { threshold: 0.8, tp: 1, fp: 0, tn: 2, fn: 1, precision: 1, recall: 0.5 },
      ]);
      const buckets = r.skills[skill].calibration;
      expect(buckets).toHaveLength(10);
      expect(buckets[0]).toMatchObject({ count: 1, yesRate: 0, meanProbability: 0 });
      expect(buckets[1]).toMatchObject({ count: 1, yesRate: 1, meanProbability: 0.1 });
      expect(buckets[5]).toMatchObject({ count: 1, yesRate: 0 });
      expect(buckets[9]).toMatchObject({ count: 1, yesRate: 1, meanProbability: 1 });
      expect(buckets[2]).toMatchObject({ count: 0, yesRate: null, meanProbability: null });
    }
    const text = formatReport(r);
    expect(text).toContain("TP\tFP\tTN\tFN\tPrecision\tRecall");
    expect(text).toContain("[0.9, 1.0]");
    expect(text).toContain("Missing labels: 0");
  });

  test("reports every missing label, unmatched label and undefined ratio without treating null as no", () => {
    const rows = parseResults([result("a", 0.5), result("b", 0.2), result("c", 0.4)].map((row) => JSON.stringify(row)).join("\n"));
    const labels = parseLabels([{ ...label("a", null), legal: false, labeller: "tester" }, label("extra", true)].map((row) => JSON.stringify(row)).join("\n"));
    const r = report(rows, labels);
    expect(r.missingLabels).toBe(3);
    expect(r.labelsWithoutResults).toBe(1);
    expect(r.skills.legal.missingLabels).toBe(2);
    expect(r.skills.technical.missingLabels).toBe(3);
    expect(r.skills.legal.thresholds).toEqual([{ threshold: 0.5, tp: 0, fp: 1, tn: 0, fn: 0, precision: 0, recall: null }]);
    expect(r.skills.technical.thresholds[0].precision).toBeNull();
    expect(formatReport(r)).toContain("n/a");
    expect(report([], []).totalResults).toBe(0);
    for (const value of [-1, 2, NaN, Infinity]) expect(() => report(rows, labels, value)).toThrow("threshold");
    expect(report(rows, labels, 0).skills.legal.thresholds).toHaveLength(2);
    expect(report(rows, labels, 1).skills.legal.thresholds).toHaveLength(2);
  });

  test("CLI runs and reports offline through injected fetch, with safe usage and error output", async () => {
    const f = fixture();
    const out: string[] = [];
    const err: string[] = [];
    const invoke = (args: string[], key?: string) => runCli(args, key, f.deps, (s) => out.push(s), (s) => err.push(s));
    expect(await invoke(["run", "out"], "key")).toBe(0);
    expect(out.join("\n")).toContain("Written: 1; skipped: 0");
    f.files.set("labels", JSON.stringify(label(ITEM.id, true)));
    expect(await invoke(["report", "out", "labels", "0.8"])).toBe(0);
    expect(await invoke(["report", "out", "labels"])).toBe(0);
    expect(out.join("\n")).toContain("0.8");
    for (const args of [[], ["--help"], ["probe-size"], ["run"], ["run", "out", "extra"],
      ["report", "out"], ["report", "out", "labels", "0.2", "extra"]]) {
      expect(await invoke(args)).toBe(args[0] === "--help" ? 0 : 2);
    }
    expect(await invoke(["run", "out"])).toBe(1);
    expect(await invoke(["report", "absent", "labels"])).toBe(1);
    expect(await invoke(["report", "out", "absent"])).toBe(1);
    expect(await invoke(["report", "out", "labels", "oops"])).toBe(1);
    expect(err.join("\n")).not.toContain("secret-key");
    f.deps.readText = () => { throw "secret-key"; };
    expect(await invoke(["report", "out", "labels"])).toBe(1);
    expect(err.at(-1)).toContain("failed");
  });

  test("reads real files, distinguishing missing files from other filesystem errors", () => {
    const directory = mkdtempSync(join(tmpdir(), "jev-read-"));
    try {
      const path = join(directory, "file");
      expect(readOptionalFile(path)).toBeNull();
      writeFileSync(path, "hello");
      expect(readOptionalFile(path)).toBe("hello");
      expect(() => readOptionalFile(directory)).toThrow();
    } finally { rmSync(directory, { recursive: true }); }
  });

  test("ships fifty unlabelled items with matching blank labels and paired requests", () => {
    const items = parseItems(readFileSync(ITEMS_PATH, "utf8"));
    expect(items).toHaveLength(50);
    const blanks = parseLabels(readFileSync(ITEMS_PATH.replace("items.jsonl", "labels.template.jsonl"), "utf8"));
    expect(blanks.map((row) => row.id)).toEqual(items.map((row) => row.id));
    for (const row of blanks) {
      for (const skill of SKILLS) expect(row[skill]).toBeNull();
      expect(row.labeller).toBe("");
    }
    expect(items.filter((item) => item.borderline_note).length).toBeGreaterThanOrEqual(4);
    expect(items.filter((item) => !item.synthetic).length).toBeGreaterThan(0);
    expect(new Set(items.map((item) => item.text)).size).toBeLessThan(items.length);
    for (const item of items) expect(buildRequest(item)).toBeDefined();
  });

  test("shipped CLI runs fifty mocked requests and reports the blank template without network access", () => {
    const directory = mkdtempSync(join(tmpdir(), "jev-cli-"));
    try {
      const preload = join(directory, "mock.ts");
      const output = join(directory, "results.jsonl");
      writeFileSync(preload, `globalThis.fetch = async () => Response.json(${JSON.stringify(reply())});`);
      const cli = join(import.meta.dir, "../jev-routing-cli.ts");
      const launched = Bun.spawnSync([process.execPath, "--preload", preload, cli, "run", output], {
        env: { ...process.env, TYPESAFE_API_KEY: "mock-only-key" },
      });
      expect(launched.exitCode).toBe(0);
      expect(new TextDecoder().decode(launched.stdout)).toContain("Written: 50; skipped: 0");
      expect(parseResults(readFileSync(output, "utf8"))).toHaveLength(50);
      const printed = Bun.spawnSync([process.execPath, "--preload", preload, cli, "report", output,
        ITEMS_PATH.replace("items.jsonl", "labels.template.jsonl"), "0.8"]);
      expect(printed.exitCode).toBe(0);
      expect(new TextDecoder().decode(printed.stdout)).toContain("Missing labels: 50");
    } finally { rmSync(directory, { recursive: true }); }
  });
});
