/**
 * The terminal card a code scene paints under its snippet.
 *
 * Output is the proof: a programming video claims the code runs, and a small
 * terminal card showing the program's own output is the evidence, sitting in
 * the frame like a second character. Canvas-only, no DOM — the same rules as
 * the code panel: measure the font, never read page layout, and produce the
 * same pixels in the preview and in the export.
 *
 * Sits on the brand gradient like the code card does, echoes the code card's
 * header style (three dots, one title) so the two read as one system, and
 * prints its lines one by one over the first 80% of the scene so the output
 * feels produced rather than pasted. When the band under the code card cannot
 * fit every line, it prints the rows that fit and nothing past its bottom
 * limit.
 */

import { monoFamily } from "./code-panel.ts";

/** What the terminal card draws. */
export type SceneTerminal = {
  /** Window title in the header, e.g. `node demo.ts`. */
  title: string;
  /** Output lines, printed one by one as the scene plays. */
  output: string[];
};

/** How much of the frame height the terminal may claim. */
const MAX_HEIGHT = 0.22;
/** Of the frame width — slightly narrower than the code card, set in from it. */
const WIDTH_RATIO = 0.8;
/** Output starts appearing this far into the scene. */
const START = 0.08;
/** Output finishes printing this far into the scene, holding the rest. */
const END = 0.8;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

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

/** Colours of the terminal card, keyed off the frame so both orientations fit. */
type TerminalPalette = {
  background: string;
  border: string;
  chrome: string;
  title: string;
  text: string;
  /** The block cursor at the end of the last printed line. */
  caret: string;
  /** `$` prompt glyph colour. */
  prompt: string;
};

const PALETTE: TerminalPalette = {
  background: "#0d1117",
  border: "#2d333b",
  chrome: "#161b22",
  title: "#8b949e",
  text: "#e6edf3",
  caret: "#7ee787",
  prompt: "#7ee787",
};

/**
 * How many lines are printed at this point in the scene. At least one from
 * START on: an empty terminal reads as broken, so the first line lands as
 * soon as the card is there at all.
 */
export function printedLineCount(
  total: number,
  progress: number,
): number {
  if (total <= 0 || progress < START) return 0;
  const done = clamp((progress - START) / (END - START), 0, 1);
  return clamp(1 + Math.floor(done * total), 1, total);
}

export type PaintTerminalOptions = {
  terminal: SceneTerminal;
  /** 0..1 through the scene, the same clock the code reveal uses. */
  progress: number;
  /**
   * Bottom edge, in frame pixels, the terminal must stay above — the top of
   * the subtitle plate when captions are burning in.
   */
  bottomLimit: number;
  /**
   * Top edge the terminal must stay below — the bottom of the code card, so
   * the two never overlap on a snippet that grew.
   */
  topLimit: number;
  /** Extra room below the code card, so the pair reads as stacked cards. */
  gap?: number;
};

/**
 * Paints the terminal card. Sized so every authored line fits without
 * scrolling — a terminal that scrolls is a spec breakdown, and the fix is the
 * author trimming the output, which the inspector makes obvious.
 */
export function paintTerminal(
  ctx: CanvasRenderingContext2D,
  frameW: number,
  frameH: number,
  options: PaintTerminalOptions,
): void {
  const { terminal, progress } = options;
  const lines = terminal.output.filter((l) => l.trim() !== "");
  if (lines.length === 0) return;

  const family = monoFamily();
  const gap = options.gap ?? Math.round(frameW * 0.02);
  const pad = Math.round(frameW * 0.016);
  const headerH = Math.round(frameW * 0.034);
  // The font is the largest one whose widest line fits the card and whose
  // line count fits the vertical band between the code card and the bottom
  // limit — the same measure-don't-guess contract as the code panel.
  const cardW = Math.round(frameW * WIDTH_RATIO);
  const innerW = cardW - pad * 2;
  const band = Math.max(frameW * 0.05, options.bottomLimit - options.topLimit - gap);
  // A band too small for the header plus one printed line shows nothing
  // readable — drop the card rather than let it spill over the code above
  // or the captions below.
  if (band < headerH + Math.round(frameW * 0.02)) return;
  const wanted = Math.round(frameW * 0.017);
  const floorSize = Math.max(9, Math.round(frameW * 0.009));

  ctx.font = `500 ${wanted}px ${family}`;
  const unit = (ctx.measureText("M").width || wanted * 0.6) / wanted;
  const longest = Math.max(1, ...lines.map((l) => l.length), 4);

  let size = wanted;
  while (size > floorSize && size * unit * longest > innerW) size -= 1;
  const printed = printedLineCount(lines.length, progress);
  while (size > floorSize && Math.round(size * 1.5) * (printed + 1) > band) {
    size -= 1;
  }
  const step = Math.round(size * 1.5);
  // A band narrower than the whole printout wants: cap the lines to the rows
  // that fit, so the card never spills past its bottom limit.
  const fitRows = Math.max(
    1,
    Math.floor(
      (band - headerH - Math.round(pad * 0.7) - Math.round(pad * 1.4)) / step,
    ),
  );
  const shown = Math.min(printed, fitRows);
  const visible = lines.slice(0, shown);
  const cardH = Math.min(
    band,
    headerH + pad + step * visible.length + Math.round(pad * 1.4),
  );
  const cardX = Math.round((frameW - cardW) / 2);
  // Anchor the card just above the bottom limit; the band math above keeps
  // it clear of the code card.
  const cardY = Math.min(
    options.topLimit + gap,
    options.bottomLimit - cardH,
  );

  ctx.save();
  ctx.shadowColor = "rgba(2, 6, 20, 0.45)";
  ctx.shadowBlur = Math.round(frameW * 0.014);
  ctx.shadowOffsetY = Math.round(frameW * 0.004);
  ctx.fillStyle = PALETTE.background;
  roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(frameW * 0.009));
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = Math.max(1, Math.round(frameW * 0.001));
  ctx.stroke();

  // Header: the same window chrome as the code card, with the command as its
  // title, so the two cards read as one system on the frame.
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(frameW * 0.009));
  ctx.clip();
  ctx.fillStyle = PALETTE.chrome;
  ctx.fillRect(cardX, cardY, cardW, headerH);
  ctx.fillStyle = PALETTE.border;
  ctx.fillRect(cardX, cardY + headerH - 1, cardW, 1);
  const dot = Math.round(headerH * 0.17);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((colour, i) => {
    ctx.beginPath();
    ctx.fillStyle = colour;
    ctx.arc(cardX + pad * 0.9 + i * dot * 2.4, cardY + headerH / 2, dot, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.font = `600 ${Math.round(headerH * 0.36)}px ${family}`;
  ctx.fillStyle = PALETTE.title;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    terminal.title || "terminal",
    cardX + pad * 0.9 + dot * 8,
    cardY + headerH / 2,
  );

  // The output, prompt-marked and printed up to `shown` lines, with a block
  // cursor holding the position of the next line while there is one left.
  const textTop = cardY + headerH + Math.round(pad * 0.7);
  for (let i = 0; i < visible.length; i++) {
    const y = textTop + step * i + step / 2;
    ctx.font = `500 ${size}px ${family}`;
    ctx.fillStyle = PALETTE.prompt;
    ctx.fillText("$", cardX + pad, y);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(visible[i]!, cardX + pad + size * 1.4, y);
  }
  if (shown < lines.length && shown < fitRows && progress < END) {
    const y = textTop + step * visible.length + step / 2;
    ctx.fillStyle = PALETTE.caret;
    ctx.fillRect(cardX + pad + size * 1.4, y - size * 0.55, size * 0.55, size * 1.1);
  }
  ctx.restore();
  ctx.restore();
}
