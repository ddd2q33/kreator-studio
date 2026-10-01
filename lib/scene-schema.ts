import { uid } from "./projects.ts";

/**
 * Canonical scene file format for the Video Editor.
 *
 * A scene file is a JSON document describing the whole timeline:
 *
 *   { "version": 1, "brand": "#0d9488", "portrait": false, "scenes": [ … ] }
 *
 * Only `title` is required on a scene — every other field is optional and gets
 * a default, so a hand-written file can be as small as:
 *
 *   { "scenes": [ { "title": "The threshold" } ] }
 *
 * Text fields (`kicker`, `subtitle`, `narration`) default to empty rather than
 * to placeholder copy: the author writes the words. The UI shows a neutral
 * label while a field is empty, but nothing is written back into the scene.
 *
 * `group` is a plain label, and the same label may appear more than once — each
 * run of adjacent scenes sharing a label is its own section, which is what the
 * timeline draws a header for.
 *
 * `normalizeSceneDocument` is the single entry point: it repairs that partial
 * input instead of trusting it, and reports what it had to change so the UI can
 * tell the user rather than silently dropping data.
 */

export const SCENE_FORMAT_VERSION = 1;

export const DEFAULT_BRAND = "#0d9488";
export const DURATION_MIN = 1;
export const DURATION_MAX = 20;
export const DURATION_DEFAULT = 4;
/** Generous ceiling for a narration field; nothing uploads it any more. */
export const NARRATION_MAX = 5000;
/**
 * Ceiling for author notes.
 *
 * Notes are a scratchpad, not a script, so the limit is tighter than the
 * narration's: long enough for a page of cut notes, short enough that a scene
 * carrying one cannot quietly dominate the localStorage quota the whole
 * timeline shares.
 */
export const NOTES_MAX = 2000;

export type Transition = "cut" | "fade" | "zoom" | "pan";

export const TRANSITIONS: readonly Transition[] = [
  "cut",
  "fade",
  "zoom",
  "pan",
];

/**
 * How the image fills the 16:9 frame.
 *
 * `contain` is the default because that is what the renderer has always done:
 * a wrongly-proportioned image shows the whole picture over the brand gradient
 * instead of losing the edges. `cover` crops to fill the frame, which is the
 * right choice for a background but can cut the one part of a diagram a scene is
 * about, so it is a per-scene decision rather than a global setting.
 */
export type ImageFit = "cover" | "contain" | "fill";

export const IMAGE_FITS: readonly ImageFit[] = ["cover", "contain", "fill"];

export const DEFAULT_IMAGE_FIT: ImageFit = "contain";

const asImageFit = (v: unknown, fallback: ImageFit): ImageFit =>
  typeof v === "string" && (IMAGE_FITS as readonly string[]).includes(v)
    ? (v as ImageFit)
    : fallback;

const asGain = (v: unknown, fallback: number): number => {
  const n = asNumber(v);
  if (n === null) return fallback;
  return Math.min(1, Math.max(0, n));
};

/**
 * The voice-over a scene plays, described without the audio itself.
 *
 * The bytes live in IndexedDB under `key` (see lib/audio-store.ts) because they
 * are far too large for localStorage; `duration` and `bytes` are kept here so
 * the editor can label the clip and stretch the scene before reading it back.
 */
export type SceneAudio = {
  /** IndexedDB key for the stored Blob. */
  key: string;
  /** Original file name, shown next to the clip. */
  name: string;
  /** Length in seconds, measured when the file was dropped. */
  duration: number;
  /** Size of the stored blob in bytes. */
  bytes: number;
  /** MIME type reported by the browser, used to pick a decoder. */
  type: string;
  /**
   * Stretches of the clip where the voice is audible, clip-relative seconds.
   *
   * Measured once when the file is attached so the subtitles can be aligned to
   * the real pauses and highlighted word by word without re-decoding the audio
   * on every reload. Empty means the analysis did not run, and the subtitles
   * fall back to being estimated from the text.
   */
  regions: { start: number; end: number }[];
  /**
   * The clip drawn as a waveform in the timeline: one loudness per bucket,
   * 0-100, left to right.
   *
   * Measured from the same decode that finds `regions`, so attaching a clip
   * still reads the file once. Storing it means a reload paints the waveform
   * without touching the audio bytes at all - the alternative is decoding
   * every clip on every page load just to draw thumbnails. Empty means the
   * measurement did not run, and the strip falls back to a plain clip bar.
   */
  peaks: number[];
};

/**
 * A code snippet painted onto the scene's frame.
 *
 * This is what turns a scene from a title card into a programming video: the
 * snippet is the picture, and the narration explains it. It is plain text plus
 * a language name rather than a file, because a scene is a moment, not a
 * project - the author pastes the eight lines that matter and the video shows
 * those eight lines.
 *
 * The defaults are chosen so that a scene with nothing but `code: "…"` is a
 * usable scene: plain text, shown all at once, at the size that fits the frame.
 */
export type SceneCode = {
  /** highlight.js grammar name, or "text" for no colour. */
  language: string;
  /** The snippet itself, as pasted. */
  source: string;
  /** Panel palette; see lib/code-panel.ts. */
  theme: string;
  /** How much of the snippet the frame shows, and when. */
  reveal: CodeReveal;
  /** Font size as a fraction of the frame width, before the panel fits it. */
  scale: number;
  /**
   * Callout labels pinned to their lines, keyed by 1-based line number.
   *
   * A programming video teaches one thing per beat; the label next to the line
   * is the thing. Keys are strings because JSON objects only have string keys,
   * and lines are 1-based because that is what the gutter shows the viewer.
   * Optional so documents written before callouts existed still load; the
   * normalizer always fills it in.
   */
  callouts?: Record<string, string>;
  /**
   * Lines kept permanently bright (1-based) while the rest of the snippet dims
   * once the reveal has passed them — the "look here" beat of an explanation.
   * Optional for the same reason; the normalizer always fills it in.
   */
  focus?: number[];
  /**
   * Presentation mode: `single` is one snippet; `diff` shows the rewrite
   * from `base` to `source`, added lines green, removed red — the shape
   * every code review UI has taught programmers to read.
   */
  mode?: CodeMode;
  /** The "before" text of a diff scene, read exactly like `source`. */
  base?: string;
};

/** How a snippet appears over the life of the scene. */
export const CODE_REVEALS = ["all", "typed", "lines"] as const;
export type CodeReveal = (typeof CODE_REVEALS)[number];

/** Bounds for `scale`, so a hand-edited file cannot ask for a 4px font. */
export const CODE_SCALE_MIN = 0.4;
export const CODE_SCALE_MAX = 2;
/** Longest snippet kept on a scene; a file pasted by accident is a mistake. */
export const CODE_SOURCE_MAX = 8000;

/** How a snippet is presented on the frame. */
export const SCENE_CODE_MODES = ["single", "diff"] as const;
export type CodeMode = (typeof SCENE_CODE_MODES)[number];

/**
 * A terminal card printed under the snippet: the program's output, the proof
 * the code runs. Optional; null is a scene without a terminal.
 */
export type SceneTerminal = {
  /** Window title in the header, e.g. `node demo.ts`. */
  title: string;
  /** Output lines, printed one by one as the scene plays. */
  output: string[];
};

/** Longest output line kept; a wall of logs is a paste, not a teaching beat. */
export const TERMINAL_LINE_MAX = 120;
/** Longest output list kept; the card has to stay readable at video size. */
export const TERMINAL_LINES_MAX = 12;

/**
 * Repairs a terminal card. Anything that is not text is dropped, not fatal —
 * a hand-written file with one bad line should still show the other nine.
 */
export function normalizeSceneTerminal(input: unknown): {
  terminal: SceneTerminal | null;
  warnings: string[];
} {
  if (input === undefined || input === null) return { terminal: null, warnings: [] };
  if (!isRecord(input)) {
    return { terminal: null, warnings: ["terminal ignored — expected an object"] };
  }
  const warnings: string[] = [];
  const rawLines = Array.isArray(input.output) ? input.output : [];
  const output: string[] = [];
  for (const item of rawLines) {
    if (typeof item !== "string" || item.trim() === "") continue;
    if (output.length >= TERMINAL_LINES_MAX) {
      warnings.push(`terminal output trimmed to ${TERMINAL_LINES_MAX} lines`);
      break;
    }
    if (item.length > TERMINAL_LINE_MAX) {
      warnings.push(`terminal line trimmed to ${TERMINAL_LINE_MAX} chars`);
    }
    output.push(item.slice(0, TERMINAL_LINE_MAX));
  }
  if (output.length === 0) return { terminal: null, warnings };
  return {
    terminal: {
      title: asText(input.title, "terminal").slice(0, 60) || "terminal",
      output,
    },
    warnings,
  };
}

/**
 * The palette a snippet gets when the author does not pick one.
 *
 * Only the id lives here. The palettes themselves are presentation and live in
 * lib/code-panel.ts, which is the only module that draws; an id this build does
 * not know falls back to the first palette rather than failing the frame.
 */
export const DEFAULT_CODE_THEME = "midnight";

const asReveal = (v: unknown, fallback: CodeReveal): CodeReveal =>
  typeof v === "string" && (CODE_REVEALS as readonly string[]).includes(v)
    ? (v as CodeReveal)
    : fallback;

export type VideoScene = {
  id: string;
  /** Links the scene back to the chapter it was generated from, if any. */
  chapterId: string | null;
  /**
   * Section this scene belongs to, by label. Groups are contiguous runs in the
   * scene array rather than a nested structure, so ordering, drop targets and
   * the flat export all keep working unchanged.
   */
  group: string | null;
  kicker: string;
  title: string;
  subtitle: string;
  narration: string;
  /**
   * Author notes for this scene that live only in the editor.
   *
   * These are not spoken, not exported to video and not written to DOCX, so
   * they are free to capture cut notes, ideas and take numbers without
   * affecting the output. Stored alongside the scene for round-trips through
   * the JSON editor and localStorage.
   */
  notes: string;
  /** Key into the app's image map (a file name), never a data URL. */
  imageKey: string | null;
  /**
   * How the image fills the 16:9 frame. `contain` is the default so existing
   * projects keep the look they were authored with; see `ImageFit`.
   */
  imageFit: ImageFit;
  duration: number;
  transition: Transition;
  /** Dropped audio for this scene, or null for a silent one. */
  audio: SceneAudio | null;
  /**
   * Linear gain for this scene's clip, 0..1. Authored per scene so a loud take
   * next to a quiet one needs no gain ride in the mix.
   */
  volume: number;
  /** Muted scenes keep their clip but contribute silence, for a beat without deleting it. */
  muted: boolean;
  /**
   * Code painted on the frame, or null for a scene with no code.
   *
   * Optional in the file and always present on a scene in memory, so a project
   * written before code scenes existed loads unchanged and a scene without a
   * snippet is simply a title card.
   */
  code: SceneCode | null;
  /**
   * Terminal card under the code, or null for a scene without one.
   *
   * Optional in the file so older projects load unchanged; the normalizer
   * always writes a value in memory.
   */
  terminal: SceneTerminal | null;
};

export type SceneDocument = {
  version: number;
  brand: string;
  portrait: boolean;
  scenes: VideoScene[];
  /** Optional subtitle style template id (lib/subtitles.ts SUBTITLE_STYLES). */
  subtitleStyleId?: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asText = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v.trim() : fallback;

const asOptionalText = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Accepts numbers and numeric strings so `"4.5"` survives hand-editing. */
const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

const round2 = (n: number): number => Math.round(n * 100) / 100;

const isHexColor = (v: string): boolean =>
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

export type NormalizeOptions = {
  /** Keys in the current image map. When given, unknown imageKeys are cleared. */
  imageKeys?: readonly string[];
  /** Chapter ids in the active book, used to flag dangling chapter links. */
  chapterIds?: readonly string[];
  /** Clip keys present in IndexedDB. When given, unknown audio is cleared. */
  audioKeys?: readonly string[];
  /**
   * Suppresses the "has no title" warning.
   *
   * A blank title is only worth reporting when the author was expected to write
   * one. Inside a grouped scene the title lives on the section, so every
   * subscene is titled blank by design and warning about each one turns a valid
   * file into a wall of noise — and, worse, teaches the author to ignore the
   * warnings that do matter.
   */
  titleOptional?: boolean;
  /** Injectable id factory, so tests can assert on deterministic ids. */
  newId?: () => string;
};

/**
 * Expands the grouped authoring format into a run of flat scenes:
 *
 *   { "scene": "The Silence", "subscenes": [ { "narration": … }, … ] }
 *
 * The group takes its label from `scene` (or the group's first subscene
 * `title`/`group` field as fallbacks) and is inherited by every subscene, so
 * the timeline draws one section header for the whole run. Subscene fields use
 * the same names as full scenes; `image`/`imageKey` is resolved against the
 * image map at the group level too, and missing fields fall back to defaults
 * (duration 4s, transition fade) exactly like flat scenes do.
 */
function expandGroupedScene(
  input: Record<string, unknown>,
  subscenes: unknown[],
  index: number,
  options: NormalizeOptions = {},
): { scene: VideoScene | null; warnings: string[] } {
  const label = `Scene ${index + 1}`;
  const warnings: string[] = [];

  const groupLabel =
    asOptionalText(input.scene) ??
    asOptionalText(input.title) ??
    asOptionalText(input.group) ??
    `Section ${index + 1}`;

  // Optional per-group defaults the subscenes can override individually.
  const groupDefaults = {
    imageKey: asOptionalText(input.image) ?? asOptionalText(input.imageKey),
    kicker: asOptionalText(input.kicker) ?? "",
    imageFit: asImageFit(input.imageFit, DEFAULT_IMAGE_FIT),
    volume: asGain(input.volume, 1),
    muted: input.muted === true,
  };

  const scenes: VideoScene[] = [];
  subscenes.forEach((raw, subIndex) => {
    const subLabel = `${label} · subscene ${subIndex + 1}`;
    if (!isRecord(raw)) {
      warnings.push(`${subLabel} is not an object — skipped.`);
      return;
    }
    const result = normalizeScene(
      {
        ...raw,
        // Group label flows to the scene; the subscene's own group/title win if
        // the author overrode them (an explicit override starts a new section).
        group: asOptionalText(raw.group) ?? groupLabel,
        title: asOptionalText(raw.title) ?? "",
        kicker: asOptionalText(raw.kicker) ?? groupDefaults.kicker,
        imageKey:
          asOptionalText(raw.imageKey) ?? asOptionalText(raw.image) ?? groupDefaults.imageKey,
        imageFit: asImageFit(raw.imageFit, groupDefaults.imageFit),
        volume: asGain(raw.volume, groupDefaults.volume),
        muted: raw.muted === true || groupDefaults.muted,
      },
      subIndex,
      { ...options, titleOptional: true },
    );
    if (result.scene) {
      // The subscene's own group wins when it set one; otherwise it inherits the
      // section. Forcing groupLabel here would discard the override the call
      // above just resolved, making it impossible for a subscene to open a new
      // section from inside a group.
      scenes.push({ ...result.scene, group: result.scene.group ?? groupLabel });
      warnings.push(...result.warnings.map((w) => w.replace(/^Scene \d+:/, subLabel + ":")));
    } else {
      warnings.push(...result.warnings.map((w) => w.replace(/^Scene \d+:/, subLabel + ":")));
    }
  });

  if (scenes.length === 0) {
    warnings.push(`${label}: group "${groupLabel}" has no usable subscenes — skipped.`);
    return { scene: null, warnings };
  }

  // The first scene of the group carries the group's title as its own title
  // when the subscene has none, so the section header and the first frame
  // agree without the author writing it twice.
  if (!scenes[0]!.title && scenes.length > 0) {
    scenes[0] = { ...scenes[0]!, title: groupLabel };
  }

  // Flatten: the first scene carries the group's id slot; the rest are
  // siblings. Returning one representative keeps the normalizeScene contract.
  // The remaining scenes ride along via the extra field below.
  return { scene: scenes[0]!, warnings, extra: scenes.slice(1) } as {
    scene: VideoScene | null;
    warnings: string[];
    extra?: VideoScene[];
  };
}

/**
 * Keeps the stored waveform as finite numbers in 0-100, dropping junk.
 *
 * Like the regions beside it, `peaks` arrives from a file the author can edit
 * by hand, so it cannot be trusted to be numbers. A waveform is cosmetic, so
 * the repair is silent: bad entries become silence and the strip still draws.
 */
function normalizePeaks(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const out: number[] = [];
  for (const entry of input) {
    const value = asNumber(entry);
    if (value === null) continue;
    out.push(Math.round(Math.max(0, Math.min(100, value))));
  }
  return out;
}

/**
 * Keeps only usable speech regions, in order and non-overlapping.
 *
 * These numbers come from a hand-editable JSON file, so a bad entry must not be
 * able to produce negative spans or a region that starts before the one before
 * it, which would make the word aligner loop or run backwards.
 */function normalizeSpeechRegions(input: unknown): { start: number; end: number }[] {
  if (!Array.isArray(input)) return [];
  const out: { start: number; end: number }[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) continue;
    const start = asNumber(entry.start);
    const end = asNumber(entry.end);
    if (start === null || end === null) continue;
    const region = { start: round2(start), end: round2(end) };
    if (region.end <= region.start) continue;
    const last = out[out.length - 1];
    // Overlapping or out-of-order regions would break the cumulative walk.
    if (last && region.start < last.end) continue;
    out.push(region);
  }
  return out;
}

/**
 * Repairs a scene's audio descriptor.
 *
 * The blob itself is checked against `audioKeys` so a scene JSON that
 * references a clip the browser no longer has comes back silent instead of
 * failing to play at export time. Callers that do not pass `audioKeys` (the
 * common case, since IndexedDB is only read on demand) keep the descriptor.
 */
export function normalizeSceneAudio(
  input: unknown,
  options: Pick<NormalizeOptions, "audioKeys"> = {},
): { audio: SceneAudio | null; warnings: string[] } {
  if (!isRecord(input)) return { audio: null, warnings: [] };
  const key = asOptionalText(input.key);
  if (!key) return { audio: null, warnings: [] };

  if (options.audioKeys && !options.audioKeys.includes(key)) {
    return {
      audio: null,
      warnings: [`audio "${key}" is no longer in browser storage — dropped`],
    };
  }

  const bytes = asNumber(input.bytes);
  const duration = asNumber(input.duration);
  return {
    audio: {
      key,
      name: asText(input.name, key),
      duration: duration === null ? 0 : Math.max(0, round2(duration)),
      bytes: bytes === null ? 0 : Math.max(0, Math.round(bytes)),
      type: asText(input.type, "audio/mpeg"),
      regions: normalizeSpeechRegions(input.regions),
      peaks: normalizePeaks(input.peaks),
    },
    warnings: [],
  };
}

/**
 * Repairs a scene's code snippet.
 *
 * Accepts both shapes on purpose, because the author writes both by hand: a
 * bare string is the common case (`"code": "const x = 1"`) and an object is how
 * the language, the palette and the reveal are set. A snippet with no text is
 * dropped rather than kept as an empty card, since a frame with an empty panel
 * is worse than a frame with no panel.
 */
/**
 * Repairs a code callout map.
 *
 * Keys must be integers naming lines that exist in the snippet and values must
 * carry text; anything else is dropped with a warning rather than rejected —
 * a hand-written file with one bad key should still load the other nine.
 */
function normalizeCodeCallouts(
  input: unknown,
  lineCount: number,
  warnings: string[],
): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    warnings.push("code callouts ignored — expected an object of line numbers");
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const line = Number(key);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) {
      warnings.push(`callout "${key}" ignored — not a line in the snippet`);
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) continue; // an empty label is noise, not an error
    out[String(line)] = text.slice(0, 120);
  }
  return out;
}

/**
 * Repairs a code focus list: 1-based line numbers that exist in the snippet,
 * deduplicated and ordered, so the painter iterates a stable list.
 */
function normalizeCodeFocus(
  input: unknown,
  lineCount: number,
  warnings: string[],
): number[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    warnings.push("code focus ignored — expected an array of line numbers");
    return [];
  }
  const out: number[] = [];
  for (const item of input) {
    const line = Number(item);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) {
      warnings.push(
        `focus line "${String(item)}" ignored — not a line in the snippet`,
      );
      continue;
    }
    if (!out.includes(line)) out.push(line);
  }
  return out.sort((a, b) => a - b);
}

export function normalizeSceneCode(
  input: unknown,
): { code: SceneCode | null; warnings: string[] } {
  // Both halves of a diff are read by the same repair path; the shared body
  // below runs on whichever text is present.
  if (input === undefined || input === null) return { code: null, warnings: [] };
  if (typeof input === "string") {
    const source = input.trim();
    return {
      code: source
        ? {
            language: "text",
            source,
            theme: DEFAULT_CODE_THEME,
            reveal: "all",
            scale: 1,
            callouts: {},
            focus: [],
            mode: "single",
            base: "",
          }
        : null,
      warnings: [],
    };
  }
  if (!isRecord(input)) return { code: null, warnings: [] };

  const rawSource = typeof input.source === "string" ? input.source : "";
  const source = rawSource.trim();
  if (source === "") return { code: null, warnings: [] };

  const warnings: string[] = [];
  if (rawSource.length > CODE_SOURCE_MAX) {
    warnings.push(
      `code is ${rawSource.length} chars — trimmed to ${CODE_SOURCE_MAX}`,
    );
  }

  const rawReveal = asOptionalText(input.reveal);
  let reveal: CodeReveal = "all";
  if (rawReveal && !(CODE_REVEALS as readonly string[]).includes(rawReveal)) {
    warnings.push(`unknown code reveal "${rawReveal}" — used "all"`);
  } else {
    reveal = asReveal(rawReveal, "all");
  }

  const rawScale = asNumber(input.scale);
  if (rawScale !== null && (rawScale < CODE_SCALE_MIN || rawScale > CODE_SCALE_MAX)) {
    warnings.push(
      `code scale ${rawScale} is outside ${CODE_SCALE_MIN}–${CODE_SCALE_MAX} — clamped`,
    );
  }

  const rawMode = asOptionalText(input.mode);
  if (rawMode && !(SCENE_CODE_MODES as readonly string[]).includes(rawMode)) {
    warnings.push(`unknown code mode "${rawMode}" — used "single"`);
  }
  const mode: CodeMode =
    rawMode && (SCENE_CODE_MODES as readonly string[]).includes(rawMode)
      ? (rawMode as CodeMode)
      : "single";
  const rawBase = typeof input.base === "string" ? input.base : "";
  if (mode === "diff" && rawBase.trim() === "") {
    warnings.push("diff scene has no base text — shown as a single snippet");
  }

  return {
    code: {
      language: asText(input.language, "text"),
      source: rawSource.slice(0, CODE_SOURCE_MAX),
      theme: asText(input.theme, DEFAULT_CODE_THEME),
      reveal,
      scale: rawScale === null ? 1 : clamp(rawScale, CODE_SCALE_MIN, CODE_SCALE_MAX),
      callouts: normalizeCodeCallouts(input.callouts, rawSource.split("\n").length, warnings),
      focus: normalizeCodeFocus(input.focus, rawSource.split("\n").length, warnings),
      mode,
      base: rawBase.slice(0, CODE_SOURCE_MAX),
    },
    warnings,
  };
}

/**
 * Repairs one scene. Returns `scene: null` (with a warning) only when the input
 * is not an object at all.
 *
 * A blank `title` is kept, not rejected: scenes are authored from blank
 * (see `DEFAULT_SCENE`), so an empty title is a legitimate authoring state and
 * dropping the scene here would make the per-scene JSON editor impossible to
 * round-trip on a brand new scene.
 */
export function normalizeScene(
  input: unknown,
  index: number,
  options: NormalizeOptions = {},
): { scene: VideoScene | null; warnings: string[] } {
  const label = `Scene ${index + 1}`;
  if (!isRecord(input)) {
    return { scene: null, warnings: [`${label} is not an object — skipped.`] };
  }

  // Grouped authoring format: { scene, subscenes: [...] } describes ONE
  // timeline section — `scene` names the group and each subscene becomes a
  // plain scene carrying that group label, so the timeline renders one header
  // per section while every subscene stays individually editable.
  const rawSubscenes = (input as { subscenes?: unknown }).subscenes;
  if (Array.isArray(rawSubscenes) && rawSubscenes.length > 0) {
    return expandGroupedScene(input, rawSubscenes, index, options);
  }

  const title = asText(input.title, "");

  const warnings: string[] = [];
  if (!title && !options.titleOptional) {
    warnings.push(`${label} has no "title" — kept as a blank frame.`);
  }

  const rawTransition = asOptionalText(input.transition);
  let transition: Transition = "fade";
  if (rawTransition) {
    if ((TRANSITIONS as readonly string[]).includes(rawTransition)) {
      transition = rawTransition as Transition;
    } else {
      warnings.push(
        `unknown transition "${rawTransition}" — used "fade"`,
      );
    }
  }

  const rawDuration = asNumber(input.duration);
  let duration = DURATION_DEFAULT;
  if (rawDuration === null) {
    if (input.duration !== undefined) {
      warnings.push(
        `unreadable duration ${JSON.stringify(input.duration)} — used ${DURATION_DEFAULT}s`,
      );
    }
  } else if (rawDuration < DURATION_MIN || rawDuration > DURATION_MAX) {
    duration = round2(clamp(rawDuration, DURATION_MIN, DURATION_MAX));
    warnings.push(
      `duration ${rawDuration}s is outside ${DURATION_MIN}–${DURATION_MAX}s — clamped to ${duration}s`,
    );
  } else {
    duration = round2(rawDuration);
  }

  const narration =
    typeof input.narration === "string" ? input.narration.trim() : "";
  if (narration.length > NARRATION_MAX) {
    warnings.push(
      `narration is ${narration.length} chars — trimmed to ${NARRATION_MAX}`,
    );
  }

  // Notes keep their line breaks and leading indentation: a checklist pasted
  // from somewhere else should not come back reformatted, and trimming the
  // edges is all the repair a scratchpad needs. A non-string becomes empty
  // rather than "[object Object]".
  let notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    notes = notes.slice(0, NOTES_MAX);
    warnings.push(`notes are longer than ${NOTES_MAX} chars — trimmed`);
  }

  let imageKey = asOptionalText(input.imageKey);
  if (imageKey && options.imageKeys && !options.imageKeys.includes(imageKey)) {
    warnings.push(`image "${imageKey}" is not in the current image map — cleared`);
    imageKey = null;
  }

  const chapterId = asOptionalText(input.chapterId);
  if (chapterId && options.chapterIds && !options.chapterIds.includes(chapterId)) {
    warnings.push(`chapterId "${chapterId}" matches no chapter in this book`);
  }

  const { audio, warnings: audioWarnings } = normalizeSceneAudio(input.audio, {
    audioKeys: options.audioKeys,
  });
  warnings.push(...audioWarnings);

  const { code, warnings: codeWarnings } = normalizeSceneCode(input.code);
  warnings.push(...codeWarnings);

  const { terminal, warnings: terminalWarnings } = normalizeSceneTerminal(
    input.terminal,
  );
  warnings.push(...terminalWarnings);

  return {
    scene: {
      id: asOptionalText(input.id) ?? (options.newId ?? (() => uid("scene-")))(),
      chapterId,
      group: asOptionalText(input.group),
      kicker: asText(input.kicker, ""),
      title,
      subtitle: asText(input.subtitle, ""),
      narration,
      notes,
      imageKey,
      imageFit: asImageFit(input.imageFit, DEFAULT_IMAGE_FIT),
      duration,
      transition,
      audio,
      volume: asGain(input.volume, 1),
      muted: input.muted === true,
      code,
      terminal,
    },
    warnings: warnings.map((w) => `${label}: ${w}`),
  };
}

export function normalizeScenes(
  input: unknown,
  options: NormalizeOptions = {},
): { scenes: VideoScene[]; warnings: string[] } {
  if (!Array.isArray(input)) {
    return { scenes: [], warnings: ["`scenes` is not an array."] };
  }

  const scenes: VideoScene[] = [];
  const warnings: string[] = [];
  input.forEach((raw, index) => {
    const result = normalizeScene(raw, index, options);
    // Grouped scenes ({ scene, subscenes }) expand into a run of flat scenes;
    // the representative is the first, the rest ride on `extra`.
    const extra = (result as { extra?: VideoScene[] }).extra ?? [];
    if (result.scene) scenes.push(result.scene, ...extra);
    warnings.push(...result.warnings);
  });

  if (scenes.length === 0) warnings.push("No usable scenes found.");
  return { scenes, warnings };
}

/**
 * Accepts either a full document or a bare array of scenes, so the smallest
 * useful file is `[ { "title": "…" } ]`.
 */
/**
 * Normalizes whatever the Scene JSON editor was handed.
 *
 * The editor accepts three different shapes and the difference decides whether
 * the content replaces the selected scene, becomes a new section, or lands on
 * the timeline whole. That routing used to live in the component, where nothing
 * could test it, and the one case it got wrong turned a 32-scene episode into a
 * single blank frame: the top-level `scenes` key was read as an unknown field
 * because the draft had been wrapped as one scene first.
 *
 * - `{ scenes: [...] }` is a whole document: many sections at once.
 * - `{ scene, subscenes: [...] }` is one section.
 * - Anything else that is an object is a single scene.
 */
export function normalizeSceneInput(
  input: unknown,
  options: NormalizeOptions = {},
): { document: SceneDocument | null; warnings: string[] } {
  if (Array.isArray(input)) {
    return {
      document: null,
      warnings: [
        "Expected a scene object or a document with a \"scenes\" array, not a bare array.",
      ],
    };
  }
  if (!isRecord(input)) {
    return {
      document: null,
      warnings: ["A scene must be a JSON object."],
    };
  }
  // A `scenes` array means this is a document, not one scene. Anything else is a
  // single scene, which is the only shape that replaces what is selected.
  return Array.isArray((input as { scenes?: unknown }).scenes)
    ? normalizeSceneDocument(input, options)
    : normalizeSceneDocument({ scenes: [input] }, options);
}

export function normalizeSceneDocument(
  input: unknown,
  options: NormalizeOptions = {},
): { document: SceneDocument | null; warnings: string[] } {
  // A single grouped scene at top level ({ scene, subscenes }) is its own file
  // shape: treat it as a one-section document.
  const singleGroup =
    !Array.isArray(input) &&
    isRecord(input) &&
    Array.isArray((input as { subscenes?: unknown }).subscenes)
      ? { scenes: [input] }
      : input;
  const raw = Array.isArray(singleGroup) ? { scenes: singleGroup } : singleGroup;
  if (!isRecord(raw)) {
    return {
      document: null,
      warnings: ["A scene file must be an object, an array of scenes, or a { scene, subscenes } group."],
    };
  }

  const { scenes, warnings } = normalizeScenes(raw.scenes, options);
  if (scenes.length === 0) return { document: null, warnings };

  const version = asNumber(raw.version);
  if (version !== null && version > SCENE_FORMAT_VERSION) {
    warnings.push(
      `file is v${version} but this build understands v${SCENE_FORMAT_VERSION} — unknown fields were ignored`,
    );
  }

  const rawBrand = asOptionalText(raw.brand);
  let brand = DEFAULT_BRAND;
  if (rawBrand) {
    if (isHexColor(rawBrand)) {
      brand = rawBrand;
    } else {
      warnings.push(`brand "${rawBrand}" is not a hex color — used ${DEFAULT_BRAND}`);
    }
  }

  return {
    document: {
      version: SCENE_FORMAT_VERSION,
      brand,
      portrait: raw.portrait === true,
      scenes,
      subtitleStyleId: asOptionalText(raw.subtitleStyleId) ?? undefined,
    },
    warnings,
  };
}

/**
 * Reads the first scene out of a dropped file. The three shapes a person is
 * likely to produce are all accepted: a single scene object, an array, or a
 * full exported document. When the file holds more than one scene only the
 * first is used — dropping a whole timeline onto one clip is almost certainly
 * a mistake, and the caller is told how many were ignored.
 */
export function normalizeFirstScene(
  input: unknown,
  options: NormalizeOptions = {},
): { scene: VideoScene | null; totalScenes: number; warnings: string[] } {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.scenes)
      ? input.scenes
      : [input];

  const { scenes, warnings } = normalizeScenes(raw, options);
  const scene = scenes[0] ?? null;
  if (!scene) return { scene: null, totalScenes: 0, warnings };

  return {
    scene,
    totalScenes: scenes.length,
    warnings:
      scenes.length > 1
        ? [
            ...warnings,
            `file held ${scenes.length} scenes — only the first was applied`,
          ]
        : warnings,
  };
}
