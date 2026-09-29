// The client for Jev, the judgement model TypeSafe serves at one endpoint.
//
// Everything here was measured against the live service on 2026-09-28. A
// burst of 24 requests drew a 520 from the proxy in front of it, so no more
// than four are ever in flight, and a 429 or any 5xx is retried with a wait
// that doubles each time.

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/**
 * The model every request asks for. It is a pinned version, not jev-latest:
 * the TypeSafe documentation says an alias moves when a new release ships,
 * and advises pinning a version once thresholds are tuned against it.
 */
export const JEV_MODEL = "jev-1.13.0";
export const MOST_IN_FLIGHT = 4;
export const MOST_ATTEMPTS = 6;
/**
 * How far the probabilities in a Choice answer may sum from 1. The documented
 * example sums to exactly 1, so this allows for rounding and is not measured.
 */
export const CHOICE_SUM_TOLERANCE = 0.01;
const FIRST_WAIT_MS = 500;
// A model name is printed only when it looks like one, so a name from the
// service can never carry control characters or run on to the terminal.
const PRINTABLE_MODEL = /^[A-Za-z0-9._-]{1,64}$/;

/** A yes-or-no question, answered with the probability that the answer is yes. */
export interface NoulQuestion {
  type?: "noul";
  /**
   * Names fields of the state in backticks, such as `heading`. Several
   * strings are sent as they are, when the question needs examples.
   */
  instructions: string | string[];
  criteria: { true: string; false: string };
}

/** A question answered by picking one of several named options. */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string | string[];
  /** Each option, keyed by the name Jev answers with, and what it means. */
  criteria: Record<string, string>;
}

export type Question = NoulQuestion | ChoiceQuestion;

/** The option Jev picked, how sure it was, and the probability of every option. */
export interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/** A Choice question is answered with a ChoiceAnswer, and a Noul question with a probability. */
export type AnswerTo<Asked extends Question> = Asked extends ChoiceQuestion ? ChoiceAnswer : number;

export type Answers<Asked extends Record<string, Question>> = { [Id in keyof Asked]: AnswerTo<Asked[Id]> };

export type JevState = Record<string, string | number>;

/** Several yes-or-no questions about one state travel in one request. */
export interface JevRequest {
  state: JevState;
  questions: Record<string, NoulQuestion>;
}

/** The probability of a true answer, by question identifier. */
export type Probabilities = Record<string, number>;

/**
 * Asks Jev the yes-or-no questions in one request. The design audit takes this
 * as a parameter, so a test can pass a plain function in its place.
 */
export type Ask = (request: JevRequest) => Promise<Probabilities>;

/** Asks Jev questions of any type, and gives each answer the type its question calls for. */
export type TypedAsk = <Asked extends Record<string, Question>>(
  request: { state: JevState; questions: Asked },
) => Promise<Answers<Asked>>;

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

export type Sleep = (ms: number) => Promise<void>;

/** Told the model named in each accepted response, so a run can report it. */
export type RecordModel = (model: string) => void;

/** The service could not answer, so the audit is incomplete. */
export class JevServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevServiceError";
  }
}

/** The service answered, but not with the model the request pinned. */
export class JevModelError extends JevServiceError {
  constructor(message: string) {
    super(message);
    this.name = "JevModelError";
  }
}

export interface AskOptions {
  fetch?: Fetch;
  sleep?: Sleep;
  onModel?: RecordModel;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The JSON body the endpoint expects. Exported so a test can check it without sending it. */
export function requestBody(request: { state: JevState; questions: Record<string, Question> }): object {
  const questions = Object.fromEntries(
    Object.entries(request.questions).map(([id, question]) => [
      id,
      { type: question.type ?? "noul", instructions: question.instructions, criteria: question.criteria },
    ]),
  );
  return { model: JEV_MODEL, state: request.state, questions };
}

/** Build the function that asks questions of any type. Building it sends nothing. */
export function createTypedAsk(apiKey: string, options: AskOptions = {}): TypedAsk {
  const send = options.fetch ?? globalThis.fetch;
  const wait = options.sleep ?? sleep;
  const inTurn = limitInFlight(MOST_IN_FLIGHT);
  return (request) => inTurn(async () => {
    const answers = await askWithRetries(request, apiKey, send, wait, options.onModel);
    return answers as Answers<typeof request.questions>;
  });
}

/** Build the function that asks yes-or-no questions. Building it sends nothing. */
export function createAsk(apiKey: string, options: AskOptions = {}): Ask {
  return createTypedAsk(apiKey, options);
}

/**
 * Build the function that asks Jev, telling `recordModel` which model answered
 * each request. Every request pins JEV_MODEL, and an answer from any other
 * model is refused, so the report names the model its findings came from.
 */
export function connectToJev(apiKey: string, recordModel: RecordModel): Ask {
  return createAsk(apiKey, { onModel: recordModel });
}

async function askWithRetries(
  request: { state: JevState; questions: Record<string, Question> },
  apiKey: string,
  send: Fetch,
  wait: Sleep,
  onModel: RecordModel | undefined,
): Promise<Record<string, number | ChoiceAnswer>> {
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
    if (response.ok) {
      const { model, answers } = await readAnswers(response, request.questions);
      onModel?.(model);
      return answers;
    }
    lastProblem = `The last attempt got HTTP status ${response.status}.`;
    if (response.status !== 429 && response.status < 500) {
      throw new JevServiceError(
        `Jev refused the request with HTTP status ${response.status}. Check that TYPESAFE_API_KEY holds a valid key.`,
      );
    }
  }
  throw new JevServiceError(`Jev did not answer after ${MOST_ATTEMPTS} attempts. ${lastProblem}`);
}

interface Payload {
  model?: unknown;
  answers?: Record<string, unknown>;
}

async function readAnswers(
  response: Response,
  questions: Record<string, Question>,
): Promise<{ model: string; answers: Record<string, number | ChoiceAnswer> }> {
  const payload = (await response.json().catch(() => null)) as Payload | null;
  const answers: Record<string, number | ChoiceAnswer> = {};
  // Each answer is read as the type its question asked for, so an answer of
  // any other type is not an answer to it, whatever it carries. The answers
  // are checked before the model, so a malformed answer is named as such.
  for (const [id, question] of Object.entries(questions)) {
    const answer = payload?.answers?.[id];
    answers[id] = question.type === "choice" ? readChoice(answer, question) : readNoul(answer);
  }
  return { model: pinnedModel(payload?.model), answers };
}

function readNoul(answer: unknown): number {
  const { type, noul } = (answer ?? {}) as { type?: unknown; noul?: unknown };
  if (type !== "noul" || typeof noul !== "number" || noul < 0 || noul > 1) {
    throw new JevServiceError("Jev answered, but not with a probability for every question asked.");
  }
  return noul;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

/**
 * A Choice answer is accepted only whole: the right type, a choice among the
 * options asked, a confidence and every probability between 0 and 1, exactly
 * the options asked, and probabilities summing to 1 within the tolerance.
 */
function readChoice(answer: unknown, question: ChoiceQuestion): ChoiceAnswer {
  const { type, choice, confidence, probabilities } = (answer ?? {}) as Record<string, unknown>;
  const options = Object.keys(question.criteria).sort();
  const given = typeof probabilities === "object" && probabilities !== null && !Array.isArray(probabilities)
    ? probabilities as Record<string, unknown>
    : {};
  const values = Object.values(given);
  const valid = type === "choice"
    && typeof choice === "string" && options.includes(choice)
    && isProbability(confidence)
    && Object.keys(given).sort().join("\n") === options.join("\n")
    && values.every(isProbability)
    && Math.abs((values as number[]).reduce((sum, value) => sum + value, 0) - 1) <= CHOICE_SUM_TOLERANCE;
  if (!valid) {
    throw new JevServiceError("Jev answered, but not with a valid choice for every choice question asked.");
  }
  return { choice: choice as string, confidence: confidence as number, probabilities: given as Record<string, number> };
}

/** The model that answered, which must be the one every request pins. */
function pinnedModel(model: unknown): string {
  if (typeof model !== "string") {
    throw new JevModelError(
      `Jev did not say which model answered, so the answers cannot be confirmed as ${JEV_MODEL}.`,
    );
  }
  if (model !== JEV_MODEL) {
    const name = PRINTABLE_MODEL.test(model) ? `model ${model}` : "a model whose name cannot be printed safely";
    throw new JevModelError(`Jev answered with ${name}, but ${JEV_MODEL} was asked for.`);
  }
  return model;
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
