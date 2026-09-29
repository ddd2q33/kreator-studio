/**
 * Painting one frame of a code video.
 *
 * There is exactly one implementation of this tool's look, and it lives here.
 * The preview canvas calls it sixty times a second while the author scrubs, and
 * the MP4 encoder calls it once per frame of the export. That is the whole
 * reason the preview is trustworthy: if React drew the code panel and this drew
 * the export, the two would drift within a week and the author would only find
 * out after a ten-minute encode.
 *
 * Everything is computed from `time`. There is no state to advance and no
 * "current frame" variable, so the encoder can ask for frame 431 in isolation,
 * the preview can jump to 0.4 seconds, and both get the same picture.
 *
 * The one thing that cannot be computed from time alone is the blinking cursor,
 * which is derived from the take's own clock so it keeps blinking at the same
 * rate on the hold as it did while typing.
 */

import {
  beatProgress,
  formatById,
  revealUnits,
  sceneAt,
  styleById,
  visibleLines,
  type CodeBeat,
  type CodeFormat,
  type CodeProject,
  type CodeScene,
  type CodeStyle,
  type RevealUnit,
} from "./code-art.ts";
import type { CodeRun } from "./code-highlight.ts";

/** The drawing unit is the context type, so the module needs no DOM. */
export type Ctx = CanvasRenderingContext2D;

/**
 * Fills a `CodeLine`'s runs up to `chars` characters.
 *
 * A run is drawn whole, cut, or not at all, which is all a typewriter needs:
 * the character count it is given is the number of characters to show, and a run
 * boundary in the middle of that is just a place to stop.
 */
function runsUpTo(runs: readonly CodeRun[], chars: number): { run: CodeRun; text: string }[] {
  const out: { run: CodeRun; text: string }[] = [];
  let at = 0;
  for (const run of runs) {
    if (at >= chars) break;
    const left = chars - at;
    if (left >= run.text.length) {
      out.push({ run, text: run.text });
    } else {
      out.push({ run, text: run.text.slice(0, left) });
    }
    at += run.text.length;
  }
  return out;
}

/**
 * How many characters of each line are on screen, given how much of the reveal
 * has played.
 *
 * Returned as an array indexed by position in the visible line list, because a
 * shot that shows file lines 40 to 44 has no relationship to the indices the
 * lines themselves were numbered with.
 */
export function visibleChars(
  units: readonly RevealUnit[],
  done: number,
  partial: number,
  lineCount: number,
): number[] {
  const chars = new Array<number>(lineCount).fill(0);
  for (let i = 0; i < done && i < units.length; i++) {
    chars[units[i].line] += units[i].to - units[i].from;
  }
  const current = units[done];
  if (current && partial > 0) {
    chars[current.line] += (current.to - current.from) * partial;
  }
  return chars;
}

/**
 * Which line the cursor is on.
 *
 * While typing it is the line holding the next character. Once the take is
 * complete it is the last line, so the cursor sits after the closing bracket
 * instead of vanishing.
 */
function cursorLine(units: readonly RevealUnit[], done: number, lineCount: number): number {
  if (units.length === 0) return 0;
  const current = units[Math.min(done, units.length - 1)];
  return Math.max(0, Math.min(lineCount - 1, current?.line ?? lineCount - 1));
}

/** The class highlight.js gave a run, reduced to a palette key. */
function paletteFor(cls: string, style: CodeStyle): string {
  const p = style.palette;
  switch (cls) {
    case "hljs-comment":
    case "hljs-quote":
      return p.comment;
    case "hljs-keyword":
    case "hljs-selector-tag":
    case "hljs-meta":
    case "hljs-section":
    case "hljs-doctag":
    case "hljs-template-tag":
    case "hljs-meta-keyword":
    case "hljs-operator":
      return p.keyword;
    case "hljs-string":
    case "hljs-regexp":
    case "hljs-addition":
    case "hljs-symbol":
    case "hljs-bullet":
    case "hljs-template-variable":
      return p.string;
    case "hljs-number":
    case "hljs-deletion":
    case "hljs-char.escape":
    case "hljs-link":
      return p.number;
    // Function names get their own colour rather than sharing one with `title`,
    // because in every real editor theme a call and the name it calls are the
    // same colour, and separating them is most of what makes syntax colouring
    // read as an editor rather than as coloured text.
    case "hljs-title":
    case "hljs-title.function_":
    case "hljs-title.class_":
    case "hljs-name":
    case "hljs-selector-id":
    case "hljs-selector-class":
    case "hljs-selector-pseudo":
    case "hljs-variable.language_":
      return p.function;
    case "hljs-type":
    case "hljs-class":
    case "hljs-title.class.inherited__":
    case "hljs-built_in":
    case "hljs-params":
      return p.class;
    case "hljs-attr":
    case "hljs-attribute":
    case "hljs-variable":
    case "hljs-variable.other":
    case "hljs-property":
      return p.attr;
    case "hljs-literal":
    case "hljs-subst":
    case "hljs-emphasis":
    case "hljs-strong":
    case "hljs-formula":
    case "hljs-tag":
    case "hljs-punctuation":
      return p.literal;
    default:
      return p.plain;
  }
}

/**
 * Breaks text to a width on the canvas.
 *
 * Measured rather than estimated, because a caption that overflows the frame is
 * the one bug in a video nobody can fix after the fact. A word longer than the
 * line is broken by character rather than allowed to run off the edge.
 */
export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const char of word) {
        if (ctx.measureText(chunk + char).width > maxWidth && chunk) {
          out.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      line = chunk;
    }
    out.push(line);
  }
  return out.length > 0 ? out : [""];
}

function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/* ------------------------------------------------------------- safe areas */

/**
 * The margins a frame keeps clear, in pixels.
 *
 * On a phone-shaped frame the top and the bottom are not available: the account
 * row, the caption bar and the control rail all live there, and code drawn under
 * them is code the viewer cannot read. The format carries the fractions, so this
 * is the one place that knows what a safe area is, and every layout asks it
 * instead of guessing a margin from the width.
 */
function margins(format: CodeFormat, width: number, height: number) {
  return {
    x: Math.round(width * 0.06),
    top: Math.round(height * format.safe.top),
    bottom: Math.round(height * format.safe.bottom),
    /** The height actually available between the two safe edges. */
    get usable(): number {
      return Math.max(1, height - this.top - this.bottom);
    },
  };
}

/**
 * Draws a sub-scene's note as a badge over the top of the code panel.
 *
 * This is the one piece of chrome that is not decoration: it says what the next
 * few seconds are about, in the author's words, and it is what lets a scene
 * carry three beats without the viewer having to be told three times.
 */
function paintNote(
  ctx: Ctx,
  style: CodeStyle,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
) {
  const p = style.palette;
  const label = clipToWidth(ctx, text, maxWidth - fontSize * 1.4);
  const width = ctx.measureText(label).width + fontSize * 1.4;
  const height = fontSize * 2.1;

  ctx.fillStyle = p.accent;
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fill();

  ctx.fillStyle = p.panel;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, x + fontSize * 0.7, y + height / 2);
  ctx.textAlign = "left";
}

/* ------------------------------------------------------------- the frame */

export function paintCodeFrame(
  ctx: Ctx,
  project: CodeProject,
  time: number,
  width: number,
  height: number,
): void {
  const style = styleById(project.styleId);
  const p = style.palette;
  const format = formatById(project.formatId);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, width, height);

  const found = sceneAt(project, time);
  if (!found) {
    paintPlaceholder(ctx, project, style, width, height);
    ctx.restore();
    return;
  }

  const { scene, beat, local, beatLocal } = found;
  const units = revealUnits(scene, beat, project);
  const { done, partial } = beatProgress(scene, beat, project, beatLocal);

  if (style.layout === "stacked") {
    paintStacked(ctx, project, style, format, scene, beat, units, done, partial, local, width, height);
  } else {
    paintEditor(ctx, project, style, format, scene, beat, units, done, partial, local, width, height);
  }
  if (style.scanlines) paintScanlines(ctx, width, height);
  ctx.restore();
}

/** The frame with nothing in it, for a project that has no scenes yet. */
function paintPlaceholder(
  ctx: Ctx,
  project: CodeProject,
  style: CodeStyle,
  width: number,
  height: number,
) {
  const size = width * 0.03;
  ctx.fillStyle = style.palette.muted;
  ctx.font = `600 ${size}px ${style.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = [
    project.scenes.length === 0 ? "Paste some code to start" : "Nothing to film yet",
    project.scenes.length === 0
      ? "Then keep only the lines the scene is about."
      : "",
  ].filter(Boolean);
  lines.forEach((text, i) => {
    ctx.fillText(text, width / 2, height / 2 + i * size * 1.6);
  });
  ctx.textAlign = "left";
}

/* ---------------------------------------------------------- editor layout */

function paintEditor(
  ctx: Ctx,
  project: CodeProject,
  style: CodeStyle,
  format: CodeFormat,
  scene: CodeScene,
  beat: CodeBeat,
  units: readonly RevealUnit[],
  done: number,
  partial: number,
  local: number,
  width: number,
  height: number,
) {
  const p = style.palette;
  const m = margins(format, width, height);
  const panelX = m.x;
  const panelY = m.top;
  const panelW = width - m.x * 2;
  const panelH = m.usable;

  ctx.save();
  ctx.fillStyle = p.panel;
  roundRect(ctx, panelX, panelY, panelW, panelH, width * 0.012);
  ctx.fill();

  const chromeH = style.chrome ? Math.round(width * 0.034) : 0;
  if (style.chrome) {
    ctx.fillStyle = p.chrome;
    roundRect(ctx, panelX, panelY, panelW, panelH, width * 0.012);
    ctx.fill();
    // Squared off the bottom of the rounded panel so the bar meets the code
    // without a seam.
    ctx.fillRect(panelX, panelY, panelW, chromeH);
    const dotR = chromeH * 0.14;
    [p.muted, p.muted, p.muted].forEach((_, i) => {
      ctx.beginPath();
      ctx.arc(panelX + chromeH * 0.42 + i * dotR * 3.4, panelY + chromeH / 2, dotR, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? p.accent : p.muted;
      ctx.globalAlpha = i === 0 ? 0.9 : 0.45;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    // The file name, not the scene title: the title is drawn as the heading, and
    // this bar is the one that has to look like the editor the code came from.
    const label = scene.fileName || scene.language || "code";
    ctx.fillStyle = p.muted;
    ctx.font = `${Math.round(chromeH * 0.34)}px ${style.font}`;
    ctx.textBaseline = "middle";
    ctx.fillText(label, panelX + chromeH * 1.5, panelY + chromeH / 2);
  }

  const innerX = panelX + Math.round(panelW * 0.035);
  const innerW = panelW - Math.round(panelW * 0.07);
  const contentTop = panelY + chromeH + Math.round(panelH * 0.035);
  const contentBottom = panelY + panelH - Math.round(panelH * 0.035);

  // The heading and the caption are drawn outside the code area, so the code's
  // height budget is what is left over.
  const headingSize = Math.round(width * 0.026);
  const captionSize = Math.round(width * 0.019);
  let top = contentTop;
  if (scene.title) {
    ctx.fillStyle = p.text;
    ctx.font = `700 ${headingSize}px ${style.font}`;
    ctx.textBaseline = "top";
    ctx.fillText(clipToWidth(ctx, scene.title, innerW), innerX, top);
    top += headingSize * 1.5;
  }

  const lines = visibleLines(scene, beat);
  const noteFont = Math.round(width * 0.019);
  const showNote = project.notes && beat.note.length > 0;
  const codeTop = showNote ? top + noteFont * 3.1 : top;
  const codeBottom = contentBottom - (project.captions && scene.caption ? captionSize * 2.4 : 0);
  const availH = Math.max(width * 0.05, codeBottom - codeTop);

  // Auto-fit. This is the promise the whole tool makes - keep only the lines the
  // scene is about and they will all be readable - so the font shrinks to fit
  // rather than letting a long beat run off the bottom of the frame.
  const lineH = Math.max(
    6,
    Math.min(width * style.codeScale * 1.6, availH / Math.max(1, lines.length)),
  );
  const fontSize = Math.round(lineH / 1.6);
  const blockH = lineH * lines.length;
  // A scene shorter than the panel sits centred in it, which looks deliberate;
  // one taller than the panel is aligned to the top so the first line, the one
  // being typed, is always in the same place.
  const startY = blockH < availH ? codeTop + (availH - blockH) / 2 : codeTop;

  const chars = visibleChars(units, done, partial, lines.length);
  const active = cursorLine(units, done, lines.length);
  const gutterW = style.numbers ? Math.round(fontSize * 3.4) : 0;

  // The line being written is lit, which is the only motion in this layout and
  // the thing that tells the viewer where to look.
  if (style.id === "spotlight" || project.reveal === "lines") {
    ctx.fillStyle = p.activeLine;
    ctx.fillRect(innerX - gutterW * 0.5, startY + active * lineH, innerW, lineH);
  }

  const marked = new Set(beat.marks);
  for (const [index, line] of lines.entries()) {
    const y = startY + index * lineH;
    if (y > panelY + panelH) break;

    if (marked.has(index)) {
      // A bar in the gutter, not a recolouring of the text: the syntax colours
      // are the information, and a marked line still has to be readable code.
      ctx.fillStyle = p.accent;
      roundRect(ctx, innerX - gutterW * 0.42, y + lineH * 0.18, Math.max(3, fontSize * 0.16), lineH * 0.64, fontSize * 0.08);
      ctx.fill();
    }

    ctx.font = `${fontSize}px ${style.font}`;
    ctx.textBaseline = "middle";

    if (style.numbers) {
      ctx.fillStyle = p.muted;
      ctx.globalAlpha = 0.6;
      ctx.fillText(String(line.number), innerX - gutterW * 0.3, y + lineH / 2);
      ctx.globalAlpha = 1;
    }

    let x = innerX;
    const visible = chars[index] ?? 0;
    for (const { run, text } of runsUpTo(line.runs, Math.floor(visible))) {
      if (!text) continue;
      ctx.fillStyle = paletteFor(run.cls, style);
      if (style.glow > 0) {
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = style.glow;
      }
      ctx.fillText(text, x, y + lineH / 2);
      ctx.shadowBlur = 0;
      x += ctx.measureText(text).width;
    }
  }

  // The cursor: a block at the writing point, and it blinks on the scene's clock
  // so it keeps moving during the hold instead of freezing on the last frame.
  if (project.cursor) {
    const line = lines[active];
    const shown = Math.floor(chars[active] ?? 0);
    let x = innerX;
    for (const { text } of runsUpTo(line?.runs ?? [], shown)) x += ctx.measureText(text).width;
    const blink = Math.floor(local * 2.2) % 2 === 0;
    if (blink) {
      ctx.fillStyle = p.accent;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, startY + active * lineH + lineH * 0.16, Math.max(2, fontSize * 0.11), lineH * 0.68);
      ctx.globalAlpha = 1;
    }
  }

  if (showNote) {
    ctx.font = `600 ${noteFont}px ${style.font}`;
    paintNote(ctx, style, beat.note, innerX, top, innerW, noteFont);
  }

  if (project.captions && scene.caption) {
    const capY = panelY + panelH - Math.round(panelH * 0.035) - captionSize * 1.2;
    ctx.fillStyle = p.muted;
    ctx.font = `${captionSize}px ${style.font}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(clipToWidth(ctx, scene.caption, innerW), innerX, capY);
  }
  ctx.restore();
}

/* --------------------------------------------------------- stacked layout */

function paintStacked(
  ctx: Ctx,
  project: CodeProject,
  style: CodeStyle,
  format: CodeFormat,
  scene: CodeScene,
  beat: CodeBeat,
  units: readonly RevealUnit[],
  done: number,
  partial: number,
  local: number,
  width: number,
  height: number,
) {
  const p = style.palette;
  const m = margins(format, width, height);
  // The code gets the top part of the safe area and the sentence the rest, which
  // is the split a vertical video needs: the code is what the frame is about, and
  // the sentence is what the viewer is reading.
  const textH = Math.round(m.usable * 0.42);
  const panelH = Math.round((m.usable - textH) * 0.92);
  const codeX = m.x;
  const codeY = m.top;
  const codeW = width - m.x * 2;

  ctx.save();
  ctx.fillStyle = p.panel;
  roundRect(ctx, codeX, codeY, codeW, panelH, width * 0.014);
  ctx.fill();

  const lines = visibleLines(scene, beat);
  const padY = Math.round(panelH * 0.12);
  const availH = panelH - padY * 2;
  const lineH = Math.max(6, Math.min(width * style.codeScale * 1.6, availH / Math.max(1, lines.length)));
  const fontSize = Math.round(lineH / 1.6);
  const startY = codeY + Math.max(0, (availH - lineH * lines.length) / 2) + lineH / 2;

  const chars = visibleChars(units, done, partial, lines.length);
  const active = cursorLine(units, done, lines.length);

  for (const [index, line] of lines.entries()) {
    const y = startY + index * lineH;
    let x = codeX + padY;
    ctx.font = `${fontSize}px ${style.font}`;
    ctx.textBaseline = "middle";
    for (const { run, text } of runsUpTo(line.runs, Math.floor(chars[index] ?? 0))) {
      if (!text) continue;
      ctx.fillStyle = paletteFor(run.cls, style);
      if (style.glow > 0) {
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = style.glow;
      }
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
      x += ctx.measureText(text).width;
    }
  }
  if (project.cursor && Math.floor(local * 2.2) % 2 === 0) {
    const line = lines[active];
    let x = codeX + padY;
    for (const { text } of runsUpTo(line?.runs ?? [], Math.floor(chars[active] ?? 0))) {
      x += ctx.measureText(text).width;
    }
    ctx.fillStyle = p.accent;
    ctx.fillRect(x, startY + active * lineH - lineH * 0.34, Math.max(2, fontSize * 0.12), lineH * 0.68);
  }

  // The sub-scene's note sits under the code on this layout, where there is room
  // for a second line of text and the badge would otherwise have nowhere to go.
  let y = codeY + panelH + Math.round(panelH * 0.09);
  if (project.notes && beat.note) {
    const noteSize = Math.round(width * 0.034);
    ctx.fillStyle = p.accent;
    ctx.font = `600 ${noteSize}px ${style.font}`;
    ctx.textBaseline = "top";
    for (const row of wrapText(ctx, beat.note, width - m.x * 2)) {
      ctx.fillText(row, width / 2, y);
      y += noteSize * 1.24;
    }
    y += noteSize * 0.4;
  }

  // The caption is the point of this layout: on a phone the code is a texture
  // above the sentence, and the sentence is what the viewer is actually reading.
  if (project.captions && (scene.caption || scene.title)) {
    const capSize = Math.round(width * 0.062);
    ctx.font = `700 ${capSize}px ${style.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const text = scene.caption || scene.title;
    const rows = wrapText(ctx, text, width - m.x * 2);
    for (const row of rows) {
      ctx.fillStyle = p.text;
      ctx.fillText(row, width / 2, y);
      y += capSize * 1.32;
    }
    ctx.textAlign = "left";
  }
  ctx.restore();
}

function paintScanlines(ctx: Ctx, width: number, height: number) {
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#000000";
  const gap = Math.max(2, Math.round(height / 420));
  for (let y = 0; y < height; y += gap * 2) {
    ctx.fillRect(0, y, width, gap);
  }
  ctx.restore();
}

/** Trims text with an ellipsis so a long heading cannot run off the frame. */
function clipToWidth(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}
