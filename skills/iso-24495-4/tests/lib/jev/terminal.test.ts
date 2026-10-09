import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { controllingTerminal } from "../../../scripts/lib/jev/terminal.ts";

test("the prompt reads the controlling terminal and preserves exact agreement", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const paths: string[] = [];
  const terminal = controllingTerminal(true, true, path => { paths.push(path); return input; }, path => { paths.push(path); return output; });
  const answer = terminal.prompt();
  input.write("yes\n");
  expect(await answer).toBe("yes");
  expect(paths).toEqual(process.platform === "win32" ? ["CONIN$", "CONOUT$"] : ["/dev/tty", "/dev/tty"]);
  expect(input.destroyed).toBe(true);
  expect(output.destroyed).toBe(true);
  expect(controllingTerminal(false, false).inputIsTTY).toBe(false);
  const brokenInput = new PassThrough();
  const brokenOutput = new PassThrough();
  const unavailable = controllingTerminal(true, true, () => brokenInput, () => brokenOutput).prompt();
  brokenInput.emit("error", new Error("Unavailable terminal"));
  await expect(unavailable).rejects.toThrow("Unavailable terminal");
  expect(brokenInput.destroyed).toBe(true);
  expect(brokenOutput.destroyed).toBe(true);
});
