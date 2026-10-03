import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequest, sha256, validateCalibration } from "../../../scripts/lib/jev/catalogue.ts";

test("the three-gate catalogue and both templates are pinned", () => {
  validateCalibration();
  const provenance = JSON.parse(readFileSync(join(import.meta.dir, "../../../scripts/lib/jev/results-r11.json"), "utf8"));
  for (const name of ["lock", "bounds", "requests", "extraction"]) {
    expect(sha256(readFileSync(join(import.meta.dir, "../../fixtures/jev", `${name}.json`)))).toBe(provenance.hashes[name]);
  }
  expect(buildRequest("opening", { opening: "Title" }).questions.purpose.type).toBe("choice");
  expect(() => validateCalibration(path => path.endsWith("results-r11.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("catalogue");
  expect(() => validateCalibration(path => path.endsWith("opening-A.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("template");
  expect(() => validateCalibration(path => path.endsWith("block-A.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("template");
  expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
