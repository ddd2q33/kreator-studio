/**
 * Cancellation for a long export.
 *
 * Split out of `video-export.ts` for two reasons.
 *
 * The mechanical one: that module imports mediabunny and touches WebCodecs at
 * module scope, so a node test cannot import it - the encoder and the cancel
 * contract would be untestable together for no good reason. What is worth testing
 * about cancelling is that a deliberate stop is distinguishable from a failure,
 * and that needs no encoder.
 *
 * The design one: cancelling and encoding are different jobs. The encoder asks
 * whether it should keep going; this file owns the question and the answer. A
 * caller holding an AbortSignal from anywhere - a video file, a pack of clips -
 * checks the same way and gets the same error type, so the UI has one branch.
 */

/**
 * Thrown when the caller aborted, as opposed to the work failing.
 *
 * A separate type on purpose. Both arrive at the same catch block, but they must
 * not be reported the same way: a failure is a problem to solve, while an abort
 * is exactly what the user asked for, and a status line that says "the export
 * failed" after someone pressed Cancel is worse than no status line at all.
 */
export class ExportCancelledError extends Error {
  constructor() {
    super("The export was cancelled.");
    this.name = "ExportCancelledError";
  }
}

/**
 * Stops the caller if the signal has fired.
 *
 * Throws rather than returning a boolean so the check can go straight in the path
 * of an async function without every call site having to remember to act on the
 * answer - the version that returned `boolean` was one early return away from
 * quietly continuing past the abort.
 */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ExportCancelledError();
}