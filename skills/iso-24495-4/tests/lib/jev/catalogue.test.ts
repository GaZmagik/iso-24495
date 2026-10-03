import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildRequest, sha256, validateCalibration } from "../../../scripts/lib/jev/catalogue.ts";

test("the three-gate catalogue and both templates are pinned", () => {
  validateCalibration();
  expect(buildRequest("opening", { opening: "Title" }).questions.purpose.type).toBe("choice");
  expect(() => validateCalibration(path => path.endsWith("results-r11.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("catalogue");
  expect(() => validateCalibration(path => path.endsWith("opening-A.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("template");
  expect(() => validateCalibration(path => path.endsWith("block-A.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("template");
  expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
