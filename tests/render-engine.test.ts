import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMarkdownRenderer,
  escapeAttr,
  hasTocMarker,
  hexToRgba,
  openersFromHtml,
  resolveImage,
  slugify,
  titleFromMarkdown,
} from "../lib/render-engine.ts";

describe("escapeAttr", () => {
  it("escapes quotes, angle brackets and ampersands", () => {
    assert.equal(escapeAttr('a "b" <c> & d'), "a &quot;b&quot; &lt;c&gt; &amp; d");
  });
});

describe("slugify", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    assert.equal(slugify("Hello, World!"), "hello-world");
  });

  it("strips accents via NFKD", () => {
    assert.equal(slugify("Código Limpio"), "codigo-limpio");
  });

  it("falls back to 'section' when empty", () => {
    assert.equal(slugify("***"), "section");
  });
});

describe("hexToRgba", () => {
  it("converts 6-digit hex", () => {
    assert.equal(hexToRgba("#4f46e5", 0.08), "rgba(79, 70, 229, 0.08)");
  });

  it("expands 3-digit hex", () => {
    assert.equal(hexToRgba("#abc", 1), "rgba(170, 187, 204, 1)");
  });

  it("falls back to black on invalid input", () => {
    assert.equal(hexToRgba("zzz", 0.5), "rgba(0, 0, 0, 0.5)");
  });
});

describe("resolveImage", () => {
  const images = {
    "images/pic.png": "data:image/png;base64,AA==",
    "photo.jpg": "data:image/jpeg;base64,BB==",
  };

  it("passes data/http/blob URLs through untouched", () => {
    assert.equal(resolveImage("data:image/png;base64,CC==", images), "data:image/png;base64,CC==");
    assert.equal(resolveImage("https://example.com/x.png", images), "https://example.com/x.png");
  });

  it("resolves direct keys", () => {
    assert.equal(resolveImage("images/pic.png", images), "data:image/png;base64,AA==");
  });

  it("normalizes Windows separators and leading ./", () => {
    assert.equal(resolveImage("images\\pic.png", images), "data:image/png;base64,AA==");
  });

  it("falls back to the lowercased basename", () => {
    assert.equal(resolveImage("./assets/deep/photo.jpg", images), "data:image/jpeg;base64,BB==");
  });

  it("returns the href unchanged when nothing matches", () => {
    assert.equal(resolveImage("missing.png", images), "missing.png");
  });
});

describe("titleFromMarkdown", () => {
  it("returns the first # heading", () => {
    assert.equal(titleFromMarkdown("intro\n\n# My Title\nbody"), "My Title");
  });

  it("ignores ## headings", () => {
    assert.equal(titleFromMarkdown("## only h2"), null);
  });
});

describe("hasTocMarker", () => {
  it("detects [toc] and <!-- toc --> on their own line", () => {
    assert.equal(hasTocMarker("intro\n\n[toc]\n\n## X"), true);
    assert.equal(hasTocMarker("<!-- toc -->"), true);
  });

  it("rejects inline occurrences", () => {
    assert.equal(hasTocMarker("see [toc] below"), false);
    assert.equal(hasTocMarker("[toc] inline"), false);
  });
});

describe("createMarkdownRenderer", () => {
  it("renders plain paragraphs", () => {
    assert.equal(createMarkdownRenderer()("plain text"), "<p>plain text</p>\n");
    assert.equal(createMarkdownRenderer()(""), "");
  });

  it("renders chapter openers with label, slug id and ornament", () => {
    const html = createMarkdownRenderer()("# Chapter 1. Foundations\n\nHello.");
    assert.match(html, /class="chapter-page"/);
    assert.match(html, />Chapter 1<\/p>/);
    assert.match(html, /id="chapter-1-foundations"/);
    assert.match(html, />Foundations<\/h1>/);
  });

  it("supports roman numerals in openers", () => {
    const html = createMarkdownRenderer()("# Chapter IV. The Turn");
    assert.match(html, />Chapter IV<\/p>/);
    assert.equal(openersFromHtml(html).chapter, 4);
  });

  it("renders part openers and counts both counters", () => {
    const html = createMarkdownRenderer()("# Part I. Warming Up\n\ntext\n\n# Chapter 2. Deep");
    assert.match(html, /class="part-page"/);
    assert.match(html, />Part I<\/p>/);
    assert.deepEqual(openersFromHtml(html), { chapter: 2, part: 1 });
  });

  it("deduplicates heading slugs", () => {
    const html = createMarkdownRenderer()("## Setup\n\n## Setup");
    assert.match(html, /id="setup"/);
    assert.match(html, /id="setup-2"/);
  });

  it("highlights code with language label", () => {
    const html = createMarkdownRenderer()("```ts\nconst a = 1;\n```");
    assert.match(html, /class="code-frame"/);
    assert.match(html, /code-lang">ts</);
    assert.match(html, /language-ts/);
    assert.match(html, /hljs-keyword/);
  });

  it("falls back to auto-highlight for unknown languages", () => {
    const html = createMarkdownRenderer()("```weird\nfoo bar\n```");
    assert.match(html, /class="code-frame"/);
    assert.match(html, /code-lang">weird</);
  });

  it("resolves image hrefs through the image map", () => {
    const render = createMarkdownRenderer({
      images: { "pic.png": "data:image/png;base64,AAAA" },
    });
    const html = render("![alt text](images/pic.png)");
    assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="alt text">/);
    assert.doesNotMatch(html, /<figure/);
  });

  it("wraps titled images in figures and numbers them per chapter", () => {
    const render = createMarkdownRenderer({
      images: { "pic.png": "data:image/png;base64,AAAA" },
    });
    const html = render('# Chapter 3. Tools\n\n![shot](pic.png "Shot")');
    assert.match(html, /id="figure-3-1"/);
    assert.match(html, /<figcaption>Figure 3\.1 — Shot<\/figcaption>/);
  });

  it("keeps running counters across successive calls", () => {
    const render = createMarkdownRenderer({
      images: { "pic.png": "data:image/png;base64,AAAA" },
    });
    render('# Chapter 1. A\n\n![x](pic.png "T1")');
    const second = render('![](pic.png "T2")');
    assert.match(second, /<figcaption>Figure 1\.2 — T2<\/figcaption>/);
  });

  it("expands [!kind] admonitions into callouts", () => {
    const html = createMarkdownRenderer()("> [!warning]\n> Careful with this step.");
    assert.match(html, /callout callout-warning/);
    assert.match(html, />Warning<\/p>/);
    assert.match(html, /Careful with this step\./);
  });

  it("leaves plain blockquotes untouched", () => {
    const html = createMarkdownRenderer()("> just a quote");
    assert.equal(html, "<blockquote><p>just a quote</p>\n</blockquote>");
  });

  it("maps write-line rules to .md-write-line and keeps --- as <hr>", () => {
    assert.match(createMarkdownRenderer()("a\n\n___\n\nb"), /class="md-write-line"/);
    assert.match(createMarkdownRenderer()("a\n\n----\n\nb"), /class="md-write-line"/);
    assert.match(createMarkdownRenderer()("a\n\n---\n\nb"), /<hr>/);
  });

  it("builds a numbered TOC at the [toc] marker", () => {
    const html = createMarkdownRenderer()(
      ["# Chapter 1. Start", "", "[toc]", "", "## First", "", "Para.", "", "### Deep"].join("\n"),
    );
    assert.match(html, /<nav class="toc"/);
    assert.match(html, /<li class="toc-l2"><a href="#first"><span class="toc-num">1\.1<\/span>/);
    assert.match(html, /toc-num">1\.1\.1<\/span>/);
    assert.doesNotMatch(html, /<p>\[toc\]<\/p>/);
  });

  it("expands ::: quote directives", () => {
    const html = createMarkdownRenderer()(
      '::: quote by="Carl Jung"\nThe wound is the place where the Light enters you.\n:::',
    );
    assert.match(html, /feature-quote/);
    assert.match(html, /quote-by">— Carl Jung</);
  });

  it("expands ::: tool directives with labeled sections and numbered steps", () => {
    const html = createMarkdownRenderer()(
      "::: tool\n**How To Use**\n1. Breathe\n2. Ground yourself\n:::",
    );
    assert.match(html, /tool-label">How To Use</);
    assert.match(html, /<li data-n="1">Breathe<\/li>/);
    assert.match(html, /tool-list/);
  });
});
