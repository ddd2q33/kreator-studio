/**
 * Time-to-pixel geometry for the timeline strip.
 *
 * The strip shows one card per scene, and a ruler with a needle only means
 * anything if a tick at 0:07 sits exactly on the boundary between two cards.
 * That needs one shared mapping, so it lives here instead of inside the
 * component: the cards, the ruler ticks, the cut markers and the needle all
 * read these numbers, and `timeline-scale.test.ts` pins them without a DOM.
 *
 * The mapping is strictly linear. The old strip was not - it floored every card
 * at 72px - so a 1s scene in a 40s timeline was drawn 72x too wide and no ruler
 * could line up with it. A linear scale plus horizontal scrolling is honest;
 * a floor is a lie that only shows up once something has to be measured against
 * it. Very short scenes stay legible by hiding their text instead, which the
 * component does off `clip.width`.
 */

/** Gap between cards, in px. Matches the `gap-0.5` the strip renders. */
export const TIMELINE_GAP_PX = 2;

/** Narrowest a card may be drawn before the component drops its text. */
export const TIMELINE_NARROW_PX = 56;

/** Default pixels per second, before any zoom. */
export const DEFAULT_TIMELINE_PX_PER_SECOND = 24;

/** Zoom steps offered in the ruler, in pixels per second. */
export const TIMELINE_ZOOM_LEVELS = [12, 24, 48, 96] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOM_LEVELS)[number];

/** The zoom level the timeline loads with. */
export const DEFAULT_TIMELINE_ZOOM: TimelineZoom = 24;

export function isTimelineZoom(value: number): value is TimelineZoom {
  return (TIMELINE_ZOOM_LEVELS as readonly number[]).includes(value);
}

export type TimelineClip = {
  /** The scene's id, so a cut marker can name what it cuts. */
  id: string;
  /** Index in the timeline, 0-based. */
  index: number;
  /** Seconds from the start of the timeline. */
  start: number;
  /** `start` plus the scene's duration. */
  end: number;
  /** Left edge in px, measured from the left of the strip's content. */
  x: number;
  /** Width in px. Proportional to duration, so it can be very narrow. */
  width: number;
};

export type TimelineScale = {
  clips: TimelineClip[];
  /** Seconds covered by the whole strip. */
  total: number;
  /** The one number every position in the strip is derived from. */
  pxPerSecond: number;
  /** Width of all cards and the gaps between them, in px. */
  width: number;
  gap: number;
};

export type TimelineScene = { id: string; duration: number };

/**
 * Lays the strip out on a linear scale.
 *
 * Durations that are not finite or not positive are treated as zero so a bad
 * scene cannot produce a card of negative width or a needle that runs
 * backwards; the normalizer is what repairs them for real.
 */
export function timelineScale(
  scenes: readonly TimelineScene[],
  pxPerSecond: number = DEFAULT_TIMELINE_ZOOM,
  gap: number = TIMELINE_GAP_PX,
): TimelineScale {
  const rate = pxPerSecond > 0 ? pxPerSecond : DEFAULT_TIMELINE_PX_PER_SECOND;
  const clips: TimelineClip[] = [];
  let time = 0;
  let x = 0;
  scenes.forEach((scene, index) => {
    const duration =
      Number.isFinite(scene.duration) && scene.duration > 0 ? scene.duration : 0;
    const width = duration * rate;
    clips.push({ id: scene.id, index, start: time, end: time + duration, x, width });
    time += duration;
    x += width + gap;
  });
  // No trailing gap: the strip's width is where the last card ends.
  const width = clips.length > 0 ? x - gap : 0;
  return { clips, total: time, pxPerSecond: rate, width: Math.max(0, width), gap };
}

/**
 * Where a time in seconds sits on the strip, in px.
 *
 * The cards are laid out as `x + width + gap` per clip, so a plain
 * `t * rate` is wrong: the boundary after the first card is one gap further
 * right than `duration * rate` would put it, and a needle computed that way
 * floats off every cut point. The position comes from the clip's own x instead.
 *
 * Rounds, because a needle between two 1px columns would otherwise flicker
 * between them on every frame of playback.
 */
export function xForTime(scale: TimelineScale, t: number): number {
  if (scale.clips.length === 0) return 0;
  const clamped = Math.min(Math.max(0, t), scale.total);
  const clip = scale.clips.find((c) => clamped >= c.start && clamped < c.end);
  if (clip) {
    const rate = scale.pxPerSecond;
    return Math.round(clip.x + (clamped - clip.start) * rate);
  }
  // `clamped === total`, which no clip owns; the strip ends at the last card.
  const last = scale.clips.at(-1)!;
  return Math.round(last.x + last.width);
}

/**
 * The inverse of `xForTime`, for dragging the needle.
 *
 * A click lands in the 2px seam between two cards every so often; that is the
 * boundary of two clips and there is no meaningful time inside a seam, so it
 * resolves to the time of the clip that starts there.
 */
export function timeForX(scale: TimelineScale, x: number): number {
  if (scale.clips.length === 0 || scale.pxPerSecond <= 0) return 0;
  const clamped = Math.min(scale.width, Math.max(0, x));
  const clip = scale.clips.find(
    (c) => clamped >= c.x && clamped < c.x + c.width,
  );
  if (clip) {
    return clip.start + (clamped - clip.x) / scale.pxPerSecond;
  }
  // In a seam (or past the last card): the next clip starts at the boundary the
  // seam sits on.
  const next = scale.clips.find((c) => clamped < c.x);
  return next ? next.start : scale.total;
}

/** The clip holding a time, or null past the end of the timeline. */
export function clipAtTime(
  scale: TimelineScale,
  t: number,
): TimelineClip | null {
  if (scale.clips.length === 0) return null;
  if (t < 0 || t >= scale.total) return null;
  return scale.clips.find((c) => t >= c.start && t < c.end) ?? null;
}

export type RulerTick = {
  /** Seconds from the start of the timeline. */
  t: number;
  /** Px from the left of the strip, matching `xForTime`. */
  x: number;
  /** Clip boundaries: get a full-height line and are never dropped. */
  major: boolean;
  /** Preformatted m:ss, or null when this tick has no room for text. */
  label: string | null;
};

/** The same `m:ss` the transport and the cards already use. */
export function formatTimelineTime(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Nice step sizes, ascending. One of these is always close enough. */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300] as const;

/**
 * Picks the step that lands closest to `target` ticks.
 *
 * A fixed step is wrong at both ends: 0.5s on a five-minute timeline is six
 * hundred labels, and 5 minutes on a ten-second timeline is two. So the step is
 * chosen from the ladder by how many ticks it would produce.
 */
export function rulerStep(total: number, target = 8): number {
  if (!(total > 0)) return STEPS[0];
  let best: number = STEPS[0];
  let bestDistance = Infinity;
  for (const step of STEPS) {
    if (step > total) break;
    const count = Math.floor(total / step) + 1;
    const distance = Math.abs(count - target);
    // Ties go to the smaller step, which is the one that shows more detail.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = step;
    }
  }
  return best;
}

export type CutMarker = {
  /** Seconds from the start of the timeline: where the cut falls. */
  t: number;
  x: number;
  /** The clip that starts here, so a click can select what it cuts into. */
  id: string;
  index: number;
};

/**
 * Where the timeline is cut: one mark per scene boundary.
 *
 * The first clip has no marker of its own - a cut at 0:00 is the start of the
 * video, not an edit.
 */
export function cutMarkers(scale: TimelineScale): CutMarker[] {
  const marks: CutMarker[] = [];
  scale.clips.forEach((clip) => {
    if (clip.index === 0) return;
    marks.push({ t: clip.start, x: xForTime(scale, clip.start), id: clip.id, index: clip.index });
  });
  return marks;
}

/**
 * Ticks for the ruler.
 *
 * Boundaries between clips are always major: they are the times the author
 * actually cuts at, and a ruler that left them as hairlines would be measuring
 * the wrong thing. Everything else is added only where it clears the previous
 * label, so a narrow strip never prints two numbers on top of each other.
 */
export function rulerTicks(
  scale: TimelineScale,
  options: { minLabelGapPx?: number; target?: number } = {},
): RulerTick[] {
  const { minLabelGapPx = 34, target = 8 } = options;
  const step = rulerStep(scale.total, target);

  // Every interval start is its own candidate; a Map dedupes a boundary that a
  // step also lands on, keeping the boundary's major status.
  const byTime = new Map<number, { t: number; x: number; major: boolean }>();
  for (const clip of scale.clips) {
    byTime.set(clip.start, {
      t: clip.start,
      x: xForTime(scale, clip.start),
      major: true,
    });
  }
  for (let t = 0; t <= scale.total + 1e-9; t += step) {
    const seconds = Math.round(t * 1000) / 1000;
    if (byTime.has(seconds)) continue;
    byTime.set(seconds, { t: seconds, x: xForTime(scale, seconds), major: false });
  }

  const all = [...byTime.values()].sort((a, b) => a.x - b.x);

  // Geometry first: every line survives, majors always. Text second: a label is
  // dropped when it would crowd the one before it, so a narrow strip never
  // prints two numbers on top of each other.
  const kept: RulerTick[] = [];
  for (const tick of all) {
    if (kept.length > 0) {
      const previous = kept[kept.length - 1];
      const crowded = tick.x - previous.x < minLabelGapPx;
      if (crowded && !tick.major) continue;
    }
    kept.push({ ...tick, label: formatTimelineTime(tick.t) });
  }
  // Text pass: a minor tick may sit on a major tick's shoulder after a major
  // on its left was dropped-adjacent — actually no: majors are never dropped,
  // so the only crowding possible is minor-after-minor, already handled above.
  // Still, a label pinned to a boundary on the far right of a clip 0.1s long
  // can crowd the next boundary; drop those labels only, keeping the lines.
  let previousLabelX = -Infinity;
  for (const tick of kept) {
    if (tick.x - previousLabelX < minLabelGapPx) {
      tick.label = null;
    } else {
      previousLabelX = tick.x;
    }
  }
  return kept;
}
