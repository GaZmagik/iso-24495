import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { scoreMaturity } from "../scripts/score-maturity.ts";

const answers = await Bun.file(
  join(import.meta.dir, "fixtures", "answers.sample.json"),
).json();

describe("scoreMaturity", () => {
  const maturity = scoreMaturity(answers);

  test("pins the level of every dimension from the sample answers", () => {
    expect(maturity.dimensions["governance"].level).toBe(2);
    expect(maturity.dimensions["capability"].level).toBe(1);
    expect(maturity.dimensions["process"].level).toBe(2);
    expect(maturity.dimensions["measurement"].level).toBe(0);
    expect(maturity.dimensions["culture"].level).toBe(1);
  });

  test("overall maturity is the weakest dimension", () => {
    expect(maturity.overall).toBe(0);
  });

  test("each dimension lists the criteria blocking the next level", () => {
    expect(maturity.dimensions["governance"].missing).toEqual(["resourced-mandated"]);
    expect(maturity.dimensions["measurement"].missing).toEqual(["corpus-baseline-taken"]);
  });

  test("a level is never awarded past an unmet lower criterion", () => {
    const gapped = structuredClone(answers);
    gapped.dimensions["culture"]["leadership-aware"] = false;
    gapped.dimensions["culture"]["feedback-loops"] = true;
    expect(scoreMaturity(gapped).dimensions["culture"].level).toBe(0);
  });
});
