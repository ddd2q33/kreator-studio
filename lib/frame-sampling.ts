/**
 * Frame sampling for "drop a video on a card, get scenes".
 *
 * Deciding *which* moments to grab is the only part of this feature worth
 * testing on its own: the browser side needs a <video>, a canvas and real time
 * to pass, so it stays out of the unit tests.
 */

/** Roughly one still per this many seconds of footage. */
export const SECONDS_PER_FRAME = 2;

/** A sub-second clip still gets two scenes; a feature film does not get 3000. */
export const MIN_FRAMES = 2;
export const MAX_FRAMES = 12;

export function frameCountForDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return MIN_FRAMES;
  }
  const raw = Math.round(durationSeconds / SECONDS_PER_FRAME);
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, raw));
}

/**
 * Evenly spaced timestamps, taken at the middle of each segment rather than on
 * the boundaries: t=0 and t=duration are usually black or mid-fade, and a
 * segment midpoint is the most representative still of that stretch.
 */
export function frameTimestamps(
  durationSeconds: number,
  count: number,
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const n = Math.max(1, Math.floor(count));
  const step = durationSeconds / n;
  return Array.from({ length: n }, (_, i) => round3((i + 0.5) * step));
}

/** `promo-01.jpg`, `promo-02.jpg`, … so the pool sorts in capture order. */
export function frameKey(base: string, index: number): string {
  return `${base}-${String(index + 1).padStart(2, "0")}.jpg`;
}

/**
 * Seconds per scene, never below the 1s floor the scene schema enforces, so a
 * two-second clip still produces legal scenes.
 */
export function secondsPerFrame(
  durationSeconds: number,
  count: number,
  floor = 1,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return floor;
  const n = Math.max(1, Math.floor(count));
  return Math.max(floor, round3(durationSeconds / n));
}

/**
 * Source rectangle that fills a `dw`×`dh` target without distorting the frame:
 * scale by the larger of the two ratios and let the overflow hang off the edges.
 */
export function coverRect(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): { x: number; y: number; width: number; height: number } {
  if (!(sw > 0) || !(sh > 0) || !(dw > 0) || !(dh > 0)) {
    return { x: 0, y: 0, width: Math.max(0, dw), height: Math.max(0, dh) };
  }
  const scale = Math.max(dw / sw, dh / sh);
  const width = sw * scale;
  const height = sh * scale;
  return { x: (dw - width) / 2, y: (dh - height) / 2, width, height };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
