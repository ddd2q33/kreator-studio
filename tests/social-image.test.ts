/**
 * Tests for the image composer.
 *
 * What matters here is the string the renderer is handed. A preview that
 * disagrees with the PNG is the failure this whole module is built to prevent,
 * so these assert the document's structure — canvas size, the fit loop, the
 * handle, escaping — rather than anything about pixels, which is the browser's
 * job and is covered by the end-to-end check against a real render.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  BRAND_HANDLE,
  CANVASES,
  FONTS,
  LAYOUTS,
  artFor,
  buildPostHtml,
  canvasById,
  copyForImage,
  defaultArt,
  elementBox,
  elementKind,
  escapeHtml,
  fontById,
  layoutById,
  normalizeArt,
  pngFilename,
} from "../lib/social-image.ts";
import {
  ELEMENT_KINDS,
  ELEMENT_LIMIT,
  ELEMENT_SCALE_MAX,
  ELEMENT_SCALE_MIN,
  newElement,
} from "../lib/social-art.ts";
import { emptyDraft, type SocialDraft } from "../lib/social-draft.ts";
import { validateSize } from "../lib/browser-screenshot.ts";

function draftWith(patch: Partial<SocialDraft> = {}): SocialDraft {
  return {
    ...emptyDraft("custom"),
    name: "Chapter quote",
    hook: "Trauma is not a bad memory.",
    body: "It is a nervous system still waiting for the fire.",
    cta: "Chapter 3 is out now.",
    hashtags: ["trauma", "healing"],
    ...patch,
  };
}

/** A 1x1 transparent GIF, the smallest thing that is still a real image. */
const TINY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("canvases", () => {
  it("gives every network the pixel size it actually accepts", () => {
    const byId = Object.fromEntries(CANVASES.map((c) => [c.id, [c.width, c.height]]));
    assert.deepEqual(byId, {
      instagram: [1080, 1080],
      story: [1080, 1920],
      facebook: [1200, 630],
      x: [1600, 900],
      linkedin: [1200, 1200],
      tiktok: [1080, 1920],
    });
  });

  it("falls back to the default rather than throwing on a bad id", () => {
    assert.equal(canvasById("myspace").id, "instagram");
    assert.equal(canvasById(null).id, "instagram");
  });
});

describe("fonts", () => {
  it("only offers system stacks, so the render never needs the network", () => {
    for (const font of FONTS) {
      // Every stack ends in a generic family, which is what guarantees the
      // headless render gets a face of a similar shape even on a machine that
      // lacks the named one.
      assert.match(font.stack, /serif$|sans-serif$|monospace$/, `${font.id} has no generic fallback`);
    }
  });

  it("keeps every id unique", () => {
    assert.equal(new Set(FONTS.map((f) => f.id)).size, FONTS.length);
    assert.equal(new Set(LAYOUTS.map((l) => l.id)).size, LAYOUTS.length);
  });

  it("scales Impact down, because it sets far larger than its nominal size", () => {
    const impact = fontById("impact");
    const georgia = fontById("georgia");
    assert.ok(impact.scale < georgia.scale, "Impact should start smaller than Georgia");
    assert.equal(impact.upper, true, "Impact is a caps face");
  });
});

describe("normalizeArt", () => {
  it("returns the defaults for junk", () => {
    for (const junk of [undefined, null, 0, "x", [], true]) {
      assert.deepEqual(normalizeArt(junk), defaultArt());
    }
  });

  it("replaces ids that are not in the tables", () => {
    const art = normalizeArt({
      canvas: "myspace",
      font: "comic",
      layout: "origami",
      style: "baroque",
    });
    assert.equal(art.canvas, "instagram");
    assert.equal(art.font, "georgia");
    assert.equal(art.layout, defaultArt().layout);
    assert.equal(art.style, defaultArt().style);
  });

  it("refuses a colour that is not a hex string", () => {
    const art = normalizeArt({ ink: "red", accent: "url(javascript:alert(1))", base: "#fff" });
    const defaults = defaultArt();
    assert.equal(art.ink, defaults.ink);
    assert.equal(art.accent, defaults.accent);
    assert.equal(art.base, "#fff");
  });

  it("clamps the veil into range", () => {
    assert.equal(normalizeArt({ dim: 5 }).dim, 0.85);
    assert.equal(normalizeArt({ dim: -2 }).dim, 0);
    assert.equal(normalizeArt({ dim: Number.NaN }).dim, defaultArt().dim);
  });

  it("keeps a data URL background and drops a remote one", () => {
    assert.equal(normalizeArt({ background: TINY_GIF }).background, TINY_GIF);
    assert.equal(
      normalizeArt({ background: "https://example.com/a.png" }).background,
      undefined,
      "a remote background would make the headless render reach the network",
    );
  });

  it("reads art off a draft, defaulting when there is none", () => {
    assert.deepEqual(artFor({}), defaultArt());
    assert.deepEqual(artFor(undefined), defaultArt());
    assert.equal(artFor({ art: { font: "impact" } }).font, "impact");
  });
});

describe("escapeHtml", () => {
  it("neutralises every character that can break out of markup", () => {
    assert.equal(escapeHtml("<b>"), "&lt;b&gt;");
    assert.equal(escapeHtml("a & b"), "a &amp; b");
    assert.equal(escapeHtml('say "hi"'), "say &quot;hi&quot;");
    assert.equal(escapeHtml("it's"), "it&#39;s");
  });

  it("escapes the ampersand first, so entities are not double-decoded", () => {
    // If `<` ran before `&`, `&lt;` would come back as a literal `<`.
    assert.equal(escapeHtml("<"), "&lt;");
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });
});

describe("copyForImage", () => {
  it("flattens markdown rather than showing the asterisks", () => {
    const copy = copyForImage(draftWith({ body: "It is **not** a bad memory." }));
    assert.equal(copy.paragraphs[0], "It is not a bad memory.");
  });

  it("keeps paragraph breaks", () => {
    const copy = copyForImage(draftWith({ body: "First para.\n\nSecond para." }));
    assert.deepEqual(copy.paragraphs, ["First para.", "Second para."]);
  });

  it("caps the body and says so rather than dropping text quietly", () => {
    const long = Array.from({ length: 9 }, (_, i) => `Paragraph number ${i}.`).join("\n\n");
    const copy = copyForImage(draftWith({ body: long }));
    assert.equal(copy.paragraphs.length, 4);
    assert.equal(copy.bodyTruncated, true);
  });

  it("does not claim truncation for a body that fits", () => {
    assert.equal(copyForImage(draftWith()).bodyTruncated, false);
  });

  it("renders hashtags with a leading hash and no duplicates", () => {
    const copy = copyForImage(draftWith({ hashtags: ["#trauma", "trauma", "healing"] }));
    assert.equal(copy.hashtags, "#trauma #healing");
  });

  it("drops an empty or hash-only tag", () => {
    const copy = copyForImage(draftWith({ hashtags: ["#", "  ", "healing"] }));
    assert.equal(copy.hashtags, "#healing");
  });
});

describe("buildPostHtml", () => {
  const art = defaultArt();

  it("sizes the document to the canvas", () => {
    const html = buildPostHtml({ art: { ...art, canvas: "facebook" }, draft: draftWith() });
    assert.match(html, /width: 1200px/);
    assert.match(html, /height: 630px/);
  });

  it("stamps the handle bottom centre on every layout", () => {
    for (const layout of LAYOUTS) {
      const html = buildPostHtml({ art: { ...art, layout: layout.id }, draft: draftWith() });
      assert.match(html, /id="tag"/, `${layout.id} lost the handle`);
      assert.ok(
        html.includes(`>${BRAND_HANDLE}<`),
        `${layout.id} did not render the handle text`,
      );
      assert.match(html, /#tag \{[\s\S]*?text-align: center/, `${layout.id} tag is not centred`);
      assert.match(html, /#tag \{[\s\S]*?left: 0; right: 0/, `${layout.id} tag is not full width`);
      assert.match(html, /#tag \{[\s\S]*?bottom: \d/, `${layout.id} tag is not anchored to the bottom`);
    }
  });

  it("ships the fit loop, and a capped box for it to measure", () => {
    const html = buildPostHtml({ art, draft: draftWith() });
    assert.match(html, /getElementById\('fit'\)/);
    assert.match(html, /scrollHeight > box\.clientHeight/);
    // Without the cap the content box grows with the text and the loop can never
    // observe an overflow, so this is load-bearing, not decoration.
    assert.match(html, /#fit \{[^}]*max-height: 100%/, "the fit box is not height-capped");
    assert.match(html, /#fit \{[^}]*overflow: hidden/, "the fit box does not clip");
  });

  it("keeps children in em so one font-size write rescales the whole block", () => {
    const html = buildPostHtml({ art, draft: draftWith() });
    assert.match(html, /\.hook \{ font-size: 1em/);
    assert.match(html, /\.body p \{ font-size: 0\.46em/);
  });

  it("escapes the post's own text", () => {
    const html = buildPostHtml({
      art,
      draft: draftWith({ hook: '<script>alert("x")</script>', cta: "Tom & Jerry" }),
    });
    assert.ok(!html.includes("<script>alert"), "the hook was not escaped");
    assert.ok(html.includes("&lt;script&gt;"), "the hook is missing as escaped text");
    assert.ok(html.includes("Tom &amp; Jerry"), "the ampersand was not escaped");
  });

  it("uppercases the hook only for a caps face", () => {
    const impact = buildPostHtml({
      art: { ...art, font: "impact" },
      draft: draftWith(),
    });
    assert.match(impact, /TRAUMA IS NOT A BAD MEMORY/);
    const georgia = buildPostHtml({ art, draft: draftWith() });
    assert.match(georgia, /Trauma is not a bad memory/);
  });

  it("uses the chosen stack in the document", () => {
    const html = buildPostHtml({ art: { ...art, font: "bahnschrift" }, draft: draftWith() });
    assert.match(html, /font-family: Bahnschrift/);
  });

  it("dims the photo for veil and not for panel", () => {
    const veil = buildPostHtml({
      art: { ...art, layout: "veil", background: TINY_GIF, dim: 0.4 },
      draft: draftWith(),
    });
    assert.match(veil, /class="scrim" style="background:rgba\(10,10,12,0\.4\);"/);

    const panel = buildPostHtml({
      art: { ...art, layout: "panel", background: TINY_GIF },
      draft: draftWith(),
    });
    // The words in `panel` sit on an opaque block, so a scrim would only cost
    // contrast in the band above them.
    assert.ok(!panel.includes('class="scrim"'), "panel must not dim the photo");
    assert.match(panel, /class="panel"/);
  });

  it("confines the text to the lower half in the panel layout", () => {
    const html = buildPostHtml({
      art: { ...art, layout: "panel", background: TINY_GIF },
      draft: draftWith(),
    });
    // Keyed off the stage so every look inherits the band; without it `panel`
    // and `veil` are the same picture under two names.
    assert.match(html, /\.panel-layout \.body \{[^}]*top:\s*54%;[^}]*height:\s*46%;/);
    assert.match(html, /<div class="panel" style="background:/);
    // The opaque block fills exactly the space the text is confined to.
    assert.match(html, /\.panel \{[^}]*height:\s*46%;/);
  });

  it("falls back to a gradient when a photo layout has no photo", () => {
    const html = buildPostHtml({ art: { ...art, layout: "veil" }, draft: draftWith() });
    // The exact gradient is the look's business; what matters is that the stage
    // is painted rather than left empty, and that no url() has nothing to point at.
    assert.match(html, /background[a-z-]*:[^;]*gradient\(/);
    assert.ok(!html.includes("base64"), "there is no image to point a url() at");
  });

  it("ignores the photo for the solid and gradient layouts", () => {
    for (const layout of ["solid", "gradient"] as const) {
      const html = buildPostHtml({
        art: { ...art, layout, background: TINY_GIF },
        draft: draftWith(),
      });
      // Not "no url()": the frame paints a grain texture from one. What must not
      // appear is the author's photo, which is what the base64 marker stands for.
      assert.ok(!html.includes("base64"), `${layout} should not embed the photo`);
    }
  });

  it("shows hashtags only when asked", () => {
    const off = buildPostHtml({ art, draft: draftWith() });
    assert.ok(!off.includes("#trauma #healing"));
    const on = buildPostHtml({ art: { ...art, showHashtags: true }, draft: draftWith() });
    assert.ok(on.includes("#trauma #healing"));
  });

  it("leaves out the cta and hashtag lines when the post has none", () => {
    const html = buildPostHtml({
      art: { ...art, showHashtags: true },
      draft: draftWith({ cta: "", hashtags: [] }),
    });
    assert.ok(!html.includes('class="cta"'));
    assert.ok(!html.includes('class="tags"'));
  });

  it("never emits a meta viewport, which could override the canvas size", () => {
    const html = buildPostHtml({ art, draft: draftWith() });
    assert.ok(!html.includes("viewport"), "the render document must not carry a viewport meta");
  });
});

describe("pngFilename", () => {
  const art = defaultArt();

  it("produces a safe name ending in the canvas", () => {
    assert.equal(pngFilename(draftWith(), { ...art, canvas: "x" }), "chapter-quote-x.png");
  });

  it("strips anything a filesystem or a header would object to", () => {
    const name = pngFilename(
      draftWith({ name: 'Mi post: "2026" / trauma? <b>' }),
      art,
    );
    assert.match(name, /^[a-z0-9.-]+\.png$/);
  });

  it("falls back when the name has no usable characters", () => {
    const name = pngFilename(draftWith({ name: "***", hook: "" }), art);
    assert.equal(name, "post-instagram.png");
  });
});

describe("layoutById", () => {
  it("marks which layouts can use a photo", () => {
    assert.equal(layoutById("veil").usesPhoto, true);
    assert.equal(layoutById("panel").usesPhoto, true);
    assert.equal(layoutById("solid").usesPhoto, false);
    assert.equal(layoutById("gradient").usesPhoto, false);
  });

  it("falls back rather than throwing", () => {
    assert.equal(layoutById("nope").id, "veil");
  });
});

describe("validateSize", () => {
  it("accepts every canvas in the studio", () => {
    for (const canvas of CANVASES) {
      assert.equal(validateSize({ width: canvas.width, height: canvas.height }), null);
    }
  });

  it("rejects sizes the headless window would silently clamp", () => {
    assert.match(validateSize({ width: 10, height: 100 }) ?? "", /width/);
    assert.match(validateSize({ width: 100, height: 99999 }) ?? "", /height/);
    assert.match(validateSize({ width: 100.5, height: 100 }) ?? "", /whole number/);
    assert.match(validateSize({ width: Number.NaN, height: 100 }) ?? "", /width/);
  });
});

describe("elementBox", () => {
  const canvas = canvasById("instagram");

  it("centres a mark at the fraction it is stored at", () => {
    const box = elementBox(canvas, {
      id: "a",
      kind: "circle",
      x: 0.5,
      y: 0.5,
      scale: 1,
      color: "#fff",
    });
    assert.equal(box.cx, canvas.width / 2);
    assert.equal(box.cy, canvas.height / 2);
    assert.equal(box.left + box.width / 2, box.cx);
    assert.equal(box.top + box.height / 2, box.cy);
  });

  it("scales the box by the mark's own scale", () => {
    const base = elementBox(canvas, {
      id: "a",
      kind: "circle",
      x: 0.5,
      y: 0.5,
      scale: 1,
      color: "#fff",
    });
    const doubled = elementBox(canvas, {
      id: "a",
      kind: "circle",
      x: 0.5,
      y: 0.5,
      scale: 2,
      color: "#fff",
    });
    assert.equal(doubled.width, base.width * 2);
    assert.equal(doubled.height, base.height * 2);
    // The centre must not move when the mark grows, or resizing would slide it.
    assert.equal(doubled.cx, base.cx);
    assert.equal(doubled.cy, base.cy);
  });

  it("keeps a mark's proportions across canvas sizes", () => {
    // A Story is 9:16, so a fraction-based position has to mean the same thing in
    // both. This is the property that makes switching frame safe.
    const story = canvasById("story");
    for (const kind of ELEMENT_KINDS) {
      const onSquare = elementBox(canvas, { id: "a", kind: kind.id, x: 0.25, y: 0.75, scale: 1, color: "#fff" });
      const onStory = elementBox(story, { id: "a", kind: kind.id, x: 0.25, y: 0.75, scale: 1, color: "#fff" });
      const ratio = onStory.height / onStory.width;
      assert.ok(
        Math.abs(ratio - onSquare.height / onSquare.width) < 1e-9,
        `${kind.id} changed shape when the canvas did`,
      );
    }
  });

  it("derives the aspect from the kind, not from the stored mark", () => {
    const rule = elementBox(canvas, { id: "a", kind: "rule", x: 0.5, y: 0.5, scale: 1, color: "#fff" });
    const square = elementBox(canvas, { id: "a", kind: "corner", x: 0.5, y: 0.5, scale: 1, color: "#fff" });
    assert.ok(rule.width / rule.height > 4, "the rule should be a wide bar");
    assert.equal(square.width, square.height, "the corner should be square");
  });
});

describe("element kinds", () => {
  it("gives every kind a positive base and a usable aspect", () => {
    for (const kind of ELEMENT_KINDS) {
      assert.ok(kind.base > 0, `${kind.id} has no width`);
      assert.ok(kind.aspect > 0, `${kind.id} has no height`);
    }
  });

  it("supplies a character for exactly the glyph shapes", () => {
    for (const kind of ELEMENT_KINDS) {
      if (kind.shape === "glyph") {
        assert.equal(typeof kind.glyph, "string", `${kind.id} is a glyph with no character`);
        assert.ok((kind.glyph ?? "").length > 0);
      }
    }
  });

  it("uses unique ids, so no two buttons are the same mark", () => {
    const ids = ELEMENT_KINDS.map((k) => k.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("offers no quotation mark", () => {
    // A big decorative quote is the single most recognisable tell of a post
    // somebody else wrote. This tool exists so the author's own words carry the
    // post, so the ornament stays out of the library.
    assert.ok(
      // Widened deliberately: the point is that a value the type no longer
      // admits must not reappear in the table either.
      !ELEMENT_KINDS.some((k) => (k.id as string) === "quote"),
      "the quotation mark should not be offered",
    );
    assert.equal(elementKind("quote").id, ELEMENT_KINDS[0].id);
  });

  it("falls back for an unknown kind instead of throwing", () => {
    assert.equal(elementKind("nope").id, ELEMENT_KINDS[0].id);
    assert.equal(elementKind(null).id, ELEMENT_KINDS[0].id);
  });
});

describe("newElement", () => {
  it("hands out a distinct id every time", () => {
    const ids = new Set(
      Array.from({ length: 25 }, () => newElement("arrow", 0).id),
    );
    assert.equal(ids.size, 25);
  });

  it("starts on the canvas rather than off it", () => {
    for (let i = 0; i < 12; i += 1) {
      const element = newElement("asterisk", i);
      assert.ok(element.x >= -ELEMENT_LIMIT && element.x <= 1 + ELEMENT_LIMIT);
      assert.ok(element.y >= -ELEMENT_LIMIT && element.y <= 1 + ELEMENT_LIMIT);
    }
  });

  it("stagger repeats so a second mark is not hidden by the first", () => {
    const first = newElement("arrow", 0);
    const second = newElement("arrow", 1);
    assert.notEqual(first.x, second.x);
    assert.notEqual(first.y, second.y);
  });
});

describe("normalizeArt with elements", () => {
  const mark = (patch: Record<string, unknown> = {}) => ({
    id: "e1",
    kind: "arrow",
    x: 0.3,
    y: 0.7,
    scale: 1.2,
    color: "#ff0000",
    ...patch,
  });

  it("defaults to no marks at all", () => {
    assert.deepEqual(defaultArt().elements, []);
    assert.deepEqual(normalizeArt(undefined).elements, []);
    assert.deepEqual(normalizeArt({}).elements, []);
  });

  it("keeps a well formed mark", () => {
    const art = normalizeArt({ elements: [mark()] });
    assert.equal(art.elements.length, 1);
    assert.equal(art.elements[0].kind, "arrow");
    assert.equal(art.elements[0].x, 0.3);
    assert.equal(art.elements[0].color, "#ff0000");
  });

  it("drops marks whose kind is not in the library", () => {
    const art = normalizeArt({
      elements: [mark({ kind: "sparkle" }), mark({ id: "e2", kind: "rule" })],
    });
    assert.equal(art.elements.length, 1);
    assert.equal(art.elements[0].id, "e2");
  });

  it("drops a duplicated id, which would drag and delete as one mark", () => {
    const art = normalizeArt({ elements: [mark(), mark({ x: 0.9 })] });
    assert.equal(art.elements.length, 1);
    assert.equal(art.elements[0].x, 0.3, "the first copy should win");
  });

  it("substitutes a missing id rather than losing the mark", () => {
    const art = normalizeArt({ elements: [{ kind: "arrow" }] });
    assert.equal(art.elements.length, 1);
    assert.ok(art.elements[0].id);
  });

  it("clamps a mark that would be impossible to find again", () => {
    const art = normalizeArt({ elements: [mark({ x: 9, y: -9 })] });
    assert.ok(art.elements[0].x <= 1 + ELEMENT_LIMIT);
    assert.ok(art.elements[0].y >= -ELEMENT_LIMIT);
  });

  it("clamps the size to the range the controls offer", () => {
    const tiny = normalizeArt({ elements: [mark({ scale: 0.0001 })] });
    const huge = normalizeArt({ elements: [mark({ scale: 500 })] });
    assert.equal(tiny.elements[0].scale, ELEMENT_SCALE_MIN);
    assert.equal(huge.elements[0].scale, ELEMENT_SCALE_MAX);
  });

  it("repairs a colour that is not a colour", () => {
    assert.equal(normalizeArt({ elements: [mark({ color: "url(javascript:1)" })] }).elements[0].color, "#ffffff");
    assert.equal(normalizeArt({ elements: [mark({ color: 0x112233 })] }).elements[0].color, "#ffffff");
  });

  it("replaces a non-finite position with the centre", () => {
    const art = normalizeArt({
      elements: [mark({ x: Number.NaN, y: Number.POSITIVE_INFINITY })],
    });
    assert.equal(art.elements[0].x, 0.5);
    assert.equal(art.elements[0].y, 0.5);
  });

  it("ignores a list that is not a list", () => {
    for (const bad of ["nope", 5, null, { kind: "arrow" }]) {
      assert.deepEqual(normalizeArt({ elements: bad }).elements, [], String(bad));
    }
  });

  it("skips entries that are not objects", () => {
    const art = normalizeArt({ elements: [null, "x", 7, mark()] });
    assert.equal(art.elements.length, 1);
  });
});

describe("handle size", () => {
  it("defaults to the larger size, not the old fixed one", () => {
    assert.ok(defaultArt().handleSize > 1);
  });

  it("stamps a bigger handle when the dial is turned up", () => {
    const draft = draftWith();
    const base = defaultArt();
    const sizeOf = (html: string) => {
      const match = /#tag \{[^}]*font-size: (\d+)px/.exec(html);
      assert.ok(match, "the tag rule should carry a size");
      return Number(match[1]);
    };
    const small = sizeOf(buildPostHtml({ art: { ...base, handleSize: 1 }, draft }));
    const large = sizeOf(buildPostHtml({ art: { ...base, handleSize: 2.5 }, draft }));
    // Rounding to whole pixels is the only thing allowed to differ, so the
    // ratio is checked with a pixel of slack rather than exactly.
    assert.ok(large > small, "turning the dial up must enlarge the stamp");
    assert.ok(
      Math.abs(large / small - 2.5) < 0.1,
      `expected about 2.5x, got ${large / small}`,
    );
  });

  it("clamps the dial to its range", () => {
    assert.equal(normalizeArt({ handleSize: 0 }).handleSize, 0.5);
    assert.equal(normalizeArt({ handleSize: 99 }).handleSize, 3);
    assert.equal(normalizeArt({ handleSize: "big" }).handleSize, defaultArt().handleSize);
  });

  it("still lets the handle be edited, and still stamps it", () => {
    const html = buildPostHtml({
      art: { ...defaultArt(), handle: "@otro.libro" },
      draft: draftWith(),
    });
    assert.match(html, /<div id="tag">@otro\.libro<\/div>/);
  });

  it("drops the signature when the handle is cleared", () => {
    const html = buildPostHtml({
      art: { ...defaultArt(), handle: "" },
      draft: draftWith(),
    });
    assert.match(html, /<div id="tag"><\/div>/);
  });
});

describe("marks in the rendered document", () => {
  const art = {
    ...defaultArt(),
    elements: [
      { id: "a", kind: "asterisk" as const, x: 0.2, y: 0.3, scale: 1, color: "#ffd700" },
      { id: "b", kind: "rule" as const, x: 0.5, y: 0.5, scale: 1, color: "#00ff00" },
    ],
  };

  it("draws one box per mark", () => {
    const html = buildPostHtml({ art, draft: draftWith() });
    assert.equal(html.match(/class="mark"/g)?.length, 2);
  });

  it("places each box where elementBox says", () => {
    const html = buildPostHtml({ art, draft: draftWith() });
    const canvas = canvasById(art.canvas);
    for (const element of art.elements) {
      const box = elementBox(canvas, element);
      assert.match(
        html,
        new RegExp(
          `left:${Math.round(box.left)}px;top:${Math.round(box.top)}px;` +
            `width:${Math.round(box.width)}px;height:${Math.round(box.height)}px;`,
        ),
        `${element.kind} was drawn somewhere other than its box`,
      );
    }
  });

  it("carries the mark's own colour through", () => {
    const html = buildPostHtml({ art, draft: draftWith() });
    assert.match(html, /#ffd700/);
    assert.match(html, /#00ff00/);
  });

  it("puts the marks above the words", () => {
    // A mark that renders behind the text is invisible, which reads as "the
    // button did nothing". The body sits at z-index 2 and the grain at 5, so the
    // marks have to clear both to stay visible in every look.
    const html = buildPostHtml({ art, draft: draftWith() });
    const body = html.indexOf('class="body"');
    const mark = html.indexOf('class="mark"');
    assert.ok(body >= 0 && mark > body, "the marks should be drawn after the words");
    const z = /\.mark \{ position: absolute; z-index: (\d+); \}/.exec(html);
    assert.ok(z, "the mark rule should carry a z-index");
    assert.ok(Number(z[1]) > 5, `marks at z-index ${z[1]} would sit under the grain`);
  });

  it("draws the glyph for a character mark", () => {
    const html = buildPostHtml({
      art: { ...art, elements: [art.elements[0]] },
      draft: draftWith(),
    });
    assert.match(html, /class="mark"[^>]*>✳</);
  });

  it("adds no markup when there are no marks", () => {
    const html = buildPostHtml({ art: defaultArt(), draft: draftWith() });
    assert.doesNotMatch(html, /class="mark"/);
  });
});

