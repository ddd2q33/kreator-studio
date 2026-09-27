/**
 * Turning a decoded voice-over into word-level timings, without a network call.
 *
 * The subtitle layer used to guess *when* each word was said from a fixed words
 * per second rate spread over the scene length. Now that every scene can carry
 * its own audio, the real signal is available, and the only thing worth measuring
 * from it is *where the voice is talking and where it pauses*. This module does
 * exactly that:
 *
 *   1. per-frame energy, to see where sound is at all
 *   2. speech regions, by comparing that energy against its own noise floor
 *   3. the words, spread across those regions in proportion to their syllables
 *
 * Step 3 spreads text over regions; it does not transcribe. So the narration
 * field is assumed to be the script that was actually recorded. When it is, the
 * pauses land where the speaker paused and the highlight tracks the voice. When
 * the recording says something else, the timings are still bounded by the real
 * audio (so nothing drifts or runs past the clip) but the words are approximate.
 *
 * Everything here is pure arithmetic over plain numbers, so it is unit tested
 * directly; decoding a File to samples happens in the component.
 */

/** A stretch of the clip where the voice is audible. Seconds, clip-relative. */
export type SpeechRegion = { start: number; end: number };

/** One word and the span it is spoken over. */
export type AlignedWord = { text: string; start: number; end: number };

/** Analysis resolution. 20 ms resolves a syllable without a visible cost. */
export const FRAME_SECONDS = 0.02;

/** Sample rate the analysis resamples to; energy does not need more. */
export const ANALYSIS_SAMPLE_RATE = 16_000;

/**
 * RMS of each fixed-size frame, the loudness curve the regions come from.
 *
 * A constant-amplitude signal gives a constant result, which is what makes this
 * worth testing directly.
 */
export function frameEnergy(
  samples: Float32Array,
  frameSize: number,
): Float32Array {
  if (frameSize <= 0 || samples.length === 0) return new Float32Array(0);
  const frames = Math.floor(samples.length / frameSize);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const v = samples[base + i] ?? 0;
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / frameSize);
  }
  return out;
}

const percentile = (sorted: Float32Array, p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(p * (sorted.length - 1))),
  );
  return sorted[idx] ?? 0;
};

/**
 * Smallest loudness in the clip, found as the bottom of the biggest jump in the
 * sorted energy curve.
 *
 * A fixed percentile is the obvious way to pick a noise floor and it is wrong
 * here: whether any given percentile lands in the silence depends on how much
 * of the clip is silent, which is exactly what we do not know. A narration that
 * is 80% speech and one that is 50/50 would need different percentiles, and
 * either choice silently fails for the other. The gap between the quiet frames
 * and the loud ones, on the other hand, is the same whichever way the split
 * falls, so that is what gets measured.
 *
 * Returns null when there is no clear split, meaning the clip is one continuous
 * level with no silence to find.
 */
function noiseFloor(energy: Float32Array): number | null {
  if (energy.length < 2) return null;
  const sorted = Float32Array.from(energy).sort();
  let bestIndex = -1;
  let bestRatio = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    // A zero floor is normal for digital silence, so the divisor is clamped.
    const ratio = (sorted[i + 1] ?? 0) / Math.max(sorted[i] ?? 0, 1e-6);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIndex = i;
    }
  }
  // No meaningful step up: nothing is standing out from the background.
  if (bestIndex < 0 || bestRatio < 2) return null;
  return sorted[bestIndex] ?? 0;
}

export type RegionOptions = {
  /** Length of the clip, used as the fallback span when nothing is detected. */
  totalSeconds?: number;
  /** How far above the noise floor counts as speech. */
  thresholdFactor?: number;
  /** Silence shorter than this is a breath between words, not a real pause. */
  minGapSeconds?: number;
  /** Runs shorter than this are clicks and plosives, not words. */
  minSpeechSeconds?: number;
};

/**
 * Finds the stretches where the voice is talking.
 *
 * The threshold is relative to the clip's own noise floor rather than a fixed
 * number, so a clean studio take and a phone recording in a room both work, and
 * a track that is quiet throughout is not treated as silent.
 *
 * When nothing clears the bar the whole clip is returned as one region, so
 * alignment degrades to a plain proportional spread instead of losing the
 * subtitles entirely.
 */
export function detectSpeechRegions(
  energy: Float32Array,
  frameSeconds: number,
  options: RegionOptions = {},
): SpeechRegion[] {
  const {
    totalSeconds,
    thresholdFactor = 3,
    minGapSeconds = 0.18,
    minSpeechSeconds = 0.08,
  } = options;

  if (frameSeconds <= 0 || energy.length === 0) {
    const span = totalSeconds ?? 0;
    return span > 0 ? [{ start: 0, end: span }] : [];
  }

  const floor = noiseFloor(energy);
  // No split between background and voice: treat the clip as one continuous take.
  if (floor === null) {
    const span = totalSeconds ?? energy.length * frameSeconds;
    return span > 0 ? [{ start: 0, end: span }] : [];
  }

  const peak = percentile(energy, 1);
  // The peak term keeps a loud clip from carving out its own quietest peaks as
  // speech; the floor term is what adapts to a quiet recording.
  const threshold = Math.max(floor * thresholdFactor, peak * 0.06);

  const regions: SpeechRegion[] = [];
  let runStart = -1;
  for (let f = 0; f <= energy.length; f++) {
    const loud = f < energy.length && (energy[f] ?? 0) > threshold;
    if (loud && runStart < 0) runStart = f;
    if (!loud && runStart >= 0) {
      regions.push({
        start: runStart * frameSeconds,
        end: f * frameSeconds,
      });
      runStart = -1;
    }
  }

  // A short silence is a breath, so runs closer together than minGap merge.
  const merged: SpeechRegion[] = [];
  for (const region of regions) {
    const last = merged[merged.length - 1];
    if (last && region.start - last.end < minGapSeconds) {
      last.end = region.end;
    } else {
      merged.push({ ...region });
    }
  }

  const kept = merged.filter((r) => r.end - r.start >= minSpeechSeconds);
  if (kept.length > 0) return kept;

  const span = totalSeconds ?? energy.length * frameSeconds;
  return span > 0 ? [{ start: 0, end: span }] : [];
}

/** Splits on whitespace, keeping punctuation attached to its word. */
export function splitWords(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

/**
 * How long each word should take, in arbitrary but consistent units.
 *
 * Syllable groups are a good stand-in for spoken length, so the highlight
 * lingers on "extraordinarily" the way it does when said. Punctuation alone
 * (a dash, a standalone ellipsis) gets a small weight rather than zero, so it
 * does not steal time from the words around it.
 */
export function wordWeights(words: string[]): number[] {
  return words.map((word) => {
    const letters = word.replace(/[^\p{L}\p{N}]/gu, "");
    if (letters.length === 0) return 0.35;
    const groups = letters.match(/[aeiouyà-ÿ]+/gi);
    const syllables = groups ? groups.length : 1;
    // A long word is spoken slower than its syllable count alone suggests.
    const lengthBonus = letters.length > 8 ? 0.2 : 0;
    return Math.max(1, syllables + lengthBonus);
  });
}

/** Total length covered by a set of regions. */
export function speechSpan(regions: SpeechRegion[]): number {
  return regions.reduce((acc, r) => acc + Math.max(0, r.end - r.start), 0);
}

/**
 * Maps a position on the concatenated speech timeline back to real seconds.
 *
 * This is what makes pauses fall correctly: the words are laid end to end over
 * the speech only, and then stretched back out over the real regions, so the
 * silence between regions is simply skipped.
 */
function speechToReal(regions: SpeechRegion[], t: number): number {
  if (regions.length === 0) return 0;
  let remaining = t;
  for (const region of regions) {
    const len = Math.max(0, region.end - region.start);
    if (remaining <= len) return region.start + Math.max(0, remaining);
    remaining -= len;
  }
  const last = regions[regions.length - 1]!;
  return last.end;
}

export type AlignOptions = {
  /** Added to every timestamp, to put scene-relative times on the video clock. */
  offset?: number;
};

/**
 * Spreads words across the detected speech regions, in proportion to syllables.
 *
 * Every word gets a share of the speech in proportion to how long it takes to
 * say, and the shares add up to exactly the speech, so the last word lands on
 * the end of the last region on its own. The silence between regions is simply
 * never handed out, which is what makes a pause read as a pause.
 */
export function alignWords(
  words: string[],
  regions: SpeechRegion[],
  options: AlignOptions = {},
): AlignedWord[] {
  const { offset = 0 } = options;
  if (words.length === 0) return [];

  const usable = regions.filter((r) => r.end > r.start);
  const total = speechSpan(usable);
  if (total <= 0) {
    return words.map((text) => ({ text, start: offset, end: offset }));
  }

  const weights = wordWeights(words);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    return words.map((text) => ({ text, start: offset, end: offset }));
  }

  const aligned: AlignedWord[] = [];
  let cursor = 0;
  words.forEach((text, i) => {
    const share = ((weights[i] ?? 1) / totalWeight) * total;
    const start = offset + speechToReal(usable, cursor);
    const end = offset + speechToReal(usable, cursor + share);
    aligned.push({ text, start, end: Math.max(start, end) });
    cursor += share;
  });

  return aligned;
}
