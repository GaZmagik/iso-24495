import { MODEL, validateCalibration, type RequestBody } from "./catalogue.ts";
import { add, compare, ONE, parseDecimal, subtract, ZERO, type Decimal } from "./decimal.ts";
import { parseExactJson } from "./exact-json.ts";
import type { ExactAnswers } from "./engine.ts";

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MAX_ATTEMPTS = 6;
export const MAX_IN_FLIGHT = 4;
export const TIMEOUT_MS = 30000;
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;
export interface Clock { schedule: (callback: () => void, ms: number) => () => void }
export interface ClientOptions {
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: Clock;
  signal?: AbortSignal;
  validate?: () => void;
}
export class JevError extends Error {
  constructor(message: string, readonly exitCode = 3) { super(message); this.name = "JevError"; }
}
class TransportError extends Error {
  constructor() { super("The transport attempt timed out."); }
}
export type Ask = (body: RequestBody) => Promise<ExactAnswers>;

/**
 * Makes the function that sends one request to TypeSafe and returns its
 * checked answers. Nothing is sent until that function is called.
 *
 * Each call posts its request to `ENDPOINT` with the key, so document text
 * leaves the machine and charges may apply. The body is captured when the
 * call is made, and later changes to the object are not sent. At most
 * `MAX_IN_FLIGHT` requests made through one returned function are in flight
 * at once, and the rest wait. An attempt is abandoned after `TIMEOUT_MS`. A
 * timeout, a connection failure, HTTP 429 and HTTP 5xx are tried again, up to
 * `MAX_ATTEMPTS` attempts, after a wait that starts at half a second and
 * doubles. An answer with a 2xx status is never asked for again, even where
 * it then fails its checks.
 *
 * The shared boundary checks the original key before trimming spaces.
 *
 * @param key The TypeSafe API key. Spaces around it are trimmed.
 * @param options Replacements for the fetch, the wait between attempts, the
 *     timeout clock and the calibration check. `signal` cancels requests that
 *     are waiting or in flight.
 * @returns The sending function. Its promise rejects with a `JevError` whose
 *     exit code is 3 when the service refuses the request, when no attempt
 *     succeeds, when the answer fails `readAnswers`, or when `signal` aborts.
 * @throws A `JevError` with exit code 4 when the key is empty or holds a
 *     control character, and with exit code 3 when the calibration files fail
 *     their integrity check.
 */
export function createAsk(key: string, options: ClientOptions = {}): Ask {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(key)) throw new JevError("TYPESAFE_API_KEY contains a control character. Set it again with the key alone.", 4);
  const trimmed = key.trim();
  if (trimmed === "") throw new JevError("Set TYPESAFE_API_KEY to a TypeSafe API key. Get one from https://docs.typesafe.ai.", 4);
  try { (options.validate ?? validateCalibration)(); } catch { throw new JevError("Calibration integrity failed. Restore the reviewed catalogue and templates."); }
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? wait;
  const clock = options.clock ?? systemClock;
  const limited = limitInFlight(MAX_IN_FLIGHT);
  return body => {
    // Capture bytes at submission, before any queue or retry can observe mutations.
    const snapshot = JSON.stringify(body);
    const questions = JSON.parse(snapshot).questions as RequestBody["questions"];
    return limited(() => askWithRetries(snapshot, questions, trimmed, send, sleep, clock, options.signal));
  };
}

/**
 * Reads a response from Jev into exact probabilities, one entry for each
 * question that was asked.
 *
 * Both the vendored floating-point validation and the exact checks of the
 * calibration must pass.
 *
 * @param text The response body as it arrived.
 * @param questions The questions sent, which decide the answers read and the
 *     kind each must be. An answer to a question not listed is ignored.
 * @returns A `Decimal` for a "noul" question, and a `Decimal` for each option
 *     of a "choice" question. With no questions the result is empty, and the
 *     model is still checked.
 * @throws A `JevError` in fixed words, with exit code 3, when the text is not
 *     JSON or holds a number `parseDecimal` refuses as too long or for its
 *     exponent, the model is not `MODEL`, a probability is missing or lies
 *     outside 0 to 1, a choice does not carry exactly the options asked, or
 *     its probabilities do not sum to 1 within 0.01. Bad input is never
 *     returned as a value.
 */
export function readAnswers(text: string, questions: RequestBody["questions"]): ExactAnswers {
  let payload: { model?: unknown; answers?: Record<string, unknown> };
  let exact: { answers: Record<string, Record<string, unknown>> };
  try { payload = JSON.parse(text); exact = parseExactJson(text) as typeof exact; } catch { throw new JevError("Jev returned malformed JSON."); }
  if (payload?.model !== MODEL) throw new JevError("Jev returned a wrong or missing model. Expected jev-1.13.0.");
  const answers: ExactAnswers = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = payload.answers?.[id] as Record<string, unknown> | undefined;
    const precise = exact.answers?.[id];
    if (question.type === "noul") {
      if (answer?.type !== "noul" || !isProbability(answer.noul) || !isExactProbability(precise?.noul)) throw new JevError("Jev returned an invalid probability.");
      answers[id] = precise.noul as Decimal;
      continue;
    }
    const options = Object.keys(question.criteria).sort();
    const given = typeof answer?.probabilities === "object" && answer.probabilities !== null && !Array.isArray(answer.probabilities) ? answer.probabilities as Record<string, unknown> : {};
    const values = Object.values(given);
    if (!(precise !== undefined && answer?.type === "choice" && typeof answer.choice === "string" && options.includes(answer.choice)
      && isProbability(answer.confidence) && Object.keys(given).sort().join("\n") === options.join("\n")
      && values.every(isProbability) && Math.abs((values as number[]).reduce((sum, value) => sum + value, 0) - 1) <= 0.01)) throw new JevError("Jev returned an invalid Choice distribution.");
    const probabilities = precise.probabilities as Record<string, Decimal>;
    if (!isExactProbability(precise.confidence) || !Object.values(probabilities).every(isExactProbability)) throw new JevError("Jev returned an out-of-range exact Choice probability.");
    const sum = Object.values(probabilities).reduce(add, ZERO);
    const distance = compare(sum, ONE) >= 0 ? subtract(sum, ONE) : subtract(ONE, sum);
    if (compare(distance, parseDecimal("0.01")) > 0) throw new JevError("Jev returned an invalid exact Choice sum.");
    answers[id] = probabilities;
  }
  return answers;
}

async function askWithRetries(body: string, questions: RequestBody["questions"], key: string, send: Fetch, sleep: (ms: number) => Promise<void>, clock: Clock, signal?: AbortSignal): Promise<ExactAnswers> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new JevError("Jev execution was cancelled.");
    if (attempt > 1) await sleep(500 * 2 ** (attempt - 2));
    if (signal?.aborted) throw new JevError("Jev execution was cancelled.");
    let result: { status: number; text: string };
    try { result = await transport(body, key, send, clock, signal); }
    catch (error) { if (error instanceof JevError) throw error; continue; }
    if (result.status >= 200 && result.status <= 299) return readAnswers(result.text, questions);
    if (result.status !== 429 && !(result.status >= 500 && result.status <= 599)) throw new JevError(`Jev refused the request with HTTP status ${result.status}.`);
  }
  throw new JevError("Jev did not answer after six transport attempts.");
}

async function transport(body: string, key: string, send: Fetch, clock: Clock, signal?: AbortSignal): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const interrupted = Promise.withResolvers<never>();
  const cancel = (): void => { interrupted.reject(new JevError("Jev execution was cancelled.")); controller.abort(); };
  signal?.addEventListener("abort", cancel, { once: true });
  const cancelTimer = clock.schedule(() => { interrupted.reject(new TransportError()); controller.abort(); }, TIMEOUT_MS);
  try {
    return await Promise.race([interrupted.promise, send(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body, signal: controller.signal }).then(async response => ({ status: response.status, text: await response.text() }))]);
  } finally { cancelTimer(); signal?.removeEventListener("abort", cancel); }
}

function isProbability(value: unknown): value is number { return typeof value === "number" && value >= 0 && value <= 1; }
function isExactProbability(value: unknown): value is Decimal {
  return typeof value === "object" && value !== null && typeof (value as Decimal).units === "bigint" && compare(value as Decimal, ZERO) >= 0 && compare(value as Decimal, ONE) <= 0;
}
/**
 * A promise that resolves after `ms` milliseconds and never rejects. It is
 * the wait `createAsk` uses between attempts unless it is given another.
 */
export function wait(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
export const systemClock: Clock = { schedule: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); } };

function limitInFlight(most: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async task => {
    if (active < most) active++; else await new Promise<void>(resolve => waiting.push(resolve));
    try { return await task(); } finally { const next = waiting.shift(); if (next === undefined) active--; else next(); }
  };
}
