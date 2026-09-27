/**
 * Subtitle templates.
 *
 * A template is not just a colour scheme. It carries the typography, the
 * position, how a word arrives, what the word being spoken does, and the extras
 * that make a caption read as a designed object rather than burnt-in text. The
 * seven pro styles below are grouped by where they are meant to be used, because
 * a cinematic template on a TikTok is a worse choice than no template at all.
 *
 * Two decisions worth knowing about:
 *
 * The font stacks are concrete system families, not webfonts. The painter draws
 * into a canvas, and a canvas only sees a family name once it is actually
 * loaded; naming a font the page never loaded silently falls back, which is
 * exactly what the old `Inter` stack was doing. These render as asked on macOS,
 * Windows and Android without a network round trip.
 *
 * The `recommended` block is guidance, not a default. The studio reads the first
 * two fields for the portrait hint and ignores the rest, so a template can tell
 * the author what suits it without overriding their own settings.
 */

import {
  BASE_ENTRANCE_SECONDS,
  type KeywordMotion,
  type SubtitleEntrance,
} from "./subtitle-motion.ts";

/** How the spoken word is distinguished from the rest of the line. */
export type SubtitleHighlight =
  | "color"
  | "box"
  | "underline"
  | "glow"
  | "scale"
  | "gradient";

/** Line-level treatments, independent of the per-word highlight. */
export type SubtitleEffect = "shadow" | "softShadow" | "glow" | "progress";

export type SubtitleStyle = {
  id: string;
  label: string;
  /** Grouping in the picker. */
  category: string;
  /** One line shown on the template in the picker. */
  description: string;

  /** Text color. */
  color: string;
  /**
   * Color of the word currently being spoken. `null` keeps the style color,
   * for a look where only the highlight signals the beat.
   */
  highlightColor: string | null;
  /** Background behind the text: solid plate, translucent plate, or none. */
  plate: "solid" | "translucent" | "none";
  /** Plate fill (css color). */
  plateColor: string;
  /** Outline stroke around glyphs when there is no plate. */
  strokeColor: string | null;
  strokeWidthRatio: number;
  /** Weight multiplier over the base 600. */
  fontWeight: number;
  /** Size multiplier over the base 0.042 * min(w, h*0.8). */
  sizeRatio: number;
  /** Vertical position of the box bottom, as a fraction of h. */
  bottomRatio: number;
  /** Extra letter spacing in px at 1080p scale (approximated per font size). */
  tracking: number;

  /** Concrete family stack. See the note at the top of this file. */
  fontFamily: string;
  /** `left` and `right` are relative to the box, which itself is centred. */
  align: "center" | "left" | "right";
  /** Corner rounding of the plate, as a fraction of the font size. */
  plateRadius: number;
  /** Padding inside the plate, in font-size multiples. */
  platePadding: number;

  /** Drop shadow behind every glyph. */
  shadow: { color: string; blurRatio: number; offsetRatio: number } | null;

  entrance: SubtitleEntrance;
  keywordMotion: KeywordMotion;
  /** Multiplier over the 0.2s base entrance. Higher is faster. */
  speed: number;
  highlight: SubtitleHighlight;
  effects: readonly SubtitleEffect[];
  /** Second color for `gradient`, otherwise unused. */
  gradientTo: string | null;
  /** Guidance shown to the author; never applied automatically. */
  recommended: {
    format: string;
    useFor: string;
    note: string;
  };
};

/** Concrete, reliably available stacks. See the note at the top. */
const SANS = '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';
const HEAVY = '"Arial Black", "Helvetica Neue", Arial, system-ui, sans-serif';
const ROUNDED =
  '"SF Pro Rounded", "Segoe UI", "Trebuchet MS", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", Times, serif';

const SOFT_SHADOW = {
  color: "rgba(0, 0, 0, 0.55)",
  blurRatio: 0.34,
  offsetRatio: 0.06,
};
const HARD_SHADOW = {
  color: "rgba(0, 0, 0, 0.85)",
  blurRatio: 0.12,
  offsetRatio: 0.09,
};
const GLOW_SHADOW = {
  color: "rgba(0, 0, 0, 0.7)",
  blurRatio: 0.5,
  offsetRatio: 0.04,
};

/** The six originals, kept so saved projects keep rendering as they did. */
const BASIC: SubtitleStyle[] = [
  {
    id: "plate",
    label: "Plate",
    category: "Basics",
    description: "The dependable default: a dark plate under white text.",
    color: "#ffffff",
    highlightColor: "#ffd400",
    plate: "translucent",
    plateColor: "rgba(2, 6, 14, 0.62)",
    strokeColor: null,
    strokeWidthRatio: 0,
    fontWeight: 600,
    sizeRatio: 1,
    bottomRatio: 0.055,
    tracking: 0,
    fontFamily: SANS,
    align: "center",
    plateRadius: 0.4,
    platePadding: 0.55,
    shadow: null,
    entrance: "none",
    keywordMotion: "none",
    speed: 1,
    highlight: "color",
    effects: [],
    gradientTo: null,
    recommended: {
      format: "Any",
      useFor: "General narration",
      note: "The safe choice when nothing else is specified.",
    },
  },
  {
    id: "tiktok",
    label: "TikTok punch",
    category: "Basics",
    description: "Huge white caps with a hard black edge and a cyan beat.",
    color: "#ffffff",
    highlightColor: "#25f4ee",
    plate: "none",
    plateColor: "transparent",
    strokeColor: "#000000",
    strokeWidthRatio: 0.16,
    fontWeight: 900,
    sizeRatio: 1.25,
    bottomRatio: 0.14,
    tracking: 0.02,
    fontFamily: HEAVY,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: null,
    entrance: "none",
    keywordMotion: "none",
    speed: 1,
    highlight: "color",
    effects: [],
    gradientTo: null,
    recommended: {
      format: "9:16",
      useFor: "Short-form hooks",
      note: "Loud by design; too much of it is exhausting.",
    },
  },
  {
    id: "reels",
    label: "Reels bold",
    category: "Basics",
    description: "Tighter than the TikTok punch, pink beat, softer edge.",
    color: "#ffffff",
    highlightColor: "#ff2d78",
    plate: "none",
    plateColor: "transparent",
    strokeColor: "rgba(0,0,0,0.85)",
    strokeWidthRatio: 0.09,
    fontWeight: 800,
    sizeRatio: 1.12,
    bottomRatio: 0.1,
    tracking: 0.01,
    fontFamily: HEAVY,
    align: "center",
    plateRadius: 0.35,
    platePadding: 0.45,
    shadow: null,
    entrance: "none",
    keywordMotion: "none",
    speed: 1,
    highlight: "color",
    effects: [],
    gradientTo: null,
    recommended: {
      format: "9:16",
      useFor: "Social captions",
      note: "A middle ground between shouty and neutral.",
    },
  },
  {
    id: "yellow",
    label: "Classic yellow",
    category: "Basics",
    description: "Yellow text on a hard outline, the old-school look.",
    color: "#ffd400",
    highlightColor: "#ffffff",
    plate: "none",
    plateColor: "transparent",
    strokeColor: "#000000",
    strokeWidthRatio: 0.11,
    fontWeight: 700,
    sizeRatio: 1.05,
    bottomRatio: 0.06,
    tracking: 0,
    fontFamily: SANS,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: null,
    entrance: "none",
    keywordMotion: "none",
    speed: 1,
    highlight: "color",
    effects: [],
    gradientTo: null,
    recommended: {
      format: "16:9",
      useFor: "Emphasis",
      note: "Reads as dated next to the pro templates.",
    },
  },
  {
    id: "bar",
    label: "Lower bar",
    category: "Basics",
    description: "A solid black band with a cool blue beat.",
    color: "#ffffff",
    highlightColor: "#7dd3fc",
    plate: "solid",
    plateColor: "rgba(0, 0, 0, 0.92)",
    strokeColor: null,
    strokeWidthRatio: 0,
    fontWeight: 700,
    sizeRatio: 0.95,
    bottomRatio: 0,
    tracking: 0,
    fontFamily: SANS,
    align: "center",
    plateRadius: 0,
    platePadding: 0.7,
    shadow: null,
    entrance: "none",
    keywordMotion: "none",
    speed: 1,
    highlight: "color",
    effects: [],
    gradientTo: null,
    recommended: {
      format: "16:9",
      useFor: "Interviews",
      note: "Deliberately unstyled; easy to read, easy to ignore.",
    },
  },
  {
    id: "minimal",
    label: "Minimal clean",
    category: "Basics",
    description: "Light weight, wide tracking, a lime beat.",
    color: "#ffffff",
    highlightColor: "#a3e635",
    plate: "none",
    plateColor: "transparent",
    strokeColor: "rgba(0,0,0,0.55)",
    strokeWidthRatio: 0.05,
    fontWeight: 500,
    sizeRatio: 0.9,
    bottomRatio: 0.045,
    tracking: 0.03,
    fontFamily: SANS,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: null,
    entrance: "none",
    keywordMotion: "none",
    speed: 1,
    highlight: "color",
    effects: [],
    gradientTo: null,
    recommended: {
      format: "Any",
      useFor: "Quiet captions",
      note: "Disappears a little too easily over busy footage.",
    },
  },
];

/**
 * The seven designed styles.
 *
 * The numbers are chosen for a 9:16 frame viewed on a phone held at arm's
 * length: `sizeRatio` against a 0.042 base is the single biggest lever on
 * legibility, and anything under 0.9 fails on a small screen outdoors.
 */
const PRO: SubtitleStyle[] = [
  {
    id: "pro-minimal",
    label: "Minimal Premium",
    category: "Pro",
    description:
      "Transparent, white, one accent colour. Documentary restraint.",
    color: "#ffffff",
    highlightColor: "#f5c542",
    plate: "none",
    plateColor: "transparent",
    strokeColor: null,
    strokeWidthRatio: 0,
    fontWeight: 600,
    sizeRatio: 0.95,
    bottomRatio: 0.08,
    tracking: 0.005,
    fontFamily: SANS,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: SOFT_SHADOW,
    entrance: "fade",
    keywordMotion: "none",
    speed: 1.1,
    highlight: "color",
    effects: ["softShadow"],
    gradientTo: null,
    recommended: {
      format: "9:16",
      useFor: "Psychology, storytelling, interviews",
      note: "The one to reach for when the footage is the point.",
    },
  },
  {
    id: "pro-viral",
    label: "Viral Shorts",
    category: "Pro",
    description:
      "Big centred caps, word-by-word pop, hard shadow. Built to hold attention.",
    color: "#ffffff",
    highlightColor: "#ffe600",
    plate: "none",
    plateColor: "transparent",
    strokeColor: "#000000",
    strokeWidthRatio: 0.14,
    fontWeight: 900,
    sizeRatio: 1.3,
    bottomRatio: 0.18,
    tracking: 0.01,
    fontFamily: HEAVY,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: HARD_SHADOW,
    entrance: "pop",
    keywordMotion: "pop",
    speed: 1.6,
    highlight: "scale",
    effects: ["shadow"],
    gradientTo: null,
    recommended: {
      format: "9:16",
      useFor: "Hooks, marketing, retention",
      note: "Fast. Pairs with short sentences, not dense ones.",
    },
  },
  {
    id: "pro-podcast",
    label: "Podcast Modern",
    category: "Pro",
    description:
      "Elegant lower thirds with a progress bar tracking the line.",
    color: "#f8fafc",
    highlightColor: "#38bdf8",
    plate: "translucent",
    plateColor: "rgba(8, 12, 22, 0.78)",
    strokeColor: null,
    strokeWidthRatio: 0,
    fontWeight: 500,
    sizeRatio: 0.9,
    bottomRatio: 0.05,
    tracking: 0,
    fontFamily: SANS,
    align: "left",
    plateRadius: 0.5,
    platePadding: 0.85,
    shadow: null,
    entrance: "rise",
    keywordMotion: "none",
    speed: 0.9,
    highlight: "color",
    effects: ["progress"],
    gradientTo: null,
    recommended: {
      format: "9:16",
      useFor: "Podcast clips, talking heads",
      note: "The bar shows how much of the line is left.",
    },
  },
  {
    id: "pro-educational",
    label: "Educational",
    category: "Pro",
    description:
      "Soft contrast, calm motion, sized for long explanations.",
    color: "#f1f5f9",
    highlightColor: "#7dd3fc",
    plate: "translucent",
    plateColor: "rgba(15, 23, 42, 0.72)",
    strokeColor: null,
    strokeWidthRatio: 0,
    fontWeight: 500,
    sizeRatio: 0.92,
    bottomRatio: 0.06,
    tracking: 0.005,
    fontFamily: SANS,
    align: "center",
    plateRadius: 0.45,
    platePadding: 0.7,
    shadow: null,
    entrance: "fade",
    keywordMotion: "none",
    speed: 0.85,
    highlight: "underline",
    effects: [],
    gradientTo: null,
    recommended: {
      format: "9:16",
      useFor: "Lessons, courses, walkthroughs",
      note: "Never pops; the eye can rest on the text.",
    },
  },
  {
    id: "pro-cinematic",
    label: "Cinematic",
    category: "Pro",
    description:
      "Elegant serif, slow arrivals, a filmic fade rather than a punch.",
    color: "#f5f0e6",
    highlightColor: "#e8c88a",
    plate: "none",
    plateColor: "transparent",
    strokeColor: null,
    strokeWidthRatio: 0,
    fontWeight: 500,
    sizeRatio: 0.9,
    bottomRatio: 0.09,
    tracking: 0.06,
    fontFamily: SERIF,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: GLOW_SHADOW,
    entrance: "cinematic",
    keywordMotion: "none",
    speed: 0.55,
    highlight: "color",
    effects: ["softShadow"],
    gradientTo: null,
    recommended: {
      format: "16:9",
      useFor: "Storytelling, brand film, quotes",
      note: "The slowest template here; resist speeding it up.",
    },
  },
  {
    id: "pro-creator",
    label: "Creator Style",
    category: "Pro",
    description:
      "Rounded, bouncy, playful. Highlights land on a beat rather than a colour.",
    color: "#ffffff",
    highlightColor: "#c084fc",
    plate: "none",
    plateColor: "transparent",
    strokeColor: "#1b1033",
    strokeWidthRatio: 0.1,
    fontWeight: 800,
    sizeRatio: 1.1,
    bottomRatio: 0.15,
    tracking: 0.01,
    fontFamily: ROUNDED,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: HARD_SHADOW,
    entrance: "bounce",
    keywordMotion: "bounce",
    speed: 1.35,
    highlight: "box",
    effects: ["shadow"],
    gradientTo: null,
    recommended: {
      format: "9:16",
      useFor: "Lifestyle, reaction, informal explainers",
      note: "Bouncy on purpose. Wrong register for a brand launch.",
    },
  },
  {
    id: "pro-ai",
    label: "AI Content",
    category: "Pro",
    description:
      "Futuristic gradient type with a soft glow. Reads as machine-made.",
    color: "#e0f2fe",
    highlightColor: "#a78bfa",
    plate: "none",
    plateColor: "transparent",
    strokeColor: "rgba(0, 0, 0, 0.5)",
    strokeWidthRatio: 0.05,
    fontWeight: 700,
    sizeRatio: 0.95,
    bottomRatio: 0.1,
    tracking: 0.02,
    fontFamily: SANS,
    align: "center",
    plateRadius: 0.3,
    platePadding: 0.4,
    shadow: GLOW_SHADOW,
    entrance: "zoom",
    keywordMotion: "glow",
    speed: 1.1,
    highlight: "gradient",
    effects: ["glow"],
    gradientTo: "#22d3ee",
    recommended: {
      format: "9:16",
      useFor: "Tech, AI topics, product demos",
      note: "Very specific in tone; not neutral.",
    },
  },
];

/**
 * Pro first, so the flat order matches the picker's grouping and the newest
 * work is what a caller iterating the list sees first. `subtitleStyleById` does
 * not depend on this: it falls back to `DEFAULT_SUBTITLE_STYLE_ID` by name.
 */
export const SUBTITLE_STYLES: readonly SubtitleStyle[] = [...PRO, ...BASIC];

/** Grouped for the picker, in the order they should appear. */
export const SUBTITLE_STYLE_GROUPS: readonly { label: string; ids: readonly string[] }[] =
  [
    { label: "Pro", ids: PRO.map((s) => s.id) },
    { label: "Basics", ids: BASIC.map((s) => s.id) },
  ];

export const DEFAULT_SUBTITLE_STYLE_ID = "plate";

export function subtitleStyleById(id: string | null | undefined): SubtitleStyle {
  return (
    SUBTITLE_STYLES.find((s) => s.id === id) ??
    SUBTITLE_STYLES.find((s) => s.id === DEFAULT_SUBTITLE_STYLE_ID)!
  );
}

/** Seconds an entrance takes for this template, tempo included. */
export function entranceSecondsFor(style: SubtitleStyle): number {
  return BASE_ENTRANCE_SECONDS / Math.max(0.25, style.speed);
}
