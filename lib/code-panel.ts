import {
  CODE_LANGUAGES,
  lineText,
  tokenizeCode,
  type CodeLine,
  type CodeTokenKind,
} from "./code-highlight.ts";
import { DEFAULT_CODE_THEME, type CodeReveal, type SceneCode } from "./scene-schema.ts";

/**
 * The code card a scene paints on its frame.
 *
 * The video editor draws straight onto a canvas, so this is a painter and not a
 * component: there is no DOM, no scrollbar and no text selection, only rounded
 * rectangles and `fillText`. That constraint is the reason for the two rules
 * that run through this file - the font is measured rather than declared, and
 * nothing here may read layout from the page, because the same call has to
 * produce the same pixels in the preview canvas and in the exported file.
 *
 * A snippet is chosen by the author and drawn as given. No reflowing, no
 * re-indenting, no auto-wrapping: a programming video lives or dies on the
 * author pasting exactly the lines they meant to show. A line too long for the
 * card is cut at the edge rather than bent onto a second line, which is what
 * every code editor does and what a viewer expects to see.
 */

/** One palette. Every role the tokenizer can produce is named here. */
export type CodePanelTheme = {
  id: string;
  label: string;
  /** Card fill. */
  background: string;
  /** The card's own border, one step up from the fill. */
  border: string;
  /** The header strip, where the language is named. */
  chrome: string;
  /** Line numbers in the gutter. */
  gutter: string;
  /** Plain code text, and the caret. */
  plain: string;
  tokens: Record<CodeTokenKind, string>;
};

/**
 * Four palettes, not a dozen.
 *
 * A video's palette has to survive being watched on a phone in daylight, which
 * rules out low-contrast themes, and it has to sit on top of a brand gradient
 * without fighting it, which rules out anything with transparency in the fill.
 * Four is what that leaves once each one is checked against the others.
 */
export const CODE_PANEL_THEMES: readonly CodePanelTheme[] = [
  {
    id: "midnight",
    label: "Midnight",
    background: "#0b1220",
    border: "#1e2c44",
    chrome: "#131d2e",
    gutter: "#4a5b78",
    plain: "#d7e0f0",
    tokens: {
      plain: "#d7e0f0",
      keyword: "#ff9ec4",
      string: "#a5e075",
      comment: "#6b7d99",
      number: "#f7c66b",
      function: "#7cc4ff",
      type: "#7ee0d0",
      variable: "#e6e9f2",
      punctuation: "#8fa1bd",
    },
  },
  {
    id: "paper",
    label: "Paper",
    background: "#fbfaf7",
    border: "#ddd8cd",
    chrome: "#f1eee6",
    gutter: "#a49d8e",
    plain: "#1f2933",
    tokens: {
      plain: "#1f2933",
      keyword: "#a626a4",
      string: "#3f8f4f",
      comment: "#8b93a1",
      number: "#b2621b",
      function: "#2b6cb0",
      type: "#0f7b8a",
      variable: "#1f2933",
      punctuation: "#6b7280",
    },
  },
  {
    id: "carbon",
    label: "Carbon",
    background: "#111111",
    border: "#2b2b2b",
    chrome: "#191919",
    gutter: "#5c5c5c",
    plain: "#f2f2f2",
    tokens: {
      plain: "#f2f2f2",
      keyword: "#ff7b72",
      string: "#a5d6ff",
      comment: "#8b949e",
      number: "#79c0ff",
      function: "#d2a8ff",
      type: "#ffa657",
      variable: "#f2f2f2",
      punctuation: "#9aa4b2",
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    background: "#241a2b",
    border: "#3d2c47",
    chrome: "#2e2138",
    gutter: "#8a6f9b",
    plain: "#f6ecf7",
    tokens: {
      plain: "#f6ecf7",
      keyword: "#ff9f68",
      string: "#b8e986",
      comment: "#9a7fae",
      number: "#ffd479",
      function: "#8ad7f0",
      type: "#f7a8c4",
      variable: "#f6ecf7",
      punctuation: "#c3a9cf",
    },
  },
];

/**
 * What each reveal is called in the inspector.
 *
 * The stored values are terse because they are values in a JSON file an author
 * may hand-write; the labels are words, because they are for a person choosing
 * between them.
 */
export const CODE_REVEAL_LABELS: Record<CodeReveal, string> = {
  all: "All at once",
  typed: "Typed out",
  lines: "Line by line",
};

/** Looks a palette up by id, falling back to the default rather than failing. */export function codePanelTheme(id: string | null | undefined): CodePanelTheme {
  return (
    CODE_PANEL_THEMES.find((t) => t.id === id) ??
    CODE_PANEL_THEMES.find((t) => t.id === DEFAULT_CODE_THEME) ??
    CODE_PANEL_THEMES[0]!
  );
}

/**
 * The monospace family the card is drawn in.
 *
 * Read from the same CSS variable the editor uses, so the snippet in the frame
 * and the snippet in the inspector are the same typeface. Cached, because this
 * is called once per frame during an export and `getComputedStyle` is not free;
 * and it falls back to the generic monospace family when there is no document,
 * which is the case in a Node test.
 */
let cachedFamily: string | null = null;

export function monoFamily(): string {
  if (cachedFamily !== null) return cachedFamily;
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    cachedFamily = "monospace";
    return cachedFamily;
  }
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-geist-mono")
    .trim();
  cachedFamily = declared ? `${declared}, monospace` : "monospace";
  return cachedFamily;
}

/** Everything the painter needs beyond the frame. */
export type PaintCodePanelOptions = {
  /** The snippet to draw. */
  code: SceneCode;
  /**
   * How far through the scene the frame is, 0 to 1.
   *
   * A fraction and not seconds, because that is what the renderer works in:
   * the same frame has to look the same in the preview and in the export, and
   * the preview only ever knows where it is in the scene, not when it is. A
   * reveal paced in seconds would be wrong the moment a scene's duration
   * changed.
   */
  progress: number;
  /**
   * Leave room at the bottom of the frame, in pixels, for the burned-in
   * subtitles. The card is centred in what is left, so the two never overlap.
   */
  reservedBottom?: number;
};

const PAD = 0.028; // of the frame width
const HEADER = 0.05; // of the frame width
const GUTTER = 0.062; // of the frame width
const MAX_HEIGHT = 0.66; // of the frame height
const MIN_SIZE = 0.011; // of the frame width
/**
 * Both reveals finish this far into the scene, not at the very last frame.
 *
 * The tail of a scene is the beat where the reader looks at the finished code,
 * so the animation has to be over before the cut rather than landing on it.
 */
const REVEAL_END = 0.9;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * How much of the snippet is on screen at this point in the scene.
 *
 * Returned as a line count plus a fraction of the last visible line, so the
 * "typed" reveal can show a half-finished line - which is the whole point of
 * it, a video about code should look like the code is being written.
 */
function revealState(
  lines: CodeLine[],
  reveal: CodeReveal,
  progress: number,
): { whole: number; partial: number } {
  if (reveal === "all" || lines.length === 0) {
    return { whole: lines.length, partial: 0 };
  }
  // The animation runs over the first REVEAL_END of the scene and then holds.
  const done = clamp(progress / REVEAL_END, 0, 1);
  if (reveal === "lines") {
    // Never fewer than one line: a frame with an empty card is a broken frame.
    const shown = 1 + Math.floor(done * lines.length);
    return { whole: clamp(shown, 1, lines.length), partial: 0 };
  }
  const total = lines.reduce((acc, line) => acc + lineText(line).length, 0);
  const wanted = Math.floor(total * done);
  if (wanted >= total) return { whole: lines.length, partial: 0 };
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const length = lineText(lines[i]!).length;
    if (seen + length > wanted) {
      return { whole: i, partial: clamp(wanted - seen, 0, length) };
    }
    seen += length + 1; // the newline counts, so the cursor walks the file
  }
  return { whole: lines.length, partial: 0 };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Paints the snippet. Returns nothing: the caller decides where it goes, and
 * this only draws inside the card it chose.
 */
export function paintCodePanel(
  ctx: CanvasRenderingContext2D,
  frameW: number,
  frameH: number,
  options: PaintCodePanelOptions,
): void {
  const { code, progress } = options;
  const theme = codePanelTheme(code.theme);
  const lines = tokenizeCode(code.source, code.language);
  // A snippet of nothing but blank lines is nothing, and an empty card with a
  // header and a gutter is worse than no card: it reads as a broken export.
  if (lines.every((line) => lineText(line).trim() === "")) return;
  const state = revealState(lines, code.reveal, progress);
  const visible = lines.slice(0, state.whole);
  const partial = state.partial > 0 ? lines[state.whole] : undefined;
  if (visible.length === 0 && !partial) return;

  const pad = Math.round(frameW * PAD);
  const reserved = options.reservedBottom ?? 0;
  const maxH = frameH * MAX_HEIGHT;
  const cardW = Math.round(frameW * 0.88);
  const innerW = cardW - pad * 2 - Math.round(frameW * GUTTER);

  // Font size is the largest one whose widest line and whose line count both
  // fit the card. Measuring beats guessing because a snippet is 30 characters
  // in one scene and 300 in the next, and the author should not have to think
  // about either.
  const family = monoFamily();
  const wanted = Math.round(frameW * 0.021 * code.scale);
  const floorSize = Math.round(frameW * MIN_SIZE);
  const headerH = Math.round(frameW * HEADER);
  const maxLines = Math.max(1, visible.length + (partial ? 1 : 0));

  // The advance of a monospace glyph is linear in the font size, so one
  // measurement scales to every candidate size and the loops below cost one
  // measure instead of one per step.
  ctx.font = `500 ${wanted}px ${family}`;
  const unit = (ctx.measureText("M").width || wanted * 0.6) / wanted;
  const longest = Math.max(
    1,
    ...visible.map((line) => lineText(line).length),
    partial ? Math.min(lineText(partial).length, state.partial) : 1,
  );

  let size = wanted;
  while (size > floorSize && size * unit * longest > innerW) size -= 1;
  // Then the height, which is the limit that bites on a long snippet.
  const usable = maxH - headerH - pad;
  while (
    size > floorSize &&
    Math.round(size * 1.42) * maxLines > usable
  ) {
    size -= 1;
  }
  const advance = size * unit;
  const step = Math.round(size * 1.42);
  // What actually fits, which is fewer lines than the snippet has on a snippet
  // too long for the card - the top of the file, the way a scrolling editor
  // shows the top of a long file.
  const lineCount = Math.max(1, Math.min(maxLines, Math.floor(usable / step)));
  const cardH = Math.min(
    maxH,
    headerH + Math.round(pad * 0.6) + step * lineCount + Math.round(pad * 0.6),
  );
  const cardX = Math.round((frameW - cardW) / 2);
  const cardY = Math.round(
    Math.max(pad, (frameH - reserved - cardH) / 2),
  );

  ctx.save();
  // A shadow rather than a border on both: a card sitting on a brand gradient
  // reads as a card because it floats, not because it is outlined.
  ctx.shadowColor = "rgba(2, 6, 20, 0.45)";
  ctx.shadowBlur = Math.round(frameW * 0.02);
  ctx.shadowOffsetY = Math.round(frameW * 0.006);
  ctx.fillStyle = theme.background;
  roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(frameW * 0.012));
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = Math.max(1, Math.round(frameW * 0.0012));
  ctx.stroke();

  // Header: three dots and the language, the way every code window looks, so
  // the frame reads as a snippet rather than as a block of text.
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(frameW * 0.012));
  ctx.clip();
  ctx.fillStyle = theme.chrome;
  ctx.fillRect(cardX, cardY, cardW, headerH);
  ctx.fillStyle = theme.border;
  ctx.fillRect(cardX, cardY + headerH - 1, cardW, 1);
  const dot = Math.round(headerH * 0.16);
  const dots = ["#ff5f57", "#febc2e", "#28c840"];
  dots.forEach((colour, i) => {
    ctx.beginPath();
    ctx.fillStyle = colour;
    ctx.arc(
      cardX + pad * 0.8 + i * dot * 2.4,
      cardY + headerH / 2,
      dot,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  });
  ctx.font = `600 ${Math.round(headerH * 0.34)}px ${family}`;
  ctx.fillStyle = theme.gutter;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    code.language && code.language !== "text" ? code.language : "text",
    cardX + cardW - pad * 0.8,
    cardY + headerH / 2,
  );
  ctx.restore();

  // The code itself, clipped to the card so a long line ends at the edge.
  const textLeft = cardX + pad + Math.round(frameW * GUTTER);
  const top = cardY + headerH + Math.round(pad * 0.6);
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(frameW * 0.012));
  ctx.clip();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `500 ${size}px ${family}`;

  // A snippet taller than the card is anchored to its last line, not its
  // first: a reveal adds lines at the end, and showing the top of a long file
  // would hide exactly the lines that just appeared.
  const first = Math.max(0, maxLines - lineCount);
  for (let row = 0; row < lineCount; row++) {
    const index = first + row;
    const line = visible[index];
    if (!line) break;
    const y = top + step * row + step / 2;
    ctx.font = `500 ${Math.round(size * 0.82)}px ${family}`;
    ctx.fillStyle = theme.gutter;
    ctx.textAlign = "right";
    ctx.fillText(String(index + 1), textLeft - Math.round(size * 0.7), y);
    ctx.font = `500 ${size}px ${family}`;
    ctx.textAlign = "left";
    let x = textLeft;
    for (const token of line) {
      ctx.fillStyle = theme.tokens[token.kind];
      ctx.fillText(token.text, x, y);
      x += token.text.length * advance;
      if (x > cardX + cardW) break; // past the edge: stop drawing, do not wrap
    }
    if (index === visible.length - 1 && partial) {
      // The half-written line under the caret, which is what makes the typed
      // reveal look like typing rather than like a wipe.
      ctx.save();
      roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(frameW * 0.012));
      ctx.clip();
      const rest = partialLine(partial, state.partial);
      let cx = x;
      for (const token of rest) {
        ctx.fillStyle = theme.tokens[token.kind];
        ctx.fillText(token.text, cx, y);
        cx += token.text.length * advance;
      }
      ctx.fillStyle = theme.plain;
      const caretH = Math.round(size * 1.1);
      ctx.fillRect(
        cx + 1,
        y - caretH / 2,
        Math.max(1, Math.round(size * 0.07)),
        caretH,
      );
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.restore();
}

/** The first `count` characters of a line, split back into runs. */
function partialLine(line: CodeLine, count: number): CodeLine {
  const out: CodeLine = [];
  let left = count;
  for (const token of line) {
    if (left <= 0) break;
    if (token.text.length <= left) {
      out.push(token);
      left -= token.text.length;
    } else {
      out.push({ text: token.text.slice(0, left), kind: token.kind });
      left = 0;
    }
  }
  return out;
}

/** The languages the inspector offers, re-exported so the UI has one import. */
export { CODE_LANGUAGES };
