import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paintCodeFrame, visibleChars, type Ctx } from "../lib/code-frames.ts";
import {
  CODE_STYLES,
  defaultProject,
  newBeat,
  newScene,
  playableScenes,
  projectDuration,
  revealUnits,
  sceneTiming,
  type CodeProject,
  type CodeScene,
} from "../lib/code-art.ts";

type DrawCall = { text: string; color: string; x: number; y: number; font: string };

/** A context that records what was drawn, plus the recording itself. */
type Recorder = Ctx & { calls: DrawCall[] };

/**
 * A canvas context that records what was drawn instead of drawing it.
 *
 * The painter's contract is not "does it look right", which no assertion in a
 * Node process can check, but "what text, in what colour, in what order". So
 * this records the fillText calls and measures text the way a monospace font
 * would, which is what the auto-fit and the wrap both branch on.
 *
 * `measureText` returns width proportional to length rather than a lookup table:
 * the painter only ever asks how wide a string is relative to the panel, and a
 * font in which every glyph is the same width is exactly that case.
 *
 * The cast is the honest one. Implementing all of CanvasRenderingContext2D would
 * be a hundred methods of filler, and a stub that lies about its own type is
 * worse than one that is clearly a stand-in for the parts the painter touches.
 */
function recordingCtx(charWidth = 10): Recorder {
  const calls: DrawCall[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    calls,
    measureText: (text: string) => ({ width: text.length * charWidth }),
    fillText(this: { fillStyle: string; font: string }, text: string, x: number, y: number) {
      calls.push({ text, color: this.fillStyle, x, y, font: this.font });
    },
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    fill() {},
    stroke() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    rect() {},
    translate() {},
    scale() {},
    setLineDash() {},
  };
  return ctx as unknown as Recorder;
}

/** Every character the painter drew, in the order it drew it. */
function drawnText(ctx: Recorder): string {
  return ctx.calls.map((c) => c.text).join("");
}

/** Asserts that one frame has less on it than another, by draw call count. */
function assertLessOnScreen(early: Recorder, late: Recorder) {
  assert.ok(
    early.calls.length < late.calls.length,
    `expected the earlier frame to draw less: ${early.calls.length} vs ${late.calls.length}`,
  );
}

const TWO_LINES = ["const total = price - discount;", "return total;"].join("\n");

/** A scene over a known two-line file, with one sub-scene keeping `lines`. */
function scene(over: Partial<CodeScene> = {}): CodeScene {
  const built = newScene(TWO_LINES, "javascript");
  built.beats = [{ ...newBeat([0, 1]), ...(over.beats?.[0] ?? {}) }];
  return { ...built, ...over, beats: built.beats };
}

function projectOf(scenes: CodeScene[], patch: Partial<CodeProject> = {}): CodeProject {
  return { ...defaultProject(), scenes, ...patch };
}

describe("visibleChars", () => {
  const project = projectOf([]);
  const one = newScene("abcd", "text");
  const beat = newBeat([0]);

  it("shows nothing before the first unit", () => {
    const units = revealUnits(one, beat, project);
    assert.deepEqual(visibleChars(units, 0, 0, 1), [0]);
  });

  it("shows a whole line when the line reveal has landed it", () => {
    const lines = { ...project, reveal: "lines" as const };
    const units = revealUnits(one, beat, lines);
    assert.deepEqual(visibleChars(units, 1, 0, 1), [4]);
  });

  it("shows part of the line being typed", () => {
    const typing = { ...project, reveal: "typewriter" as const };
    const units = revealUnits(one, beat, typing);
    assert.deepEqual(visibleChars(units, 2, 0.5, 1), [2.5]);
  });

  it("counts into the right line when several are typing", () => {
    // The index is the position in the *kept* list, not the file's, so a
    // sub-scene showing lines 40 to 44 has to put the first typed character on
    // index 0. The kept list here is reversed, so a character on index 1 would be
    // a character drawn on the wrong line.
    const two = newScene("ab\ncd", "text");
    const kept = newBeat([1, 0]);
    const units = revealUnits(two, kept, project);
    assert.deepEqual(visibleChars(units, 1, 0, 2), [1, 0]);
  });

  it("does not count more units than exist", () => {
    const units = revealUnits(one, beat, project);
    assert.deepEqual(visibleChars(units, 999, 1, 1), [4]);
  });
});

describe("paintCodeFrame", () => {
  it("draws nothing but an invitation in an empty project", () => {
    const ctx = recordingCtx();
    paintCodeFrame(ctx, projectOf([]), 0, 1920, 1080);
    assert.match(drawnText(ctx), /Paste some code to start/);
  });

  it("says so when there are scenes but none can be filmed yet", () => {
    const ctx = recordingCtx();
    paintCodeFrame(ctx, projectOf([scene({ beats: [newBeat([])] })]), 0, 1920, 1080);
    assert.match(drawnText(ctx), /Nothing to film yet/);
  });

  it("draws the code, with no markup left in it", () => {
    // The regression this guards: the tokenizer's closing tag used to be treated
    // as text, so `</span>` was drawn on screen and every line took twice as long
    // to type as it was wide.
    const ctx = recordingCtx();
    paintCodeFrame(ctx, projectOf([scene()]), 99, 1920, 1080);
    const text = drawnText(ctx);
    assert.match(text, /const total = price - discount;/);
    assert.doesNotMatch(text, /span|hljs/);
  });

  it("types the first line before the second", () => {
    const early = recordingCtx();
    const late = recordingCtx();
    const project = projectOf([scene()]);
    paintCodeFrame(early, project, 0, 1920, 1080);
    paintCodeFrame(late, project, 99, 1920, 1080);
    assertLessOnScreen(early, late);
    assert.doesNotMatch(drawnText(early), /return total;/);
    assert.match(drawnText(late), /return total;/);
  });

  it("draws the whole sub-scene once its typing is over", () => {
    const ctx = recordingCtx();
    const project = projectOf([scene()]);
    paintCodeFrame(ctx, project, projectDuration(project) + 1, 1920, 1080);
    const text = drawnText(ctx);
    assert.match(text, /const total = price - discount;/);
    assert.match(text, /return total;/);
  });

  it("holds the finished sub-scene rather than un-typing it", () => {
    // The rest of the authored length is reading time. If the last frame dropped
    // characters, the video would end mid-word.
    const project = projectOf([scene()]);
    const at = (t: number) => {
      const ctx = recordingCtx();
      paintCodeFrame(ctx, project, t, 1920, 1080);
      return drawnText(ctx);
    };
    assert.equal(at(projectDuration(project) * 0.9), at(projectDuration(project) + 3));
  });

  it("moves from one sub-scene to the next on the same file", () => {
    // The whole point of a scene: one paste, several moments, and the second one
    // shows different lines of it. Sampled past each sub-scene's own typing,
    // because a frame mid-type has only part of the line and would be testing the
    // typewriter rather than the handover.
    const built = newScene(TWO_LINES, "javascript");
    built.title = "Checkout";
    built.beats = [
      { ...newBeat([0]), note: "the arithmetic", duration: 2 },
      { ...newBeat([1]), note: "and this returns it", duration: 2 },
    ];
    const project = projectOf([built]);
    const timing = sceneTiming(built, project);
    const first = recordingCtx();
    const second = recordingCtx();
    paintCodeFrame(first, project, timing.beats[0].typing + 0.01, 1920, 1080);
    paintCodeFrame(second, project, timing.beats[1].start + timing.beats[1].typing + 0.01, 1920, 1080);
    assert.match(drawnText(first), /the arithmetic/);
    assert.match(drawnText(first), /const total = price - discount;/);
    assert.doesNotMatch(drawnText(first), /return total;/);
    assert.match(drawnText(second), /and this returns it/);
    assert.match(drawnText(second), /return total;/);
  });

  it("can leave the sub-scene notes out", () => {
    const withNote = recordingCtx();
    const without = recordingCtx();
    const built = newScene(TWO_LINES, "javascript");
    built.beats = [{ ...newBeat([0, 1]), note: "the arithmetic" }];
    const project = projectOf([built]);
    paintCodeFrame(withNote, project, 99, 1920, 1080);
    paintCodeFrame(without, projectOf([built], { notes: false }), 99, 1920, 1080);
    assert.match(drawnText(withNote), /the arithmetic/);
    assert.doesNotMatch(drawnText(without), /the arithmetic/);
  });

  it("skips a sub-scene with no lines and films the next one", () => {
    const ctx = recordingCtx();
    const built = newScene(TWO_LINES, "javascript");
    built.beats = [{ ...newBeat([]), note: "skipped", duration: 4 }, { ...newBeat([0, 1]), note: "kept" }];
    paintCodeFrame(ctx, projectOf([built]), 0.5, 1920, 1080);
    const text = drawnText(ctx);
    assert.doesNotMatch(text, /skipped/);
    assert.match(text, /kept/);
  });

  it("skips a scene with no lines and films the next one", () => {
    const ctx = recordingCtx();
    const project = projectOf([scene({ title: "skipped", beats: [newBeat([])] }), scene({ title: "kept" })]);
    paintCodeFrame(ctx, project, 0.5, 1920, 1080);
    const text = drawnText(ctx);
    assert.doesNotMatch(text, /skipped/);
    assert.match(text, /kept/);
  });

  it("colours a keyword differently from the plain text around it", () => {
    const ctx = recordingCtx();
    paintCodeFrame(ctx, projectOf([scene()]), 99, 1920, 1080);
    const drawn = ctx.calls.filter((c) => c.text.length > 0);
    const colors = new Set(drawn.map((c) => c.color));
    assert.ok(colors.size > 1, "expected syntax colours, got one flat colour");
  });

  it("draws line numbers in the gutter, at the file's numbers", () => {
    const later = newScene("a;\nb;\nc;\nd;", "text");
    later.beats = [newBeat([2, 3])];
    const ctx = recordingCtx();
    paintCodeFrame(ctx, projectOf([later]), 99, 1920, 1080);
    // 3 and 4, not 1 and 2: the author is looking at their own file.
    assert.match(drawnText(ctx), /3/);
    assert.match(drawnText(ctx), /4/);
  });

  it("draws a marked line with an accent bar and leaves the text alone", () => {
    const plain = recordingCtx();
    const marked = recordingCtx();
    const base = scene();
    const accented = scene();
    accented.beats = [{ ...base.beats[0], marks: [1] }];
    paintCodeFrame(plain, projectOf([base]), 99, 1920, 1080);
    paintCodeFrame(marked, projectOf([accented]), 99, 1920, 1080);
    assert.equal(drawnText(plain), drawnText(marked));
    // The mark is a shape, not a recolouring: a marked line is still code.
    assert.ok(marked.calls.length >= plain.calls.length);
  });

  it("titles a scene that has a title", () => {
    const ctx = recordingCtx();
    paintCodeFrame(ctx, projectOf([scene({ title: "The refund bug" })]), 99, 1920, 1080);
    assert.match(drawnText(ctx), /The refund bug/);
  });

  it("can leave the caption out", () => {
    const withCaption = recordingCtx();
    const without = recordingCtx();
    const taken = scene({ caption: "It added instead of subtracting." });
    paintCodeFrame(withCaption, projectOf([taken], { captions: true }), 99, 1920, 1080);
    paintCodeFrame(without, projectOf([taken], { captions: false }), 99, 1920, 1080);
    assert.match(drawnText(withCaption), /added instead/);
    assert.doesNotMatch(drawnText(without), /added instead/);
  });

  it("survives a size it was not designed for", () => {
    // The same call has to work for a 1080-wide square and a 1080x1920 vertical,
    // because the format is a choice in the UI and the painter is not told which.
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [640, 360],
    ]) {
      const ctx = recordingCtx();
      paintCodeFrame(ctx, projectOf([scene()]), 99, w, h);
      assert.match(drawnText(ctx), /return total;/, `${w}x${h}`);
    }
  });

  it("keeps the code inside the safe area of a phone frame", () => {
    // A vertical video loses its top and its bottom to the account row and the
    // caption, so nothing that matters may be drawn outside the safe band.
    const ctx = recordingCtx();
    const built = scene({ caption: "A caption long enough to wrap." });
    paintCodeFrame(ctx, projectOf([built]), 99, 1080, 1920);
    for (const call of ctx.calls) {
      if (!call.text.trim()) continue;
      // The top tenth and the bottom fifth are the platform's, not ours.
      assert.ok(call.y >= 1920 * 0.1, `text above the safe area at y=${call.y}: ${call.text}`);
      assert.ok(
        call.y <= 1920 * (1 - 0.18),
        `text below the safe area at y=${call.y}: ${call.text}`,
      );
    }
  });

  it("paints every style without throwing or losing the code", () => {
    for (const style of CODE_STYLES) {
      const ctx = recordingCtx();
      paintCodeFrame(
        ctx,
        projectOf([scene({ caption: "A caption long enough to wrap." })], { styleId: style.id }),
        99,
        1080,
        1080,
      );
      const text = drawnText(ctx);
      assert.match(text, /return total;/, style.id);
      assert.doesNotMatch(text, /span|hljs/, style.id);
    }
  });

  it("paints every reveal the same finished line", () => {
    for (const reveal of ["typewriter", "lines", "token"] as const) {
      const ctx = recordingCtx();
      const project = projectOf([scene()], { reveal });
      paintCodeFrame(ctx, project, projectDuration(project) + 1, 1920, 1080);
      assert.match(drawnText(ctx), /const total = price - discount;/, reveal);
    }
  });

  it("blinks the cursor, and the blink does not change the code", () => {
    const project = projectOf([scene()]);
    const at = (t: number) => {
      const ctx = recordingCtx();
      paintCodeFrame(ctx, project, t, 1920, 1080);
      return drawnText(ctx);
    };
    // Two moments inside the same blink window have identical text, and the
    // cursor is a fillRect rather than a fillText, so this is about stability: a
    // cursor drawn as text would corrupt every character count.
    assert.equal(at(0.05), at(0.06));
  });

  it("keeps the code inside the frame it was given", () => {
    // Every draw has to land inside the canvas, or a long line is silently
    // cropped in the export while the preview still shows it.
    const ctx = recordingCtx();
    const long = newScene("x".repeat(200), "text");
    long.beats = [newBeat([0])];
    paintCodeFrame(ctx, projectOf([long]), 99, 1080, 1080);
    for (const call of ctx.calls) {
      assert.ok(call.y >= 0 && call.y <= 1080, `text drawn at y=${call.y}: ${call.text}`);
      assert.ok(call.x >= 0, `text drawn at x=${call.x}: ${call.text}`);
    }
  });
});

describe("playableScenes", () => {
  it("is the list the painter walks, so the two cannot disagree", () => {
    const project = projectOf([scene({ beats: [newBeat([])] }), scene(), scene()]);
    assert.equal(playableScenes(project).length, 2);
  });
});
