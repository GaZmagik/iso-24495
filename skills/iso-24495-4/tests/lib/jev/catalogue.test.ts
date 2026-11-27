import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequest, sha256, validateCalibration } from "../../../scripts/lib/jev/catalogue.ts";

/**
 * The environment variable that names the folder holding `requests.json` and
 * `extraction.json`. They hold the calibration documents, which are other
 * people's text, so this repository does not ship them. `lock.json` and
 * `bounds.json` hold only numbers, so they stay in the repository.
 */
const CALIBRATION_VARIABLE = "ISO_24495_CALIBRATION_FIXTURES";

test("the three-gate catalogue and both templates are pinned", () => {
  validateCalibration();
  const provenance = JSON.parse(readFileSync(join(import.meta.dir, "../../../scripts/lib/jev/results-r11.json"), "utf8"));
  for (const name of ["lock", "bounds"]) {
    expect(sha256(readFileSync(join(import.meta.dir, "../../fixtures/jev", `${name}.json`)))).toBe(provenance.hashes[name]);
  }
  expect(buildRequest("opening", { opening: "Title" }).questions.purpose?.type).toBe("choice");
  expect(() => validateCalibration(path => path.endsWith("results-r11.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("catalogue");
  expect(() => validateCalibration(path => path.endsWith("opening-A.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("template");
  expect(() => validateCalibration(path => path.endsWith("block-A.json") ? Buffer.from("{}") : readFileSync(path))).toThrow("template");
  expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

// A file supplied with the wrong bytes fails here rather than being skipped.
for (const name of ["requests", "extraction"]) {
  test.skipIf(!hasCalibrationDocument(name))(calibrationTestName(`the supplied ${name}.json is the pinned file`, name), () => {
    const provenance = JSON.parse(readFileSync(join(import.meta.dir, "../../../scripts/lib/jev/results-r11.json"), "utf8"));
    expect(sha256(readCalibrationDocument(name))).toBe(provenance.hashes[name]);
  });
}

// The three functions below repeat those in engine.test.ts. A shared module
// under tests/ would count towards the coverage gate, and its reading path
// never runs when the calibration files are absent.

/**
 * Whether the folder named by CALIBRATION_VARIABLE holds the named
 * calibration file. A file that is present but altered still counts, so its
 * test runs and fails on the digest rather than being skipped.
 *
 * @returns False when the variable is unset or empty, or the file is absent.
 */
function hasCalibrationDocument(name: string): boolean {
  const folder = process.env[CALIBRATION_VARIABLE];
  return folder !== undefined && folder !== "" && existsSync(join(folder, `${name}.json`));
}

/**
 * The name of a test that reads a calibration file. When the file cannot be
 * found, the name also says what to set, so the skipped test explains itself.
 *
 * @returns The test name, with the setting to make when the file is absent.
 */
function calibrationTestName(title: string, name: string): string {
  return hasCalibrationDocument(name) ? title : `${title} (skipped: set ${CALIBRATION_VARIABLE} to a folder holding ${name}.json)`;
}

/**
 * Reads the named calibration file from the folder CALIBRATION_VARIABLE names.
 *
 * @returns The file's bytes, unchanged, so their digest can be checked.
 * @throws Error when the variable is unset or empty. A test calls this only
 *     after hasCalibrationDocument has found the file.
 */
function readCalibrationDocument(name: string): Buffer {
  const folder = process.env[CALIBRATION_VARIABLE];
  if (folder === undefined || folder === "") throw new Error(`${CALIBRATION_VARIABLE} is not set; set it to the folder holding ${name}.json.`);
  return readFileSync(join(folder, `${name}.json`));
}
