import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paintTerminal, printedLineCount } from "../lib/code-terminal.ts";

/**
 * The same recorded-context trick the code panel tests use: the painter's
 * arithmetic is the part that can break silently, so the context answers
 * exactly what a real one would - `measureText` scales with the current
 * `font` - and the test reads the recorded draw calls.
 */
type RecordedCall = {
  op: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  font: string;
  align: string;
  fillStyle: string;
};

function recorder() {
  const calls: RecordedCall[] = [];
  const state = {
    font: "10px monospace",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetY: 0,
  };
  const sizeOf = () => {
    const match = /(\d+(?:\.\d+)?)px/.exec(state.font);
    return match ? Number(match[1]) : 10;
  };
  const methods = {
    measureText: (text: string) => ({ width: sizeOf() * 0.6 * text.length }),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push({
        op: "fillRect",
        x,
        y,
        w,
        h,
        text: "",
        font: state.font,
        align: state.textAlign,
        fillStyle: state.fillStyle,
      }),
    fillText: (text: string, x: number, y: number) =>
      calls.push({
        op: "fillText",
        x,
        y,
        w: 0,
        h: 0,
        text,
        font: state.font,
        align: state.textAlign,
        fillStyle: state.fillStyle,
      }),
  };
  const ctx: Record<string, unknown> = { ...methods };
  const bag = state as unknown as Record<string, string | number>;
  for (const key of Object.keys(state)) {
    Object.defineProperty(ctx, key, {
      get: () => bag[key],
      set: (value: string | number) => {
        bag[key] = value;
      },
    });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const FRAME = 1280;
const HEIGHT = 720;
const TERMINAL = {
  title: "node demo.ts",
  output: ["hello", "world", "done"],
};

describe("printedLineCount", () => {
  it("prints nothing before the start beat", () => {
    assert.equal(printedLineCount(3, 0), 0);
    assert.equal(printedLineCount(3, 0.05), 0);
  });

  it("prints at least one line as soon as output starts", () => {
    assert.ok(printedLineCount(3, 0.081) >= 1);
  });

  it("finishes printing by the end beat and holds", () => {
    assert.equal(printedLineCount(3, 0.8), 3);
    assert.equal(printedLineCount(3, 0.95), 3);
    assert.equal(printedLineCount(3, 1), 3);
  });

  it("counts no lines when there is nothing to print", () => {
    assert.equal(printedLineCount(0, 0.5), 0);
  });
});

describe("paintTerminal", () => {
  // One recorder shared by the tests below; `paint` clears it per run.
  const shared = recorder();
  const recorderCtx = shared.ctx;
  const calls = shared.calls;
  const paint = (calls: RecordedCall[], progress: number) => {
    calls.length = 0;
    paintTerminal(recorderCtx, FRAME, HEIGHT, {
      terminal: TERMINAL,
      progress,
      bottomLimit: HEIGHT - 80,
      topLimit: 260,
    });
  };

  it("draws nothing when the output is only blank lines", () => {
    calls.length = 0;
    paintTerminal(recorderCtx, FRAME, HEIGHT, {
      terminal: { title: "t", output: ["  ", ""] },
      progress: 0.5,
      bottomLimit: HEIGHT - 80,
      topLimit: 260,
    });
    assert.equal(calls.length, 0);
  });

  it("prints one line early in the scene and all of them by the end", () => {
    paint(calls, 0.1);
    const early = calls.filter((c) => c.op === "fillText" && c.text !== "$");
    assert.ok(early.length >= 1);

    paint(calls, 0.9);
    const done = calls.filter(
      (c) => c.op === "fillText" && c.text !== "$" && c.font.includes("px"),
    );
    for (const line of TERMINAL.output) {
      assert.ok(done.some((c) => c.text === line), `missing output "${line}"`);
    }
  });

  it("prefixes every printed line with a $ prompt", () => {
    paint(calls, 0.9);
    const prompts = calls.filter((c) => c.op === "fillText" && c.text === "$");
    assert.equal(prompts.length, TERMINAL.output.length);
  });

  it("draws the block cursor only while output is still printing", () => {
    paint(calls, 0.5);
    const printing = calls.filter(
      (c) => c.op === "fillRect" && c.fillStyle === "#7ee787",
    );
    assert.ok(printing.length > 0);

    paint(calls, 0.95);
    const held = calls.filter(
      (c) => c.op === "fillRect" && c.fillStyle === "#7ee787",
    );
    assert.equal(held.length, 0);
  });

  it("prints the title in the header", () => {
    paint(calls, 0.5);
    assert.ok(calls.some((c) => c.op === "fillText" && c.text === "node demo.ts"));
  });

  it("fits between the code card and the bottom limit", () => {
    // Read the output rows' baselines back from the calls: the card may hang
    // from the top of its band when there is room, so the assertions that
    // matter are "never above the code card" and "never past the bottom
    // limit", not where the card is anchored.
    const probe = (bottomLimit: number) => {
      calls.length = 0;
      paintTerminal(recorderCtx, FRAME, HEIGHT, {
        terminal: TERMINAL,
        progress: 0.9,
        bottomLimit,
        topLimit: 260,
      });
      const ys = calls
        .filter((c) => c.op === "fillText" && c.fillStyle === "#e6edf3")
        .map((c) => c.y);
      return {
        drawn: calls.length > 0,
        headerTop: calls.find((c) => c.op === "fillRect" && c.fillStyle === "#161b22")
          ?.y,
        lastRow: ys.length > 0 ? Math.max(...ys) : 0,
      };
    };
    const roomy = probe(HEIGHT - 80);
    assert.ok((roomy.headerTop ?? 0) >= 260, "card starts below the code card");
    assert.ok(roomy.lastRow <= HEIGHT - 80, "output stays above the limit");

    // A tighter band gives up rows rather than spilling over the captions.
    const tight = probe(HEIGHT - 320);
    assert.ok((tight.headerTop ?? 0) >= 260);
    assert.ok(
      tight.lastRow <= HEIGHT - 320,
      `output bottom ${tight.lastRow} over the limit`,
    );

    // A band too small for even one line shows no card at all — a strip with
    // a header and no rows reads as a broken export.
    const none = probe(340);
    assert.equal(none.drawn, false);
  });
});
