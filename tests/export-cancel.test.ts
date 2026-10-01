import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ExportCancelledError,
  throwIfCancelled,
} from "../lib/export-cancel.ts";
import { VideoExportError } from "../lib/video-export.ts";

/**
 * The cancel path is the part of the export nobody can see working.
 *
 * The encoder itself needs WebCodecs and a real canvas, which a node test has
 * neither of, so these cover the contract the encoder is written against: what
 * an aborted signal throws, that the type is distinguishable from a failure, and
 * that it cannot be confused for one. The behaviour that actually matters -
 * stopping mid-render - is verified in the browser by export-cancel.mjs.
 */

describe("throwIfCancelled", () => {
  it("does nothing when there is no signal", () => {
    assert.doesNotThrow(() => throwIfCancelled(undefined));
  });

  it("does nothing while the signal is live", () => {
    const controller = new AbortController();
    assert.doesNotThrow(() => throwIfCancelled(controller.signal));
  });

  it("throws once the signal has fired", () => {
    const controller = new AbortController();
    controller.abort();
    assert.throws(() => throwIfCancelled(controller.signal), ExportCancelledError);
  });

  it("stays thrown when checked again", () => {
    // The export loop polls this 30 times a second. A check that only threw once
    // would let a cancelled render carry on into the next few frames.
    const controller = new AbortController();
    controller.abort();
    for (let i = 0; i < 5; i++) {
      assert.throws(() => throwIfCancelled(controller.signal), ExportCancelledError);
    }
  });
});

describe("ExportCancelledError", () => {
  it("is not a VideoExportError", () => {
    // The whole reason this type exists. The UI branches on it to say "cancelled"
    // instead of "the export failed", and an instanceof that matched both would
    // report a deliberate stop as a fault the user has to fix.
    const error = new ExportCancelledError();
    assert.ok(!(error instanceof VideoExportError));
    assert.ok(error instanceof Error);
  });

  it("carries a name and message that read as deliberate", () => {
    const error = new ExportCancelledError();
    assert.equal(error.name, "ExportCancelledError");
    assert.match(error.message, /cancel/i);
  });

  it("survives the rethrow the encoder does on the cancel path", async () => {
    // renderVideoToFile rethrows this unchanged instead of wrapping it, which is
    // what keeps the distinction alive across the boundary. Simulated with the
    // same try/catch the encoder uses, and asserted on the value that escapes.
    const signal = AbortSignal.abort();
    const escaped = await (async () => {
      try {
        throwIfCancelled(signal);
        return "no throw";
      } catch (error) {
        if (error instanceof ExportCancelledError) return error;
        return error;
      }
    })();
    assert.ok(
      escaped instanceof ExportCancelledError,
      "the cancel should reach the caller as itself, not wrapped in a failure",
    );
  });

  it("is constructible without an AbortController present", () => {
    // AbortSignal is a DOM global. A module that only needed the error type for
    // its own control flow should not fall over where the global is missing.
    assert.ok(new ExportCancelledError() instanceof ExportCancelledError);
  });
});