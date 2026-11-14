import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequest, planDocument, classify } from "../../../scripts/lib/jev/engine.ts";
import { calibrationEvidence, sha256 } from "../../../scripts/lib/jev/catalogue.ts";
import { add, ONE, parseDecimal, subtract, type Decimal } from "../../../scripts/lib/jev/decimal.ts";

/**
 * The environment variable that names the folder holding `requests.json` and
 * `extraction.json`. They hold the calibration documents, which are other
 * people's text, so this repository does not ship them. Without them, the two
 * tests that read them are skipped and reported as skipped.
 */
const CALIBRATION_VARIABLE = "ISO_24495_CALIBRATION_FIXTURES";

/** The digest results-r11.json records for each calibration file, by name. */
const PINNED_HASHES: { requests: string; extraction: string } = JSON.parse(readFileSync(join(import.meta.dir, "../../../scripts/lib/jev/results-r11.json"), "utf8")).hashes;

describe("calibrated engine", () => {
  test.skipIf(!hasCalibrationDocument("requests"))(calibrationTestName("reproduces every manifest request byte for byte", "requests"), () => {
    const bytes = readCalibrationDocument("requests");
    expect(sha256(bytes), "requests.json is not the pinned file").toBe(PINNED_HASHES.requests);
    const fixtures = JSON.parse(bytes.toString("utf8"));
    expect(fixtures.length).toBe(1613);
    for (const fixture of fixtures) {
      expect(JSON.stringify(buildRequest(fixture.kind, fixture.state))).toBe(fixture.body);
    }
  });
  test.skipIf(!hasCalibrationDocument("extraction"))(calibrationTestName("preserves all corpus extraction states and source locations", "extraction"), () => {
    const bytes = readCalibrationDocument("extraction");
    expect(sha256(bytes), "extraction.json is not the pinned file").toBe(PINNED_HASHES.extraction);
    const fixtures = JSON.parse(bytes.toString("utf8"));
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
