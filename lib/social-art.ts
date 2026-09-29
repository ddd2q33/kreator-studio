/**
 * The vocabulary of the image composer: which canvases exist, which faces the
 * author may pick, how a post's design is validated — and which *looks* the
 * composer can dress a post in.
 *
 * This module deliberately imports nothing. `social-draft.ts` needs to validate
 * `art` while normalising a draft, and `social-image.ts` needs the same tables
 * while rendering; putting the shared data in a leaf keeps that a real
 * dependency arrow instead of a cycle.
 */

/** The handle stamped on the bottom centre of every image. */
export const BRAND_HANDLE = "@tryhardbooks";

export type CanvasId =
  | "instagram"
  | "story"
  | "facebook"
  | "x"
  | "linkedin"
  | "tiktok";

export type Canvas = {
  id: CanvasId;
  label: string;
  width: number;
  height: number;
  /** Where this size comes from, shown next to the picker. */
  note: string;
};

/**
 * Pixel sizes each platform actually accepts. Instagram and LinkedIn cap a
 * square at 1080/1200, X renders 16:9, and a link preview is a fixed 1200x630
 * on Facebook — 630, not 628, which is the number most tools get wrong.
 */
export const CANVASES: readonly Canvas[] = [
  {
    id: "instagram",
    label: "Instagram",
    width: 1080,
    height: 1080,
    note: "Post cuadrado, 1080×1080",
  },
  {
    id: "story",
    label: "Story / Reel",
    width: 1080,
    height: 1920,
    note: "Vertical 9:16, 1080×1920",
  },
  {
    id: "facebook",
    label: "Facebook",
    width: 1200,
    height: 630,
    note: "Link preview, 1200×630",
  },
  {
    id: "x",
    label: "X",
    width: 1600,
    height: 900,
    note: "16:9, 1600×900",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    width: 1200,
    height: 1200,
    note: "Cuadrado, 1200×1200",
  },
  {
    id: "tiktok",
    label: "TikTok",
    width: 1080,
    height: 1920,
    note: "Vertical 9:16, 1080×1920",
  },
];

export const DEFAULT_CANVAS_ID: CanvasId = "instagram";

export function canvasById(id: string | null | undefined): Canvas {
  return CANVASES.find((c) => c.id === id) ?? CANVASES[0];
}

export type FontId =
  | "georgia"
  | "segoe"
  | "impact"
  | "franklin"
  | "constantia"
  | "palatino"
  | "bahnschrift"
  | "candara"
  | "inter"
  | "recoleta";

export type PostFont = {
  id: FontId;
  label: string;
  /** Grouping in the picker, because "serif" alone does not tell an author much. */
  group: "Serif" | "Sans" | "Display" | "Humanist";
  /**
   * A CSS font stack. Each one leads with the face a post is *meant* to be set
   * in — Inter and Recoleta when the machine has them, because they are the
   * faces this genre of post is actually dressed in — and ends in a face
   * Windows or macOS ships, then a generic family. A missing font degrades to
   * something of the same shape instead of to Times New Roman, and the render
   * never needs the network.
   */
  stack: string;
  /**
   * Windows' Impact and similar display faces sit far larger on the body than
   * their nominal size suggests, so each font scales the start size itself.
   */
  scale: number;
  /** Display faces are all-caps by nature; capitalising them twice is noise. */
  upper: boolean;
};

export const FONTS: readonly PostFont[] = [
  {
    id: "georgia",
    label: "Georgia",
    group: "Serif",
    stack: "Georgia, 'Times New Roman', Times, serif",
    scale: 1,
    upper: false,
  },
  {
    id: "constantia",
    label: "Constantia",
    group: "Serif",
    stack: "Constantia, Cambria, Georgia, serif",
    scale: 1.05,
    upper: false,
  },
  {
    id: "palatino",
    label: "Palatino",
    group: "Serif",
    stack: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
    scale: 1.02,
    upper: false,
  },
  {
    id: "recoleta",
    label: "Recoleta",
    group: "Serif",
    stack: "Recoleta, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
    scale: 1.04,
    upper: false,
  },
  {
    id: "segoe",
    label: "Segoe UI",
    group: "Sans",
    stack: "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    scale: 1,
    upper: false,
  },
  {
    id: "inter",
    label: "Inter",
    group: "Sans",
    stack: "Inter, 'Segoe UI Variable Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    scale: 0.98,
    upper: false,
  },
  {
    id: "franklin",
    label: "Franklin Gothic",
    group: "Sans",
    stack: "'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif",
    scale: 0.92,
    upper: false,
  },
  {
    id: "bahnschrift",
    label: "Bahnschrift",
    group: "Sans",
    stack: "Bahnschrift, 'DIN Alternate', 'Segoe UI', sans-serif",
    scale: 0.95,
    upper: false,
  },
  {
    id: "candara",
    label: "Candara",
    group: "Humanist",
    stack: "Candara, Calibri, 'Segoe UI', sans-serif",
    scale: 1.06,
    upper: false,
  },
  {
    id: "impact",
    label: "Impact",
    group: "Display",
    stack: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
    scale: 0.7,
    upper: true,
  },
];

export const DEFAULT_FONT_ID: FontId = "georgia";

export function fontById(id: string | null | undefined): PostFont {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export type LayoutId = "veil" | "panel" | "solid" | "gradient";

export type PostLayout = {
  id: LayoutId;
  label: string;
  hint: string;
  /** Whether a dropped background image has anything to do with this layout. */
  usesPhoto: boolean;
};

export const LAYOUTS: readonly PostLayout[] = [
  {
    id: "veil",
    label: "Photo + veil",
    hint: "The photo fills the frame, dimmed so the words stay readable.",
    usesPhoto: true,
  },
  {
    id: "panel",
    label: "Photo + panel",
    hint: "Photo on top, solid block of colour underneath for the words.",
    usesPhoto: true,
  },
  {
    id: "solid",
    label: "Solid",
    hint: "One flat colour. No image, nothing to fight with.",
    usesPhoto: false,
  },
  {
    id: "gradient",
    label: "Gradient",
    hint: "Two colours bleeding into each other.",
    usesPhoto: false,
  },
];

export const DEFAULT_LAYOUT_ID: LayoutId = "gradient";

export function layoutById(id: string | null | undefined): PostLayout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}

export type StyleId = "aurora" | "card" | "poster" | "editorial" | "frame" | "clean";

/**
 * A *look*: the composed style that renders the frame. Where a layout answers
 * "where does the photograph go", a look answers "what does the frame feel
 * like" — it is composition, type setting and a starting palette in one pick.
 * The author keeps every knob afterwards; the look is the first move, not a
 * cage.
 */
export type VisualStyle = {
  id: StyleId;
  label: string;
  hint: string;
  /**
   * The palette applied when the look is picked. Curated rather than computed:
   * these are the combinations that survive a feed, and a randomiser would
   * hand the author a combination nobody would publish.
   */
  look: { base: string; accent: string; ink: string; font: FontId };
};

export const STYLES: readonly VisualStyle[] = [
  {
    id: "aurora",
    label: "Aurora",
    hint: "Deep base with light gathering in the corners.",
    look: { base: "#134e4a", accent: "#f59e0b", ink: "#fffbeb", font: "inter" },
  },
  {
    id: "card",
    label: "Card",
    hint: "A floating slab on a quiet stage, kicker chip included.",
    look: { base: "#1c1917", accent: "#fbbf24", ink: "#fafaf9", font: "inter" },
  },
  {
    id: "poster",
    label: "Poster",
    hint: "One huge serif statement, centred, rule under the CTA.",
    look: { base: "#fdf6ec", accent: "#b45309", ink: "#3d2f1e", font: "recoleta" },
  },
  {
    id: "editorial",
    label: "Editorial",
    hint: "Top rule, left-set headline. Magazine, not meme.",
    look: { base: "#faf7f2", accent: "#9a3412", ink: "#292524", font: "palatino" },
  },
  {
    id: "frame",
    label: "Frame",
    hint: "Double hairline border, centred. Ceremony without lace.",
    look: { base: "#f8f5ef", accent: "#0f766e", ink: "#1f2937", font: "constantia" },
  },
  {
    id: "clean",
    label: "Clean",
    hint: "White page, mono kicker, nothing to fight with.",
    look: { base: "#ffffff", accent: "#2563eb", ink: "#111827", font: "inter" },
  },
];

export const DEFAULT_STYLE_ID: StyleId = "aurora";

export function styleById(id: string | null | undefined): VisualStyle {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

/** The whole look as a patch: palette, face and the style id itself. */
export function styleLook(id: StyleId): Partial<PostArt> {
  return { style: id, ...styleById(id).look };
}

/**
 * The marks an author lays over the finished picture themselves.
 *
 * A note on what is deliberately *not* here: there is no quotation mark, no
 * sparkle, no ribbon. This tool writes posts, it does not write them for you —
 * that is the whole point of it — and a post that arrives wearing generated
 * ornaments is the thing readers recognise as machine-made. These are marks an
 * author chose to add with their own hands, so the list is short and every entry
 * is something a person might genuinely reach for to point at a line.
 *
 * Everything is a positioned box, including the shapes that look as though they
 * belong to the whole frame. That uniformity is deliberate: one geometry
 * function places all of them, so the drag overlay and the renderer can never
 * disagree about where a mark ended up.
 */
export type ElementId =
  | "asterisk"
  | "arrow"
  | "circle"
  | "frame"
  | "rule"
  | "highlight"
  | "corner";

export type ElementKind = {
  id: ElementId;
  label: string;
  /** How it is drawn. A glyph uses `glyph`; the rest are built from boxes. */
  shape: "glyph" | "ring" | "border" | "line" | "bar" | "bracket";
  /** The character used when `shape` is "glyph". */
  glyph?: string;
  /** Box width as a fraction of the canvas width, before `scale`. */
  base: number;
  /** Box height divided by its width. */
  aspect: number;
  /** Labels the colour picker for this mark. */
  colourLabel: string;
};

export const ELEMENT_KINDS: readonly ElementKind[] = [
  {
    id: "asterisk",
    label: "Asterisk",
    shape: "glyph",
    glyph: "✳",
    base: 0.2,
    aspect: 1,
    colourLabel: "Mark",
  },
  {
    id: "arrow",
    label: "Arrow",
    shape: "glyph",
    glyph: "→",
    base: 0.24,
    aspect: 1.5,
    colourLabel: "Mark",
  },
  {
    id: "circle",
    label: "Ring",
    shape: "ring",
    base: 0.3,
    aspect: 1,
    colourLabel: "Ring",
  },
  {
    id: "frame",
    label: "Frame",
    shape: "border",
    base: 0.78,
    aspect: 1.25,
    colourLabel: "Frame",
  },
  {
    id: "rule",
    label: "Rule",
    shape: "line",
    base: 0.55,
    aspect: 7,
    colourLabel: "Line",
  },
  {
    id: "highlight",
    label: "Colour bar",
    shape: "bar",
    base: 0.5,
    aspect: 4,
    colourLabel: "Bar",
  },
  {
    id: "corner",
    label: "Corner",
    shape: "bracket",
    base: 0.22,
    aspect: 1,
    colourLabel: "Corner",
  },
];

export function elementKind(id: string | null | undefined): ElementKind {
  return ELEMENT_KINDS.find((k) => k.id === id) ?? ELEMENT_KINDS[0];
}

export type ArtElement = {
  id: string;
  kind: ElementId;
  /** Centre of the box, as a fraction of the canvas. 0.5 is the middle. */
  x: number;
  y: number;
  /** Size multiplier applied to the kind's base. */
  scale: number;
  /** Hex, for the mark itself. */
  color: string;
};

/**
 * How far a mark's centre may stray from the canvas, as a fraction of it.
 *
 * Generous on purpose: a mark hung half off the edge is a legitimate look, and a
 * mark that can be dragged entirely off is a mark the author cannot find again.
 * The same limit is applied to dragged and to hand-written values, so a saved
 * post can never come back carrying something unreachable on it.
 */
export const ELEMENT_LIMIT = 0.25;

/** Smallest and largest a mark may be, relative to its base. */
export const ELEMENT_SCALE_MIN = 0.35;
export const ELEMENT_SCALE_MAX = 3;

let elementSeq = 0;

/** A new mark, placed where it will be noticed rather than over the words. */
export function newElement(kind: ElementId, index: number): ArtElement {
  elementSeq += 1;
  // Nudged down the right-hand side as more are added, so a second mark does not
  // land exactly on the first and make it look like nothing happened.
  const step = (index % 5) * 0.07;
  return {
    id: `el-${Date.now().toString(36)}-${elementSeq.toString(36)}`,
    kind,
    x: Math.min(0.9, 0.76 + step),
    y: Math.min(0.9, 0.2 + step),
    scale: 1,
    color: "#ffffff",
  };
}

/**
 * Everything about a post that is picture rather than prose. Kept off the text
 * half on purpose: the draft is the words, this is the treatment, and swapping
 * a background should not touch what the post says.
 */
export type PostArt = {
  canvas: CanvasId;
  font: FontId;
  layout: LayoutId;
  /** Which composed look renders the frame; the colours below stay editable. */
  style: StyleId;
  /**
   * Small label over the text ("Journal prompt"). Empty means the renderer
   * falls back to a per-template default, so a post made from a template
   * arrives already labelled without the author typing a kicker.
   */
  kicker: string;
  /** Text colour, as a hex string. */
  ink: string;
  /** The second colour: panel fill, or the gradient's far stop. */
  accent: string;
  /** The gradient's near stop, and the fill behind a solid layout. */
  base: string;
  /** 0–1. How hard the veil presses the photo down. */
  dim: number;
  /** Bottom-centre signature. */
  handle: string;
  /**
   * How large the signature is, as a multiple of the canvas-derived base.
   * 1 is small enough to disappear under the words; 1.6 is legible on a phone.
   */
  handleSize: number;
  /** Show the hashtag line. Off by default; it is usually noise on a picture. */
  showHashtags: boolean;
  /** Marks over the picture, in the order they were added. */
  elements: ArtElement[];
  /** A data: URL. Absent means "no photo", which is not an error. */
  background?: string;
};

export function defaultArt(): PostArt {
  return {
    canvas: DEFAULT_CANVAS_ID,
    font: DEFAULT_FONT_ID,
    layout: DEFAULT_LAYOUT_ID,
    style: DEFAULT_STYLE_ID,
    kicker: "",
    ink: "#fffbeb",
    accent: "#f59e0b",
    base: "#134e4a",
    dim: 0.45,
    handle: BRAND_HANDLE,
    handleSize: 1.6,
    showHashtags: false,
    elements: [],
  };
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value));

/**
 * A colour or the fallback. Used for every colour in this module, marks included,
 * so a hand-edited `url(javascript:...)` cannot end up inside a style attribute.
 */
const hexColor = (input: unknown, fallback: string): string =>
  typeof input === "string" && /^#[0-9a-f]{3,8}$/i.test(input.trim())
    ? input.trim()
    : fallback;

function readElements(value: unknown): ArtElement[] {
  if (!Array.isArray(value)) return [];
  const out: ArtElement[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const kind = ELEMENT_KINDS.find((k) => k.id === entry.kind);
    if (!kind) continue;
    const id = typeof entry.id === "string" && entry.id ? entry.id : `el-${out.length}`;
    // A duplicated id would make two marks share a drag target and delete together.
    if (seen.has(id)) continue;
    seen.add(id);
    const num = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fallback;
    out.push({
      id,
      kind: kind.id,
      x: clamp(num(entry.x, 0.5), -ELEMENT_LIMIT, 1 + ELEMENT_LIMIT),
      y: clamp(num(entry.y, 0.5), -ELEMENT_LIMIT, 1 + ELEMENT_LIMIT),
      scale: clamp(num(entry.scale, 1), ELEMENT_SCALE_MIN, ELEMENT_SCALE_MAX),
      color: hexColor(entry.color, "#ffffff"),
    });
  }
  return out;
}

/** Repairs anything a hand-edited JSON or an older draft might carry. */
export function normalizeArt(value: unknown): PostArt {
  const defaults = defaultArt();
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Record<string, unknown>;

  const hex = hexColor;

  const dim =
    typeof raw.dim === "number" && Number.isFinite(raw.dim) ? raw.dim : defaults.dim;

  const hasBackground =
    typeof raw.background === "string" && /^data:image\//i.test(raw.background);

  const art: PostArt = {
    canvas: CANVASES.some((c) => c.id === raw.canvas)
      ? (raw.canvas as CanvasId)
      : defaults.canvas,
    font: FONTS.some((f) => f.id === raw.font) ? (raw.font as FontId) : defaults.font,
    layout: LAYOUTS.some((l) => l.id === raw.layout)
      ? (raw.layout as LayoutId)
      : defaults.layout,
    style: STYLES.some((s) => s.id === raw.style)
      ? (raw.style as StyleId)
      : defaults.style,
    kicker:
      typeof raw.kicker === "string" ? raw.kicker.slice(0, 80) : defaults.kicker,
    ink: hex(raw.ink, defaults.ink),
    accent: hex(raw.accent, defaults.accent),
    base: hex(raw.base, defaults.base),
    dim: Math.min(0.85, Math.max(0, dim)),
    handle: typeof raw.handle === "string" ? raw.handle.slice(0, 40) : defaults.handle,
    handleSize: clamp(
      typeof raw.handleSize === "number" && Number.isFinite(raw.handleSize)
        ? raw.handleSize
        : defaults.handleSize,
      0.5,
      3,
    ),
    showHashtags: raw.showHashtags === true,
    elements: readElements(raw.elements),
  };

  // The key is added only when there is a photo, so a repaired object has the
  // same shape as `defaultArt()`. These objects are persisted and diffed, and a
  // stray `background: undefined` is a difference that is not a difference.
  //
  // A background is honoured only if it is a data: URL. Anything else would make
  // the headless render reach for the network, which is the one thing this path
  // is built to avoid.
  if (hasBackground) art.background = raw.background as string;

  return art;
}

/** The design for a draft that may not have one yet. */
export function artFor(value: unknown): PostArt {
  return normalizeArt(
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).art
      : undefined,
  );
}
