import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileFault,
  pathFailure,
  readJsonFile,
  unexpectedKind,
  writeTextFile,
} from "../../scripts/lib/failure.ts";

// Every failing input below carries this word. No message may repeat it.
const MARKER = "hunter2";
const NUL = String.fromCharCode(0);

/** An error shaped like the ones node:fs throws, whose message quotes a path. */
function fileSystemError(code: string): Error {
  return Object.assign(new Error(`${code}: something happened, open '${MARKER}'`), { code });
}

function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "iso-failure-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("fileFault", () => {
  test("words each file-system code it knows, and nothing else", () => {
    expect(fileFault(fileSystemError("ENOENT"))).toBe("no such file or directory");
    expect(fileFault(fileSystemError("EACCES"))).toBe("permission refused");
    expect(fileFault(fileSystemError("EPERM"))).toBe("permission refused");
    expect(fileFault(fileSystemError("EISDIR"))).toBe("a directory where a file was expected");
    expect(fileFault(fileSystemError("ENOTDIR"))).toBe("a file where a directory was expected");
  });

  test("a code it does not know is no file fault, so the code is never printed", () => {
    expect(fileFault(fileSystemError(MARKER))).toBeNull();
    expect(fileFault(fileSystemError("constructor"))).toBeNull();
    expect(fileFault(Object.assign(new Error(MARKER), { code: 2 }))).toBeNull();
    expect(fileFault(new Error(MARKER))).toBeNull();
    expect(fileFault({ code: "ENOENT" })).toBeNull();
    expect(fileFault("ENOENT")).toBeNull();
  });
});

describe("unexpectedKind", () => {
  test("names a built-in error type from a fixed list", () => {
    expect(unexpectedKind(new TypeError(MARKER))).toBe("an unexpected TypeError");
    expect(unexpectedKind(new RangeError(MARKER))).toBe("an unexpected RangeError");
    expect(unexpectedKind(new SyntaxError(MARKER))).toBe("an unexpected SyntaxError");
    expect(unexpectedKind(new ReferenceError(MARKER))).toBe("an unexpected ReferenceError");
    expect(unexpectedKind(new URIError(MARKER))).toBe("an unexpected URIError");
    expect(unexpectedKind(new EvalError(MARKER))).toBe("an unexpected EvalError");
    expect(unexpectedKind(new Error(MARKER))).toBe("an unexpected error");
  });

  // Whoever throws an error can set its name, so the name is never read.
  test("never reads the name an error gives itself", () => {
    class Forged extends TypeError {
      constructor() {
        super(MARKER);
        this.name = MARKER;
      }
    }
    Object.defineProperty(Forged, "name", { value: MARKER });
    expect(unexpectedKind(new Forged())).toBe("an unexpected TypeError");
    const renamed = new Error(MARKER);
    renamed.name = MARKER;
    expect(unexpectedKind(renamed)).toBe("an unexpected error");
  });

  test("gives only the type of a thrown value that is not an error", () => {
    expect(unexpectedKind(MARKER)).toBe("a thrown value of type string");
    expect(unexpectedKind({ message: MARKER, name: MARKER })).toBe("a thrown value of type object");
    expect(unexpectedKind(undefined)).toBe("a thrown value of type undefined");
  });
});

describe("pathFailure", () => {
  test("a file fault names the argument and the length of its path", () => {
    expect(pathFailure(fileSystemError("ENOENT"), `${MARKER}/corpus`, "<corpus-dir>", "cannot be listed")).toBe(
      "<corpus-dir> names a path of 14 characters that cannot be listed: no such file or directory",
    );
  });

  test("anything else is reported as unexpected, with no path", () => {
    expect(pathFailure(new RangeError(MARKER), MARKER, "<corpus-dir>", "cannot be listed")).toBe(
      "stopped by an unexpected RangeError",
    );
  });
});

describe("readJsonFile", () => {
  test("returns what a JSON file holds", () => {
    withDirectory((directory) => {
      const path = join(directory, "sound.json");
      writeFileSync(path, '{"level": 2}');
      expect(readJsonFile(path, "<answers.json>")).toEqual({ ok: true, value: { level: 2 } });
    });
  });

  test("a missing file is described by the argument and the length of its path", () => {
    withDirectory((directory) => {
      const path = join(directory, `${MARKER}.json`);
      expect(readJsonFile(path, "<answers.json>")).toEqual({
        ok: false,
        problem: `<answers.json> names a path of ${path.length} characters that cannot be read: no such file or directory`,
      });
    });
  });

  test("a directory is not a file", () => {
    withDirectory((directory) => {
      expect(readJsonFile(directory, "--state")).toEqual({
        ok: false,
        problem: `--state names a path of ${directory.length} characters that cannot be read: a directory where a file was expected`,
      });
    });
  });

  // The runtime quotes the offending token, so its message is never passed on.
  test("text that is not JSON is described by its length", () => {
    withDirectory((directory) => {
      const path = join(directory, "broken.json");
      writeFileSync(path, `{"password": ${MARKER}}`);
      expect(readJsonFile(path, "<answers.json>")).toEqual({
        ok: false,
        problem: "<answers.json> names a file of 21 characters that is not valid JSON",
      });
    });
  });

  test("a path the runtime refuses outright is unexpected, and is not quoted", () => {
    const path = `${MARKER}${NUL}.json`;
    expect(readJsonFile(path, "<answers.json>")).toEqual({
      ok: false,
      problem: "<answers.json> names a path of 13 characters that cannot be read: an unexpected TypeError",
    });
  });
});

describe("writeTextFile", () => {
  test("writes the text and reports no problem", () => {
    withDirectory((directory) => {
      const path = join(directory, "out.txt");
      expect(writeTextFile(path, "written", "--out")).toBeNull();
      expect(readFileSync(path, "utf8")).toBe("written");
    });
  });

  test("a path in a missing directory is described by the option and its length", () => {
    withDirectory((directory) => {
      const path = join(directory, MARKER, "out.txt");
      expect(writeTextFile(path, "text", "--out")).toBe(
        `--out names a path of ${path.length} characters that cannot be written: no such file or directory`,
      );
    });
  });

  test("a path the runtime refuses outright is unexpected, and is not quoted", () => {
    expect(writeTextFile(`${MARKER}${NUL}.txt`, "text", "--json")).toBe(
      "--json names a path of 12 characters that cannot be written: an unexpected TypeError",
    );
  });
});
