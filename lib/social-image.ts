/**
 * Rendering a post as a picture.
 *
 * The whole design rests on one idea — `buildPostHtml` is the single source of
 * truth for what a post looks like. The live preview puts that exact string in
 * an <iframe srcDoc>, and the download sends the very same string to headless
 * Chrome. There is no second code path, so there is nothing to drift: what the
 * author arranges is literally the bytes that come out of the render.
 *
 * The look lives in `social-art.ts` as a *style*: composition, type setting and
 * a starting palette in one pick. This module renders each of them; the knobs
 * (colours, face, canvas, handle) stay editable on top of any look.
 *
 * That is also why the fonts are system fonts. A web font would have to be
 * fetched during the render, and a render that happens to be offline would
 * quietly substitute a different face — the preview would promise one thing and
 * the PNG deliver another. System faces resolve the same way in the tab and in
 * the headless process because it is the same machine and the same browser.
 *
 * The document is self-contained on purpose: no external stylesheet, no font
 * request, no script beyond the fit loop and the small look scripts below. A
 * render that depends on anything the machine has to fetch is a render that can
 * differ from the preview.
 */

import { markdownToPlainText } from "./social-networks.ts";
import type { SocialDraft } from "./social-draft.ts";
import {
  canvasById,
  elementKind,
  fontById,
  layoutById,
  normalizeArt,
  styleById,
  styleLook,
  type Canvas,
  type PostArt,
  type PostFont,
  type StyleId,
} from "./social-art.ts";
import type { ArtElement, ElementKind } from "./social-art.ts";

export {
  BRAND_HANDLE,
  CANVASES,
  FONTS,
  LAYOUTS,
  STYLES,
  canvasById,
  defaultArt,
  elementKind,
  fontById,
  layoutById,
  normalizeArt,
  artFor,
  styleById,
  styleLook,
  DEFAULT_CANVAS_ID,
  DEFAULT_FONT_ID,
  DEFAULT_LAYOUT_ID,
  DEFAULT_STYLE_ID,
} from "./social-art.ts";
export type {
  ArtElement,
  Canvas,
  CanvasId,
  ElementId,
  ElementKind,
  FontId,
  LayoutId,
  PostArt,
  PostFont,
  StyleId,
  PostLayout,
  VisualStyle,
} from "./social-art.ts";

/**
 * Escapes text for element content and for a quoted CSS/HTML attribute.
 *
 * The `url()` case is the one that bites: a quote in the data URL would end the
 * attribute early, and an unescaped `)` would end the `url()` early. Escaping
 * both, plus the ampersand, is the whole job.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeCssUrl(dataUrl: string): string {
  return dataUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Flattens a markdown body into the paragraphs an image can show.
 *
 * Images have no paragraph rhythm, and a wall of solid text is unreadable on a
 * phone, so the body is capped and `bodyTruncated` says so. Dropping the tail
 * silently would be the one unforgivable option here: the author would publish a
 * claim they did not finish making.
 */
const BODY_PARAGRAPH_CAP = 4;
const BODY_PARAGRAPH_MAX = 180;

export type ImageCopy = {
  hook: string;
  paragraphs: string[];
  cta: string;
  hashtags: string;
  /** True when the body was cut, so the UI can say so out loud. */
  bodyTruncated: boolean;
};

/** Trims to a sentence boundary when one is close, else to the word. */
function clampToSentence(value: string, max: number): string {
  if (value.length <= max) return value;
  const window = value.slice(0, max);
  const stop = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (stop > max * 0.5) return window.slice(0, stop + 1).trim();
  const space = window.lastIndexOf(" ");
  return `${(space > 0 ? window.slice(0, space) : window).trim()}…`;
}

export function copyForImage(draft: SocialDraft): ImageCopy {
  const hook = draft.hook.trim();
  const raw = markdownToPlainText(draft.body ?? "");
  const paragraphs = raw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const kept = paragraphs.slice(0, BODY_PARAGRAPH_CAP);
  const dropped = paragraphs.length > BODY_PARAGRAPH_CAP;
  const clamped = kept.map((p) => clampToSentence(p, BODY_PARAGRAPH_MAX));
  const bodyTruncated =
    dropped || clamped.some((p, i) => p !== kept[i]);

  return {
    hook,
    paragraphs: clamped,
    cta: draft.cta.trim(),
    hashtags: hashtagLine(draft.hashtags ?? []),
    bodyTruncated,
  };
}

/**
 * `#a #b`, with the leading `#` added and repeats dropped.
 *
 * Deduped here as well as in normalizeDraft: this runs on whatever draft the
 * caller holds, and a duplicated tag printed at 200% of a canvas size is a very
 * expensive way to notice a stray `#`.
 */
function hashtagLine(tags: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/^#/, "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${tag}`);
  }
  return out.join(" ");
}

/**
 * Picks a starting font size for the hook.
 *
 * Scaled to the canvas so a 1200x630 Facebook link preview and a 1080px
 * Instagram square come out optically the same size, and scaled to the face so
 * Impact does not start out twice the height of Georgia.
 */
function hookSize(canvas: Canvas, font: PostFont, style: StyleId): number {
  // The poster look exists to be enormous; it starts above the shared scale and
  // lets the fit loop bring it down.
  const lift = style === "poster" ? 1.18 : 1;
  const byWidth = canvas.width * 0.088 * lift;
  const byHeight = canvas.height * 0.052 * lift;
  return Math.round(Math.min(byWidth, byHeight) * font.scale);
}

/**
 * The fit loop.
 *
 * One write to font-size rescales the whole block because every child is sized
 * in em, so stepping down is O(few hundred) style writes rather than a relayout
 * per descendant. The loop reads `scrollHeight > clientHeight` on a box that is
 * capped by `max-height` and `overflow: hidden` in the stylesheet — without that
 * cap the content box would grow with the text and never report an overflow.
 */
const FIT_SCRIPT = `
(function () {
  var box = document.getElementById('fit');
  if (!box) return;
  var max = parseFloat(box.getAttribute('data-max')) || 64;
  var min = parseFloat(box.getAttribute('data-min')) || 20;
  var size = max;
  box.style.fontSize = size + 'px';
  var guard = 0;
  while (size > min && box.scrollHeight > box.clientHeight + 1 && guard < 400) {
    size -= 1;
    box.style.fontSize = size + 'px';
    guard++;
  }
  box.setAttribute('data-fitted', String(size));
})();
`;

/**
 * Fits the first body paragraph to its half-open area in the caption look.
 *
 * Runs after the main fit loop, because its result depends on the font-size the
 * loop has already settled on — the paragraph is sized in em, so once the block
 * stops shrinking, the area left for it is final.
 */
const CARD_SCRIPT = `
(function () {
  var box = document.getElementById('lead');
  if (!box) return;
  var max = 30, min = 13, size = max;
  box.style.fontSize = size + 'px';
  var guard = 0;
  while (size > min && box.scrollHeight > box.clientHeight + 1 && guard < 100) {
    size -= 1;
    box.style.fontSize = size + 'px';
    guard++;
  }
})();
`;

/** Small mono label defaults, by template id, for posts with an empty kicker. */
const DEFAULT_KICKERS: Record<string, string> = {
  "chapter-quote": "From the book",
  "myth-vs-reality": "Myth vs reality",
  "reflection-prompt": "Journal prompt",
  "worksheet-teaser": "Try this",
  glossary: "What it actually means",
  "case-note": "From practice",
  "evidence-digest": "The evidence",
  "book-launch": "New book",
  "behind-the-book": "Behind the book",
  "crisis-resources": "",
  blank: "",
};

/**
 * Resolves the label over the text.
 *
 * A template-made post arrives already labelled — the studio earns the word it
 * prints — and a custom post stays silent unless the author types one.
 */
function kickerFor(safe: PostArt, draft: SocialDraft): string {
  const typed = safe.kicker.trim();
  if (typed) return typed;
  if (draft.templateId && draft.templateId !== "custom") {
    return DEFAULT_KICKERS[draft.templateId] ?? "";
  }
  return "";
}

/** The share of the frame the photo takes in the `panel` layout. */
const PHOTO_SPLIT = 54;

export type BuildPostInput = {
  art: unknown;
  draft: SocialDraft;
};

/** A mark's rectangle, in canvas pixels. */
export type ElementBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Centre, in canvas pixels. The drag handle works from this. */
  cx: number;
  cy: number;
};

/**
 * Where a mark sits, in canvas pixels.
 *
 * This is the single source of truth for placement. The renderer draws from it
 * and the drag overlay hit-tests against it, so a mark can never be picked up
 * somewhere other than where it was drawn. Keeping it here — rather than
 * duplicating the maths in the component — is what keeps the two in step.
 *
 * Positions are stored as a fraction so that switching from an Instagram square
 * to a Story does not silently move every mark.
 */
export function elementBox(
  canvas: { width: number; height: number },
  element: ArtElement,
): ElementBox {
  const kind = elementKind(element.kind);
  const width = canvas.width * kind.base * element.scale;
  const height = width / kind.aspect;
  const cx = element.x * canvas.width;
  const cy = element.y * canvas.height;
  return {
    left: cx - width / 2,
    top: cy - height / 2,
    width,
    height,
    cx,
    cy,
  };
}

/**
 * The css for one mark. Kept next to `elementBox` so a new shape is one entry in
 * `social-art.ts` plus one case here.
 */
function elementStyle(kind: ElementKind, color: string, box: ElementBox): string {
  const sizing = "box-sizing:border-box;";
  switch (kind.shape) {
    case "glyph":
      return `${sizing}color:${color};font-size:${Math.round(
        box.height * 0.92,
      )}px;line-height:1;display:flex;align-items:center;justify-content:center;font-weight:700;`;
    case "ring":
      return `${sizing}border:${Math.max(
        2,
        Math.round(box.width * 0.035),
      )}px solid ${color};border-radius:50%;`;
    case "border":
      return `${sizing}border:${Math.max(
        3,
        Math.round(box.width * 0.02),
      )}px solid ${color};`;
    case "line":
      return `${sizing}background:${color};border-radius:${Math.round(
        box.height / 2,
      )}px;`;
    case "bar":
      return `${sizing}background:${color};border-radius:${Math.round(
        box.height * 0.22,
      )}px;`;
    case "bracket":
      // Two Ls, drawn with gradients so there is no extra markup to place.
      return `${sizing}background:
        linear-gradient(${color},${color}) left top/28% 8% no-repeat,
        linear-gradient(${color},${color}) left top/8% 28% no-repeat,
        linear-gradient(${color},${color}) right bottom/28% 8% no-repeat,
        linear-gradient(${color},${color}) right bottom/8% 28% no-repeat;`;
    default:
      // Unreachable while `ElementKind["shape"]` is the union above. A new shape
      // that forgets its case draws nothing rather than crashing the render.
      return `${sizing}color:${color};font-size:${Math.round(
        box.height * 0.92,
      )}px;line-height:1;display:flex;align-items:center;justify-content:center;`;
  }
}

/** The rendered markup for every mark, above the words. */
function elementsHtml(canvas: Canvas, elements: readonly ArtElement[]): string {
  if (!elements.length) return "";
  return elements
    .map((element) => {
      const kind = elementKind(element.kind);
      const box = elementBox(canvas, element);
      const style = elementStyle(kind, element.color, box);
      const glyph = kind.shape === "glyph" ? escapeHtml(kind.glyph ?? "") : "";
      return `<div class="mark" style="left:${Math.round(box.left)}px;top:${Math.round(
        box.top,
      )}px;width:${Math.round(box.width)}px;height:${Math.round(
        box.height,
      )}px;${style}">${glyph}</div>`;
    })
    .join("");
}

/**
 * Renders a post to a standalone HTML document sized to the canvas.
 *
 * The document carries no `<meta viewport>`: it is never displayed as a page,
 * only rasterised, and a viewport meta would only add a way for the size to be
 * overridden.
 */
export function buildPostHtml({ art, draft }: BuildPostInput): string {
  const safe = normalizeArt(art);
  const canvas = canvasById(safe.canvas);
  const font = fontById(safe.font);
  const layout = layoutById(safe.layout);
  const look = styleById(safe.style).id;
  const copy = copyForImage(draft);
  const hasPhoto = Boolean(safe.background);
  const photoUrl = safe.background ?? "";
  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.085);
  // 0.026 is the size that used to be hard-coded, and it vanished under the words
  // on a phone. `handleSize` is the author's dial; 1.6 is where it now rests. It
  // scales every part of the signature, so the signature keeps its proportions.
  const tagSize = Math.round(canvas.width * 0.026 * safe.handleSize);
  const hookText = font.upper ? copy.hook.toUpperCase() : copy.hook;
  const kicker = kickerFor(safe, draft);

  const maxSize = hookSize(canvas, font, look);
  // A short hook can be enormous; a long one has to be allowed to get small.
  const minSize = Math.max(18, Math.round(maxSize * 0.34));

  const bodyHtml = copy.paragraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  const ctaHtml = copy.cta
    ? `<p class="cta">${escapeHtml(copy.cta)}</p>`
    : "";
  const tagsHtml =
    safe.showHashtags && copy.hashtags
      ? `<p class="tags">${escapeHtml(copy.hashtags)}</p>`
      : "";

  // `solid` and `gradient` ignore the photo entirely; the other layouts fall
  // back to the gradient when there is no photo yet, so the author always sees
  // real text rather than an empty frame. The *look* colours the stage either
  // way: two-stop aurora for aurora, one flat stage everywhere else.
  const stageBackground = (() => {
    if (layout.id === "solid") return `background:${safe.base};`;
    if (layout.id === "gradient") {
      return `background:linear-gradient(135deg, ${safe.base} 0%, ${safe.accent} 100%);`;
    }
    if (look === "aurora" && !hasPhoto) {
      return `background:radial-gradient(115% 115% at 50% 118%, ${safe.accent} 0%, ${safe.base} 58%);`;
    }
    if (!hasPhoto) return `background:${safe.base};`;
    return `background-image:url("${escapeCssUrl(photoUrl)}");background-size:cover;background-position:center;`;
  })();

  // The photo layouts need the photo somewhere: `veil` puts it behind the
  // words, `panel` keeps it in the top band. Everything else ignores it.
  //
  // Without this split `panel` and `veil` render identically, which would leave
  // the panel layout documented as "photo on top, colour underneath" and actually
  // delivering a full-bleed photo with a scrim. The band is what distinguishes
  // them, so it is expressed here rather than left to each look.
  const photoBlock =
    layout.id === "veil" && hasPhoto
      ? `<div class="photo" style="background-image:url('${escapeCssUrl(
          photoUrl,
        )}');background-size:cover;background-position:center;"></div>`
      : layout.id === "panel" && hasPhoto
        ? `<div class="photo" style="background-image:url('${escapeCssUrl(
            photoUrl,
          )}');background-size:cover;background-position:center;bottom:auto;height:${PHOTO_SPLIT}%;"></div>`
        : "";

  // The block the words sit on in the panel layout. Opaque, so the text below it
  // never has to fight the photograph.
  const panelBlock =
    layout.id === "panel"
      ? `<div class="panel" style="background:${safe.accent}"></div>`
      : "";

  // `dim` is how hard the photo is pressed down. With a photo on any look it
  // becomes a scrim; the gradient's own dimming multiplies, so it reads a step
  // darker at the same number. `panel` is the exception: its words sit on an
  // opaque block, so dimming the band above them would only cost contrast.
  const scrimBlock =
    hasPhoto && layout.id !== "solid" && layout.id !== "gradient" && layout.id !== "panel"
      ? `<div class="scrim" style="background:rgba(10,10,12,${safe.dim});"></div>`
      : "";

  const grainBlock = `<div class="grain" aria-hidden="true"></div>`;

  /** The default kicker: mono, letterspaced, above the words. */
  const kickerHtml = kicker
    ? `<p class="kicker">${escapeHtml(kicker.toUpperCase())}</p>`
    : "";

  /* First word carries the accent with an underline, so the eye lands once. */
  const lookWord = (() => {
    const words = hookText.split(" ");
    const first = words.shift() ?? "";
    const rest = words.length > 0 ? ` ${escapeHtml(words.join(" "))}` : "";
    return `<span class="word">${escapeHtml(first)}</span>${rest}`;
  })();

  type Look = { body: string; script: string };

  const looks: Record<StyleId, Look> = {
    /* Warm aurora, glass tag, grain. The default look of the studio. */
    aurora: {
      body: `
        <div class="body">
          <div id="fit" data-max="${maxSize}" data-min="${minSize}">
            ${kickerHtml}
            <p class="hook">${escapeHtml(hookText)}</p>
            ${bodyHtml}
            ${ctaHtml}
            ${tagsHtml}
          </div>
        </div>
        <div id="tag">${escapeHtml(safe.handle)}</div>`,
      script: "",
    },

    /* A floating caption card on a quiet stage, kicker chip at the top. */
    card: {
      body: `
        ${kicker ? `<div class="kickerchip">${escapeHtml(kicker.toUpperCase())}</div>` : ""}
        <div class="chip">
          <div class="cbody">
            <div id="fit" data-max="${maxSize}" data-min="${minSize}">
              <p class="hook">${escapeHtml(hookText)}</p>
            </div>
            <div id="lead">${escapeHtml(copy.paragraphs.join("\n\n"))}</div>
            ${copy.cta ? `<p class="cta">${escapeHtml(copy.cta)}</p>` : ""}
          </div>
        </div>
        <div id="tag">${escapeHtml(safe.handle)}</div>`,
      script: CARD_SCRIPT,
    },

    /* One huge serif statement, a rule, then the CTA. Quote-post energy. */
    poster: {
      body: `
        <div class="body">
          <div id="fit" data-max="${maxSize}" data-min="${minSize}">
            ${kickerHtml}
            <p class="hook">${escapeHtml(hookText)}</p>
          </div>
        </div>
        ${copy.paragraphs.length > 0 ? `<div class="quote">${escapeHtml(copy.paragraphs[0])}</div>` : ""}
        ${copy.cta ? `<div class="rule"></div><p class="tagline">${escapeHtml(copy.cta)}</p>` : `<div class="rule"></div><p class="tagline">${escapeHtml(safe.handle)}</p>`}
        <div id="tag">${escapeHtml(safe.handle)}</div>`,
      script: "",
    },

    /* Magazine hand letterhead: top rule, left-set headline, mono kicker. */
    editorial: {
      body: `
        <div class="frame topframe"><div class="rule top"></div><p class="kicker">${escapeHtml(kicker.toUpperCase())}</p></div>
        <div class="body left">
          <div id="fit" data-max="${maxSize}" data-min="${minSize}">
            <p class="hook">${escapeHtml(hookText)}</p>
            ${bodyHtml}
          </div>
        </div>
        <div class="frame bottomframe"><p class="tagline">${escapeHtml(copy.cta || safe.handle)}</p></div>
        <div id="tag">${escapeHtml(safe.handle)}</div>`,
      script: "",
    },

    /* Ceremony: double hairline border, centred, mono kicker. */
    frame: {
      body: `
        <div class="frame border"></div>
        <div class="body">
          <div id="fit" data-max="${maxSize}" data-min="${minSize}">
            ${kickerHtml}
            <p class="hook">${escapeHtml(hookText)}</p>
            ${bodyHtml}
            ${ctaHtml}
          </div>
        </div>
        <div id="tag">${escapeHtml(safe.handle)}</div>`,
      script: "",
    },

    /* White page, accent underline on the first word, mono handle bottom-right. */
    clean: {
      body: `
        <div class="body">
          <div id="fit" data-max="${maxSize}" data-min="${minSize}">
            ${kickerHtml}
            <p class="hook">${lookWord}</p>
            ${bodyHtml}
            ${ctaHtml}
            ${tagsHtml}
          </div>
        </div>
        <p class="note">${escapeHtml(safe.handle)}</p>`,
      script: "",
    },
  };

  const lookRender = looks[look];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(draft.name || "Post")}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden; }
  #stage {
    position: relative; box-sizing: border-box; overflow: hidden;
    width: ${canvas.width}px; height: ${canvas.height}px;
    font-family: ${font.stack};
    color: ${safe.ink};
    ${stageBackground}
  }
  .veil, .scrim { position: absolute; inset: 0; }
  .photo {
    position: absolute; inset: 0;
  }
  /* --- layout: panel ------------------------------------------------------ */
  /* Keyed off the stage rather than off each look, so all six looks get the
     band without any of them having to know the layout exists. */
  .panel {
    position: absolute; left: 0; right: 0; bottom: 0;
    height: ${100 - PHOTO_SPLIT}%;
  }
  .panel-layout .body {
    top: ${PHOTO_SPLIT}%; bottom: auto; height: ${100 - PHOTO_SPLIT}%;
  }
  .body {
    position: absolute; z-index: 2; inset: 0;
    box-sizing: border-box; padding: ${pad}px;
    display: flex; align-items: center; justify-content: center; text-align: center;
    overflow: hidden;
  }
  .body.left {
    align-items: center; justify-content: flex-start; text-align: left;
  }
  /* max-height plus overflow:hidden is what gives the fit loop something to
     measure: the box is capped, and scrollHeight reports what the text wanted
     to be. Without the cap the loop would never see an overflow. */
  #fit { max-width: 100%; max-height: 100%; overflow: hidden; }
  .hook { font-size: 1em; line-height: 1.14; font-weight: 800; margin: 0 0 0.34em; }
  .body p { font-size: 0.46em; line-height: 1.36; margin: 0 0 0.5em; font-weight: 400; opacity: 0.92; }
  .body p.cta { font-size: 0.4em; font-weight: 700; opacity: 1; }
  .body p.tags { font-size: 0.32em; opacity: 0.72; margin-top: 0.2em; }
  .kicker {
    font-size: 0.3em; font-weight: 600; letter-spacing: 0.34em;
    text-transform: uppercase; opacity: 0.8; margin: 0 0 1.4em;
  }
  #tag {
    position: absolute; z-index: 3; left: 0; right: 0;
    bottom: ${Math.round(canvas.height * 0.045)}px;
    text-align: center; font-size: ${tagSize}px; font-weight: 600;
    letter-spacing: 0.09em; opacity: 0.88;
  }
  /* --- look: aurora ------------------------------------------------- */
  .grain {
    position: absolute; inset: 0; z-index: 4; pointer-events: none;
    opacity: 0.05; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  /* --- look: card ---------------------------------------------------- */
  .kickerchip {
    position: absolute; z-index: 3; top: ${Math.round(pad * 1.1)}px; left: 50%;
    transform: translateX(-50%);
    font-size: ${Math.round(tagSize * 0.85)}px; font-weight: 700;
    letter-spacing: 0.32em; color: ${safe.ink};
    background: ${safe.accent}; border-radius: 999px; padding: 0.55em 1.4em 0.5em 1.6em;
  }
  .chip {
    position: absolute; z-index: 2; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: ${canvas.width - pad * 2}px;
    max-height: ${canvas.height - pad * 2}px;
    box-sizing: border-box; padding: ${Math.round(pad * 0.72)}px ${Math.round(pad * 0.85)}px;
    background: #ffffff; color: #1c1917;
    border-radius: ${Math.round(Math.min(canvas.width, canvas.height) * 0.045)}px;
    box-shadow: 0 ${Math.round(canvas.height * 0.03)}px ${Math.round(canvas.width * 0.06)}px rgba(0,0,0,0.28);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .chip #fit { font-weight: 800; flex: none; }
  .chip .hook { color: #1c1917; margin-bottom: 0.35em; }
  .cbody { min-height: 0; display: flex; flex-direction: column; }
  #lead {
    flex: 1; min-height: 0; overflow: hidden;
    font-size: 24px; line-height: 1.42; color: #44403c;
    white-space: pre-wrap;
  }
  .chip p.cta {
    margin: 0.7em 0 0; padding: 0.55em 0.8em; font-size: 0.36em; font-weight: 700;
    color: ${safe.accent}; border-top: 1px solid #e7e5e4;
  }
  /* --- look: poster --------------------------------------------------- */
  .quote {
    position: absolute; z-index: 2; left: ${pad}px; right: ${pad}px; bottom: ${Math.round(
    canvas.height * 0.19,
  )}px;
    font-style: italic; font-size: ${Math.round(canvas.width * 0.03)}px;
    line-height: 1.4; opacity: 0.82; overflow: hidden;
  }
  .rule {
    position: absolute; z-index: 2; left: ${pad}px; width: ${Math.round(pad * 1.6)}px;
    border-top: 2px solid ${safe.accent};
  }
  .rule.top { position: static; width: 100%; margin: 0 0 ${Math.round(pad * 0.32)}px; }
  .tagline {
    position: absolute; z-index: 2; left: ${pad}px; right: ${pad}px;
    bottom: ${Math.round(canvas.height * 0.1)}px;
    font-size: ${Math.round(canvas.width * 0.024)}px; font-weight: 700;
    letter-spacing: 0.06em; opacity: 0.92;
  }
  #stage .rule:not(.top) { bottom: ${Math.round(canvas.height * 0.155)}px; }
  /* --- look: editorial ------------------------------------------------- */
  .topframe {
    position: absolute; z-index: 2; top: ${Math.round(pad * 0.6)}px;
    left: ${pad}px; right: ${pad}px;
  }
  .topframe .kicker { margin: 0.6em 0 0; text-align: left; opacity: 0.75; }
  .body.left .hook { text-align: left; }
  .body.left p { text-align: left; }
  .bottomframe {
    position: absolute; z-index: 2; bottom: ${Math.round(pad * 0.6)}px;
    left: ${pad}px; right: ${pad}px;
  }
  .bottomframe .tagline { position: static; text-align: left; opacity: 0.75; }
  /* --- look: frame ------------------------------------------------------ */
  .frame.border {
    position: absolute; z-index: 2; inset: ${Math.round(pad * 0.45)}px;
    border: 1px solid ${safe.ink}; opacity: 0.55; pointer-events: none;
  }
  .frame.border::after {
    content: ""; position: absolute; inset: ${Math.round(pad * 0.09)}px;
    border: 1px solid ${safe.ink}; opacity: 0.6;
  }
  /* --- look: clean ------------------------------------------------------- */
  /* The accent underline under the first word is the only ornament: it points
     the eye once and leaves the rest of the page alone. */
  .note {
    position: absolute; z-index: 2; right: ${pad}px; bottom: ${Math.round(canvas.height * 0.045)}px;
    font-size: ${Math.round(tagSize * 0.9)}px; font-weight: 600;
    letter-spacing: 0.18em; opacity: 0.6;
  }
  .word {
    display: inline-block; border-bottom: 4px solid ${safe.accent};
    padding-bottom: 0.04em; font-weight: 800;
  }
  /* Marks sit above the words, in whichever look drew them. A mark is a decision
     the author made by hand, so nothing here clips it without saying so. */
  .mark { position: absolute; z-index: 6; }
</style>
</head>
<body>
  <div id="stage" class="${layout.id === "panel" ? "panel-layout" : ""}">
    ${photoBlock}
    ${panelBlock}
    ${scrimBlock}
    ${lookRender.body}
    ${grainBlock}
    ${elementsHtml(canvas, safe.elements)}
  </div>
<script>${FIT_SCRIPT}${lookRender.script}</script>
</body>
</html>`;
}

/** `my-post-instagram.png` — safe on every filesystem the author might save to. */
export function pngFilename(draft: SocialDraft, art: unknown): string {
  const base =
    (draft.name || draft.hook || "post")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "post";
  return `${base}-${normalizeArt(art).canvas}.png`;
}
