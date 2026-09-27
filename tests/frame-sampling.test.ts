import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_FRAMES,
  MIN_FRAMES,
  SECONDS_PER_FRAME,
  coverRect,
  frameCountForDuration,
  frameKey,
  frameTimestamps,
  secondsPerFrame,
} from "../lib/frame-sampling.ts";

describe("frameCountForDuration", () => {
  it("keeps short clips at the minimum", () => {
    assert.equal(frameCountForDuration(0.5), MIN_FRAMES);
    assert.equal(frameCountForDuration(2), MIN_FRAMES);
  });

  it("scales with the runtime", () => {
    assert.equal(frameCountForDuration(4 * SECONDS_PER_FRAME), 4);
    assert.equal(frameCountForDuration(20), 10);
  });

  it("never returns more than the cap", () => {
    // An hour of footage would be 1800 frames at one per 2s.
    assert.equal(frameCountForDuration(3600), MAX_FRAMES);
  });

  it("falls back to the minimum for an unreadable duration", () => {
    assert.equal(frameCountForDuration(0), MIN_FRAMES);
    assert.equal(frameCountForDuration(-12), MIN_FRAMES);
    assert.equal(frameCountForDuration(Number.NaN), MIN_FRAMES);
    assert.equal(frameCountForDuration(Number.POSITIVE_INFINITY), MIN_FRAMES);
  });
});

describe("frameTimestamps", () => {
  it("splits the clip into equal segments", () => {
    assert.deepEqual(frameTimestamps(8, 4), [1, 3, 5, 7]);
  });

  it("samples segment midpoints, never the black first or last frame", () => {
    const times = frameTimestamps(10, 5);
    assert.equal(times.length, 5);
    assert.equal(times[0], 1);
    assert.equal(times[times.length - 1], 9);
    for (const t of times) {
      assert.ok(t > 0 && t < 10, `${t} should sit inside the clip`);
    }
  });

  it("keeps every timestamp inside the clip and in order", () => {
    const times = frameTimestamps(37, 7);
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] > times[i - 1], "timestamps should ascend");
    }
    assert.ok(times[0] > 0);
    assert.ok(times[times.length - 1] < 37);
  });

  it("rounds to milliseconds so seeking is reproducible", () => {
    const times = frameTimestamps(1, 3);
    for (const t of times) {
      assert.equal(t, Math.round(t * 1000) / 1000);
    }
  });

  it("returns nothing when there is no usable duration", () => {
    assert.deepEqual(frameTimestamps(0, 4), []);
    assert.deepEqual(frameTimestamps(-1, 4), []);
    assert.deepEqual(frameTimestamps(Number.NaN, 4), []);
  });

  it("still returns one timestamp when asked for none", () => {
    assert.deepEqual(frameTimestamps(6, 0), [3]);
  });
});

describe("frameKey", () => {
  it("zero-pads so the pool sorts in capture order", () => {
    assert.equal(frameKey("promo", 0), "promo-01.jpg");
    assert.equal(frameKey("promo", 8), "promo-09.jpg");
    assert.equal(frameKey("promo", 11), "promo-12.jpg");
  });
});

describe("coverRect", () => {
  it("fills the target when the aspect ratios match", () => {
    assert.deepEqual(coverRect(1920, 1080, 1920, 1080), {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it("crops the top and bottom when the source is proportionally taller", () => {
    // 4:3 source into a wider 16:9 target: scaled to full width, sides intact,
    // and the extra height hangs off the top and bottom.
    const r = coverRect(1400, 1050, 1600, 900);
    assert.equal(r.width, 1600);
    assert.equal(r.x, 0);
    assert.equal(r.height, 1200);
    assert.equal(r.y, -150);
  });

  it("crops the sides when the source is proportionally narrower", () => {
    // 3:4 source into a 9:16 target: scaled to full height, and the extra
    // width hangs off both sides.
    const r = coverRect(1080, 1440, 1080, 1920);
    assert.equal(r.height, 1920);
    assert.equal(r.y, 0);
    assert.equal(r.width, 1440);
    assert.equal(r.x, -180);
  });

  it("always covers the whole target, never a gap", () => {
    for (const [sw, sh] of [[640, 480], [1920, 1080], [1080, 1920], [3000, 200]]) {
      for (const [dw, dh] of [[1280, 720], [1080, 1920], [720, 720]]) {
        const r = coverRect(sw, sh, dw, dh);
        assert.ok(r.width >= dw - 1e-9, `${sw}x${sh} -> ${dw}x${dh} leaves a gap`);
        assert.ok(r.height >= dh - 1e-9, `${sw}x${sh} -> ${dw}x${dh} leaves a gap`);
      }
    }
  });

  it("keeps the source aspect ratio", () => {
    const r = coverRect(1920, 1080, 1080, 1920);
    assert.ok(Math.abs(r.width / r.height - 1920 / 1080) < 1e-9);
  });

  it("degrades safely on a zero-sized input", () => {
    assert.deepEqual(coverRect(0, 0, 100, 50), {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });
});

describe("secondsPerFrame", () => {
  it("divides the runtime across the scenes", () => {
    assert.equal(secondsPerFrame(12, 6), 2);
  });

  it("never goes under the schema floor", () => {
    // A 2s clip split in two would be 1s each, which is legal.
    assert.equal(secondsPerFrame(2, 2), 1);
    // A 1s clip would be 0.5s each, which the scene schema rejects.
    assert.equal(secondsPerFrame(1, 2), 1);
  });

  it("falls back to the floor for an unreadable duration", () => {
    assert.equal(secondsPerFrame(0, 4), 1);
    assert.equal(secondsPerFrame(Number.NaN, 4), 1);
  });
});
