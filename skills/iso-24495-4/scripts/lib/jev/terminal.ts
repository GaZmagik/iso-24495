import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export interface Terminal { inputIsTTY: boolean; outputIsTTY: boolean; prompt: () => Promise<string> }

/** Agreement comes from the controlling terminal, never a pipeline's standard input. */
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
