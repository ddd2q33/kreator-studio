import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paintCodePanel, type CodeCardLayout } from "../lib/code-panel.ts";
import { DEFAULT_CODE_THEME, type CodeReveal, type SceneCode } from "../lib/scene-schema.ts";

/**
 * A 2D context that records what it was asked to draw.
 *
 * The painter is the only part of a code scene that cannot be checked by
 * looking at a screenshot in CI, and its arithmetic is where the bugs are: a
 * card sized from a font measured at the wrong size, or a reveal that never
 * advances, both render as "something is on screen" to the eye. So the context
 * answers exactly what a real one would - `measureText` scales with the font
 * size in the current `font` - and the test reads the recorded draw calls.
 */
/** One recorded drawing call, with the fields every op shares defaulted. */
type RecordedCall = {
  op: string;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  cx: number;
  cy: number;
  text: string;
  font: string;
  align: string;
  fillStyle: string;
  strokeStyle: string;
  /** `globalAlpha` at the time of the call, for the dimming assertions. */
  alpha: number;
};

const BLANK: RecordedCall = {
  op: "",
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  r: 0,
  cx: 0,
  cy: 0,
  text: "",
  font: "",
  align: "",
  fillStyle: "",
  strokeStyle: "",
  alpha: 1,
};

function recorder() {
  const calls: RecordedCall[] = [];
  const record = (call: Partial<RecordedCall>) => {
    calls.push({ ...BLANK, ...call });
  };
  // Every property the painter writes is kept in one place, because the
  // recorded calls report the state at the time of the call and a plain field
  // would drift out of sync with what was actually set.
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
    save: () => record({ op: "save" }),
    restore: () => record({ op: "restore" }),
    beginPath: () => record({ op: "beginPath" }),
    closePath: () => record({ op: "closePath" }),
    moveTo: (x: number, y: number) => record({ op: "moveTo", x, y }),
    lineTo: (x: number, y: number) => record({ op: "lineTo", x, y }),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) =>
      record({ op: "curve", cx, cy, x, y }),
    arc: (x: number, y: number, r: number) => record({ op: "arc", x, y, r }),
    fill: () => record({ op: "fill", fillStyle: state.fillStyle }),
    stroke: () => record({ op: "stroke", strokeStyle: state.strokeStyle }),
    clip: () => record({ op: "clip" }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      record({ op: "fillRect", x, y, w, h, fillStyle: state.fillStyle }),
    fillText: (text: string, x: number, y: number) =>
      record({
        op: "fillText",
        text,
        x,
        y,
        fillStyle: state.fillStyle,
        font: state.font,
        align: state.textAlign,
        alpha: state.globalAlpha,
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, bag };
}

const SNIPPET = [
  "export function slugify(value: string): string {",
  "  return value",
  "    .toLowerCase()",
  "    .replace(/[^a-z0-9]+/g, '-')",
  "}",
].join("\n");

const snippet = (over: Partial<SceneCode> = {}): SceneCode => ({
  language: "typescript",
  source: SNIPPET,
  theme: DEFAULT_CODE_THEME,
  reveal: "all",
  scale: 1,
  ...over,
});

const paint = (
  code: SceneCode,
  w = 1080,
  h = 1920,
  progress = 0,
  reservedBottom = 0,
) => {
  const { ctx, calls } = recorder();
  paintCodePanel(ctx, w, h, { code, progress, reservedBottom });
  return calls;
};

/**
 * Paints once and returns the reported card geometry.
 *
 * The layout travels in a holder object because TypeScript does not track
 * assignments made inside a callback to a `let` — the holder's property type
 * survives, a bare `let` narrows to `null` and every later read is `never`.
 */
const captureLayout = (code: SceneCode, progress = 0.5): CodeCardLayout => {
  const holder: { layout: CodeCardLayout | null } = { layout: null };
  const { ctx } = recorder();
  paintCodePanel(ctx, 1080, 1920, {
    code,
    progress,
    onLayout: (l) => {
      holder.layout = l;
    },
  });
  if (!holder.layout) throw new Error("onLayout was never called");
  return holder.layout;
};

const texts = (calls: RecordedCall[]) =>
  calls.filter((c) => c.op === "fillText").map((c) => c.text);
/**
 * The gutter numbers, which are the only text drawn right-aligned.
 *
 * Filtering on the text alone would also match a numeric literal in the code,
 * which is how "the last line is 200" became "the last line is 199".
 */
const lineNumbers = (calls: RecordedCall[]) =>
  calls
    .filter((c) => c.op === "fillText" && c.align === "right" && /^\d+$/.test(c.text))
    .map((c) => c.text);

describe("paintCodePanel", () => {
  it("draws a card with the language in its header", () => {
    const calls = paint(snippet());
    const header = texts(calls).find((t) => t === "typescript");
    assert.ok(header, "the language should be named in the header");
    assert.equal(lineNumbers(calls).length, 5, "one number per source line");
  });

  it("centres the card and keeps it 88% of the frame wide", () => {
    const calls = paint(snippet(), 1080, 1920);
    const xs = calls.filter((c) => c.op === "lineTo").map((c) => c.x);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    assert.ok(Math.abs(left - 66) <= 2, `left edge ${left}`);
    assert.ok(Math.abs(right - 1014) <= 2, `right edge ${right}`);
  });

  it("sizes the card to the snippet, not to a fixed box", () => {
    const short = paint(snippet({ source: "a = 1" }));
    const long = paint(snippet());
    const height = (calls: RecordedCall[]) => {
      const ys = calls.filter((c) => c.op === "lineTo").map((c) => c.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    assert.ok(height(short) < height(long), "a one-line snippet is a shorter card");
  });

  it("keeps a 200-line snippet inside the frame", () => {
    const source = Array.from({ length: 200 }, (_, i) => `const value${i} = ${i};`).join("\n");
    const calls = paint(snippet({ source }));
    const ys = calls.filter((c) => c.op === "lineTo").map((c) => c.y);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    // The card is centred, so the cap is on its height, not on where it ends.
    assert.ok(top >= 0, `card starts at ${top}`);
    assert.ok(bottom <= 1920, `card ends at ${bottom}, outside the frame`);
    assert.ok(
      bottom - top <= 1920 * 0.66,
      `card is ${bottom - top}px tall, over the ${1920 * 0.66}px cap`,
    );
    // Only what fits is drawn, and the last line is the one on screen.
    const shown = lineNumbers(calls);
    assert.ok(shown.length > 1 && shown.length < 200, `${shown.length} lines shown`);
    assert.equal(shown.at(-1), "200");
  });

  it("shrinks the type rather than letting a long line run off the card", () => {
    const calls = paint(snippet({ source: 'const x = "' + "a".repeat(400) + '";' }));
    // The gutter numbers are drawn smaller than the code, so only the code's own
    // font says anything about whether the line was made to fit.
    const codeSizes = calls
      .filter((c) => c.op === "fillText" && !/^\d+$/.test(c.text))
      .map((c) => Number(/(\d+(?:\.\d+)?)px/.exec(c.font ?? "")?.[1] ?? 0))
      .filter((n) => n > 0);
    assert.ok(codeSizes.length > 0, "the code was drawn");
    const smallest = Math.min(...codeSizes);
    assert.ok(smallest >= 1080 * 0.011 - 1, `smallest code font ${smallest}px`);
    assert.ok(
      smallest < 1080 * 0.021,
      `a 400-character line should have forced the font down, got ${smallest}px`,
    );
  });

  it("never draws past the right edge of the card", () => {
    const calls = paint(snippet({ source: "x".repeat(300) }));
    for (const call of calls) {
      if (call.op !== "fillText") continue;
      assert.ok(call.x < 1014, `text drawn at x=${call.x} of a card ending at 1014`);
    }
  });

  it("draws nothing for an empty snippet", () => {
    assert.deepEqual(paint(snippet({ source: "" })), []);
    assert.deepEqual(paint(snippet({ source: "   " })), []);
  });

  it("moves the card up when subtitles are burning in at the bottom", () => {
    const without = paint(snippet());
    const withSubs = paint(snippet(), 1080, 1920, 0, 400);
    const top = (calls: RecordedCall[]) =>
      Math.min(...calls.filter((c) => c.op === "lineTo").map((c) => c.y));
    assert.ok(top(withSubs) < top(without), "the card gives room to the subtitles");
  });

  it("fits a landscape frame as well as a portrait one", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [720, 1280],
      [1280, 720],
      [320, 240],
    ]) {
      const calls = paint(snippet(), w, h);
      assert.ok(calls.length > 0, `${w}x${h} drew nothing`);
      const ys = calls.filter((c) => c.op === "lineTo").map((c) => c.y);
      assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= h, `${w}x${h} drew outside the frame`);
    }
  });
});

describe("reveal", () => {
  const heightOf = (code: SceneCode, progress: number) => {
    const calls = paint(code, 1080, 1920, progress);
    const ys = calls.filter((c) => c.op === "lineTo").map((c) => c.y);
    return calls.length === 0 ? 0 : Math.max(...ys) - Math.min(...ys);
  };

  it("shows the whole snippet at once", () => {
    const calls = paint(snippet({ reveal: "all" }), 1080, 1920, 0);
    assert.equal(lineNumbers(calls).length, 5);
  });

  it("types nothing at the first frame and everything before the last", () => {
    assert.deepEqual(lineNumbers(paint(snippet({ reveal: "typed" }), 1080, 1920, 0)), []);
    const late = paint(snippet({ reveal: "typed" }), 1080, 1920, 0.95);
    assert.equal(lineNumbers(late).length, 5, "the whole snippet is there before the cut");
  });

  it("holds the finished snippet for the tail of the scene", () => {
    for (const progress of [0.9, 0.95, 1]) {
      const calls = paint(snippet({ reveal: "typed" }), 1080, 1920, progress);
      assert.equal(lineNumbers(calls).length, 5, `progress ${progress}`);
    }
  });

  it("grows the card as the snippet is typed", () => {
    const reveals: CodeReveal[] = ["typed", "lines"];
    for (const reveal of reveals) {
      const heights = [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9].map((progress) =>
        heightOf(snippet({ reveal }), progress),
      );
      assert.ok(heights[0]! > 0, `${reveal}: nothing drawn early in the scene`);
      assert.ok(
        Math.max(...heights) > heights[0]!,
        `${reveal}: the card never grew — ${heights.join(", ")}`,
      );
      assert.ok(
        heights.every((h, i) => i === 0 || h >= heights[i - 1]!),
        `${reveal}: the card shrank mid-scene — ${heights.join(", ")}`,
      );
    }
  });

  it("adds one line at a time and never shows an empty card", () => {
    const counts = [0, 0.2, 0.4, 0.6, 0.8, 1].map(
      (progress) =>
        lineNumbers(paint(snippet({ reveal: "lines" }), 1080, 1920, progress)).length,
    );
    assert.equal(counts[0], 1, "the first line is there before the scene moves");
    for (let i = 1; i < counts.length; i++) {
      assert.ok(counts[i]! >= counts[i - 1]!, `lines went backwards: ${counts.join(", ")}`);
    }
    assert.equal(counts.at(-1), 5);
  });
});

describe("callouts", () => {
  it("draws a label beside the card with the callout text", () => {
    const { ctx, calls } = recorder();
    paintCodePanel(ctx, 1080, 1920, {
      code: snippet({ callouts: { 2: "caches results" } }),
      progress: 0.5,
    });
    assert.ok(
      calls.some((c) => c.op === "fillText" && c.text === "caches results"),
      "the label text should be drawn verbatim",
    );
  });

  it("reports its geometry through onLayout", () => {
    const card = captureLayout(snippet({ callouts: { 2: "lookup" } }));
    assert.equal(card.callouts.length, 1);
    const box = card.callouts[0]!;
    // The label sits to the right of the card, vertically inside it.
    assert.ok(box.x >= card.x + card.w, `label at ${box.x}, card ends ${card.x + card.w}`);
    assert.ok(box.y >= card.y && box.y <= card.y + card.h);
    assert.ok(box.anchored, "line 2 is on screen, so the label is anchored");
  });

  it("narrows the card to make room for the label column", () => {
    const card = captureLayout(snippet({ callouts: { 1: "a" } }));
    assert.ok(
      card.w < 1080 * 0.88,
      `card is ${card.w}px — a callout should have narrowed it`,
    );
    // And the card plus its column still fits the frame.
    assert.ok(card.x + card.w + card.callouts[0]!.w <= 1080);
  });

  it("pins a label whose line scrolled off the card to a visible row", () => {
    const source = Array.from({ length: 200 }, (_, i) => `const value${i} = ${i};`).join("\n");
    const card = captureLayout(snippet({ source, callouts: { 1: "the very top" } }));
    assert.ok(card.callouts.length === 1);
    assert.equal(card.callouts[0]!.anchored, false, "line 1 is scrolled off the card");
    assert.ok(
      card.callouts[0]!.y >= card.y && card.callouts[0]!.y <= card.y + card.h,
      "the label is still inside the card vertically",
    );
  });

  it("stacks two labels on the same row instead of overlapping", () => {
    const card = captureLayout(snippet({ callouts: { 2: "first", 3: "second" } }));
    assert.equal(card.callouts.length, 2);
    assert.ok(
      card.callouts[1]!.y >= card.callouts[0]!.y + card.callouts[0]!.h,
      `labels at y=${card.callouts[0]!.y} and y=${card.callouts[1]!.y} collide`,
    );
  });

  it("draws nothing extra for a scene with no callouts", () => {
    const calls = paint(snippet());
    assert.ok(!calls.some((c) => c.op === "fillText" && c.text.includes("results")));
  });
});

describe("focus dimming", () => {
  /** How many text draws went out at reduced alpha, per call. */
  const dimRows = (code: SceneCode) => {
    const { ctx, calls } = recorder();
    paintCodePanel(ctx, 1080, 1920, { code, progress: 0.5 });
    return calls.filter((c) => c.op === "fillText" && c.alpha < 1).length;
  };

  it("dims unfocused lines and keeps the spotlight rows full strength", () => {
    const dimOps = dimRows(snippet({ focus: [2] }));
    assert.ok(dimOps > 0, "unfocused rows should be drawn dimmed");
  });

  it("never dims anything without focus lines", () => {
    assert.equal(dimRows(snippet()), 0);
  });

  it("never dims the focused row itself", () => {
    const { ctx, calls } = recorder();
    paintCodePanel(ctx, 1080, 1920, {
      code: snippet({ focus: [1] }),
      progress: 0.5,
    });
    // Row 1's gutter number is drawn at full alpha, every dimmed row below it
    // at the dim level — read from the calls, not from the context, because
    // the painter sets and restores alpha per row.
    const one = calls.find(
      (c) => c.op === "fillText" && c.text === "1" && c.align === "right",
    );
    assert.ok(one, "line 1's gutter number was drawn");
    assert.equal(one!.alpha, 1, "the focused row is at full alpha");
    const dimmed = calls.filter((c) => c.op === "fillText" && c.alpha < 1);
    assert.ok(dimmed.length > 0, "the other rows are drawn dimmed");
    assert.ok(
      dimmed.every((c) => !/^1$/.test(c.text) || c.align !== "right"),
      "no dimmed gutter call belongs to the focused line",
    );
  });

  it("leaves progressive reveals untouched by dimming", () => {
    assert.equal(dimRows(snippet({ focus: [2], reveal: "lines" })), 0);
  });
});
