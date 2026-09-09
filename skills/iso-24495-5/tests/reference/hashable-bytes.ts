// What to hash, so that a checkout's line endings do not matter and a binary
// file's bytes do.
//
// Two reviews found this twice, in opposite directions. Hashing raw bytes
// recorded one machine's carriage returns in 59 of 61 entries, so the Linux
// runner would have failed on files nobody had touched. Normalising everything
// then swallowed a deleted carriage return from a PNG signature, and a browser
// that had shown the image refused the changed one while the gate stayed green.
//
// So the question is asked per file rather than answered once. Text has its
// line endings normalised, because a checkout decides those. Anything else is
// hashed exactly as it lies, because nothing about it is a line.
//
// Text is told apart the way git tells it apart: a NUL byte near the start
// means binary. That is a heuristic rather than a proof, and it errs towards
// hashing raw, which is the safe direction: a file wrongly called binary still
// fails when its bytes change, and only its line endings could make a build
// fail somewhere else.

/** How far in to look for a NUL byte, as git does. */
const SNIFF = 8000;

function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, SNIFF).includes(0);
}

/** The bytes to hash, as a latin1 string so no decoding is lossy. */
export function normalisedForHashing(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  return looksBinary(bytes) ? raw : raw.replace(/\r\n/g, "\n");
}
