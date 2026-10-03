import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequest, planDocument, classify } from "../scripts/lib/jev/engine.ts";
import { parseDecimal } from "../scripts/lib/jev/decimal.ts";

const FIXTURES = join(import.meta.dir, "fixtures/jev");
describe("calibrated engine", () => {
  test("reproduces every manifest request byte for byte", () => {
    const fixtures = JSON.parse(readFileSync(join(FIXTURES, "requests.json"), "utf8"));
    expect(fixtures.length).toBe(1613);
    for (const fixture of fixtures) expect(JSON.stringify(buildRequest(fixture.kind, fixture.state))).toBe(fixture.body);
  });
  test("preserves all corpus extraction states and source locations", () => {
    const fixtures = JSON.parse(readFileSync(join(FIXTURES, "extraction.json"), "utf8"));
    expect(fixtures.length).toBe(840);
    let checked = 0;
    for (const fixture of fixtures) {
      const plan = planDocument(fixture.text);
      expect(plan.candidates.map(candidate => ({ line: candidate.line, state: candidate.body.state }))).toEqual(fixture.states.filter(item => Object.values(item.state).some(value => typeof value === "string" && value.trim() !== "")));
      checked += fixture.states.length;
    }
    expect(checked).toBe(46005);
  }, 60000);
  test("classifies exact boundaries without rounding or normalisation", () => {
    const probability = parseDecimal;
    const purpose = (both: string, task: string, scope: string, neither: string) => classify("opening", { purpose: { both: probability(both), task_only: probability(task), scope_only: probability(scope), neither: probability(neither) } });
    expect(purpose("0.13", "0.02", "0.02", "0.83")).toMatchObject({ band: "fail", diagnosis: "neither", score: "0.87", cutOff: "0.87" });
    expect(purpose("0.13000000000000001", "0.02", "0.02", "0.83").band).toBe("unsure");
    expect(purpose("0.12", "0.83", "0.02", "0.83").diagnosis).toBeUndefined();
    expect(purpose("0.12", "0.01", "0.84", "0.83").diagnosis).toBeUndefined();
    expect(purpose("0.12", "0.02", "0.04", "0.82").diagnosis).toBeUndefined();
    expect(classify("block", { colour_only: probability("0.17") }).band).toBe("pass");
    expect(classify("block", { colour_only: probability("0.17000000000000001") }).band).toBe("unsure");
    expect(planDocument("Plain text.").findings[0].rule).toBe("opening-title");
    expect(planDocument("# Title\n\n---\n").candidates).toHaveLength(1);
  });
});
