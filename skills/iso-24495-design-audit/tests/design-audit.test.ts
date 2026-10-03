import { expect, test } from "bun:test";
import { runCli, planDocument } from "../scripts/design-audit.ts";

test("the design entry point uses the shared calibrated planner and argument gate", async () => {
  const errors: string[] = [];
  expect(await runCli(["bun", "cli"], () => {}, text => errors.push(text))).toBe(2);
  expect(errors[0]).toContain("Invalid audit arguments");
  expect(planDocument("# Title\n\nWords.").candidates.map(candidate => candidate.kind)).toEqual(["opening", "block"]);
});
