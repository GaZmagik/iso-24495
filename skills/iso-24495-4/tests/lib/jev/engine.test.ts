import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequest, planDocument, classify } from "../../../scripts/lib/jev/engine.ts";
import { calibrationEvidence } from "../../../scripts/lib/jev/catalogue.ts";
import { add, ONE, parseDecimal, subtract, type Decimal } from "../../../scripts/lib/jev/decimal.ts";

const FIXTURES = join(import.meta.dir, "../../fixtures/jev");
describe("calibrated engine", () => {
  test("reproduces every manifest request byte for byte", () => {
    const fixtures = JSON.parse(readFileSync(join(FIXTURES, "requests.json"), "utf8"));
    expect(fixtures.length).toBe(1613);
    for (const fixture of fixtures) {
      expect(JSON.stringify(buildRequest(fixture.kind, fixture.state))).toBe(fixture.body);
    }
  });
  test("preserves all corpus extraction states and source locations", () => {
    const fixtures = JSON.parse(readFileSync(join(FIXTURES, "extraction.json"), "utf8"));
    expect(fixtures.length).toBe(840);
    let checked = 0;
    for (const fixture of fixtures) {
      const plan = planDocument(fixture.text);
      expect(plan.candidates.map(candidate => ({ line: candidate.line, state: candidate.body.state }))).toEqual(fixture.states.filter((item: { state: Record<string, unknown> }) => Object.values(item.state).some(value => typeof value === "string" && value.trim() !== "")));
      checked += fixture.states.length;
    }
    expect(checked).toBe(46005);
  }, 60000);
  test("classifies exact boundaries without rounding or normalisation", () => {
    const probability = parseDecimal;
    const purpose = purposeClassifier(probability);
    expect(purpose("0.13", "0.02", "0.02", "0.83")).toMatchObject({ band: "fail", diagnosis: "neither", score: "0.87", cutOff: "0.87" });
    // P(neither) is 0.83 and the likeliest of the other three, so only the fail prerequisite withholds the diagnosis.
    const unsure = purpose("0.13000000000000001", "0.02", "0.02", "0.83");
    expect(unsure.band).toBe("unsure");
    expect(unsure.diagnosis).toBeUndefined();
    expect(unsure.diagnosisGate).toBeUndefined();
    expect(purpose("0.12", "0.83", "0.02", "0.83").diagnosis).toBeUndefined();
    expect(purpose("0.12", "0.01", "0.84", "0.83").diagnosis).toBeUndefined();
    expect(purpose("0.12", "0.02", "0.04", "0.82").diagnosis).toBeUndefined();
    expect(classify("block", { colour_only: probability("0.17") }).band).toBe("pass");
    expect(classify("block", { colour_only: probability("0.17000000000000001") }).band).toBe("unsure");
    expect(planDocument("Plain text.").findings[0]?.rule).toBe("opening-title");
    expect(planDocument("# Title\n\n---\n").candidates).toHaveLength(1);
  });
  // engine.ts writes each cut-off as a literal, and results-r11.json records the
  // calibrated one. The catalogue's digest stops the file changing alone; this
  // stops the engine's copy drifting from it.
  test("each gate acts at exactly the catalogue's cut-off and not at the next smaller decimal", () => {
    const gates = new Map(calibrationEvidence().map(gate => [gate.id, gate]));
    expect([...gates.keys()]).toEqual(["colour_only:pass", "purpose:fail", "purpose:diagnosis:neither"]);
    const step = parseDecimal("0.00000000000000001");
    const colour = gates.get("colour_only:pass")?.cutOff ?? "";
    const atColour = classify("block", { colour_only: subtract(ONE, parseDecimal(colour)) });
    expect([atColour.band, atColour.cutOff]).toEqual(["pass", colour]);
    expect(classify("block", { colour_only: add(subtract(ONE, parseDecimal(colour)), step) }).band).toBe("unsure");
    const fail = gates.get("purpose:fail")?.cutOff ?? "";
    const atFail = classify("opening", { purpose: openingAnswer(subtract(ONE, parseDecimal(fail)), parseDecimal("0")) });
    expect([atFail.band, atFail.cutOff]).toEqual(["fail", fail]);
    expect(classify("opening", { purpose: openingAnswer(add(subtract(ONE, parseDecimal(fail)), step), parseDecimal("0")) }).band).toBe("unsure");
    const neitherGate = gates.get("purpose:diagnosis:neither");
    const neither = neitherGate?.cutOff ?? "";
    const atNeither = classify("opening", { purpose: openingAnswer(parseDecimal("0"), parseDecimal(neither)) });
    // The engine types its gate fields as the literals it writes; read as text, they can be compared with the catalogue's.
    const diagnosisGate: { cutOff: string; prerequisite: string } | undefined = atNeither.diagnosisGate;
    expect([atNeither.band, atNeither.diagnosis, diagnosisGate?.cutOff]).toEqual(["fail", "neither", neither]);
    expect([diagnosisGate?.prerequisite]).toEqual(neitherGate?.dependencies ?? []);
    expect(classify("opening", { purpose: openingAnswer(parseDecimal("0"), subtract(parseDecimal(neither), step)) }).diagnosis).toBeUndefined();
  });
  test("an opening answer that lacks an option is refused by name", () => {
    const given = { both: parseDecimal("0.05"), task_only: parseDecimal("0.02"), scope_only: parseDecimal("0.03"), neither: parseDecimal("0.9") };
    for (const option of Object.keys(given)) {
      const rest = Object.fromEntries(Object.entries(given).filter(([name]) => name !== option));
      expect(() => classify("opening", { purpose: rest }), option).toThrow(new TypeError(`The purpose answer holds no probability for ${option}.`));
    }
    expect(() => classify("opening", {})).toThrow(TypeError);
    expect(() => classify("block", {})).toThrow(TypeError);
  });
});

/**
 * Makes a function that classifies an opening from the four purpose
 * probabilities, each written as text and read by the given reader.
 *
 * @returns The classifying function.
 */
function purposeClassifier(probability: typeof parseDecimal): (both: string, task: string, scope: string, neither: string) => ReturnType<typeof classify> {
  return (both: string, task: string, scope: string, neither: string) => classify("opening", { purpose: { both: probability(both), task_only: probability(task), scope_only: probability(scope), neither: probability(neither) } });
}

/**
 * The four purpose probabilities for an opening, with `task_only` and
 * `scope_only` both at 0.01, so `neither` is the likeliest other option
 * whenever it is above 0.01.
 *
 * @returns The answer `classify` reads for an opening.
 */
function openingAnswer(both: Decimal, neither: Decimal): Record<string, Decimal> {
  return { both, task_only: parseDecimal("0.01"), scope_only: parseDecimal("0.01"), neither };
}
