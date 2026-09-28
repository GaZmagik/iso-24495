// The client for Jev, the judgement model TypeSafe serves at one endpoint.
//
// Everything here was measured against the live service on 2026-09-28. A
// burst of 24 requests drew a 520 from the proxy in front of it, so no more
// than four are ever in flight, and a 429 or any 5xx is retried with a wait
// that doubles each time.

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const MOST_IN_FLIGHT = 4;
export const MOST_ATTEMPTS = 6;
const FIRST_WAIT_MS = 500;

/** A yes-or-no question, answered with the probability that the answer is yes. */
export interface NoulQuestion {
  /**
   * Names fields of the state in backticks, such as `heading`. Several
   * strings are sent as they are, when the question needs examples.
   */
  instructions: string | string[];
  criteria: { true: string; false: string };
}

/** Several questions about one state travel in one request. */
export interface JevRequest {
  state: Record<string, string | number>;
  questions: Record<string, NoulQuestion>;
}

/** The probability of a true answer, by question identifier. */
export type Probabilities = Record<string, number>;

/** Asks Jev the questions in one request. The design audit takes this as a parameter. */
export type Ask = (request: JevRequest) => Promise<Probabilities>;

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

export type Sleep = (ms: number) => Promise<void>;

/** The service could not answer, so the audit is incomplete. */
export class JevServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevServiceError";
  }
}

export interface AskOptions {
  fetch?: Fetch;
  sleep?: Sleep;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The JSON body the endpoint expects. Exported so a test can check it without sending it. */
export function requestBody(request: JevRequest): object {
  const questions = Object.fromEntries(
    Object.entries(request.questions).map(([id, question]) => [
      id,
      { type: "noul", instructions: question.instructions, criteria: question.criteria },
    ]),
  );
  return { model: JEV_MODEL, state: request.state, questions };
}

/** Build the function that asks Jev. Building it sends nothing. */
export function createAsk(apiKey: string, options: AskOptions = {}): Ask {
  const send = options.fetch ?? globalThis.fetch;
  const wait = options.sleep ?? sleep;
  const inTurn = limitInFlight(MOST_IN_FLIGHT);
  return (request) => inTurn(() => askWithRetries(request, apiKey, send, wait));
}

async function askWithRetries(
  request: JevRequest,
  apiKey: string,
  send: Fetch,
  wait: Sleep,
): Promise<Probabilities> {
  let lastProblem = "";
  for (let attempt = 1; attempt <= MOST_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await wait(FIRST_WAIT_MS * 2 ** (attempt - 2));
    let response: Response;
    try {
      response = await send(JEV_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(request)),
      });
    } catch {
      // The error text is dropped on purpose. Bun and Node both quote a rejected
      // header value in it, and the Authorization header carries the key.
      lastProblem = "The last attempt could not connect.";
      continue;
    }
    if (response.ok) return readProbabilities(response, Object.keys(request.questions));
    lastProblem = `The last attempt got HTTP status ${response.status}.`;
    if (response.status !== 429 && response.status < 500) {
      throw new JevServiceError(
        `Jev refused the request with HTTP status ${response.status}. Check that TYPESAFE_API_KEY holds a valid key.`,
      );
    }
  }
  throw new JevServiceError(`Jev did not answer after ${MOST_ATTEMPTS} attempts. ${lastProblem}`);
}

async function readProbabilities(response: Response, ids: string[]): Promise<Probabilities> {
  const payload = (await response.json().catch(() => null)) as
    | { answers?: Record<string, { type?: unknown; noul?: unknown }> }
    | null;
  const probabilities: Probabilities = {};
  for (const id of ids) {
    // Every question asked is a noul question, so an answer of any other type
    // is not an answer to it, whatever number it carries.
    const answer = payload?.answers?.[id];
    const noul = answer?.noul;
    if (answer?.type !== "noul" || typeof noul !== "number" || noul < 0 || noul > 1) {
      throw new JevServiceError("Jev answered, but not with a probability for every question asked.");
    }
    probabilities[id] = noul;
  }
  return probabilities;
}

/**
 * Run tasks with no more than `most` in flight. A finishing task hands its
 * place straight to the next one waiting, so a new arrival cannot take the
 * place in between and push the count past the limit.
 */
function limitInFlight(most: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (active < most) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) {
        active -= 1;
      } else {
        next();
      }
    }
  };
}
