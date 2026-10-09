import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export interface Terminal { inputIsTTY: boolean; outputIsTTY: boolean; prompt: () => Promise<string> }

/**
 * The terminal a user gives agreement at. Agreement comes from the
 * controlling terminal, never from the standard input of a pipeline.
 *
 * Nothing is opened until `prompt` is called. It then opens the terminal
 * device, which is `/dev/tty`, or `CONIN$` and `CONOUT$` on Windows, writes
 * the question there, and closes what it opened whatever the outcome.
 *
 * @param inputIsTTY Whether standard input is a terminal. It is reported
 *     back for the caller to act on, and `prompt` does not consult it.
 * @param outputIsTTY The same for standard output.
 * @param openInput Replaces the opening of the device for reading.
 * @param openOutput Replaces the opening of the device for writing.
 * @returns The two flags and `prompt`. Its promise resolves with the line the
 *     user typed, untrimmed, which may be empty. It rejects when the device
 *     cannot be opened or closes before an answer.
 */
export function controllingTerminal(
  inputIsTTY = Boolean(process.stdin.isTTY), outputIsTTY = Boolean(process.stdout.isTTY),
  openInput: (path: string) => Readable = createReadStream,
  openOutput: (path: string) => Writable = createWriteStream,
): Terminal {
  return { inputIsTTY, outputIsTTY, prompt: async () => {
    const input = openInput(process.platform === "win32" ? "CONIN$" : "/dev/tty");
    const output = openOutput(process.platform === "win32" ? "CONOUT$" : "/dev/tty");
    const terminal = createInterface({ input, output });
    try {
      return await new Promise<string>((resolve, reject) => {
        input.once("error", reject);
        output.once("error", reject);
        terminal.once("error", reject);
        terminal.once("close", () => reject(new Error("The controlling terminal closed without agreement.")));
        terminal.question("Type yes to send this disclosed snapshot: ").then(resolve, reject);
      });
    }
    finally { terminal.close(); input.destroy(); output.destroy(); }
  } };
}
