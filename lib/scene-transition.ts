/**
 * How long the change from one scene to the next lasts.
 *
 * The schema has always had a `transition` on every scene, and "fade" has
 * always been the default, but nothing ever blended two scenes: the renderer
 * drew one scene and the next frame drew the next one. So every scene asked for
 * a fade and got a hard cut. This module is the missing half — it answers
 * "given this timeline and this instant, is a blend happening, and how far
 * through it are we".
 *
 * The duration is computed rather than fixed, because a constant is wrong at
 * both ends of the range. Half a second is most of a one-second scene, which
 * reads as a mistake, while on a fifteen-second scene it is a blink that reads
 * as a mistake in the other direction. Scaling to the scene and clamping keeps
 * the transition a consistent fraction of what it sits between.
 *
 * The window straddles the cut rather than following it, so neither scene gets
 * its head or its tail eaten: the outgoing scene is still visible half a
 * transition after its own end, and the incoming one is already half in before
 * its own start. That is the classic cross dissolve, and it is why a fade
 * between two unrelated images still reads as one continuous move.
 *
 * Pure and synchronous so the whole rule is unit testable without a canvas.
 */

import type { VideoScene } from "./scene-schema";

/** Shortest crossfade, so a fast montage does not turn into a strobe. */
export const TRANSITION_MIN_SECONDS = 0.2;

/**
 * Longest crossfade.
 *
 * Past this the two images sit on top of each other long enough to look like a
 * mistake rather than a transition, especially when the outgoing text is still
 * readable underneath the incoming text.
 */
export const TRANSITION_MAX_SECONDS = 0.6;

/**
 * Fraction of the shorter neighbouring scene the transition is allowed to take.
 *
 * On the shorter scene, because that is the one a transition can overrun. A
 * quarter is enough to read as a dissolve without eating the scene.
 */
export const TRANSITION_FRACTION = 0.25;

/** Absolute start time of a scene, in seconds from the start of the timeline. */
export function sceneStart(scenes: readonly VideoScene[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < scenes.length; i++) {
    acc += Math.max(0, scenes[i]!.duration);
  }
  return acc;
}

/** Total length of the timeline in seconds. */
export function totalDuration(scenes: readonly VideoScene[]): number {
  return scenes.reduce((acc, s) => acc + Math.max(0, s.duration), 0);
}

/**
 * Length of the crossfade into the scene at `index`, in seconds.
 *
 * Zero means there is no blend at that boundary: the first scene has nothing to
 * come from, a "cut" scene asks for a hard cut, and a scene with no duration
 * cannot host a transition. "zoom" and "pan" also return zero, because those
 * describe motion inside a scene and the cut into it was always hard.
 *
 * The result is additionally capped at the length of both scenes, which is what
 * keeps the window from reaching outside the timeline on very short scenes.
 */
export function transitionSeconds(scenes: readonly VideoScene[], index: number): number {
  if (index < 1 || index >= scenes.length) return 0;
  const incoming = scenes[index]!;
  const outgoing = scenes[index - 1]!;
  if (incoming.transition !== "fade") return 0;

  const shorter = Math.min(
    Math.max(0, outgoing.duration),
    Math.max(0, incoming.duration),
  );
  if (!(shorter > 0)) return 0;

  const scaled = shorter * TRANSITION_FRACTION;
  const clamped = Math.min(
    TRANSITION_MAX_SECONDS,
    Math.max(TRANSITION_MIN_SECONDS, scaled),
  );
  return Math.min(clamped, shorter);
}

export type Crossfade = {
  /** Scene being blended out. */
  fromIndex: number;
  /** Scene being blended in. */
  toIndex: number;
  /**
   * 0 shows the outgoing scene alone, 1 the incoming scene alone, 0.5 the
   * moment of the cut itself.
   */
  mix: number;
};

/**
 * The blend covering `time`, or null when this instant is a plain frame.
 *
 * Returning null for the common case is deliberate: a timeline with no fades
 * must keep costing exactly one paint per frame, and a caller that had to
 * composite two buffers to learn there was nothing to composite would throw
 * that away.
 */
export function crossfadeAt(
  scenes: readonly VideoScene[],
  time: number,
): Crossfade | null {
  if (scenes.length < 2) return null;

  // Only the boundary that can contain this instant is a candidate, so this is
  // a scan of at most one window rather than one per scene.
  for (let i = 1; i < scenes.length; i++) {
    const length = transitionSeconds(scenes, i);
    if (!(length > 0)) continue;
    const boundary = sceneStart(scenes, i);
    const half = length / 2;
    const from = boundary - half;
    if (time < from || time > from + length) continue;
    return {
      fromIndex: i - 1,
      toIndex: i,
      mix: Math.max(0, Math.min(1, (time - from) / length)),
    };
  }
  return null;
}

/**
 * The time to render a scene at for a given moment of the timeline.
 *
 * The outgoing scene is sampled after its own end and the incoming one before
 * its own start, which is what makes the window straddle the cut. Both are
 * clamped into their own scene so a blend that overhangs a very short scene
 * holds on its first or last frame instead of wrapping around.
 */
export function timeForScene(
  scenes: readonly VideoScene[],
  index: number,
  time: number,
): number {
  const start = sceneStart(scenes, index);
  const duration = Math.max(0, scenes[index]?.duration ?? 0);
  return start + Math.max(0, Math.min(duration, time - start));
}
