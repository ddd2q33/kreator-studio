/**
 * Subtitle cues for the scene canvas.
 *
 * The narration text already exists on every scene, so nothing has to be
 * transcribed: the only missing piece is *when* each piece of text is said.
 * That timing is estimated here, without any network call, by assuming a steady
 * speaking rate and spreading the words over the scene's own duration.
 *
 * Everything in this module is pure so it can be unit tested; the canvas only
 * consumes the resulting cues.
 */

/** Comfortable reading width. Wider cues wrap into two lines on a 1080p frame. */
export const MAX_CHARS_PER_CUE = 42;

/** Two lines is the usual subtitle ceiling; three is unreadable at phone size. */
export const MAX_LINES_PER_CUE = 2;

/** A cue shorter than this flashes by too fast to read. */
export const MIN_CUE_SECONDS = 0.9;

export type SubtitleCue = {
  /** One or two lines, already wrapped. */
  lines: string[];
  /** Absolute seconds from the start of the video. */
  start: number;
  end: number;
};

/** Words a voice gets through per second, used to turn text into a duration. */
const WORDS_PER_SECOND = 2.6;

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
    return lines.length > 0 ? [{ lines, start: startSeconds, end: startSeconds }] : [];
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
      cues.push({ lines, start: cursor, end: Math.max(cursor, end) });
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
 * Builds the cue list for a whole video from per-scene text, offsetting each
 * scene by the cumulative duration of the ones before it.
 */
export function buildTimelineCues(
  scenes: { narration: string; duration: number }[],
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let offset = 0;
  for (const scene of scenes) {
    const duration = Number.isFinite(scene.duration) && scene.duration > 0 ? scene.duration : 0;
    cues.push(...cuesForScene(scene.narration ?? "", offset, duration));
    offset += duration;
  }
  return cues;
}

/** The cue covering `time` seconds, if any. Cues do not overlap. */
export function cueAt(cues: SubtitleCue[], time: number): SubtitleCue | null {
  for (const cue of cues) {
    if (time >= cue.start && time < cue.end) return cue;
  }
  return null;
}

/** `HH:MM:SS,mmm`, the timestamp format SRT expects. */
export function toSrtTimestamp(seconds: number): string {
  const total = Math.max(0, seconds);
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
