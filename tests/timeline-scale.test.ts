import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TIMELINE_ZOOM,
  TIMELINE_ZOOM_LEVELS,
  clipAtTime,
  cutMarkers,
  formatTimelineTime,
  isTimelineZoom,
  rulerStep,
  rulerTicks,
  timeForX,
  timelineScale,
  xForTime,
} from "../lib/timeline-scale.ts";

const scenes = (...durations: number[]) =>
  durations.map((duration, i) => ({ id: `s${i}`, duration }));

describe("timelineScale", () => {
  it("gives every clip a width proportional to its duration", () => {
    const scale = timelineScale(scenes(2, 4), 24);
    // The whole point of the linear scale: a clip twice as long is twice as
    // wide, so a ruler measured in seconds lines up with the cards.
    assert.equal(scale.clips[0]!.width, 48);
    assert.equal(scale.clips[1]!.width, 96);
    assert.equal(scale.clips[1]!.width / scale.clips[0]!.width, 2);
  });

  it("does not floor a short clip, which is what made a ruler impossible", () => {
    // A 1s scene in a 40s timeline: the old strip floored the card at 72px, so
    // the card was 30x too wide and no tick could land on its edge.
    const scale = timelineScale(scenes(1, 39), 24);
    assert.equal(scale.clips[0]!.width, 24);
    assert.ok(scale.clips[0]!.width < 72, "the short clip stays proportional");
  });

  it("stacks the clips end to end with one gap between them", () => {
    const scale = timelineScale(scenes(2, 2, 2), 24, 2);
    assert.equal(scale.clips[0]!.x, 0);
    assert.equal(scale.clips[1]!.x, 50);
    assert.equal(scale.clips[2]!.x, 100);
    // No trailing gap counted as content.
    assert.equal(scale.width, 148);
    assert.equal(scale.total, 6);
  });

  it("keeps the times of each clip consistent with its width", () => {
    const scale = timelineScale(scenes(1.5, 2.5, 3), 20);
    assert.equal(scale.clips[1]!.start, 1.5);
    assert.equal(scale.clips[2]!.start, 4);
    assert.equal(scale.clips[2]!.end, 7);
    assert.equal(scale.total, 7);
  });

  it("treats a bad duration as zero rather than a negative card", () => {
    const scale = timelineScale(
      [{ id: "a", duration: Number.NaN }, { id: "b", duration: -4 }, { id: "c", duration: 2 }],
      24,
    );
    assert.deepEqual(
      scale.clips.map((c) => c.width),
      [0, 0, 48],
    );
    assert.equal(scale.total, 2);
  });

  it("copes with an empty timeline", () => {
    const scale = timelineScale([], 24);
    assert.deepEqual(scale.clips, []);
    assert.equal(scale.width, 0);
    assert.equal(scale.total, 0);
  });

  it("falls back to a usable rate when asked for a negative one", () => {
    const scale = timelineScale(scenes(1), -10);
    assert.equal(scale.pxPerSecond, DEFAULT_TIMELINE_ZOOM);
    assert.equal(scale.clips[0]!.width, DEFAULT_TIMELINE_ZOOM);
  });
});

describe("xForTime and timeForX", () => {
  it("round trips a time through the strip within half a pixel", () => {
    const scale = timelineScale(scenes(3, 5), 24);
    for (const t of [0, 0.5, 1, 2.75, 4, 7.9, 8]) {
      const back = timeForX(scale, xForTime(scale, t));
      assert.ok(Math.abs(back - t) <= 0.5 / 24, `t=${t} came back ${back}`);
    }
  });

  it("round trips a pixel through the strip within one pixel", () => {
    const scale = timelineScale(scenes(3, 5), 24);
    for (const x of [0, 10, 47, 50, 79, 190, 191]) {
      const back = xForTime(scale, timeForX(scale, x));
      assert.ok(Math.abs(back - x) <= 1, `x=${x} came back ${back}`);
    }
  });

  it("lands on the exact pixel where a clip begins", () => {
    const scale = timelineScale(scenes(2, 3, 1), 25);
    // Each boundary has to be a whole pixel, or the needle jitters across two
    // columns on every frame of playback.
    for (const clip of scale.clips) {
      assert.equal(xForTime(scale, clip.start), clip.x, `clip ${clip.index}`);
      assert.equal(Number.isInteger(clip.x), true);
    }
  });

  it("resolves a seam between two clips to the boundary", () => {
    const scale = timelineScale(scenes(2, 3), 24, 4);
    // The seam is the 4px gap at the end of the first card.
    const rightEdge = scale.clips[0]!.x + scale.clips[0]!.width;
    for (const x of [rightEdge, rightEdge + 1, rightEdge + 3]) {
      assert.equal(timeForX(scale, x), 2, `x=${x} in the seam`);
    }
  });

  it("clamps a time outside the timeline to the strip's ends", () => {
    const scale = timelineScale(scenes(4), 24);
    assert.equal(xForTime(scale, -10), 0);
    assert.equal(xForTime(scale, 99), 96);
    assert.equal(timeForX(scale, -50), 0);
    assert.equal(timeForX(scale, 9999), 4);
  });
});

describe("clipAtTime", () => {
  const scale = timelineScale(scenes(2, 3), 24);

  it("finds the clip holding a time", () => {
    assert.equal(clipAtTime(scale, 0)?.id, "s0");
    assert.equal(clipAtTime(scale, 1.99)?.id, "s0");
    // The boundary belongs to the clip that starts there, matching playback.
    assert.equal(clipAtTime(scale, 2)?.id, "s1");
    assert.equal(clipAtTime(scale, 4.99)?.id, "s1");
  });

  it("returns null outside the timeline", () => {
    assert.equal(clipAtTime(scale, -1), null);
    assert.equal(clipAtTime(scale, 5), null);
    assert.equal(clipAtTime(timelineScale([], 24), 0), null);
  });
});

describe("cutMarkers", () => {
  it("marks every boundary but not the start of the video", () => {
    const scale = timelineScale(scenes(2, 3, 4), 24);
    const marks = cutMarkers(scale);
    assert.deepEqual(
      marks.map((m) => m.t),
      [2, 5],
    );
    assert.deepEqual(
      marks.map((m) => m.id),
      ["s1", "s2"],
    );
    // The mark sits exactly on the card's left edge.
    for (const mark of marks) {
      assert.equal(mark.x, scale.clips[mark.index]!.x);
    }
  });

  it("skips no boundary: every internal cut point is marked", () => {
    // splitScene applies its own minimum later; a marker only asks "where is a
    // boundary", and one that cannot be cut is still a cut that exists.
    const scale = timelineScale(scenes(0.2, 0.2, 4), 24);
    const marks = cutMarkers(scale);
    assert.deepEqual(
      marks.map((m) => m.t),
      [0.2, 0.4],
    );
  });

  it("has no marks for a single clip", () => {
    assert.deepEqual(cutMarkers(timelineScale(scenes(5), 24)), []);
  });
});

describe("rulerTicks", () => {
  it("always marks the start of every clip as a labelled tick", () => {
    const scale = timelineScale(scenes(1.3, 2.7, 1), 24);
    const starts = scale.clips.map((c) => c.start);
    for (const start of starts) {
      const tick = rulerTicks(scale).find((t) => Math.abs(t.t - start) < 1e-9);
      assert.ok(tick, `no tick at ${start}`);
      assert.equal(tick.major, true, `tick at ${start} is not major`);
      assert.equal(tick.x, xForTime(scale, start));
    }
  });

  it("labels the ticks with m:ss", () => {
    const scale = timelineScale(scenes(60), 24);
    const labels = rulerTicks(scale).map((t) => t.label);
    assert.ok(labels.includes("0:00"), labels.join(","));
    assert.ok(labels.includes("1:00"), labels.join(","));
  });

  it("picks a step that gives a readable number of labels", () => {
    // Each of these lands the tick count nearest to the 8-label target:
    // 10s@step2 -> 6 labels, 60s@step10 -> 7, 300s@step60 -> 6, 8s@step1 -> 9.
    assert.equal(rulerStep(10, 8), 2);
    assert.equal(rulerStep(60, 8), 10);
    assert.equal(rulerStep(300, 8), 60);
    assert.equal(rulerStep(8, 8), 1);
  });

  it("never prints two labels on top of each other", () => {
    // 40 one-second clips at the narrowest zoom is the worst case for labels.
    const scale = timelineScale(scenes(...Array(40).fill(1)), 12);
    const labels = rulerTicks(scale, { minLabelGapPx: 34 }).filter(
      (t) => t.label !== null,
    );
    for (let i = 1; i < labels.length; i++) {
      assert.ok(
        labels[i]!.x - labels[i - 1]!.x >= 34,
        `${labels[i - 1]!.label} and ${labels[i]!.label} are ${labels[i]!.x - labels[i - 1]!.x}px apart`,
      );
    }
  });

  it("keeps the clip boundaries even when they crowd the labels", () => {
    const scale = timelineScale(scenes(0.6, 0.6, 0.6, 8), 12);
    const ticks = rulerTicks(scale, { minLabelGapPx: 40 });
    const starts = new Set(scale.clips.map((c) => Math.round(c.start * 1000) / 1000));
    // Every clip start within the kept set is a labelled major tick; crowding
    // is resolved by dropping the plain step ticks, never a boundary.
    for (const tick of ticks) {
      if (starts.has(tick.t)) assert.equal(tick.major, true, `${tick.t} lost its major mark`);
    }
  });

  it("returns one tick for a timeline with no length", () => {
    const ticks = rulerTicks(timelineScale([], 24));
    assert.equal(ticks.length, 1);
    assert.equal(ticks[0]!.t, 0);
  });
});

describe("formatTimelineTime", () => {
  it("matches the m:ss the transport and the cards show", () => {
    assert.equal(formatTimelineTime(0), "0:00");
    assert.equal(formatTimelineTime(9.9), "0:09");
    assert.equal(formatTimelineTime(60), "1:00");
    assert.equal(formatTimelineTime(605), "10:05");
    // A negative time is a drag past the left edge, not a crash.
    assert.equal(formatTimelineTime(-4), "0:00");
  });
});

describe("zoom", () => {
  it("offers ascending steps with a default in the middle", () => {
    const levels = [...TIMELINE_ZOOM_LEVELS];
    assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
    assert.ok(TIMELINE_ZOOM_LEVELS.includes(DEFAULT_TIMELINE_ZOOM));
    assert.notEqual(TIMELINE_ZOOM_LEVELS[0], DEFAULT_TIMELINE_ZOOM);
  });

  it("recognises its own steps and nothing else", () => {
    for (const level of TIMELINE_ZOOM_LEVELS) assert.equal(isTimelineZoom(level), true);
    assert.equal(isTimelineZoom(33), false);
    assert.equal(isTimelineZoom(0), false);
  });

  it("widens the whole strip when zoomed in", () => {
    const clips = scenes(2, 2, 2);
    const narrow = timelineScale(clips, TIMELINE_ZOOM_LEVELS[0]!);
    const wide = timelineScale(clips, TIMELINE_ZOOM_LEVELS.at(-1)!);
    assert.ok(wide.width > narrow.width, `${wide.width} vs ${narrow.width}`);
    assert.equal(wide.clips[0]!.width / narrow.clips[0]!.width, 96 / 12);
  });
});
