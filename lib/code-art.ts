/**
 * The model behind a code video: the scenes, their sub-scenes, the timing, and
 * the looks.
 *
 * The premise of this tool is that filming code is mostly *writing the script*,
 * not filming. Sixty lines of a real file are unreadable at any size a phone
 * screen can give them, so a useful scene is a handful of lines with the rest
 * left out, and a useful video is a run of those scenes where each one says one
 * thing. The types here are built around authoring that script one scene at a
 * time: a `CodeScene` owns a pasted file, and each of its `CodeBeat`s - the
 * sub-scenes - says which lines are on screen for how long. Pasting a new version
 * of the file re-points every beat at the same line numbers, which is the only
 * way "replace the code" can be a one-click action instead of a re-edit of the
 * whole video.
 *
 * Duration belongs to the beat, not to the code. That is the change of heart
 * from a take-based editor, and it is the whole reason this one can be driven
 * from a JSON script: a beat lasts the seconds the author said it lasts, and the
 * typing inside it is fitted to fit. Deriving the length from how many
 * characters there are makes the video a function of the code, so the same
 * script comes out longer or shorter depending on the snippets, and an
 * explainer cannot be timed against a voice-over. A tutorial's timing is an
 * editorial decision, and it is made where the editor can see it.
 *
 * Pure on purpose. Timing arithmetic that is easy to get subtly wrong is the
 * part most worth testing, and it cannot be tested if it is tangled up with a
 * canvas.
 */

import { countChars, hasGrammar, tokenizeCode, type CodeLine } from "./code-highlight.ts";

export const CODE_PROJECT_VERSION = 2;

/**
 * The version of the JSON *script* format, which is a separate thing from the
 * project version: the script is a file that other people read and hand around,
 * and it has to be able to say "I am version 1" independently of whatever the
 * project needs to keep stored projects forward.
 */
export const CODE_SCRIPT_VERSION_LOCAL = 1;

/* ------------------------------------------------------------------ looks */

/**
 * How the code appears on screen.
 *
 * `typewriter` is the default because it is the one a viewer reads as "someone
 * is writing this", which is the feeling an explanatory video is after. The
 * other two exist because the same beat reads differently depending on whether
 * the point is the writing or the result: `lines` is for walking through logic
 * one statement at a time, `token` is for when a single identifier is the point.
 */
export type CodeReveal = "typewriter" | "lines" | "token";

export const CODE_REVEALS: readonly {
  id: CodeReveal;
  label: string;
  hint: string;
}[] = [
  {
    id: "typewriter",
    label: "Typewriter",
    hint: "Every character appears, with a blinking cursor at the end.",
  },
  {
    id: "lines",
    label: "Line by line",
    hint: "Each line lands whole and the line it just landed on is lit.",
  },
  {
    id: "token",
    label: "Token by token",
    hint: "Words and symbols arrive in pieces, so one identifier can be the point.",
  },
];

/**
 * The colour each highlight.js class is painted in.
 *
 * Held per style rather than globally because a code video that looks like a
 * terminal and a code video that looks like a printed page need the same token
 * in two very different colours, and a token in a string literal should be
 * visibly not-code without the frame having to shout.
 *
 * `function` and `class` are separate from `title` on purpose: in every real
 * editor theme a function call is the same colour as the name it is calling, and
 * folding the two together is what makes a syntax-coloured video read as
 * "coloured text" rather than as an editor.
 */
export type CodePalette = {
  plain: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  title: string;
  attr: string;
  builtIn: string;
  literal: string;
  /** Function and method names. */
  function: string;
  /** Class and type names. */
  class: string;
  /** The colour of the caption and headings, which are not code. */
  text: string;
  muted: string;
  accent: string;
  /** Background of the code panel itself. */
  panel: string;
  /** Background of the whole frame. */
  background: string;
  /** Gutter and window chrome. */
  chrome: string;
  /** Colour of the line currently being written. */
  activeLine: string;
};

export type CodeStyleId =
  | "midnight"
  | "paper"
  | "monokai"
  | "dracula"
  | "neon"
  | "terminal"
  | "spotlight"
  | "caption";

export type CodeStyle = {
  id: CodeStyleId;
  label: string;
  hint: string;
  /**
   * Whether the frame draws editor chrome - the title bar, the three dots, the
   * file name. It costs screen area that code needs, but it is the single
   * cheapest way to make a video read as "an editor" rather than "a text box".
   */
  chrome: boolean;
  /** Line numbers in the gutter. */
  numbers: boolean;
  /**
   * How the frame is arranged. `editor` is a code panel filling the frame;
   * `stacked` puts the code in the top half and a large caption under it, which
   * is what a vertical video needs because the lower two thirds of a phone
   * screen is where the captions the viewer reads live.
   */
  layout: "editor" | "stacked";
  /** Text glow, for the neon look. Radius in canvas pixels at 1080 wide. */
  glow: number;
  /** Horizontal scanlines, drawn at low alpha. */
  scanlines: boolean;
  /** Font stack. Monospace throughout: a code shot that reflows is a lie. */
  font: string;
  /** Code point size, as a fraction of the frame width. */
  codeScale: number;
  palette: CodePalette;
};

/** The monospace stack every style uses, so the picker is not a font menu. */
const MONO =
  '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", "Courier New", monospace';

export const CODE_STYLES: readonly CodeStyle[] = [
  {
    id: "midnight",
    label: "Midnight",
    hint: "Dark editor with window chrome. The safe default for a tutorial.",
    chrome: true,
    numbers: true,
    layout: "editor",
    glow: 0,
    scanlines: false,
    font: MONO,
    codeScale: 0.0165,
    palette: {
      plain: "#e6edf3",
      comment: "#8b949e",
      keyword: "#ff7b72",
      string: "#a5d6ff",
      number: "#79c0ff",
      title: "#d2a8ff",
      attr: "#79c0ff",
      builtIn: "#ffa657",
      literal: "#79c0ff",
      function: "#d2a8ff",
      class: "#ffa657",
      text: "#e6edf3",
      muted: "#8b949e",
      accent: "#58a6ff",
      panel: "#0d1117",
      background: "#010409",
      chrome: "#161b22",
      activeLine: "#1f2937",
    },
  },
  {
    id: "paper",
    label: "Paper",
    hint: "Light page. Reads well in daylight and in a bright feed.",
    chrome: false,
    numbers: true,
    layout: "editor",
    glow: 0,
    scanlines: false,
    font: MONO,
    codeScale: 0.0165,
    palette: {
      plain: "#1f2328",
      comment: "#6e7781",
      keyword: "#cf222e",
      string: "#0a3069",
      number: "#0550ae",
      title: "#8250df",
      attr: "#0550ae",
      builtIn: "#953800",
      literal: "#0550ae",
      function: "#8250df",
      class: "#953800",
      text: "#1f2328",
      muted: "#57606a",
      accent: "#0969da",
      panel: "#ffffff",
      background: "#f6f8fa",
      chrome: "#eaeef2",
      activeLine: "#eef2f6",
    },
  },
  {
    // Monokai's real values, not an approximation of them. A theme people
    // recognise is doing work the moment the video starts: it reads as "this is
    // a real editor" before a word has been read.
    id: "monokai",
    label: "Monokai",
    hint: "The classic dark editor theme. Warm, high contrast, instantly familiar.",
    chrome: true,
    numbers: true,
    layout: "editor",
    glow: 0,
    scanlines: false,
    font: MONO,
    codeScale: 0.0165,
    palette: {
      plain: "#f8f8f2",
      comment: "#75715e",
      keyword: "#f92672",
      string: "#e6db74",
      number: "#ae81ff",
      title: "#a6e22e",
      attr: "#a6e22e",
      builtIn: "#66d9ef",
      literal: "#ae81ff",
      function: "#a6e22e",
      class: "#66d9ef",
      text: "#f8f8f2",
      muted: "#75715e",
      accent: "#66d9ef",
      panel: "#272822",
      background: "#1e1f1c",
      chrome: "#3e3d32",
      activeLine: "#3e3d32",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    hint: "Purple and cyan on a near-black panel. Made for a hook or a title.",
    chrome: true,
    numbers: true,
    layout: "editor",
    glow: 0,
    scanlines: false,
    font: MONO,
    codeScale: 0.0165,
    palette: {
      plain: "#f8f8f2",
      comment: "#6272a4",
      keyword: "#ff79c6",
      string: "#f1fa8c",
      number: "#bd93f9",
      title: "#50fa7b",
      attr: "#50fa7b",
      builtIn: "#8be9fd",
      literal: "#bd93f9",
      function: "#50fa7b",
      class: "#8be9fd",
      text: "#f8f8f2",
      muted: "#6272a4",
      accent: "#bd93f9",
      panel: "#282a36",
      background: "#1e1f29",
      chrome: "#343746",
      activeLine: "#44475a",
    },
  },
  {
    id: "neon",
    label: "Neon",
    hint: "Glowing text on black with scanlines. For a hook, not for reading.",
    chrome: true,
    numbers: true,
    layout: "editor",
    glow: 14,
    scanlines: true,
    font: MONO,
    codeScale: 0.0165,
    palette: {
      plain: "#e9f7ef",
      comment: "#4b7f6a",
      keyword: "#ff2d95",
      string: "#31f7c0",
      number: "#ffd23f",
      title: "#31f7c0",
      attr: "#7df9ff",
      builtIn: "#ffd23f",
      literal: "#7df9ff",
      function: "#31f7c0",
      class: "#ffd23f",
      text: "#e9f7ef",
      muted: "#4b7f6a",
      accent: "#31f7c0",
      panel: "#05060a",
      background: "#000000",
      chrome: "#0b1016",
      activeLine: "#101a22",
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    hint: "One colour, no chrome. Right for shell transcripts and command lines.",
    chrome: false,
    numbers: false,
    layout: "editor",
    glow: 0,
    scanlines: false,
    font: '"Cascadia Mono", Consolas, "Courier New", monospace',
    codeScale: 0.0165,
    palette: {
      plain: "#33ff66",
      comment: "#1d7a38",
      keyword: "#33ff66",
      string: "#9dff9d",
      number: "#33ff66",
      title: "#33ff66",
      attr: "#33ff66",
      builtIn: "#33ff66",
      literal: "#33ff66",
      function: "#33ff66",
      class: "#33ff66",
      text: "#33ff66",
      muted: "#1d7a38",
      accent: "#9dff9d",
      panel: "#000000",
      background: "#000000",
      chrome: "#000000",
      activeLine: "#062a10",
    },
  },
  {
    id: "spotlight",
    label: "Spotlight",
    hint: "The line being written is lit and the rest recedes. Long code reads.",
    chrome: true,
    numbers: true,
    layout: "editor",
    glow: 0,
    scanlines: false,
    font: MONO,
    codeScale: 0.016,
    palette: {
      plain: "#c9d1d9",
      comment: "#6e7681",
      keyword: "#ff7b72",
      string: "#a5d6ff",
      number: "#79c0ff",
      title: "#d2a8ff",
      attr: "#79c0ff",
      builtIn: "#ffa657",
      literal: "#79c0ff",
      function: "#d2a8ff",
      class: "#ffa657",
      text: "#c9d1d9",
      muted: "#6e7681",
      accent: "#f0b429",
      panel: "#0d1117",
      background: "#010409",
      chrome: "#161b22",
      activeLine: "#1f2d3d",
    },
  },
  {
    id: "caption",
    label: "Caption",
    hint: "Code small on top, one big line of text under it. Made for Shorts.",
    chrome: false,
    numbers: false,
    layout: "stacked",
    glow: 0,
    scanlines: false,
    font: MONO,
    codeScale: 0.0135,
    palette: {
      plain: "#e6edf3",
      comment: "#8b949e",
      keyword: "#ff7b72",
      string: "#a5d6ff",
      number: "#79c0ff",
      title: "#d2a8ff",
      attr: "#79c0ff",
      builtIn: "#ffa657",
      literal: "#79c0ff",
      function: "#d2a8ff",
      class: "#ffa657",
      text: "#ffffff",
      muted: "#8b949e",
      accent: "#58a6ff",
      panel: "#0d1117",
      background: "#010409",
      chrome: "#161b22",
      activeLine: "#1f2937",
    },
  },
];

export function styleById(id: string): CodeStyle {
  return (
    CODE_STYLES.find((s) => s.id === id) ??
    CODE_STYLES.find((s) => s.id === "midnight")!
  );
}

export function revealById(id: string): CodeReveal {
  return CODE_REVEALS.some((r) => r.id === id) ? (id as CodeReveal) : "typewriter";
}

/* --------------------------------------------------------------- formats */

/**
 * Output shapes, named for the device they are going up on rather than by their
 * arithmetic, because "9:16" does not tell anyone whether it is for TikTok or a
 * YouTube Short and the safe areas differ.
 *
 * `safe` is the part of the frame that survives a platform's own furniture: the
 * channel name, the like button, the caption bar, the progress bar. It is a
 * fraction of the height from the top and from the bottom, and the painter keeps
 * the code and the text inside it. On a 9:16 phone frame that is most of the
 * decision between a video that reads and one that has a row of code hidden
 * behind the caption bar, and there is no way to guess it from the pixel count.
 */
export type CodeFormat = {
  id: string;
  label: string;
  hint: string;
  width: number;
  height: number;
  /** Fraction of the height to keep clear at the top and at the bottom. */
  safe: { top: number; bottom: number };
  /** True when the frame is taller than it is wide. */
  portrait: boolean;
};

export const CODE_FORMATS: readonly CodeFormat[] = [
  {
    id: "phone-vertical",
    label: "Phone vertical 9:16",
    hint: "Reels, Shorts and TikTok. The frame a phone is held in.",
    width: 1080,
    height: 1920,
    // Shorts and Reels both eat the bottom fifth with the caption and the
    // controls, and Reels puts the account row across the top.
    safe: { top: 0.1, bottom: 0.18 },
    portrait: true,
  },
  {
    id: "phone-horizontal",
    label: "Phone horizontal 16:9",
    hint: "A phone on its side: a lesson, a talk, a desktop player.",
    width: 1920,
    height: 1080,
    // Landscape on a player is nearly the whole frame; a little is kept off the
    // edges so a control bar never lands on the first line of code.
    safe: { top: 0.03, bottom: 0.05 },
    portrait: false,
  },
  {
    id: "square",
    label: "Square 1:1",
    hint: "A feed post, or a slide that has to survive a crop.",
    width: 1080,
    height: 1080,
    safe: { top: 0.05, bottom: 0.08 },
    portrait: false,
  },
];

export function formatById(id: string): CodeFormat {
  return (
    CODE_FORMATS.find((f) => f.id === id) ??
    CODE_FORMATS.find((f) => f.id === "phone-vertical")!
  );
}

/**
 * The ids the previous build wrote, so a project saved before the formats were
 * renamed keeps its shape instead of silently becoming vertical.
 */
const FORMAT_ALIASES: Record<string, string> = {
  landscape: "phone-horizontal",
  vertical: "phone-vertical",
};

/* ---------------------------------------------------------------- timing */

/**
 * Characters per second.
 *
 * The floor is 6, which is a deliberate pace for a language with long
 * identifiers: below it the typing stops reading as a person and starts reading
 * as a bug. The ceiling of 90 is past legible for most code and exists only so
 * an author who wants a whole file flashing past has the option.
 */
export const SPEED_MIN = 6;
export const SPEED_MAX = 90;
export const SPEED_DEFAULT = 28;

/** Seconds the finished scene stays on screen after its last sub-scene. */
export const HOLD_MIN = 0.4;
export const HOLD_MAX = 12;
export const HOLD_DEFAULT = 1.8;

/** How long a sub-scene lasts, in seconds. */
export const BEAT_MIN = 0.4;
export const BEAT_MAX = 30;
export const BEAT_DEFAULT = 2.6;

/**
 * The share of a beat the typing is allowed to take.
 *
 * A beat always ends with the code finished and still there, because a sub-scene
 * that hands the viewer a half-typed line is a beat that has not explained
 * anything yet. The remaining quarter is the beat's own reading time, which is
 * what lets a long line be typed and then read.
 */
export const TYPING_SHARE = 0.75;

/** Bounds a pasted file, so a stray 40 kB log cannot become a 20-minute scene. */
export const CODE_MAX_CHARS = 20_000;
export const SCENES_MAX = 40;
export const BEATS_MAX = 24;
export const TITLE_MAX = 120;
export const CAPTION_MAX = 400;
export const NOTE_MAX = 120;
export const FILENAME_MAX = 80;

/* ----------------------------------------------------------------- model */

/**
 * One sub-scene: the lines that are on screen, and for how long.
 *
 * A beat is the unit an explainer is actually written in. "Show the guard clause"
 * and "now the call site" are two beats, and splitting them is what makes the
 * script readable as a script rather than as a pile of line numbers.
 */
export type CodeBeat = {
  id: string;
  /** What this sub-scene is for, in the author's words. Drawn as a badge. */
  note: string;
  /**
   * Which lines of the scene's `code` are on screen, 0-based, in the order they
   * appear.
   *
   * Order is the author's, not the file's: showing lines 40 to 12 is a
   * legitimate thing to want, and sorting them would quietly undo the decision
   * the beat was made for. Duplicates are dropped by `normalizeBeat`, because
   * the same line twice is always a mistake and the painter has no way to draw
   * it as anything other than the first occurrence.
   */
  lines: number[];
  /**
   * Positions within `lines` to emphasise, 0-based. These get the accent colour
   * and a mark in the gutter, which is how "look at this bit" is said without
   * narration having to name it.
   */
  marks: number[];
  /**
   * Seconds this sub-scene lasts. Authored, not derived: the script decides the
   * running time and the typing is fitted to fit inside it.
   */
  duration: number;
};

export type CodeScene = {
  id: string;
  /** The heading on the frame. What this scene is about. */
  title: string;
  /** The sentence under it, usually what the narrator is saying. */
  caption: string;
  /** Shown in the window chrome and as a badge, so the viewer can follow along. */
  fileName: string;
  /** The whole pasted file. The scene draws a selection of its lines. */
  code: string;
  language: string;
  /** The sub-scenes, in the order they play. */
  beats: CodeBeat[];
  /** Extra seconds on screen once the last sub-scene has finished. */
  hold: number;
  /** Characters per second for this scene only; null means the project's. */
  speed: number | null;
};

export type CodeProject = {
  version: number;
  /** Stable identity, so a rename does not orphan a project's stored audio. */
  id: string;
  name: string;
  styleId: CodeStyleId;
  reveal: CodeReveal;
  formatId: string;
  /** Characters per second across the project. */
  speed: number;
  /** Whether the blinking cursor is drawn at the typing point. */
  cursor: boolean;
  /** Whether the caption is drawn. */
  captions: boolean;
  /** Whether the sub-scene note is drawn as a badge over the code. */
  notes: boolean;
  scenes: CodeScene[];
  /**
   * The narrator's own recording, mixed into the export.
   *
   * The bytes live in IndexedDB under `key` (see `lib/audio-store.ts`) because a
   * voice-over is far too large for localStorage. `duration` is kept here so the
   * timeline can be laid out without decoding it.
   */
  audio: {
    key: string;
    name: string;
    duration: number;
  } | null;
};

export function defaultProject(): CodeProject {
  return {
    version: CODE_PROJECT_VERSION,
    id: `proj_${Math.random().toString(36).slice(2, 10)}`,
    name: "code-video",
    styleId: "midnight",
    reveal: "typewriter",
    formatId: "phone-vertical",
    speed: SPEED_DEFAULT,
    cursor: true,
    captions: true,
    notes: true,
    scenes: [],
    audio: null,
  };
}

/** A sub-scene showing a set of lines for a couple of seconds. */
export function newBeat(lines: number[] = [], duration: number = BEAT_DEFAULT): CodeBeat {
  return {
    id: `beat_${Math.random().toString(36).slice(2, 10)}`,
    note: "",
    lines,
    marks: [],
    duration: clamp(duration, BEAT_MIN, BEAT_MAX),
  };
}

/** A scene with one sub-scene showing the whole file, which is what a first paste should do. */
export function newScene(code = "", language = "text", fileName = "code"): CodeScene {
  const total = code ? code.split("\n").length : 0;
  return {
    id: `scene_${Math.random().toString(36).slice(2, 10)}`,
    title: "",
    caption: "",
    fileName,
    code,
    language,
    beats: total > 0 ? [newBeat(Array.from({ length: total }, (_, i) => i))] : [],
    hold: HOLD_DEFAULT,
    speed: null,
  };
}

/* ----------------------------------------------------------- the visible set */

/**
 * The lines a scene's file has, coloured and numbered.
 *
 * This is the join between "the file the author pasted" and "the lines the beats
 * kept", and it is cached per scene rather than per frame: the colours come out
 * of a grammar, and running seventeen grammars once per frame at 30 fps would
 * be the slowest thing in the export by a wide margin.
 */
const tokenCache = new Map<string, CodeLine[]>();

function cacheKey(code: string, language: string): string {
  return `${language} ${code}`;
}

export function linesFor(scene: Pick<CodeScene, "code" | "language">): CodeLine[] {
  const key = cacheKey(scene.code, scene.language);
  const hit = tokenCache.get(key);
  if (hit) return hit;
  const lines = tokenizeCode(scene.code, scene.language);
  // Bounded so pasting a new file twenty times does not keep every intermediate
  // version's tokens alive for the life of the tab.
  if (tokenCache.size > 64) tokenCache.clear();
  tokenCache.set(key, lines);
  return lines;
}

/**
 * The lines a beat shows, in the beat's own order, with the real file's line
 * numbers.
 *
 * Out-of-range indices are dropped rather than clamped: a beat whose line 400 no
 * longer exists should show nine lines and not silently substitute line 399,
 * because a wrong line of code in a tutorial is worse than a short one.
 */
export function visibleLines(
  scene: Pick<CodeScene, "code" | "language">,
  beat: Pick<CodeBeat, "lines">,
): CodeLine[] {
  const all = linesFor(scene);
  const out: CodeLine[] = [];
  const seen = new Set<number>();
  for (const index of beat.lines) {
    if (seen.has(index)) continue;
    seen.add(index);
    const line = all[index];
    if (line) out.push(line);
  }
  return out;
}

/* ------------------------------------------------------------ the timeline */

export function sceneSpeed(scene: CodeScene, project: CodeProject): number {
  return clamp(scene.speed ?? project.speed, SPEED_MIN, SPEED_MAX);
}

/** A unit is one step of the reveal: a character, a line or a token. */
export type RevealUnit = {
  /** Index into the visible line list. */
  line: number;
  /** Character range within that line's text. */
  from: number;
  to: number;
};

/**
 * Breaks a beat into the steps its reveal happens in.
 *
 * Every reveal is expressed as the same list of character ranges so the painter
 * has one code path: typewriter makes a range per character, `lines` one range
 * per whole line, `token` one per run. That is the whole reason those three are
 * variations rather than three different animations.
 */
export function revealUnits(
  scene: CodeScene,
  beat: CodeBeat,
  project: CodeProject,
): RevealUnit[] {
  const lines = visibleLines(scene, beat);
  const units: RevealUnit[] = [];
  if (lines.length === 0) return units;

  for (const [line, entry] of lines.entries()) {
    const length = entry.text.length;
    if (project.reveal === "lines") {
      // A zero-length line still gets a unit, or the typing would stall on a
      // blank line and the viewer would think the video had hung.
      units.push({ line, from: 0, to: length });
      continue;
    }
    if (project.reveal === "token") {
      let from = 0;
      for (const run of entry.runs) {
        const to = from + run.text.length;
        units.push({ line, from, to });
        from = to;
      }
      if (length === 0) units.push({ line, from: 0, to: 0 });
      continue;
    }
    for (let i = 0; i < length; i++) units.push({ line, from: i, to: i + 1 });
  }
  return units;
}

export type BeatTiming = {
  /** Seconds spent typing. Never the whole beat: see `TYPING_SHARE`. */
  typing: number;
  /** `beat.duration`, clamped to a sane range. */
  total: number;
  /** Where this sub-scene starts inside its scene, in seconds. */
  start: number;
  /** Characters the beat types out, newlines between lines included. */
  chars: number;
  /** Number of reveal units, which is what the progress is counted in. */
  units: number;
};

/**
 * How long one sub-scene takes, and how much of that the typing gets.
 *
 * The authored `duration` is the truth. The typing is what the code would take
 * at the scene's speed, capped at `TYPING_SHARE` of the beat, so a four-second
 * beat of two lines types in a second and holds for three, and a one-second beat
 * of a long line types for three quarters of it and finishes. Both directions
 * are the point: a script that says two seconds gets two seconds, whatever was
 * pasted into it.
 */
export function beatTiming(
  scene: CodeScene,
  beat: CodeBeat,
  project: CodeProject,
): BeatTiming {
  const lines = visibleLines(scene, beat);
  const units = revealUnits(scene, beat, project);
  const speed = sceneSpeed(scene, project);
  // Newlines are typed too: a newline costs the same time as a character, which
  // is what makes a line land at a believable pace instead of all at once after
  // a long wait.
  const chars = countChars(lines) + Math.max(0, lines.length - 1);
  const total = clamp(beat.duration, BEAT_MIN, BEAT_MAX);
  const natural =
    project.reveal === "lines" ? (units.length / speed) * 2.4 : chars / speed;
  const typing = Math.max(0.2, Math.min(natural, total * TYPING_SHARE));
  return { typing, total, start: 0, chars, units: units.length };
}

export type SceneTiming = {
  /**
   * The sub-scenes, in order, each with its `start` filled in. One entry per
   * sub-scene, so `beats[i]` belongs to `scene.beats[i]` and an index into one is
   * an index into the other.
   */
  beats: BeatTiming[];
  /** Extra seconds held after the last sub-scene. */
  hold: number;
  /** `sum(playable beats) + hold`, or 0 for a scene with nothing on screen. */
  total: number;
  /** Where this scene starts on the finished timeline, in seconds. */
  start: number;
  /** Characters the scene types out in total. */
  chars: number;
};

export function sceneTiming(scene: CodeScene, project: CodeProject): SceneTiming {
  let at = 0;
  let chars = 0;
  const beats = scene.beats.map((beat) => {
    // A sub-scene with no lines is one the author has started and not finished.
    // It keeps its place in the list - so the editor, the script and the
    // timeline all agree on the order - but it takes no time in the video,
    // because a beat of empty panel in the middle of an explanation reads as a
    // broken export rather than as a pause.
    if (beat.lines.length === 0) {
      return { ...beatTiming(scene, beat, project), start: at, total: 0, typing: 0 };
    }
    const timing = { ...beatTiming(scene, beat, project), start: at };
    at += timing.total;
    chars += timing.chars;
    return timing;
  });
  const hasContent = beats.some((entry) => entry.total > 0);
  const hold = clamp(scene.hold, HOLD_MIN, HOLD_MAX);
  return { beats, hold, total: hasContent ? at + hold : 0, start: 0, chars };
}

/**
 * Every scene's timing with its `start` filled in, in timeline order.
 *
 * The accumulated `start` is what makes the export resumable frame by frame: the
 * encoder asks for time `t`, and this says which scene owns it without having to
 * replay anything.
 *
 * Built from the *playable* scenes, not from all of them. A scene whose
 * sub-scenes are all empty is a scene being authored, not one that exists in the
 * video, and it must not hold the screen for a second and a half of empty panel.
 * The index `sceneAt` returns is therefore an index into `playableScenes`, which
 * is the list the scene picker has to walk to stay in step.
 */
export function timeline(project: CodeProject): SceneTiming[] {
  let at = 0;
  return playableScenes(project).map((scene) => {
    const timing = { ...sceneTiming(scene, project), start: at };
    at += timing.total;
    return timing;
  });
}

/** A sub-scene with nothing on screen is not a thing that can be played. */
export function playableBeats(scene: CodeScene): CodeBeat[] {
  return scene.beats.filter((beat) => beat.lines.length > 0);
}

/**
 * The scenes that are in the video: those with at least one sub-scene that has
 * lines on screen.
 *
 * Kept as a function rather than a cached field so it cannot disagree with
 * `project.scenes` after an edit.
 */
export function playableScenes(project: CodeProject): CodeScene[] {
  return project.scenes.filter((scene) => playableBeats(scene).length > 0);
}

export function projectDuration(project: CodeProject): number {
  return timeline(project).reduce((acc, t) => acc + t.total, 0);
}

/** Which scene and sub-scene are on screen at `time`, and how far into each. */
export function sceneAt(
  project: CodeProject,
  time: number,
): {
  index: number;
  scene: CodeScene;
  local: number;
  timing: SceneTiming;
  beatIndex: number;
  beat: CodeBeat;
  beatLocal: number;
} | null {
  const scenes = playableScenes(project);
  const list = timeline(project);
  for (const [index, timing] of list.entries()) {
    if (time < timing.start + timing.total) {
      return {
        ...withinScene(scenes[index]!, timing, time - timing.start),
        index,
        scene: scenes[index]!,
        timing,
      };
    }
  }
  const last = list.length - 1;
  if (last < 0) return null;
  // Past the end: the final scene is held rather than cut to black, because a
  // file that ends on an empty frame reads as a failed export.
  const timing = list[last];
  return {
    ...withinScene(scenes[last]!, timing, timing.total),
    index: last,
    scene: scenes[last]!,
    timing,
  };
}

/**
 * Which sub-scene of a scene is on screen at `local` seconds.
 *
 * `timing.beats` lines up one-to-one with `scene.beats` and gives an empty
 * sub-scene a length of zero, so walking it in order needs no filtering and
 * `beatIndex` is a real index into the scene's own list - which is what the
 * editor and the script use, so the lit row and the playing code cannot drift
 * apart. The empty sub-scene still exists in the editor, where the author can
 * see it and fix it; it just gets no time in the video.
 */
function withinScene(
  scene: CodeScene,
  timing: SceneTiming,
  local: number,
): { local: number; beatIndex: number; beat: CodeBeat; beatLocal: number } {
  const clamped = Math.max(0, local);
  for (const [beatIndex, entry] of timing.beats.entries()) {
    if (entry.total <= 0) continue;
    if (clamped < entry.start + entry.total) {
      const beat = scene.beats[beatIndex];
      if (!beat) break;
      return {
        local: clamped,
        beatIndex,
        beat,
        beatLocal: Math.max(0, clamped - entry.start),
      };
    }
  }
  // On the hold, past the last sub-scene: the last one is still on screen, which
  // is what the hold means.
  let last = -1;
  for (let i = timing.beats.length - 1; i >= 0; i--) {
    if ((timing.beats[i]?.total ?? 0) > 0) {
      last = i;
      break;
    }
  }
  const beat = last >= 0 ? scene.beats[last] : scene.beats[0];
  return {
    local: clamped,
    beatIndex: last >= 0 ? last : 0,
    beat: beat ?? newBeat(),
    beatLocal: last >= 0 ? timing.beats[last]!.total : 0,
  };
}

/**
 * How much of a beat's code is on screen at `beatLocal` seconds.
 *
 * Returns whole units plus the fraction of the next, which is all the painter
 * needs: it draws every unit that is complete and clips the one that is not.
 */
export function beatProgress(
  scene: CodeScene,
  beat: CodeBeat,
  project: CodeProject,
  beatLocal: number,
): { done: number; partial: number; total: number } {
  const units = revealUnits(scene, beat, project);
  if (units.length === 0) return { done: 0, partial: 0, total: 0 };
  const typing = beatTiming(scene, beat, project).typing;
  const fraction = Math.min(1, Math.max(0, beatLocal / typing));
  const exact = fraction * units.length;
  const done = Math.min(units.length, Math.floor(exact));
  return { done, partial: exact - done, total: units.length };
}

/* ------------------------------------------------------------- normalizing */

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").slice(0, max)
    : fallback;
}

/** Line lists, deduped and kept inside the file. */
function lineList(value: unknown, total: number): number[] {
  if (!Array.isArray(value)) return [];
  const lines = value
    .map((n) => Math.trunc(num(n, -1)))
    .filter((n) => n >= 0 && n < total);
  return lines.filter((n, i) => lines.indexOf(n) === i);
}

/**
 * Repairs a sub-scene read from storage or from a pasted script.
 *
 * Every field is checked rather than assumed, because this model is edited by
 * pasting arbitrary text into it: a line index of 40000, a duration of nine
 * hours. All of it is survivable and none of it should be allowed to stop the
 * video from rendering.
 */
export function normalizeBeat(
  raw: unknown,
  totalLines: number,
  fallbackId = "beat",
): CodeBeat {
  const input = (raw ?? {}) as Record<string, unknown>;
  const lines = lineList(input.lines, totalLines);
  const marks = lineList(input.marks, lines.length);
  return {
    id: str(input.id, 64) || fallbackId,
    note: str(input.note ?? input.label, NOTE_MAX),
    lines,
    marks,
    duration: clamp(num(input.duration, BEAT_DEFAULT), BEAT_MIN, BEAT_MAX),
  };
}

/**
 * Repairs a scene read from storage or from a pasted script.
 *
 * A scene with no sub-scenes is kept. Dropping it here would mean un-ticking the
 * last line of a scene deletes the scene - including the code the author pasted
 * into it - which is the worst possible response to a click. `playableScenes`
 * keeps them out of the video instead, which is where they belong.
 */
export function normalizeScene(raw: unknown, fallbackId = "scene"): CodeScene {
  const input = (raw ?? {}) as Record<string, unknown>;
  const code = str(input.code, CODE_MAX_CHARS);
  const total = code ? code.split("\n").length : 0;
  const language = str(input.language, 40, "text");
  const fileName = str(input.fileName ?? input.file, FILENAME_MAX);

  const beats = Array.isArray(input.beats)
    ? input.beats
        .slice(0, BEATS_MAX)
        .map((beat, i) => normalizeBeat(beat, total, `beat_${i}`))
    : // A single scene with no sub-scenes plays its whole file, which is what
      // "one scene" means to somebody writing a script by hand.
      total > 0
        ? [normalizeBeat({ lines: Array.from({ length: total }, (_, i) => i) }, total, "beat_0")]
        : [];

  return {
    id: str(input.id, 64) || fallbackId,
    title: str(input.title, TITLE_MAX),
    caption: str(input.caption, CAPTION_MAX),
    fileName,
    code,
    // A language this build has no grammar for falls back to plain text rather
    // than being kept: the file will still be on screen, just without colour,
    // and the picker will show the real value so the mismatch is visible.
    language: hasGrammar(language) ? language : "text",
    beats,
    hold: clamp(num(input.hold, HOLD_DEFAULT), HOLD_MIN, HOLD_MAX),
    speed:
      input.speed === null || input.speed === undefined
        ? null
        : clamp(num(input.speed, SPEED_DEFAULT), SPEED_MIN, SPEED_MAX),
  };
}

/**
 * Brings a take-based project forward.
 *
 * The first version of this tool had one code block per take and derived the
 * length from how much code there was. A take becomes a scene with a single
 * sub-scene, and the take's old computed length is written down as the beat's
 * duration - so the video a person had already made comes out the same length
 * rather than being silently re-timed by the new model.
 *
 * The take's own line selection is carried over from `lines` and `marks` on the
 * take rather than taken from the scene, which is the difference between a
 * migrated project that still shows the six lines it was showing and one that
 * suddenly shows the whole file: `normalizeScene` is the wrong tool for a take,
 * because a take's `lines` are a selection, not the absence of sub-scenes.
 */
function scenesFromShots(input: Record<string, unknown>, project: CodeProject): CodeScene[] | null {
  if (!Array.isArray(input.shots)) return null;
  const speed = clamp(num(input.speed, SPEED_DEFAULT), SPEED_MIN, SPEED_MAX);
  const reveal = revealById(str(input.reveal, 40, "typewriter"));
  const oldProject: CodeProject = { ...project, speed, reveal };
  return input.shots.slice(0, SCENES_MAX).map((raw, i) => {
    const shot = (raw ?? {}) as Record<string, unknown>;
    const scene = normalizeScene(
      { ...shot, beats: [{ lines: shot.lines, marks: shot.marks ?? shot.highlight }] },
      `scene_${i}`,
    );
    const total = scene.code ? scene.code.split("\n").length : 0;
    // A take that had ticked nothing stays a scene with nothing in it, rather
    // than being filled out with the whole file: an empty take was invisible in
    // the old model and stays invisible here.
    const beat = normalizeBeat(
      { lines: shot.lines, marks: shot.marks ?? shot.highlight },
      total,
      "beat_0",
    );
    const lines = visibleLines(scene, beat);
    const units = revealUnits(scene, beat, oldProject);
    const chars = countChars(lines) + Math.max(0, lines.length - 1);
    const typing = reveal === "lines" ? (units.length / speed) * 2.4 : chars / speed;
    const hold = clamp(num(shot.hold, HOLD_DEFAULT), HOLD_MIN, HOLD_MAX);
    return {
      ...scene,
      beats: [
        { ...beat, note: str(shot.note, NOTE_MAX), duration: clamp(Math.max(0.35, typing) + hold, BEAT_MIN, BEAT_MAX) },
      ],
      // The hold is now inside the beat, so the scene adds none of its own.
      hold: HOLD_MIN,
    };
  });
}

/** The single entry point for reading a project, same as the other studios. */
export function normalizeProject(raw: unknown): CodeProject {
  const input = (raw ?? {}) as Record<string, unknown>;
  const base = defaultProject();
  const migrated = scenesFromShots(input, base);
  const scenes = migrated
    ? migrated
    : Array.isArray(input.scenes)
      ? input.scenes.slice(0, SCENES_MAX).map((scene, i) => normalizeScene(scene, `scene_${i}`))
      : [];

  const audioRaw = input.audio as Record<string, unknown> | null | undefined;
  const audio =
    audioRaw && typeof audioRaw.key === "string" && audioRaw.key
      ? {
          key: audioRaw.key,
          name: str(audioRaw.name, 120, "voice-over"),
          duration: Math.max(0, num(audioRaw.duration, 0)),
        }
      : null;

  const formatId = str(input.formatId, 40, "phone-vertical");
  return {
    version: CODE_PROJECT_VERSION,
    id: str(input.id, 64) || `proj_${Math.random().toString(36).slice(2, 10)}`,
    name: str(input.name, 80, base.name) || base.name,
    styleId: styleById(str(input.styleId, 40, "midnight")).id,
    reveal: revealById(str(input.reveal, 40, "typewriter")),
    formatId: formatById(FORMAT_ALIASES[formatId] ?? formatId).id,
    speed: clamp(num(input.speed, SPEED_DEFAULT), SPEED_MIN, SPEED_MAX),
    cursor: input.cursor === undefined ? true : !!input.cursor,
    captions: input.captions === undefined ? true : !!input.captions,
    notes: input.notes === undefined ? true : !!input.notes,
    scenes,
    audio,
  };
}
