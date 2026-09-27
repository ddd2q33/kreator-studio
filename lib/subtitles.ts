/**
 * Subtitle cues for the scene canvas.
 *
 * The narration text already exists on every scene, so nothing has to be
 * transcribed: the only missing piece is *when* each piece of text is said.
 *
 * Two sources of timing, in order of preference:
 *
 *   - When the scene carries a dropped voice-over, the clip is analysed for
 *     speech and pauses (see lib/speech-align.ts) and the words are laid onto
 *     the regions where the voice is actually talking. That yields per-word
 *     timings, so a line can be highlighted as it is spoken.
 *   - Otherwise the timing is estimated from the text and the scene length,
 *     with no audio involved.
 *
 * Everything in this module is pure so it can be unit tested; the canvas only
 * consumes the resulting cues.
 */

import {
  alignWords,
  splitWords,
  type SpeechRegion,
} from "./speech-align.ts";

/** Comfortable reading width. Wider cues wrap into two lines on a 1080p frame. */
export const MAX_CHARS_PER_CUE = 42;

/** Two lines is the usual subtitle ceiling; three is unreadable at phone size. */
export const MAX_LINES_PER_CUE = 2;

/** A cue shorter than this flashes by too fast to read. */
export const MIN_CUE_SECONDS = 0.9;

/** One word and the span it is spoken over, in absolute video seconds. */
export type TimedWord = {
  text: string;
  start: number;
  end: number;
};

export type SubtitleCue = {
  /** One or two lines, already wrapped. */
  lines: string[];
  /** Absolute seconds from the start of the video. */
  start: number;
  end: number;
  /**
   * The same words with per-word timings, in reading order.
   *
   * Empty when the scene had no audio to measure, which is the signal to fall
   * back to painting whole lines. When present, the words must appear in the
   * same order as they do across `lines`.
   */
  words: TimedWord[];
  /**
   * Index into `words` where each entry of `lines` begins. Parallel to `lines`,
   * so the painter can find which line a highlighted word sits on.
   */
  lineStarts: number[];
};

/** A cue with no per-word timing, for the estimate-only path. */
export function plainCue(lines: string[], start: number, end: number): SubtitleCue {
  return { lines, start, end, words: [], lineStarts: [] };
}

/** Words a voice gets through per second, used to turn text into a duration. */
const WORDS_PER_SECOND = 2.6;

/**
 * Silence a scene needs around its line so the words are not crammed against
 * the cuts. Both edges, not just one: a line that starts on the first frame
 * reads as a mistake, and so does one cut off mid-breath at the end.
 */
const NARRATION_LEAD_IN = 0.4;
const NARRATION_TAIL = 0.6;

/**
 * Seconds a whole narration needs, padding included.
 *
 * Built on the same speaking rate as the subtitle estimates on purpose: if the
 * two disagreed, a scene sized by this function would either clip its last
 * subtitle or leave a long empty tail, and neither is obvious to debug from the
 * finished video.
 *
 * Returns 0 for empty text. There is nothing to estimate, and a scene with no
 * line should keep whatever length the author chose for pacing rather than
 * snapping to a one-second minimum.
 */
export function estimateNarrationSeconds(text: string): number {
  const words = text.split(" ").filter(Boolean).length;
  if (words === 0) return 0;
  const speech = words / WORDS_PER_SECOND;
  return round2(speech + NARRATION_LEAD_IN + NARRATION_TAIL);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Breaks one sentence-ish run of text into caption-sized pieces.
 *
 * Prefers to break at punctuation so the split reads naturally, falls back to
 * the next word when a single clause is longer than the line, and never drops
 * words: a 200 character narration still comes out whole, just in more cues.
 */
export function splitIntoCues(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const cues: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const flush = () => {
    if (current.length > 0) {
      cues.push(current.join(" "));
      current = [];
      currentLen = 0;
    }
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const nextLen = currentLen === 0 ? word.length : currentLen + 1 + word.length;

    if (nextLen > MAX_CHARS_PER_CUE && current.length > 0) {
      // Prefer ending the cue on a sentence boundary when one is close enough.
      const tail = current[current.length - 1]!;
      const endsSentence = /[.!?…]["')\]]?$/.test(tail);
      const endsClause = /[,;:—]$/.test(tail);
      if (!endsSentence && !endsClause) {
        // Move the trailing clause down to the next cue instead of orphaning it.
        const held: string[] = [];
        while (
          current.length > 1 &&
          !/[.!?…]$/.test(current[current.length - 1]!)
        ) {
          held.unshift(current.pop()!);
          currentLen -= held[0]!.length + 1;
        }
        flush();
        current = held;
        currentLen = held.reduce((a, w) => a + w.length + 1, -1);
      } else {
        flush();
      }
    }

    current.push(word);
    currentLen = currentLen === 0 ? word.length : currentLen + 1 + word.length;
  }
  flush();

  return cues;
}

/**
 * Wraps a cue's text into at most two balanced lines, so a long cue splits in
 * the middle rather than filling the first line to the brim.
 */
export function wrapCue(text: string): string[] {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return [];

  if (text.length <= MAX_CHARS_PER_CUE) return [text];

  const target = Math.ceil(text.length / MAX_LINES_PER_CUE);
  const lines: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const word of words) {
    const nextLen = currentLen === 0 ? word.length : currentLen + 1 + word.length;
    if (nextLen > target && current.length > 0 && lines.length < MAX_LINES_PER_CUE - 1) {
      lines.push(current.join(" "));
      current = [];
      currentLen = 0;
    }
    current.push(word);
    currentLen = currentLen === 0 ? word.length : currentLen + 1 + word.length;
  }
  if (current.length > 0) lines.push(current.join(" "));

  return lines;
}

/**
 * Seconds a piece of text is expected to take to speak, with a floor so short
 * cues do not flash past.
 */
export function estimateCueSeconds(text: string): number {
  const words = text.split(" ").filter(Boolean).length;
  return Math.max(MIN_CUE_SECONDS, words / WORDS_PER_SECOND);
}

/**
 * Spreads a scene's narration across that scene's own slice of the timeline.
 *
 * Each cue gets a share of the scene proportional to how long it should take to
 * read, and any leftover time is left as a gap at the end of the scene so the
 * subtitles do not drift into the next scene when the narration is short.
 */
export function cuesForScene(
  narration: string,
  startSeconds: number,
  durationSeconds: number,
): SubtitleCue[] {
  const pieces = splitIntoCues(narration);
  if (pieces.length === 0) return [];

  const span = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const weights = pieces.map((p) => estimateCueSeconds(p));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // A scene with almost no time still shows one cue, clipped to its own slice,
  // rather than dropping the narration entirely.
  if (totalWeight <= 0 || span <= 0) {
    const lines = wrapCue(pieces.join(" "));
    return lines.length > 0
      ? [plainCue(lines, startSeconds, startSeconds)]
      : [];
  }

  const used = Math.min(span, totalWeight);
  const sceneEnd = startSeconds + span;
  let cursor = startSeconds;
  const cues: SubtitleCue[] = [];

  pieces.forEach((piece, i) => {
    const share = (weights[i]! / totalWeight) * used;
    // Keep a cue from flashing past, but never let that minimum push it past
    // the scene it belongs to.
    const end = Math.min(sceneEnd, Math.max(cursor + 0.05, cursor + share));
    const lines = wrapCue(piece);
    if (lines.length > 0) {
      // Word timings for the estimate path: each cue's own words are spread
      // over that cue's window with the same syllable weighting the aligned
      // path uses, so the karaoke highlight works before any audio is attached
      // and always lands inside the window it colours. Spreading the whole
      // narration once across the scene instead let the cue windows
      // (read-paced, with floors) and the word timings (syllable-paced,
      // continuous) drift apart — a word's start could land in the next cue's
      // window, so the highlight skipped words or lit the wrong one.
      const pieceWords = splitWords(piece);
      const slice =
        pieceWords.length > 0
          ? alignWords(pieceWords, [
              { start: cursor, end: Math.max(cursor, end) },
            ])
          : [];
      const lineStarts: number[] = [];
      let seen = 0;
      for (const line of lines) {
        lineStarts.push(seen);
        seen += splitWords(line).length;
      }
      cues.push({
        lines,
        start: cursor,
        end: Math.max(cursor, end),
        words: slice,
        lineStarts: slice.length === pieceWords.length ? lineStarts : [],
      });
    }
    cursor += share;
  });

  // The last cue always runs to the end of its scene so it does not cut out
  // mid-sentence when the narration is shorter than the scene.
  const last = cues[cues.length - 1];
  if (last) last.end = startSeconds + span;

  return cues;
}

/**
 * Cues for a scene whose audio has been analysed, with per-word timings.
 *
 * The words are aligned to the clip's speech regions first, then grouped into
 * the same caption-sized pieces the estimate path uses. Grouping after aligning
 * (rather than before) is what keeps each word's real position: a cue boundary
 * is just a slice of an already-timed word list, so a highlight never jumps
 * because a line happened to break in a different place.
 *
 * `regions` are clip-relative seconds; `startSeconds` moves them onto the video
 * clock.
 */
export function cuesForSceneAligned(
  narration: string,
  startSeconds: number,
  regions: SpeechRegion[],
): SubtitleCue[] {
  const words = splitWords(narration);
  if (words.length === 0 || regions.length === 0) return [];

  const timed = alignWords(words, regions, { offset: startSeconds });
  const pieces = splitIntoCues(narration);
  if (pieces.length === 0) return [];

  // Walk the timed words alongside the pieces, matching on the word itself so
  // the two lists cannot drift apart.
  const cues: SubtitleCue[] = [];
  let wordIndex = 0;
  for (const piece of pieces) {
    const pieceWords = splitWords(piece);
    const slice: TimedWord[] = [];
    for (let i = 0; i < pieceWords.length; i++) {
      const w = timed[wordIndex + i];
      // A mismatch can only come from the text changing under us; fall back to
      // a zero-width entry rather than dropping the word from the caption.
      slice.push(w ?? { text: pieceWords[i]!, start: startSeconds, end: startSeconds });
    }
    wordIndex += pieceWords.length;

    const lines = wrapCue(piece);
    if (lines.length === 0) continue;
    // lineStarts tells the painter which line each highlighted word is on.
    const lineStarts: number[] = [];
    let seen = 0;
    for (const line of lines) {
      lineStarts.push(seen);
      seen += splitWords(line).length;
    }
    const first = slice[0];
    const lastWord = slice[slice.length - 1];
    cues.push({
      lines,
      start: first ? first.start : startSeconds,
      end: lastWord ? lastWord.end : startSeconds,
      words: slice,
      lineStarts,
    });
  }

  return cues;
}

/** A scene as far as subtitle timing is concerned. */
export type CueScene = {
  narration: string;
  duration: number;
  /**
   * Speech regions measured from this scene's dropped audio, clip-relative.
   * Present means the words can be aligned to the real voice; absent falls back
   * to the text-only estimate.
   */
  regions?: SpeechRegion[] | null;
};

/**
 * Builds the cue list for a whole video from per-scene text, offsetting each
 * scene by the cumulative duration of the ones before it.
 *
 * A scene with analysed audio takes the aligned path and gets word timings; a
 * silent one is estimated from its text as before, so a project can mix both.
 */
export function buildTimelineCues(scenes: CueScene[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let offset = 0;
  for (const scene of scenes) {
    const duration =
      Number.isFinite(scene.duration) && scene.duration > 0
        ? scene.duration
        : 0;
    const regions = scene.regions;
    if (regions && regions.length > 0) {
      const aligned = cuesForSceneAligned(
        scene.narration ?? "",
        offset,
        regions,
      );
      // Regions that turn out to hold no words fall through to the estimate
      // rather than showing nothing.
      cues.push(
        ...(aligned.length > 0
          ? aligned
          : cuesForScene(scene.narration ?? "", offset, duration)),
      );
    } else {
      cues.push(...cuesForScene(scene.narration ?? "", offset, duration));
    }
    offset += duration;
  }
  return cues;
}

/**
 * Index of the word being spoken at `time`, or -1.
 *
 * Words are ordered and non-overlapping, so this is a short scan, not a search.
 * `from` is a hint at where the caller was last time, which lets continuous
 * playback skip the words it already passed; it is only a starting point, so a
 * backward seek still gets the right answer instead of a word from the wrong
 * side of the hint.
 *
 * A word counts as active from its own start until the next word begins, so a
 * word that ends in a pause keeps its highlight through the silence rather than
 * flickering off between syllables.
 */
export function activeWordIndex(
  cue: SubtitleCue,
  time: number,
  from = 0,
): number {
  const { words } = cue;
  if (words.length === 0) return -1;

  const hint = Math.max(0, Math.min(from, words.length - 1));
  const hintStart = words[hint]?.start ?? 0;

  if (time < hintStart) {
    // The time is before the hint, so the spoken word is earlier in the list.
    // Walk back to the last word that had already started.
    for (let i = hint; i >= 0; i--) {
      if ((words[i]?.start ?? Infinity) <= time) return i;
    }
    // Nothing has started yet, so no word is being spoken.
    return -1;
  }

  // The time is at or after the hint: the answer is this word or a later one.
  for (let i = hint; i < words.length; i++) {
    const next = words[i + 1];
    if (!next || time < next.start) return i;
  }
  // Past the last word: hold it rather than blanking the highlight.
  return words.length - 1;
}

/**
 * Which rendered line a word sits on, via the cue's `lineStarts`.
 * Returns -1 for a word index outside the cue.
 */
export function lineIndexForWord(cue: SubtitleCue, wordIndex: number): number {
  if (wordIndex < 0 || cue.lineStarts.length === 0) return -1;
  let line = -1;
  for (let i = 0; i < cue.lineStarts.length; i++) {
    if ((cue.lineStarts[i] ?? 0) <= wordIndex) line = i;
    else break;
  }
  return line;
}

/** The cue covering `time` seconds, if any. Cues do not overlap. */
export function cueAt(cues: SubtitleCue[], time: number): SubtitleCue | null {
  for (const cue of cues) {
    if (time >= cue.start && time < cue.end) return cue;
  }
  return null;
}

/**
 * Turns word-level timestamps (from a forced aligner) into speech regions.
 *
 * A region is one run of words with no real gap between them; the silence
 * between regions is where the aligner measured nothing being said. These
 * regions feed the same aligned-cue path the energy analysis does, but the
 * timings come from an actual transcript rather than from the loudness curve,
 * so the highlight lands on the word being spoken even over music or a noisy
 * room.
 *
 * Gaps shorter than `minGapSeconds` are merged (a breath is not a pause),
 * matching the behaviour of the energy-based detector.
 */
export function regionsFromWords(
  words: { start: number; end: number }[],
  minGapSeconds = 0.18,
): { start: number; end: number }[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const regions: { start: number; end: number }[] = [];
  for (const w of sorted) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    if (w.end <= w.start) continue;
    const last = regions[regions.length - 1];
    if (last && w.start - last.end < minGapSeconds) {
      last.end = Math.max(last.end, w.end);
    } else {
      regions.push({ start: Math.max(0, w.start), end: Math.max(0, w.end) });
    }
  }
  return regions.filter((r) => r.end > r.start);
}

/** `HH:MM:SS,mmm`, the timestamp format SRT expects. */
export function toSrtTimestamp(seconds: number): string {  const total = Math.max(0, seconds);
  const ms = Math.round((total % 1) * 1000);
  const whole = Math.floor(total);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${ms.toString().padStart(3, "0")}`;
}

/** A standard SRT file: blank-line separated blocks, 1-based indices. */
export function toSrt(cues: SubtitleCue[]): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${toSrtTimestamp(cue.start)} --> ${toSrtTimestamp(cue.end)}\n${cue.lines.join("\n")}`,
    )
    .join("\n\n")
    .concat(cues.length > 0 ? "\n" : "");
}

// ---------------------------------------------------------------------------
// Subtitle style templates
//
// The templates and their motion parameters live in their own module: they are a
// self-contained design system, and folding them in here buried the cue logic that
// this file is actually about. Re-exported so every existing import still works.
// ---------------------------------------------------------------------------

export {
  DEFAULT_SUBTITLE_STYLE_ID,
  SUBTITLE_STYLES,
  SUBTITLE_STYLE_GROUPS,
  entranceSecondsFor,
  subtitleStyleById,
} from "./subtitle-templates.ts";
export type {
  SubtitleEffect,
  SubtitleHighlight,
  SubtitleStyle,
} from "./subtitle-templates.ts";
