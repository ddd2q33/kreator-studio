import {
  CODE_LANGUAGES,
  lineText,
  tokenizeCode,
  type CodeLine,
  type CodeTokenKind,
} from "./code-highlight.ts";
import { diffLines } from "./code-diff.ts";
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
  /** Whole-row colour of an added line in a diff. */
  diffAdd: string;
  /** Whole-row colour of a removed line in a diff. */
  diffDel: string;
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
    diffAdd: "#7ee787",
    diffDel: "#ff7b72",
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
    diffAdd: "#1a7f37",
    diffDel: "#cf222e",
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
    diffAdd: "#7ee787",
    diffDel: "#ff7b72",
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
    diffAdd: "#8ce99a",
    diffDel: "#ff8f8f",
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

/**
 * A callout label pinned to one line of the snippet.
 *
 * The card is laid out in a pure pass first (so tests and the UI can reuse the
 * geometry without a canvas) and painted from that layout.
 */
export type CalloutLayout = {
  /** 1-based line number the label belongs to. */
  line: number;
  /** Label text as authored; the painter cuts it to what fits the column. */
  text: string;
  /** Left edge of the label box, in frame pixels. */
  x: number;
  /** Top edge of the label box, in frame pixels. */
  y: number;
  /** Width of the label box, in frame pixels. */
  w: number;
  /** Height of the label box, in frame pixels. */
  h: number;
  /**
   * True when the label sits on its own line's row. A label whose line has
   * scrolled off the card (or shares a row with an earlier label) is pinned to
   * the nearest free row instead, and draws without a connector so it never
   * points at the wrong line.
   */
  anchored: boolean;
};

/**
 * Everything the card painting step decided, in frame pixels.
 *
 * Exported so tests can assert geometry without a canvas, and so the editor
 * can draw the same boxes the video will burn in.
 */
export type CodeCardLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Row height of one snippet line, in frame pixels. */
  rowH: number;
  /** First visible snippet line (0-based). */
  firstLine: number;
  /** How many rows fit the card, revealed lines or not. */
  rows: number;
  /** Callout labels, positioned; the painter draws every one of these. */
  callouts: CalloutLayout[];
};

/** Looks a palette up by id, falling back to the default rather than failing. */
export function codePanelTheme(id: string | null | undefined): CodePanelTheme {
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
  /**
   * Receives the card geometry the painter decided on, in frame pixels —
   * callout boxes included. The editor uses it to draw the same boxes the
   * video will burn in; tests use it to assert geometry without a canvas.
   */
  onLayout?: (layout: CodeCardLayout) => void;
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

export function paintCodePanel(
  ctx: CanvasRenderingContext2D,
  frameW: number,
  frameH: number,
  options: PaintCodePanelOptions,
): void {
  const { code, progress } = options;
  const theme = codePanelTheme(code.theme);
  // A diff scene carries two snippets and shows the rewrite between them. A
  // base of only whitespace is a mis-edit rather than a diff against nothing,
  // so it falls back to painting the plain snippet.
  const isDiff = code.mode === "diff" && code.base.trim() !== "";
  const diffRows = isDiff ? diffLines(code.base, code.source) : [];
  const lines = isDiff
    ? diffRows.map((row) => tokenizeCode(row.text, code.language))
    : tokenizeCode(code.source, code.language);
  // A snippet of nothing but blank lines is nothing, and an empty card with a
  // header and a gutter is worse than no card: it reads as a broken export.
  if (lines.every((line) => lineText(line).trim() === "")) return;
  const state = revealState(lines, code.reveal, progress);
  const visible = lines.slice(0, state.whole);
  const partial = state.partial > 0 ? lines[state.whole] : undefined;
  if (visible.length === 0 && !partial) return;

  // Scenes built before callouts and focus existed, and objects assembled by
  // hand in the editor, carry neither field; read them defensively so an old
  // draft paints exactly as it always did.
  const focusList = Array.isArray(code.focus) ? code.focus : [];
  const calloutEntries = Object.entries(code.callouts ?? {})
    .map(([key, text]) => ({ line: Number(key), text }))
    .filter((c) => Number.isInteger(c.line) && c.line >= 1 && typeof c.text === "string" && c.text !== "")
    .sort((a, b) => a.line - b.line);

  const pad = Math.round(frameW * PAD);
  const reserved = options.reservedBottom ?? 0;
  const maxH = frameH * MAX_HEIGHT;
  // Callouts narrow the card instead of overlapping it: the line a label
  // names has to stay fully readable, which a pill floating over the code
  // never is. The card also shifts left so the card-plus-column pair stays
  // centred on the frame, and the size loop below fits the code into the
  // narrower card on its own.
  const calloutSide = calloutEntries.length > 0 ? Math.round(frameW * 0.2) : 0;
  const cardW = Math.round(frameW * (calloutSide > 0 ? 0.66 : 0.88));
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
  while (size > floorSize && Math.round(size * 1.42) * maxLines > usable) {
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
  const cardX = Math.round((frameW - cardW) / 2) - Math.round(calloutSide / 2);
  const cardY = Math.round(Math.max(pad, (frameH - reserved - cardH) / 2));
  const top = cardY + headerH + Math.round(pad * 0.6);

  // The first visible row: a snippet taller than the card is anchored to its
  // last line, not its first, so callouts are pinned against the rows that
  // are actually on screen rather than against the whole file.
  const first = Math.max(0, maxLines - lineCount);
  const lastRow = first + lineCount - 1;

  // Callout labels sit on their line's row when that row is free, and walk
  // down to the next free row when two labels land on the same line. A label
  // whose line is off the card pins to the nearest row and draws without a
  // connector, so it never points at the wrong line.
  const calloutBoxW = Math.max(0, calloutSide - Math.round(frameW * 0.015));
  const calloutLabelH = Math.max(Math.round(frameW * 0.026), Math.round(size * 1.35));
  const labelFont = Math.max(8, Math.round(calloutLabelH * 0.44));
  const takenRows = new Set<number>();
  const calloutLayout: CalloutLayout[] = calloutEntries.map(({ line, text }) => {
    let row = clamp(line - 1, first, lastRow);
    while (takenRows.has(row) && row < lastRow) row += 1;
    takenRows.add(row);
    return {
      line,
      text,
      x: cardX + cardW + Math.round(frameW * 0.015),
      y: top + step * (row - first) + Math.max(0, Math.round((step - calloutLabelH) / 2)),
      w: calloutBoxW,
      h: calloutLabelH,
      anchored: row === line - 1,
    };
  });

  options.onLayout?.({
    x: cardX,
    y: cardY,
    w: cardW,
    h: cardH,
    rowH: step,
    firstLine: first,
    rows: lineCount,
    callouts: calloutLayout,
  });

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
  const langLabel =
    code.language && code.language !== "text" ? code.language : "text";
  ctx.fillText(
    isDiff ? `${langLabel} · diff` : langLabel,
    cardX + cardW - pad * 0.8,
    cardY + headerH / 2,
  );
  ctx.restore();

  // The code itself, clipped to the card so a long line ends at the edge.
  const textLeft = cardX + pad + Math.round(frameW * GUTTER);
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(frameW * 0.012));
  ctx.clip();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `500 ${size}px ${family}`;

  for (let row = 0; row < lineCount; row++) {
    const index = first + row;
    const line = visible[index];
    if (!line) break;
    const y = top + step * row + step / 2;
    const focused = focusList.includes(index + 1);
    // With a progressive reveal the not-yet-shown lines are not drawn at all,
    // so the only case that dims is the static `all` snippet: when the author
    // marks focus lines, everything the narrator is not talking about steps
    // back and the marked lines keep full brightness - the "look here" beat
    // of an explanation, done in luminance instead of an arrow.
    const dimmed = focusList.length > 0 && !focused && code.reveal === "all";
    const rowKind = isDiff ? diffRows[index]!.kind : null;
    if (focused) {
      // The spotlight bar: the full row inside the card, gutter to right
      // edge, with the palette's border stepped inside as the bar's edges.
      // Reads as "this line" without any moving part, and it is the same
      // pixels in the preview and in the export.
      ctx.fillStyle = theme.chrome;
      ctx.fillRect(cardX + 1, top + step * row, cardW - 2, step);
      ctx.fillStyle = theme.border;
      ctx.fillRect(cardX + 1, top + step * row, 3, step);
      ctx.fillRect(cardX + cardW - 4, top + step * row, 3, step);
    }
    // The tint band under a changed row: a diff teaches by the rows that
    // moved, so the row itself announces the change and not only the marker.
    if (rowKind === "add" || rowKind === "del") {
      ctx.save();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = rowKind === "add" ? theme.diffAdd : theme.diffDel;
      ctx.fillRect(cardX + 1, top + step * row, cardW - 2, step);
      ctx.restore();
    }
    ctx.save();
    // Context rows of a diff step back so the changed rows win the frame,
    // and the focus spotlight still outranks them when it is on.
    if (focused) ctx.globalAlpha = 1;
    else if (rowKind === "same") ctx.globalAlpha = dimmed ? 0.3 : 0.62;
    else if (rowKind === null && dimmed) ctx.globalAlpha = 0.42;
    ctx.font = `500 ${Math.round(size * 0.82)}px ${family}`;
    ctx.fillStyle = theme.gutter;
    ctx.textAlign = "right";
    // The gutter shows a diff marker instead of a line number: +/-/space is
    // the notation every code review has trained readers on.
    ctx.fillText(
      rowKind === null
        ? String(index + 1)
        : rowKind === "add"
          ? "+"
          : rowKind === "del"
            ? "-"
            : " ",
      textLeft - Math.round(size * 0.7),
      y,
    );
    ctx.font = `500 ${size}px ${family}`;
    ctx.textAlign = "left";
    // Added and removed lines are drawn monochrome in their diff colour —
    // the way a terminal `git diff` reads — while kept lines keep their
    // syntax colours, muted.
    const rowColor =
      rowKind === "add" ? theme.diffAdd : rowKind === "del" ? theme.diffDel : null;
    let x = textLeft;
    for (const token of line) {
      ctx.fillStyle = rowColor ?? theme.tokens[token.kind];
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
        ctx.fillStyle = rowColor ?? theme.tokens[token.kind];
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
    ctx.restore();
  }
  ctx.restore();

  // Callout labels: the only prose on the frame next to the code. One line,
  // cut to the column, connected to its row - a label that wraps is a label
  // that collides with its neighbours.
  for (const callout of calloutLayout) {
    if (callout.anchored) {
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = Math.max(1, Math.round(frameW * 0.0012));
      ctx.beginPath();
      ctx.moveTo(cardX + cardW - 1, callout.y + callout.h / 2);
      ctx.lineTo(callout.x, callout.y + callout.h / 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.font = `600 ${labelFont}px ${family}`;
    // Cut to the column, reserving the pill's own left padding; one character
    // is always shown so a hair-thin column still says something.
    const shown = clamp(
      Math.floor((callout.w - labelFont * 1.1) / (labelFont * 0.62)),
      1,
      callout.text.length,
    );
    ctx.fillStyle = theme.chrome;
    roundRect(
      ctx,
      callout.x,
      callout.y,
      callout.w,
      callout.h,
      Math.round(frameW * 0.006),
    );
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = theme.plain;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      callout.text.slice(0, shown),
      callout.x + Math.round(labelFont * 0.55),
      callout.y + callout.h / 2,
    );
    ctx.restore();
  }
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
