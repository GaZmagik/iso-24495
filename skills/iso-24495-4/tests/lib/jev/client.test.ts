import { describe, expect, test } from "bun:test";
import { buildRequest, MODEL } from "../../../scripts/lib/jev/catalogue.ts";
import { createAsk, readAnswers, TIMEOUT_MS, systemClock, wait, type Clock, type Fetch } from "../../../scripts/lib/jev/client.ts";
import { decimalText } from "../../../scripts/lib/jev/decimal.ts";

const OPENING = buildRequest("opening", { opening: "# Title" });
const BLOCK = buildRequest("block", { paragraph: "Words." });
const VALID = { model: MODEL, answers: { purpose: { type: "choice", choice: "neither", confidence: 0.9, probabilities: { both: 0.1, task_only: 0.02, scope_only: 0.02, neither: 0.86 } }, reader: { type: "noul", noul: 0.5 } } };
const valid = () => new Response(JSON.stringify(VALID));
const idle: Clock = { schedule: () => () => {} };
const noWait = async () => {};

describe("exact response validation", () => {
  test("keeps the calibration's exact probability and companion validation", () => {
    const text = JSON.stringify(VALID).replace('"both":0.1', '"both":0.10000000000000001');
    expect(decimalText(readAnswers(text, OPENING.questions).purpose.both)).toBe("0.10000000000000001");
    expect(readAnswers(JSON.stringify({ model: MODEL, answers: { colour_only: { type: "noul", noul: 0.17 }, position_only: { type: "noul", noul: 1 } } }), BLOCK.questions).colour_only).toEqual({ units: 17n, scale: 2 });
  });
  test("rejects malformed JSON, models and all malformed answer shapes", () => {
    for (const text of ["broken", "null", "{}", JSON.stringify({ ...VALID, model: "jev-latest" })]) expect(() => readAnswers(text, OPENING.questions)).toThrow();
    for (const answer of [null, {}, { type: "choice" }, { ...VALID.answers.purpose, type: "noul" }, { ...VALID.answers.purpose, choice: "other" }, { ...VALID.answers.purpose, confidence: -1 }, { ...VALID.answers.purpose, probabilities: [] }, { ...VALID.answers.purpose, probabilities: null }, { ...VALID.answers.purpose, probabilities: { both: 1 } }, { ...VALID.answers.purpose, probabilities: { ...VALID.answers.purpose.probabilities, extra: 0 } }, { ...VALID.answers.purpose, probabilities: { both: 0.1, task_only: 0, scope_only: 0, neither: 0.8 } }, { ...VALID.answers.purpose, probabilities: { ...VALID.answers.purpose.probabilities, both: 2 } }]) {
      expect(() => readAnswers(JSON.stringify({ ...VALID, answers: { ...VALID.answers, purpose: answer } }), OPENING.questions)).toThrow();
    }
    for (const answer of [null, {}, { type: "choice", noul: 0 }, { type: "noul", noul: -0.1 }, { type: "noul", noul: 1.1 }, { type: "noul", noul: "0.2" }]) expect(() => readAnswers(JSON.stringify({ ...VALID, answers: { ...VALID.answers, reader: answer } }), OPENING.questions)).toThrow();
    expect(() => readAnswers(JSON.stringify(VALID).replace('"noul":0.5', '"noul":1.00000000000000001'), OPENING.questions)).toThrow();
    expect(() => readAnswers(JSON.stringify(VALID).replace('"confidence":0.9', '"confidence":1.00000000000000001'), OPENING.questions)).toThrow();
    expect(() => readAnswers(JSON.stringify(VALID).replace('"both":0.1', '"both":-1e-400'), OPENING.questions)).toThrow();
    expect(() => readAnswers(JSON.stringify(VALID).replace('"neither":0.86', '"neither":0.87000000000000001'), OPENING.questions)).toThrow();
    expect(() => readAnswers(JSON.stringify(VALID).replace('"neither":0.86', '"neither":0.84999999999999999'), OPENING.questions)).toThrow();
    expect(readAnswers(JSON.stringify(VALID).replace('"neither":0.86', '"neither":0.855'), OPENING.questions).purpose).toBeDefined();
  });
});

describe("transport controls", () => {
  test("the native clock adapter can cancel and the sleep adapter completes", async () => {
    let fired = false;
    const cancel = systemClock.schedule(() => { fired = true; }, 100);
    cancel();
    await wait(0);
    expect(fired).toBe(false);
    await new Promise<void>(resolve => { systemClock.schedule(resolve, 0); });
  });
  test("checks untrimmed keys and integrity before any connection", () => {
    for (const key of ["", "   ", " key\n", "\tkey", "key\u007f", "key\u0085"]) expect(() => createAsk(key)).toThrow();
    expect(() => createAsk("key", { validate: () => { throw new Error("secret"); } })).toThrow("integrity");
  });
  test("retries transport only, preserves frozen bytes and trims surrounding spaces", async () => {
    const bodies: string[] = [];
    const waits: number[] = [];
    const request = structuredClone(OPENING);
    const send: Fetch = async (url, init) => {
      expect(url).toContain("typesafe.ai");
      expect(init.headers.Authorization).toBe("Bearer key");
      bodies.push(init.body);
      request.state.opening = "changed";
      if (bodies.length === 1) throw new Error("key must be redacted");
      if (bodies.length === 2) return new Response("busy", { status: 429 });
      if (bodies.length === 3) return new Response("busy", { status: 503 });
      return valid();
    };
    await createAsk(" key ", { fetch: send, clock: idle, sleep: async ms => { waits.push(ms); } })(request);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe(JSON.stringify(OPENING));
    expect(waits).toEqual([500, 1000, 2000]);
    for (const status of [400, 401, 403, 300]) {
      let calls = 0;
      await expect(createAsk("key", { fetch: async () => { calls++; return new Response("secret", { status }); }, clock: idle, sleep: noWait })(OPENING)).rejects.toThrow("HTTP status");
      expect(calls).toBe(1);
    }
    let malformedCalls = 0;
    await expect(createAsk("key", { fetch: async () => { malformedCalls++; return new Response("bad"); }, clock: idle, sleep: noWait })(OPENING)).rejects.toThrow("malformed");
    expect(malformedCalls).toBe(1);
    let failures = 0;
    await expect(createAsk("key", { fetch: async () => { failures++; throw new Error("secret"); }, clock: idle, sleep: noWait })(OPENING)).rejects.toThrow("six");
    expect(failures).toBe(6);
  });
  test("times out attempts, ignores late answers and cancels", async () => {
    const callbacks: Array<() => void> = [];
    const clock: Clock = { schedule: (callback, ms) => { expect(ms).toBe(TIMEOUT_MS); callbacks.push(callback); return () => {}; } };
    let late: (response: Response) => void = () => {};
    let calls = 0;
    const pending = createAsk("key", { fetch: async () => { calls++; if (calls === 1) return new Promise(resolve => { late = resolve; }); return valid(); }, clock, sleep: noWait })(OPENING);
    await Promise.resolve();
    callbacks[0]();
    const accepted = await pending;
    late(new Response("wrong late answer"));
    expect(accepted.purpose).toBeDefined();
    expect(calls).toBe(2);
    const controller = new AbortController();
    controller.abort();
    await expect(createAsk("key", { fetch: async () => valid(), clock: idle, signal: controller.signal })(OPENING)).rejects.toThrow("cancelled");
    const during = new AbortController();
    const active = createAsk("key", { fetch: async () => new Promise(() => {}), clock: idle, signal: during.signal })(OPENING);
    await Promise.resolve();
    during.abort();
    await expect(active).rejects.toThrow("cancelled");
    const backoff = new AbortController();
    await expect(createAsk("key", { fetch: async () => { throw new Error(); }, clock: idle, signal: backoff.signal, sleep: async () => { backoff.abort(); } })(OPENING)).rejects.toThrow("cancelled");
  });
  test("limits all queued requests to four in flight", async () => {
    let active = 0;
    let maximum = 0;
    const ask = createAsk("key", { fetch: async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return valid(); }, clock: idle });
    await Promise.all(Array.from({ length: 20 }, () => ask(OPENING)));
    expect(maximum).toBe(4);
  });
});
