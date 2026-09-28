import { describe, expect, test } from "bun:test";
import {
  connectToJev,
  createAsk,
  JEV_ENDPOINT,
  JevServiceError,
  requestBody,
  sleep,
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
      model: "jev-latest",
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

  test("reports the model that answered each request, or that none was named", async () => {
    const models: string[] = [];
    const named = scriptedFetch([answered(0.95)]);
    await createAsk("k", { fetch: named.fetch, sleep: recordingSleep().sleep, onModel: (model) => models.push(model) })(REQUEST);
    const unnamed = scriptedFetch([Response.json({ answers: { message: { type: "noul", noul: 0.5 } } })]);
    await createAsk("k", { fetch: unnamed.fetch, sleep: recordingSleep().sleep, onModel: (model) => models.push(model) })(REQUEST);
    const numbered = scriptedFetch([Response.json({ model: 7, answers: { message: { type: "noul", noul: 0.5 } } })]);
    await createAsk("k", { fetch: numbered.fetch, sleep: recordingSleep().sleep, onModel: (model) => models.push(model) })(REQUEST);

    expect(models).toEqual(["jev-1.13.0", "unnamed", "unnamed"]);
  });

  test("builds a client that records models, without sending anything", () => {
    expect(typeof connectToJev("k", () => {})).toBe("function");
  });

  test("returns the probability of every question in the request, not only the first", async () => {
    const network = scriptedFetch([Response.json({
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
