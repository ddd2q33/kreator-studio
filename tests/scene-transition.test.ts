import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TRANSITION_MAX_SECONDS,
  TRANSITION_MIN_SECONDS,
  crossfadeAt,
  sceneStart,
  timeForScene,
  totalDuration,
  transitionSeconds,
} from "../lib/scene-transition.ts";
import {
  DURATION_MAX,
  DURATION_MIN,
  normalizeScenes,
  type Transition,
  type VideoScene,
} from "../lib/scene-schema.ts";

/**
 * A scene with only the fields the transition rules read.
 *
 * Built raw rather than through `normalizeScenes` on purpose: the normalizer
 * clamps every duration into [DURATION_MIN, DURATION_MAX], so a scene shorter
 * than a second cannot be produced by the editor at all. The defensive branches
 * for those values still have to be tested, and the clamp that makes them
 * unreachable is checked separately below.
 */
function scene(
  duration: number,
  transition: Transition = "fade",
): VideoScene {
  return {
    id: `s${Math.random().toString(36).slice(2)}`,
    chapterId: null,
    group: null,
    kicker: "",
    title: "S",
    subtitle: "",
    narration: "",
    notes: "",
    imageKey: null,
    imageFit: "cover",
    duration,
    transition,
    audio: null,
    volume: 1,
    muted: false,
    code: null,
    terminal: null,
  };
}

const timeline = (...durations: number[]): VideoScene[] =>
  durations.map((d) => scene(d));

describe("scene timing", () => {
  it("reports where each scene starts on the timeline", () => {
    const scenes = timeline(2, 3, 4);
    assert.equal(sceneStart(scenes, 0), 0);
    assert.equal(sceneStart(scenes, 1), 2);
    assert.equal(sceneStart(scenes, 2), 5);
  });

  it("totals the timeline", () => {
    assert.equal(totalDuration(timeline(2, 3, 4)), 9);
    assert.equal(totalDuration([]), 0);
  });

  it("ignores a negative duration instead of running the clock backwards", () => {
    assert.equal(totalDuration(timeline(2, -5, 3)), 5);
  });
});

describe("transitionSeconds", () => {
  it("takes a quarter of the shorter of the two scenes", () => {
    // 25% of 4s is 1s, which is over the cap, so this lands on the cap.
    assert.equal(transitionSeconds(timeline(4, 10), 1), TRANSITION_MAX_SECONDS);
    // 25% of 1.6s is 0.4s, comfortably inside the range.
    assert.equal(transitionSeconds(timeline(1.6, 10), 1), 0.4);
  });

  it("scales to the shorter scene, not the longer one", () => {
    // The outgoing scene is 12s and the incoming one 1.6s. A transition sized
    // off the long one would swallow the short one whole.
    assert.equal(transitionSeconds(timeline(12, 1.6), 1), 0.4);
  });

  it("never drops below the floor on a very short scene", () => {
    // 25% of 0.4s is 0.1s, under the 0.2s floor.
    assert.equal(transitionSeconds(timeline(0.4, 5), 1), TRANSITION_MIN_SECONDS);
  });

  it("never rises above the ceiling on a long scene", () => {
    assert.equal(transitionSeconds(timeline(60, 60), 1), TRANSITION_MAX_SECONDS);
  });

  it("does not outlast the scene it sits between", () => {
    // The floor of 0.2s is longer than a 0.1s scene, so the scene wins.
    assert.equal(transitionSeconds(timeline(0.1, 5), 1), 0.1);
    assert.equal(transitionSeconds(timeline(5, 0.1), 1), 0.1);
  });

  it("has no transition into the first scene", () => {
    assert.equal(transitionSeconds(timeline(5, 5), 0), 0);
  });

  it("has no transition past the last scene", () => {
    assert.equal(transitionSeconds(timeline(5, 5), 2), 0);
  });

  it("gives a hard cut when the incoming scene asks for one", () => {
    assert.equal(transitionSeconds([scene(5), scene(5, "cut")], 1), 0);
  });

  it("gives a hard cut into a zoom or pan scene", () => {
    // Those two describe motion inside the scene, not a blend at its edge.
    assert.equal(transitionSeconds([scene(5), scene(5, "zoom")], 1), 0);
    assert.equal(transitionSeconds([scene(5), scene(5, "pan")], 1), 0);
  });

  it("gives no transition when a scene has no duration", () => {
    assert.equal(transitionSeconds(timeline(5, 0), 1), 0);
  });

  it("ignores a negative duration rather than returning a negative length", () => {
    assert.equal(transitionSeconds(timeline(5, -2), 1), 0);
  });

  it("behaves sensibly across the range the editor can actually produce", () => {
    // The normalizer pins every scene to [DURATION_MIN, DURATION_MAX], so this
    // is the whole set of values a real timeline can hand the formula. A quarter
    // of the shortest allowed scene is 0.25s and a quarter of the longest is 5s,
    // so in practice the floor never binds and the ceiling always does above
    // 2.4s — which is why the cap, not the fraction, is what a viewer sees.
    const { scenes } = normalizeScenes([
      { title: "a", duration: DURATION_MIN },
      { title: "b", duration: DURATION_MIN },
    ]);
    const shortest = transitionSeconds(scenes, 1);
    assert.ok(
      shortest >= TRANSITION_MIN_SECONDS && shortest <= 0.25,
      `shortest allowed scene produced ${shortest}s`,
    );

    const { scenes: long } = normalizeScenes([
      { title: "a", duration: DURATION_MAX },
      { title: "b", duration: DURATION_MAX },
    ]);
    assert.equal(transitionSeconds(long, 1), TRANSITION_MAX_SECONDS);
  });
});

describe("crossfadeAt", () => {
  it("reports no blend for a single scene", () => {
    assert.equal(crossfadeAt(timeline(5), 2.5), null);
  });

  it("reports no blend for an empty timeline", () => {
    assert.equal(crossfadeAt([], 0), null);
  });

  it("straddles the cut rather than following it", () => {
    const scenes = timeline(4, 4);
    const length = transitionSeconds(scenes, 1);
    const boundary = sceneStart(scenes, 1);

    // A quarter of the way in there is still mostly the outgoing scene.
    const early = crossfadeAt(scenes, boundary - length / 2 + length * 0.25)!;
    assert.equal(early.fromIndex, 0);
    assert.equal(early.toIndex, 1);
    assert.ok(early.mix < 0.5, `expected a mix before the cut, got ${early.mix}`);

    // The cut itself is the halfway point of the dissolve.
    const atCut = crossfadeAt(scenes, boundary)!;
    assert.ok(Math.abs(atCut.mix - 0.5) < 1e-9, `got ${atCut.mix}`);

    const late = crossfadeAt(scenes, boundary - length / 2 + length * 0.75)!;
    assert.ok(late.mix > 0.5, `expected a mix after the cut, got ${late.mix}`);
  });

  it("runs from a pure outgoing frame to a pure incoming one", () => {
    const scenes = timeline(4, 4);
    const length = transitionSeconds(scenes, 1);
    const start = sceneStart(scenes, 1) - length / 2;
    // The start is exact; the end is not, because `start + length` is a float
    // and subtracting `start` back off it does not recover `length` exactly.
    // The value stays inside [0, 1] either way, so the composite is a full
    // incoming frame rather than a sliver of the outgoing one.
    assert.equal(crossfadeAt(scenes, start)!.mix, 0);
    assert.ok(
      Math.abs(crossfadeAt(scenes, start + length)!.mix - 1) < 1e-9,
      "the last instant of the window must be fully the incoming scene",
    );
  });

  it("returns null outside the window", () => {
    const scenes = timeline(4, 4);
    const length = transitionSeconds(scenes, 1);
    const start = sceneStart(scenes, 1) - length / 2;
    // Strictly outside on both sides: the endpoints belong to the blend.
    assert.equal(crossfadeAt(scenes, start - 0.01), null);
    assert.equal(crossfadeAt(scenes, start + length + 0.01), null);
  });

  it("blends only a short window at each cut, not the whole scene", () => {
    // The point of scaling to the scene is that the dissolve stays a moment and
    // not a state: on 3s scenes it covers 0.6s, and the rest of every scene is
    // a single clean frame.
    const scenes = timeline(3, 3, 3);
    const length = transitionSeconds(scenes, 1);
    assert.equal(length, TRANSITION_MAX_SECONDS);

    let blended = 0;
    let total = 0;
    for (let t = 0; t < 9; t += 0.01) {
      total++;
      if (crossfadeAt(scenes, t) !== null) blended++;
    }
    const ratio = blended / total;
    // Two windows of 0.6s each, measured at 0.01s resolution.
    assert.ok(
      ratio > 0.12 && ratio < 0.15,
      `expected roughly 13% of the timeline to blend, got ${(ratio * 100).toFixed(1)}%`,
    );
  });

  it("blends a fade boundary and skips a cut boundary", () => {
    const scenes = [scene(3), scene(3, "cut"), scene(3)];
    // The cut into scene 2 is hard…
    assert.equal(crossfadeAt(scenes, 3), null);
    // …while the fade into scene 3 blends.
    assert.ok(crossfadeAt(scenes, 6) !== null);
    // And a cut anywhere does not disable the other boundaries.
    assert.ok(crossfadeAt(scenes, 3.2) === null, "no window should open at a cut");
    assert.ok(crossfadeAt(scenes, 5.8) !== null, "the next window should still open");
  });

  it("never blends past the end of the timeline", () => {
    const scenes = timeline(4, 4);
    const end = totalDuration(scenes);
    const length = transitionSeconds(scenes, 1);
    const windowEnd = sceneStart(scenes, 1) + length / 2;
    assert.ok(windowEnd < end, "the last window must close before the end");
    assert.equal(crossfadeAt(scenes, end), null);
    assert.equal(crossfadeAt(scenes, end + 5), null);
  });

  it("never reaches before the start of the timeline", () => {
    // The first scene is far longer than the second, so without the cap the
    // window would open before the video does.
    const scenes = timeline(30, 0.1);
    const length = transitionSeconds(scenes, 1);
    const windowStart = sceneStart(scenes, 1) - length / 2;
    assert.ok(windowStart >= 0, `window opened at ${windowStart}`);
    assert.equal(crossfadeAt(scenes, 0), null);
  });
});

describe("timeForScene", () => {
  it("returns the moment itself for an instant inside the scene", () => {
    const scenes = timeline(4, 4);
    assert.equal(timeForScene(scenes, 1, 5), 5);
  });

  it("clamps to the first frame when sampled before the scene starts", () => {
    // The incoming scene is sampled before its own start, which is what makes
    // the dissolve straddle the cut.
    const scenes = timeline(4, 4);
    assert.equal(timeForScene(scenes, 1, 3.8), 4);
  });

  it("clamps to the last frame when sampled after the scene ends", () => {
    const scenes = timeline(4, 4);
    assert.equal(timeForScene(scenes, 0, 4.2), 4);
  });

  it("handles a zero-length scene without returning NaN", () => {
    const scenes = timeline(0);
    assert.equal(Number.isFinite(timeForScene(scenes, 0, 1)), true);
  });
});
