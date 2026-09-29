import { describe, expect, test } from "bun:test";
import {
  CHOICE_SUM_TOLERANCE,
  connectToJev,
  createAsk,
  createTypedAsk,
  JEV_ENDPOINT,
  JEV_MODEL,
  JevModelError,
  JevServiceError,
  requestBody,
  sleep,
  type ChoiceQuestion,
  type Fetch,
  type JevRequest,
} from "../scripts/jev.ts";

const REQUEST: JevRequest = {
  state: { heading: "Background" },
  questions: {
    message: {
      instructions: "Does `heading` state a message?",
      criteria: { true: "It states a message.", false: "It only names a topic." },
    },
  },
};

interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A stand-in for the network: answers in turn, and records what was sent. */
function scriptedFetch(answers: Array<Response | Error>): { fetch: Fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const answer = answers[Math.min(sent.length - 1, answers.length - 1)] as Response | Error;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, sent };
}

const TWO_QUESTIONS: JevRequest = {
  state: { paragraph: "Press the blue button." },
  questions: {
    colour_only: { instructions: "Colour alone?", criteria: { true: "Yes.", false: "No." } },
    position_only: { instructions: "Position alone?", criteria: { true: "Yes.", false: "No." } },
  },
};

function answered(noul: number): Response {
  return Response.json({
    model: "jev-1.13.0",
    answers: { message: { type: "noul", noul } },
    usage: {},
  });
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return { sleep: async (ms) => { waits.push(ms); }, waits };
}

describe("requestBody", () => {
  test("passes instructions given as several strings through unchanged", () => {
    const body = requestBody({
      state: { opening: "# Title" },
      questions: {
        reader: {
          instructions: ["Does `opening` name a reader?", "These count: a sentence naming one."],
          criteria: { true: "Yes.", false: "No." },
        },
      },
    }) as { questions: { reader: { instructions: unknown } } };
    expect(body.questions.reader.instructions)
      .toEqual(["Does `opening` name a reader?", "These count: a sentence naming one."]);
  });

  test("names the model, carries the state, and marks every question as noul", () => {
    expect(requestBody(REQUEST)).toEqual({
      model: "jev-1.13.0",
      state: { heading: "Background" },
      questions: {
        message: {
          type: "noul",
          instructions: "Does `heading` state a message?",
          criteria: { true: "It states a message.", false: "It only names a topic." },
        },
      },
    });
  });
});

const ROUTE: ChoiceQuestion = {
  type: "choice",
  instructions: "Which team should handle `ticket`?",
  criteria: {
    billing: "Payments, invoicing, refunds",
    technical: "Bugs, outages, integrations",
    sales: "Pricing, upgrades, new accounts",
  },
};

const URGENT = {
  instructions: "Does `ticket` convey urgency?",
  criteria: { true: "It is time-sensitive.", false: "It is not." },
};

function choiceResponse(answer: unknown): Response {
  return Response.json({
    model: "jev-1.13.0",
    answers: { route: answer, urgent: { type: "noul", noul: 0.8 } },
  });
}

describe("Choice questions", () => {
  test("send their options as criteria, typed as choice", () => {
    const body = requestBody({ state: { ticket: "Refund please" }, questions: { route: ROUTE, urgent: URGENT } });
    expect(body).toEqual({
      model: "jev-1.13.0",
      state: { ticket: "Refund please" },
      questions: {
        route: { type: "choice", instructions: ROUTE.instructions, criteria: ROUTE.criteria },
        urgent: { type: "noul", instructions: URGENT.instructions, criteria: URGENT.criteria },
      },
    });
  });

  test("come back typed beside noul answers in the same request", async () => {
    const network = scriptedFetch([choiceResponse({
      type: "choice",
      choice: "billing",
      confidence: 0.9,
      probabilities: { billing: 0.9, technical: 0.05, sales: 0.05 },
    })]);
    const models: string[] = [];
    const ask = createTypedAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep, onModel: (model) => models.push(model) });

    const answers = await ask({ state: { ticket: "Refund please" }, questions: { route: ROUTE, urgent: URGENT } });

    expect(answers.route.choice).toBe("billing");
    expect(answers.route.confidence).toBe(0.9);
    expect(answers.route.probabilities).toEqual({ billing: 0.9, technical: 0.05, sales: 0.05 });
    expect(answers.urgent).toBe(0.8);
    expect(models).toEqual(["jev-1.13.0"]);
  });

  test("accept probabilities that sum to 1 within the tolerance", async () => {
    expect(CHOICE_SUM_TOLERANCE).toBe(0.01);
    for (const probabilities of [
      { billing: 0.333, technical: 0.333, sales: 0.333 },
      { billing: 0.338, technical: 0.333, sales: 0.338 },
    ]) {
      const network = scriptedFetch([choiceResponse({ type: "choice", choice: "billing", confidence: 0, probabilities })]);
      const ask = createTypedAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep });
      const answers = await ask({ state: {}, questions: { route: ROUTE, urgent: URGENT } });
      expect(answers.route.probabilities).toEqual(probabilities);
    }
  });

  test("are refused unless every part of the answer is valid", async () => {
    const valid = { billing: 0.6, technical: 0.3, sales: 0.1 };
    const answers: Array<[string, unknown]> = [
      ["noul type", { type: "noul", noul: 0.6 }],
      ["no type", { choice: "billing", confidence: 0.6, probabilities: valid }],
      ["choice not an option", { type: "choice", choice: "legal", confidence: 0.6, probabilities: valid }],
      ["choice not a string", { type: "choice", choice: 1, confidence: 0.6, probabilities: valid }],
      ["confidence missing", { type: "choice", choice: "billing", probabilities: valid }],
      ["confidence above 1", { type: "choice", choice: "billing", confidence: 1.2, probabilities: valid }],
      ["confidence below 0", { type: "choice", choice: "billing", confidence: -0.1, probabilities: valid }],
      ["probabilities missing", { type: "choice", choice: "billing", confidence: 0.6 }],
      ["probabilities a list", { type: "choice", choice: "billing", confidence: 0.6, probabilities: [0.6, 0.3, 0.1] }],
      ["an option missing", { type: "choice", choice: "billing", confidence: 0.6, probabilities: { billing: 0.7, technical: 0.3 } }],
      ["an extra option", { type: "choice", choice: "billing", confidence: 0.6, probabilities: { ...valid, sales: 0.05, legal: 0.05 } }],
      ["a probability not a number", { type: "choice", choice: "billing", confidence: 0.6, probabilities: { ...valid, sales: "0.1" } }],
      ["a probability below 0", { type: "choice", choice: "billing", confidence: 0.6, probabilities: { billing: 0.8, technical: 0.3, sales: -0.1 } }],
      ["a probability above 1", { type: "choice", choice: "billing", confidence: 0.6, probabilities: { billing: 1.1, technical: 0, sales: -0.1 } }],
      ["a sum too low", { type: "choice", choice: "billing", confidence: 0.6, probabilities: { billing: 0.5, technical: 0.3, sales: 0.1 } }],
      ["a sum too high", { type: "choice", choice: "billing", confidence: 0.6, probabilities: { billing: 0.6, technical: 0.3, sales: 0.12 } }],
      ["no answer", undefined],
    ];
    for (const [name, answer] of answers) {
      const network = scriptedFetch([choiceResponse(answer)]);
      const ask = createTypedAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep });
      const failure = await ask({ state: {}, questions: { route: ROUTE, urgent: URGENT } }).catch((error: unknown) => error);
      expect(failure, name).toBeInstanceOf(JevServiceError);
      expect((failure as Error).message, name).toBe(
        "Jev answered, but not with a valid choice for every choice question asked.",
      );
    }
  });
});

describe("createAsk", () => {
  test("posts the body with the key and returns each probability by question", async () => {
    const network = scriptedFetch([answered(0.95)]);
    const ask = createAsk("secret", { fetch: network.fetch, sleep: recordingSleep().sleep });

    expect(await ask(REQUEST)).toEqual({ message: 0.95 });
    expect(network.sent).toHaveLength(1);
    expect(network.sent[0]?.url).toBe(JEV_ENDPOINT);
    expect(network.sent[0]?.headers.Authorization).toBe("Bearer secret");
    expect(network.sent[0]?.headers["Content-Type"]).toBe("application/json");
    expect(network.sent[0]?.body).toEqual(requestBody(REQUEST));
  });

  test("pins the model it asks for, rather than an alias that moves", () => {
    expect(JEV_MODEL).toBe("jev-1.13.0");
    expect((requestBody(REQUEST) as { model: string }).model).toBe("jev-1.13.0");
  });

  test("records the model that answered", async () => {
    const models: string[] = [];
    const named = scriptedFetch([answered(0.95)]);
    await createAsk("k", { fetch: named.fetch, sleep: recordingSleep().sleep, onModel: (model) => models.push(model) })(REQUEST);
    expect(models).toEqual(["jev-1.13.0"]);
  });

  // The request pins a version, so an answer from any other model is the
  // service not doing what was asked, like an answer of the wrong type.
  test("refuses an answer from another model, or from a model it does not name", async () => {
    const answer = { message: { type: "noul", noul: 0.5 } };
    const cases: Array<[unknown, string]> = [
      ["jev-1.14.0", "Jev answered with model jev-1.14.0, but jev-1.13.0 was asked for."],
      [undefined, "Jev did not say which model answered, so the answers cannot be confirmed as jev-1.13.0."],
      [7, "Jev did not say which model answered, so the answers cannot be confirmed as jev-1.13.0."],
      [`jev${String.fromCharCode(0x1b)}[2J`, "Jev answered with a model whose name cannot be printed safely, but jev-1.13.0 was asked for."],
      ["x".repeat(65), "Jev answered with a model whose name cannot be printed safely, but jev-1.13.0 was asked for."],
    ];
    for (const [model, message] of cases) {
      const models: string[] = [];
      const network = scriptedFetch([Response.json({ model, answers: answer })]);
      const ask = createAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep, onModel: (name) => models.push(name) });
      const failure = await ask(REQUEST).catch((error: unknown) => error);
      expect(failure, String(model)).toBeInstanceOf(JevModelError);
      expect(failure).toBeInstanceOf(JevServiceError);
      expect((failure as Error).message).toBe(message);
      expect(models).toEqual([]);
      expect(network.sent).toHaveLength(1);
    }
  });

  test("builds a client that records models, without sending anything", () => {
    expect(typeof connectToJev("k", () => {})).toBe("function");
  });

  test("returns the probability of every question in the request, not only the first", async () => {
    const network = scriptedFetch([Response.json({
      model: "jev-1.13.0",
      answers: {
        colour_only: { type: "noul", noul: 0.73 },
        position_only: { type: "noul", noul: 0.04 },
      },
    })]);
    const ask = createAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep });

    expect(await ask(TWO_QUESTIONS)).toEqual({ colour_only: 0.73, position_only: 0.04 });
  });

  test("rejects a response where any answer is not a noul answer", async () => {
    const network = scriptedFetch([Response.json({
      answers: {
        colour_only: { type: "noul", noul: 0.2 },
        position_only: { type: "score", noul: 0.2 },
      },
    })]);
    const ask = createAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep });

    const failure = await ask(TWO_QUESTIONS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JevServiceError);
    expect((failure as Error).message).toBe(
      "Jev answered, but not with a probability for every question asked.",
    );
  });

  test("retries a 429, a 5xx and a failed connection, doubling the wait each time", async () => {
    const network = scriptedFetch([
      new Response("", { status: 429 }),
      new Response("", { status: 520 }),
      new Error("connection reset"),
      answered(0.2),
    ]);
    const waiting = recordingSleep();
    const ask = createAsk("k", { fetch: network.fetch, sleep: waiting.sleep });

    expect(await ask(REQUEST)).toEqual({ message: 0.2 });
    expect(network.sent).toHaveLength(4);
    expect(waiting.waits).toEqual([500, 1000, 2000]);
  });

  test("gives up after six attempts and says what the service last answered", async () => {
    const network = scriptedFetch([new Response("", { status: 503 })]);
    const ask = createAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep });

    const failure = await ask(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JevServiceError);
    expect((failure as Error).message).toBe(
      "Jev did not answer after 6 attempts. The last attempt got HTTP status 503.",
    );
    expect(network.sent).toHaveLength(6);
  });

  // A runtime error can quote the request, key included: Bun and Node both put a
  // rejected Authorization value in their message. So none of its text is kept.
  test("never repeats a connection error's text, which can hold the key", async () => {
    const network = scriptedFetch([
      new Error("Header 'Authorization' has invalid value: 'Bearer SECRET-first\nsecond'"),
    ]);
    const ask = createAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep });

    const failure = await ask(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JevServiceError);
    expect((failure as Error).message).toBe(
      "Jev did not answer after 6 attempts. The last attempt could not connect.",
    );
    expect((failure as Error).message).not.toContain("SECRET");
  });

  test("fails at once on a refusal that a retry cannot fix", async () => {
    const network = scriptedFetch([new Response("", { status: 401 })]);
    const ask = createAsk("wrong", { fetch: network.fetch, sleep: recordingSleep().sleep });

    const failure = await ask(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JevServiceError);
    expect((failure as Error).message).toBe(
      "Jev refused the request with HTTP status 401. Check that TYPESAFE_API_KEY holds a valid key.",
    );
    expect(network.sent).toHaveLength(1);
  });

  test("rejects an answer that is not JSON, or lacks a probability", async () => {
    const shapes = [
      new Response("<html>proxy error</html>", { status: 200 }),
      Response.json({ answers: {} }),
      Response.json({ answers: { message: { type: "noul", noul: "high" } } }),
      Response.json({ answers: { message: { type: "noul", noul: 1.5 } } }),
      Response.json({ answers: { message: { type: "score", noul: 0.5 } } }),
      Response.json({ answers: { message: { noul: 0.5 } } }),
    ];
    for (const shape of shapes) {
      const network = scriptedFetch([shape]);
      const ask = createAsk("k", { fetch: network.fetch, sleep: recordingSleep().sleep });
      const failure = await ask(REQUEST).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(JevServiceError);
      expect((failure as Error).message).toBe(
        "Jev answered, but not with a probability for every question asked.",
      );
    }
  });

  test("sends at most four requests at once", async () => {
    let inFlight = 0;
    let most = 0;
    const fetch: Fetch = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await sleep(5);
      inFlight -= 1;
      return answered(0.5);
    };
    const ask = createAsk("k", { fetch, sleep: recordingSleep().sleep });

    const answers = await Promise.all(Array.from({ length: 10 }, () => ask(REQUEST)));

    expect(answers).toHaveLength(10);
    expect(most).toBe(4);
  });

  test("builds a client from the key alone without sending anything", async () => {
    expect(typeof createAsk("k")).toBe("function");
    expect(await sleep(0)).toBeUndefined();
  });
});
