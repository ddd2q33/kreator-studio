import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alignWords,
  detectSpeechRegions,
  frameEnergy,
  speechSpan,
  splitWords,
  wordWeights,
  FRAME_SECONDS,
} from "../lib/speech-align.ts";

/**
 * Builds a 1-second energy curve where each tenth of a second has its own level.
 * Reads like a timeline: [0,0.1) silent, [0.1,0.4) loud, [0.4,0.6) silent…
 */
function curve(levels: number[]): Float32Array {
  return Float32Array.from(levels);
}

const near = (a: number, b: number, tol = 1e-6) =>
  assert.ok(
    Math.abs(a - b) <= tol,
    `expected ${a} to be within ${tol} of ${b}`,
  );

describe("frameEnergy", () => {
  it("returns nothing for an empty signal or a bad frame size", () => {
    assert.equal(frameEnergy(new Float32Array(0), 320).length, 0);
    assert.equal(frameEnergy(new Float32Array(100), 0).length, 0);
  });

  it("measures the RMS of each frame", () => {
    // Four samples per frame: 0.5 amplitude steady, then silence.
    const samples = Float32Array.from([
      0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0,
    ]);
    const energy = frameEnergy(samples, 4);
    assert.equal(energy.length, 2);
    near(energy[0]!, 0.5, 1e-6);
    near(energy[1]!, 0, 1e-6);
  });

  it("uses one frame per full chunk and ignores a trailing remainder", () => {
    const energy = frameEnergy(new Float32Array(10).fill(1), 4);
    assert.equal(energy.length, 2);
  });
});

describe("detectSpeechRegions", () => {
  it("finds the loud stretches and skips the pauses between them", () => {
    // 0.0-0.2 quiet, 0.2-0.6 loud, 0.6-1.0 quiet, at 20 ms per frame.
    const frames = 50;
    const energy = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const t = f * FRAME_SECONDS;
      energy[f] = t >= 0.2 && t < 0.6 ? 0.8 : 0.01;
    }

    const regions = detectSpeechRegions(energy, FRAME_SECONDS);

    assert.equal(regions.length, 1);
    near(regions[0]!.start, 0.2, 0.03);
    near(regions[0]!.end, 0.6, 0.03);
  });

  it("keeps two phrases apart across a pause longer than a breath", () => {
    const energy = new Float32Array(100);
    for (let f = 0; f < 100; f++) {
      const t = f * FRAME_SECONDS;
      // Loud 0.0-0.6, silent 0.6-1.0 (a 0.4 s pause), loud 1.0-2.0.
      energy[f] = t < 0.6 || t >= 1.0 ? 0.8 : 0.01;
    }

    const regions = detectSpeechRegions(energy, FRAME_SECONDS);

    assert.equal(regions.length, 2);
    near(regions[0]!.end, 0.6, 0.03);
    near(regions[1]!.start, 1.0, 0.03);
  });

  it("merges a gap too short to be a real pause", () => {
    // 0.1 s of silence between two loud runs: a breath, not a sentence break.
    const energy = new Float32Array(100);
    for (let f = 0; f < 100; f++) {
      const t = f * FRAME_SECONDS;
      energy[f] = t >= 0.4 && t < 0.5 ? 0.01 : 0.8;
    }

    const regions = detectSpeechRegions(energy, FRAME_SECONDS);

    assert.equal(regions.length, 1);
  });

  it("treats a clip with no dynamic range as one continuous take", () => {
    // Constant level: a heavily compressed narration with no silence at all.
    // Reporting "no speech" here would delete the subtitles, so it must fall
    // back to the whole clip.
    const energy = new Float32Array(50).fill(0.4);
    const regions = detectSpeechRegions(energy, FRAME_SECONDS, {
      totalSeconds: 1,
    });
    assert.deepEqual(regions, [{ start: 0, end: 1 }]);
  });

  it("scales the threshold to a quiet recording instead of calling it silence", () => {
    // Everything is quiet, but the voice still rises well above its own floor.
    const energy = curve([
      ...Array(10).fill(0.004),
      ...Array(30).fill(0.05),
      ...Array(10).fill(0.004),
    ]);
    const regions = detectSpeechRegions(energy, FRAME_SECONDS);
    assert.equal(regions.length, 1);
    assert.ok(regions[0]!.end > regions[0]!.start);
  });

  it("falls back to the whole clip when there is no signal to measure", () => {
    assert.deepEqual(detectSpeechRegions(new Float32Array(0), FRAME_SECONDS, {
      totalSeconds: 3,
    }), [{ start: 0, end: 3 }]);
    assert.deepEqual(detectSpeechRegions(new Float32Array(0), FRAME_SECONDS), []);
  });

  it("never returns a region that ends before it starts", () => {
    const energy = curve([0, 1, 0, 0, 1, 0, 1, 1, 0, 0]);
    for (const r of detectSpeechRegions(energy, FRAME_SECONDS)) {
      assert.ok(r.end > r.start, `bad region ${JSON.stringify(r)}`);
    }
  });
});

describe("splitWords", () => {
  it("collapses whitespace and trims", () => {
    assert.deepEqual(splitWords("  hola   mundo \n otra vez "), [
      "hola",
      "mundo",
      "otra",
      "vez",
    ]);
  });

  it("keeps punctuation attached to its word", () => {
    assert.deepEqual(splitWords("Hola, ¿qué tal?"), [
      "Hola,",
      "¿qué",
      "tal?",
    ]);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(splitWords(""), []);
    assert.deepEqual(splitWords("   \n  "), []);
  });
});

describe("wordWeights", () => {
  it("gives a longer word more time than a short one", () => {
    const [a, b] = wordWeights(["gato", "extraordinariamente"]);
    assert.ok(a! > 0 && b! > a!, `${b} should exceed ${a}`);
  });

  it("scales with syllable groups", () => {
    const [uno, cuatro] = wordWeights(["gato", "reinventamos"]);
    assert.ok(cuatro! > uno!);
  });

  it("never returns zero, so punctuation cannot steal time", () => {
    for (const w of wordWeights(["—", "...", "¡", "a"])) {
      assert.ok(w > 0);
    }
  });
});

describe("speechSpan", () => {
  it("adds up the region lengths", () => {
    assert.equal(
      speechSpan([
        { start: 0, end: 2 },
        { start: 3, end: 4.5 },
      ]),
      3.5,
    );
  });

  it("is zero for an empty or degenerate list", () => {
    assert.equal(speechSpan([]), 0);
    assert.equal(speechSpan([{ start: 2, end: 1 }]), 0);
  });
});

describe("alignWords", () => {
  const regions = [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ];

  it("spreads words over the speech and never past the end", () => {
    const words = ["uno", "dos", "tres", "cuatro"];
    const aligned = alignWords(words, regions);

    assert.equal(aligned.length, 4);
    assert.equal(aligned[0]!.text, "uno");
    // First word starts at the first region.
    near(aligned[0]!.start, 0);
    // The last word is stretched to the end of the last region.
    near(aligned[3]!.end, 3);
    for (const w of aligned) {
      assert.ok(w.end >= w.start, `reversed span on ${w.text}`);
      assert.ok(w.end <= 3 + 1e-9, `${w.text} runs past the speech`);
    }
  });

  it("produces words in order, with no backwards jump", () => {
    const aligned = alignWords(
      ["uno", "dos", "tres", "cuatro", "cinco", "seis"],
      regions,
    );
    for (let i = 1; i < aligned.length; i++) {
      assert.ok(
        aligned[i]!.start >= aligned[i - 1]!.start,
        `word ${i} starts before word ${i - 1}`,
      );
    }
  });

  it("skips the silence between regions instead of talking through it", () => {
    // With a 1 s gap from 1 s to 2 s, the middle of the text must land in the
    // second region, not at 1.5 s where nothing is being said.
    const aligned = alignWords(["uno", "dos", "tres", "cuatro"], regions);
    const inGap = aligned.filter((w) => w.start > 1 && w.start < 2);
    assert.equal(inGap.length, 0, "a word should not start inside the pause");
  });

  it("shifts every timestamp by the video offset", () => {
    const aligned = alignWords(["uno", "dos"], regions, { offset: 30 });
    assert.equal(aligned[0]!.start, 30);
    assert.equal(aligned[1]!.end, 33);
  });

  it("lands the last word exactly on the end of the speech", () => {
    // The shares add up to the whole speech span, so the final word finishes
    // where the voice finishes without needing a special case.
    const aligned = alignWords(["uno", "dos"], regions);
    near(aligned[1]!.end, 3, 1e-9);
  });

  it("collapses every word to a point when there is no speech to align to", () => {
    const aligned = alignWords(["uno", "dos"], [], { offset: 5 });
    for (const w of aligned) {
      assert.equal(w.start, 5);
      assert.equal(w.end, 5);
    }
  });

  it("handles empty input", () => {
    assert.deepEqual(alignWords([], regions), []);
  });

  it("ignores zero-length regions", () => {
    const aligned = alignWords(["uno", "dos"], [
      { start: 0, end: 0 },
      { start: 1, end: 2 },
    ]);
    assert.ok(aligned[0]!.start >= 1);
  });

  it("gives more time to a long word than a short one", () => {
    const aligned = alignWords(["gato", "extraordinariamente"], [
      { start: 0, end: 10 },
    ]);
    const shortLen = aligned[0]!.end - aligned[0]!.start;
    const longLen = aligned[1]!.end - aligned[1]!.start;
    assert.ok(
      longLen > shortLen,
      `expected the long word to last longer, got ${longLen} vs ${shortLen}`,
    );
  });
});
