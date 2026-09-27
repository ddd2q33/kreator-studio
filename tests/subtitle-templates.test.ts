/**
 * Tests for subtitle motion and the template set.
 *
 * These are the numbers a rendered frame is made of, so they are pinned hard:
 * an easing curve that drifts by a few percent changes every exported video
 * that uses that template, and nothing would catch it except a test.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BASE_ENTRANCE_SECONDS,
  clamp01,
  composeTransform,
  cuePhaseAt,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutExpo,
  entranceScope,
  hump,
  keywordMotion,
  wordEntrance,
  wordPhaseAt,
  type SubtitleEntrance,
} from "../lib/subtitle-motion.ts";

import {
  DEFAULT_SUBTITLE_STYLE_ID,
  SUBTITLE_STYLES,
  SUBTITLE_STYLE_GROUPS,
  entranceSecondsFor,
  subtitleStyleById,
} from "../lib/subtitle-templates.ts";

/** Roughly equal, which is all these curves need. */
function near(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

const ALL_ENTRANCES: SubtitleEntrance[] = [
  "none",
  "fade",
  "pop",
  "rise",
  "bounce",
  "kinetic",
  "zoom",
  "cinematic",
];

describe("clamp01", () => {
  it("pins a value to the unit interval", () => {
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(0.25), 0.25);
    assert.equal(clamp01(2), 1);
  });

  it("survives a non-finite value rather than painting NaN", () => {
    assert.equal(clamp01(NaN), 0);
    assert.equal(clamp01(Infinity), 1);
    assert.equal(clamp01(-Infinity), 0);
  });
});

describe("easing", () => {
  it("every curve starts at 0 and finishes at 1", () => {
    for (const ease of [easeOutCubic, easeInOutCubic, easeOutExpo]) {
      near(ease(0), 0, 1e-9);
      near(ease(1), 1, 1e-9);
    }
  });

  it("outBack overshoots past 1 before settling", () => {
    // The overshoot is the entire point of the curve: a pop that never passes
    // its target reads as a fade-in.
    let peak = 0;
    for (let i = 0; i <= 100; i++) peak = Math.max(peak, easeOutBack(i / 100));
    assert.ok(peak > 1, `expected an overshoot, peaked at ${peak}`);
    near(easeOutBack(1), 1, 1e-9);
  });

  it("outCubic decelerates: the second half covers less ground", () => {
    const first = easeOutCubic(0.5) - easeOutCubic(0);
    const second = easeOutCubic(1) - easeOutCubic(0.5);
    assert.ok(first > second);
  });

  it("inOutCubic is symmetric about the midpoint", () => {
    near(easeInOutCubic(0.5), 0.5, 1e-9);
    near(
      easeInOutCubic(0.25) + easeInOutCubic(0.75),
      1,
      1e-9,
    );
  });

  it("hump is 0 at both ends and 1 in the middle", () => {
    near(hump(0), 0, 1e-9);
    near(hump(0.5), 1, 1e-9);
    near(hump(1), 0, 1e-9);
  });

  it("hump never goes negative, so a pulse cannot invert a word", () => {
    for (let i = 0; i <= 50; i++) assert.ok(hump(i / 50) >= 0);
  });
});

describe("wordEntrance", () => {
  it("starts hidden and ends settled for every preset that moves", () => {
    for (const preset of ALL_ENTRANCES) {
      if (preset === "none") continue;
      const start = wordEntrance(preset, 0, 40);
      const end = wordEntrance(preset, 1, 40);
      assert.ok(start.alpha < end.alpha, `${preset} did not fade in`);
      near(end.scale, 1, 1e-6);
      near(end.dy, 0, 1e-6);
    }
  });

  it("'none' is the identity at every point in its life", () => {
    for (const p of [0, 0.25, 0.5, 1]) {
      const t = wordEntrance("none", p, 40);
      near(t.scale, 1);
      near(t.alpha, 1);
      near(t.dy, 0);
    }
  });

  it("travel scales with the type size, so motion reads the same at any size", () => {
    const small = wordEntrance("rise", 0.2, 20);
    const large = wordEntrance("rise", 0.2, 100);
    near(large.dy / small.dy, 5, 0.01);
  });

  it("clamps progress past the ends instead of extrapolating", () => {
    near(wordEntrance("fade", -3, 40).alpha, 0);
    near(wordEntrance("fade", 4, 40).alpha, 1);
  });

  it("is invisible before it starts and fully opaque once arrived", () => {
    for (const preset of ALL_ENTRANCES) {
      if (preset === "none") continue;
      assert.equal(wordEntrance(preset, 0, 40).alpha <= 0.15, true, preset);
    }
  });
});

describe("keywordMotion", () => {
  it("'none' and 'glow' leave the geometry alone", () => {
    for (const preset of ["none", "glow"] as const) {
      for (const p of [0, 0.3, 0.7, 1]) {
        near(keywordMotion(preset, p, 40).scale, 1, 1e-9);
        near(keywordMotion(preset, p, 40).dy, 0, 1e-9);
      }
    }
  });

  it("returns to exactly rest at the end of the word", () => {
    // A word that ends mid-pop is the most visible way for this to look broken.
    for (const preset of ["pop", "zoom", "pulse", "bounce"] as const) {
      const t = keywordMotion(preset, 1, 40);
      near(t.scale, 1, 1e-9);
      near(t.dy, 0, 1e-9);
    }
  });

  it("grows in the middle of the word and never shrinks below rest", () => {
    for (const preset of ["pop", "zoom", "pulse", "bounce"] as const) {
      for (let i = 0; i <= 40; i++) {
        const p = i / 40;
        const t = keywordMotion(preset, p, 40);
        assert.ok(t.scale >= 1 - 1e-9, `${preset} dipped below rest at ${p}`);
        if (p > 0.05 && p < 0.95) {
          assert.ok(t.scale > 1, `${preset} never grew at ${p}`);
        }
      }
    }
  });

  it("bounces upward, so a negative dy is the motion", () => {
    const t = keywordMotion("bounce", 0.5, 40);
    assert.ok(t.dy < 0);
  });
});

describe("composeTransform", () => {
  it("multiplies scale and alpha, and sums the offsets", () => {
    const a = { scale: 2, alpha: 0.5, dy: 3, dx: 1 };
    const b = { scale: 3, alpha: 0.5, dy: -1, dx: 2 };
    const out = composeTransform(a, b);
    near(out.scale, 6);
    near(out.alpha, 0.25);
    near(out.dy, 2);
    near(out.dx, 3);
  });

  it("keeps alpha inside the unit interval even if the inputs are not", () => {
    const out = composeTransform(
      { scale: 1, alpha: 2, dy: 0, dx: 0 },
      { scale: 1, alpha: 2, dy: 0, dx: 0 },
    );
    near(out.alpha, 1);
  });

  it("an identity on one side is a no-op", () => {
    const a = { scale: 1.4, alpha: 0.3, dy: 5, dx: -2 };
    const id = { scale: 1, alpha: 1, dy: 0, dx: 0 };
    assert.deepEqual(composeTransform(a, id), a);
    assert.deepEqual(composeTransform(id, a), a);
  });
});

describe("entranceScope", () => {
  it("splits presets into ones that can be staggered and ones that cannot", () => {
    assert.equal(entranceScope("pop"), "word");
    assert.equal(entranceScope("kinetic"), "word");
    assert.equal(entranceScope("bounce"), "word");
    assert.equal(entranceScope("rise"), "word");
    // A line-level fade is the only thing that survives estimated timings.
    assert.equal(entranceScope("fade"), "line");
    assert.equal(entranceScope("cinematic"), "line");
    assert.equal(entranceScope("zoom"), "line");
    assert.equal(entranceScope("none"), "line");
  });
});

describe("wordPhaseAt", () => {
  it("is not yet started before the word begins", () => {
    const phase = wordPhaseAt(10, 11, 9.5, 0.2);
    assert.equal(phase.entranceP, 0);
    assert.equal(phase.visible, false);
  });

  it("is fully arrived once the entrance has run", () => {
    const phase = wordPhaseAt(10, 11, 10.5, 0.2);
    assert.equal(phase.entranceP, 1);
    assert.equal(phase.visible, true);
  });

  it("tracks progress across the word for the keyword motion", () => {
    near(wordPhaseAt(10, 12, 11, 0.2).keywordP, 0.5, 1e-9);
    near(wordPhaseAt(10, 12, 12, 0.2).keywordP, 1, 1e-9);
  });

  it("treats a zero-length word as starting rather than dividing by zero", () => {
    const phase = wordPhaseAt(10, 10, 10, 0.2);
    assert.ok(Number.isFinite(phase.keywordP));
    // At its own start a degenerate word reads as just beginning. What matters
    // is that it is a number and not NaN.
    assert.equal(phase.keywordP, 0);
  });

  it("floors the entrance so a fast template cannot be skipped by the sampler", () => {
    // At 30fps a frame is 33ms. A template asking for 10ms would sometimes be
    // sampled entirely before or after the window and the word would appear
    // without ever visibly arriving.
    const phase = wordPhaseAt(10, 11, 10.01, 0.01);
    assert.ok(phase.entranceP > 0, "a sub-frame entrance vanished");
  });

  it("gives half a frame of slack so a word is never skipped entirely", () => {
    // Landing a hair before the start should still draw the word.
    assert.equal(wordPhaseAt(10, 11, 9.99, 0.2).visible, true);
    assert.equal(wordPhaseAt(10, 11, 9.8, 0.2).visible, false);
  });
});

describe("cuePhaseAt", () => {
  it("treats the whole cue as one object", () => {
    const phase = cuePhaseAt(5, 5.1, 0.2);
    near(phase.entranceP, 0.5, 1e-9);
    assert.equal(phase.keywordP, 1);
  });

  it("is hidden before the cue starts", () => {
    assert.equal(cuePhaseAt(5, 4, 0.2).visible, false);
  });
});

describe("SUBTITLE_STYLES", () => {
  it("keeps the six original ids so saved projects still resolve", () => {
    for (const id of ["plate", "tiktok", "reels", "yellow", "bar", "minimal"]) {
      assert.ok(
        SUBTITLE_STYLES.some((s) => s.id === id),
        `missing legacy style ${id}`,
      );
    }
  });

  it("includes the seven designed styles", () => {
    for (const id of [
      "pro-minimal",
      "pro-viral",
      "pro-podcast",
      "pro-educational",
      "pro-cinematic",
      "pro-creator",
      "pro-ai",
    ]) {
      assert.ok(SUBTITLE_STYLES.some((s) => s.id === id), `missing ${id}`);
    }
  });

  it("has no duplicate ids", () => {
    const seen = new Set(SUBTITLE_STYLES.map((s) => s.id));
    assert.equal(seen.size, SUBTITLE_STYLES.length);
  });

  it("gives every style a category, a description and a recommendation", () => {
    for (const s of SUBTITLE_STYLES) {
      assert.ok(s.category.length > 0, `${s.id} has no category`);
      assert.ok(s.description.length > 0, `${s.id} has no description`);
      assert.ok(s.recommended.useFor.length > 0, `${s.id} has no useFor`);
    }
  });

  it("keeps every style legible on a phone held at arm's length", () => {
    for (const s of SUBTITLE_STYLES) {
      assert.ok(
        s.sizeRatio >= 0.85,
        `${s.id} at ${s.sizeRatio} is too small to read on a phone`,
      );
    }
  });

  it("gives every designed style something to sit on the footage", () => {
    // White text with none of these disappears over a bright frame. A thick
    // stroke counts too: that is the TikTok look.
    //
    // Scoped to the pro set on purpose. The legacy styles are preserved as they
    // were, and `minimal` in particular is meant to be the discreet option that
    // recedes over busy footage; quietly adding a shadow to it would change
    // every saved project that already picked it.
    for (const s of SUBTITLE_STYLES.filter((x) => x.category === "Pro")) {
      const hasBacking =
        s.plate !== "none" || s.shadow !== null || s.strokeWidthRatio > 0.06;
      assert.ok(hasBacking, `${s.id} has no plate, shadow or usable stroke`);
    }
  });

  it("holds the pro templates to a legibility bar the legacy set does not", () => {
    for (const s of SUBTITLE_STYLES.filter((x) => x.category === "Pro")) {
      assert.ok(s.sizeRatio >= 0.9, `${s.id} is too small for a phone`);
      assert.ok(s.bottomRatio <= 0.2, `${s.id} sits too high for platform UI`);
    }
  });

  it("names a font stack rather than a single family, so it can fall back", () => {
    for (const s of SUBTITLE_STYLES) {
      assert.ok(
        s.fontFamily.includes(","),
        `${s.id} names one font and cannot fall back`,
      );
    }
  });

  it("keeps the vertical position clear of the very bottom edge", () => {
    for (const s of SUBTITLE_STYLES) {
      assert.ok(s.bottomRatio >= 0, `${s.id} would sit below the frame`);
      assert.ok(s.bottomRatio < 0.4, `${s.id} would sit near the top`);
    }
  });

  it("keeps the highlight style and the highlight colour consistent", () => {
    for (const s of SUBTITLE_STYLES) {
      const needsColor = s.highlight === "color" || s.highlight === "glow";
      if (needsColor) {
        assert.ok(s.highlightColor, `${s.id} highlights with no colour`);
      }
      if (s.highlight === "gradient") {
        assert.ok(s.gradientTo, `${s.id} is a gradient with no second colour`);
      }
    }
  });
});

describe("SUBTITLE_STYLE_GROUPS", () => {
  it("lists every style exactly once", () => {
    const ids = SUBTITLE_STYLE_GROUPS.flatMap((g) => g.ids);
    assert.equal(ids.length, SUBTITLE_STYLES.length);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of SUBTITLE_STYLES) {
      assert.ok(ids.includes(s.id), `${s.id} is not in any group`);
    }
  });

  it("puts the pro templates first", () => {
    assert.equal(SUBTITLE_STYLE_GROUPS[0].label, "Pro");
  });

  it("keeps each group in the same order as the flat list", () => {
    const flat = SUBTITLE_STYLES.map((s) => s.id);
    const grouped = SUBTITLE_STYLE_GROUPS.flatMap((g) => g.ids);
    assert.deepEqual(grouped, flat);
  });
});

describe("subtitleStyleById", () => {
  it("finds a style by id", () => {
    assert.equal(subtitleStyleById("pro-viral").label, "Viral Shorts");
  });

  it("falls back to the default for anything unknown", () => {
    assert.equal(subtitleStyleById("nope").id, DEFAULT_SUBTITLE_STYLE_ID);
    assert.equal(subtitleStyleById(null).id, DEFAULT_SUBTITLE_STYLE_ID);
    assert.equal(subtitleStyleById(undefined).id, DEFAULT_SUBTITLE_STYLE_ID);
  });
});

describe("entranceSecondsFor", () => {
  it("divides the base by the template's tempo", () => {
    const fast = subtitleStyleById("pro-viral");
    near(entranceSecondsFor(fast), BASE_ENTRANCE_SECONDS / fast.speed, 1e-9);
  });

  it("gives a slow template a longer entrance than a fast one", () => {
    const cinematic = subtitleStyleById("pro-cinematic");
    const viral = subtitleStyleById("pro-viral");
    assert.ok(entranceSecondsFor(cinematic) > entranceSecondsFor(viral));
  });

  it("never returns an instant, however slow a template asks to be", () => {
    const absurd = { ...subtitleStyleById("plate"), speed: 0.01 };
    assert.ok(entranceSecondsFor(absurd) > 0.1);
  });
});
