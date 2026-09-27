/**
 * Subtitle motion: the arithmetic behind kinetic typography.
 *
 * Pure functions on purpose. Everything here decides *where a word is and how
 * big it is* at one instant, so it can be tested without a canvas, and so the
 * same numbers drive the preview, the scrub and the export. An export that
 * animated differently from its own preview would be worse than useless.
 *
 * The central rule is that layout never moves. A word pops in by scaling around
 * its own settled box, never by advancing the pen, because a line that re-flows
 * while someone is reading it is the single most amateurish thing a caption can
 * do. Callers measure first, then draw each word with its own transform.
 */

/** How a word arrives. */
export type SubtitleEntrance =
  | "none"
  | "fade"
  | "pop"
  | "rise"
  | "bounce"
  | "kinetic"
  | "zoom"
  | "cinematic";

/** What the word being spoken does while it is active. */
export type KeywordMotion =
  | "none"
  | "pop"
  | "zoom"
  | "pulse"
  | "bounce"
  | "glow";

/**
 * Where the entrance is anchored in time.
 *
 * `line` entrances treat the cue as one object fading in together, which is the
 * only thing that works when the timings are estimated rather than measured: with
 * no per-word times there is nothing to stagger.
 */
export type EntranceScope = "line" | "word";

const WORD_SCOPED: ReadonlySet<SubtitleEntrance> = new Set([
  "pop",
  "rise",
  "bounce",
  "kinetic",
]);

export function entranceScope(preset: SubtitleEntrance): EntranceScope {
  return WORD_SCOPED.has(preset) ? "word" : "line";
}

/** A word's offset from where it settles. */
export type WordTransform = {
  /** 1 is settled. */
  scale: number;
  /** 0 is invisible. */
  alpha: number;
  /** Pixels, positive is below its resting place. */
  dy: number;
  dx: number;
};

export const IDENTITY: WordTransform = { scale: 1, alpha: 1, dy: 0, dx: 0 };

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The overshoot that makes a pop read as a pop rather than a fade. */
export function easeOutBack(p: number, overshoot = 1.7): number {
  const t = clamp01(p);
  const c = overshoot + 1;
  const u = t - 1;
  return 1 + c * u * u * u + overshoot * u * u;
}

export function easeOutCubic(p: number): number {
  const t = clamp01(p);
  return 1 - (1 - t) ** 3;
}

export function easeInOutCubic(p: number): number {
  const t = clamp01(p);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Slow start, very fast arrival. Reads as weight. */
export function easeOutExpo(p: number): number {
  const t = clamp01(p);
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
}

/**
 * One full hump: 0 at both ends, 1 in the middle.
 *
 * This is the shape every keyword pulse wants. A word that grows and then
 * shrinks once per syllable looks deliberate; one that grows and stays grown
 * looks like a mistake in the layout.
 */
export function hump(p: number): number {
  return Math.sin(clamp01(p) * Math.PI);
}

/**
 * The state of one word at one instant, relative to its resting position.
 *
 * `size` is the font size in px, because the travel of a word has to scale with
 * the type or a 24px caption and a 96px one would move the same distance and
 * read as completely different motion.
 */
export function wordEntrance(
  preset: SubtitleEntrance,
  p: number,
  size: number,
): WordTransform {
  const t = clamp01(p);
  switch (preset) {
    case "none":
      return IDENTITY;
    case "fade":
      return { scale: 1, alpha: t, dy: 0, dx: 0 };
    case "cinematic":
      // A long, quiet arrival: barely any travel, and most of the time spent
      // finishing. Anything faster stops reading as filmic and starts reading
      // as a transition.
      return { scale: 1 + 0.04 * (1 - t), alpha: easeOutCubic(t), dy: size * 0.06 * (1 - t), dx: 0 };
    case "zoom":
      return { scale: 1 + 0.28 * (1 - easeOutExpo(t)), alpha: clamp01(t * 2), dy: 0, dx: 0 };
    case "pop":
      return { scale: 0.55 + 0.45 * easeOutBack(t), alpha: clamp01(t * 3), dy: 0, dx: 0 };
    case "rise":
      return { scale: 0.94 + 0.06 * easeOutCubic(t), alpha: clamp01(t * 2.2), dy: size * 0.34 * (1 - easeOutCubic(t)), dx: 0 };
    case "bounce":
      return {
        scale: 0.88 + 0.12 * easeOutBack(t, 2.2),
        alpha: clamp01(t * 3),
        dy: size * 0.26 * (1 - easeOutBack(t, 2.2)),
        dx: 0,
      };
    case "kinetic":
      // A touch of scale, a touch of rise, and a faster alpha than the geometry
      // so the word is legible while it is still moving.
      return {
        scale: 0.72 + 0.28 * easeOutBack(t, 1.35),
        alpha: clamp01(t * 2.6),
        dy: size * 0.14 * (1 - easeOutBack(t, 1.35)),
        dx: 0,
      };
    default:
      return IDENTITY;
  }
}

/** What the word being spoken does over the length of its own audio. */
export function keywordMotion(
  preset: KeywordMotion,
  phase: number,
  size: number,
): WordTransform {
  const t = clamp01(phase);
  const h = hump(t);
  switch (preset) {
    case "none":
    case "glow":
      // "glow" is a paint effect, not a movement: the renderer widens the
      // shadow instead of moving the word, so the geometry stays put.
      return IDENTITY;
    case "pop":
      return { scale: 1 + 0.12 * h, alpha: 1, dy: 0, dx: 0 };
    case "zoom":
      return { scale: 1 + 0.2 * Math.sin(t * Math.PI) * 1.08, alpha: 1, dy: 0, dx: 0 };
    case "pulse":
      // One swell, not a full sine cycle. `sin(t * 2PI)` would cross back
      // through rest mid-word and read as a tremble; a single hump is the
      // quiet emphasis this preset is for.
      return { scale: 1 + 0.06 * h, alpha: 1, dy: 0, dx: 0 };
    case "bounce":
      return { scale: 1 + 0.04 * h, alpha: 1, dy: -size * 0.05 * h, dx: 0 };
    default:
      return IDENTITY;
  }
}

/** Multiplies two transforms so an entrance and a pulse can coexist. */
export function composeTransform(
  entrance: WordTransform,
  keyword: WordTransform,
): WordTransform {
  return {
    scale: entrance.scale * keyword.scale,
    alpha: clamp01(entrance.alpha * keyword.alpha),
    dy: entrance.dy + keyword.dy,
    dx: entrance.dx + keyword.dx,
  };
}

/** How long an entrance takes, before the style's speed multiplier. */
export const BASE_ENTRANCE_SECONDS = 0.2;

/** One instant in the life of a word. */
export type WordPhase = {
  /** 0 hidden, 1 fully arrived. */
  entranceP: number;
  /** 0 at the word's start, 1 at its end. */
  keywordP: number;
  /** False before the word is due, so the line builds rather than appearing. */
  visible: boolean;
};

/**
 * Where a word stands at time `t`, in seconds on the video's own clock.
 *
 * `entranceSeconds` is the style's tempo, and it is floored so a template asking
 * for a very fast animation still gets more than one frame at 30fps; a 0.05s
 * entrance sampled at 30fps would sometimes be skipped entirely and the word
 * would appear without ever being seen to arrive.
 */
export function wordPhaseAt(
  wordStart: number,
  wordEnd: number,
  t: number,
  entranceSeconds: number,
): WordPhase {
  const dur = Math.max(0.034, entranceSeconds);
  const entranceP = clamp01((t - wordStart) / dur);
  const span = Math.max(0.001, wordEnd - wordStart);
  const keywordP = clamp01((t - wordStart) / span);
  // Half a frame of slack: without it a word can be skipped by the sampler
  // landing just before its start and simply never drawn.
  const visible = t >= wordStart - dur * 0.5;
  return { entranceP, keywordP, visible };
}

/** The whole cue treated as one object, for line-scoped and untimed captions. */
export function cuePhaseAt(
  cueStart: number,
  t: number,
  entranceSeconds: number,
): WordPhase {
  const dur = Math.max(0.034, entranceSeconds);
  return {
    entranceP: clamp01((t - cueStart) / dur),
    keywordP: 1,
    visible: t >= cueStart - dur * 0.5,
  };
}
