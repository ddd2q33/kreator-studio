/**
 * Shared markdown → HTML rendering engine.
 *
 * Used by three consumers so they can never drift apart:
 *   - the browser UI (components/markdown-converter.tsx)
 *   - the headless REST API (app/api/preview, app/api/convert-docx)
 *   - the CLI (bin/book-author.mjs, runs on plain Node via type stripping)
 *
 * Isomorphic on purpose: no DOM, no node builtins — only marked + highlight.js.
 */

import { Marked, Parser, type Token, type Tokens } from "marked";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import csharp from "highlight.js/lib/languages/csharp";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import php from "highlight.js/lib/languages/php";
import yaml from "highlight.js/lib/languages/yaml";
import { processDirectives } from "./directives.ts";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("php", php);
hljs.registerLanguage("yaml", yaml);

export type ImageMap = Record<string, string>;

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function resolveImage(href: string, images: ImageMap): string {
  if (
    href.startsWith("data:") ||
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("blob:")
  ) {
    return href;
  }
  const normalized = href.replace(/\\/g, "/").replace(/^\.?\//, "");
  const direct = images[normalized];
  if (direct) return direct;
  const base = normalized.split("/").pop()?.toLowerCase() ?? "";
  return images[base] ?? href;
}

export const RENDER_OPTIONS = { gfm: true, breaks: true } as const;

export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * Hierarchical renderer: detects `# Chapter N. Title` / `# Part N.` openers and
 * drives the chapter/section counters from them. Content below the opener
 * becomes sections (##) and subsections (###) — no fake "Chapter 2" pages.
 */
export type Openers = { chapter: number; part: number };
export const CHAPTER_TITLE_RE =
  /^(chapter)\s+(\d+|[ivxlcdm]+)(?::|\.|—|–|-|\s)\s*/i;
export const PART_TITLE_RE =
  /^(part)\s+(\d+|[ivxlcdm]+)(?::|\.|—|–|-|\s)\s*/i;
const ROMAN_VALUES: Record<string, number> = {
  i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000,
};
function romanToNumber(roman: string): number {
  const s = roman.toLowerCase();
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const value = ROMAN_VALUES[s[i]] ?? 0;
    const next = ROMAN_VALUES[s[i + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}
function openerNumber(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : romanToNumber(raw);
}
export function openersFromHtml(html: string): Openers {
  const re =
    /<div class="(?:part-page|chapter-page)"[^>]*><p class="(?:part-kicker|chapter-label)"[^>]*>(Chapter|Part)\s+(\d+|[ivxlcdm]+)<\/p>/gi;
  const out: Openers = { chapter: 0, part: 0 };
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = openerNumber(m[2]);
    if (m[1].toLowerCase() === "chapter") out.chapter = n;
    else out.part = n;
  }
  return out;
}

export function plainHeadingText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

export const ADMONITION_TITLES: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
  "best-practice": "Best Practice",
  error: "Error",
  example: "Example",
};

export const ADMONITION_ICONS: Record<string, string> = {
  note: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  tip: `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>`,
  important: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  warning: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 16h.01"/></svg>`,
  caution: `<svg viewBox="0 0 24 24"><path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
  "best-practice": `<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>`,
  error: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  example: `<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
};

function admonitionOf(
  block: Token | undefined,
): { kind: string; dropTokens: number } | null {
  if (!block || block.type !== "paragraph") return null;
  const para = block as Tokens.Paragraph;
  const first = para.tokens?.[0];
  if (!first || first.type !== "text") return null;
  const m = /^\[!([a-z][a-z\s-]*)\]$/i.exec(first.text.trim());
  if (!m) return null;
  const kind = m[1].trim().toLowerCase().replace(/[\s]+/g, "-");
  if (!ADMONITION_TITLES[kind]) return null;
  const drop = para.tokens[1]?.type === "br" ? 2 : 1;
  return { kind, dropTokens: Math.min(drop, para.tokens.length) };
}

/** First `# ` heading of a markdown doc, for chapter labels. */
export function titleFromMarkdown(md: string): string | null {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].trim() : null;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(0, 0, 0, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const FRONT_MATTER_RE = /^(part|book|chapter)\s+(\d+|[ivxlcdm]+)/i;

export function buildTocHtml(
  rendered: string,
): string {
  const entries: { depth: number; id: string; num: string; text: string }[] =
    [];
  const re =
    /<div class="(part-page|chapter-page)"[^>]*><p class="(?:part-kicker|chapter-label)"[^>]*>([^<]*)<\/p><h([1-6]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\3>|<h([234]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\6>/g;
  let chapter = 0;
  let chapterSeen = false;
  let section = 0;
  let subsection = 0;
  let chapterHasH2 = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rendered))) {
    if (match[1]) {
      const isChapterPage = match[1] === "chapter-page";
      const depth = Number(match[3]);
      const label = match[2].trim();
      const text = match[5].replace(/<[^>]+>/g, "").trim();
      if (isChapterPage) {
        const n = /(\d+)\s*$/.exec(label);
        chapter = n ? Number(n[1]) : chapter + 1;
        section = 0;
        subsection = 0;
        chapterHasH2 = false;
        chapterSeen = true;
      }
      entries.push({ depth, id: match[4], num: label, text });
      continue;
    }
    const depth = Number(match[6]);
    const text = match[8].replace(/<[^>]+>/g, "").trim();
    // Front-matter sections before the first chapter opener carry no number.
    if (!chapterSeen) {
      entries.push({ depth, id: match[7], num: "", text });
      continue;
    }
    let num: string;
    if (depth === 2) {
      // A real `##` section: 1.1, 1.2, ...
      section += 1;
      subsection = 0;
      chapterHasH2 = true;
      num = `${chapter}.${section}`;
    } else if (depth === 3) {
      if (chapterHasH2) {
        // `###` under a `##`: subsection 1.1.1
        subsection += 1;
        num = `${chapter}.${section}.${subsection}`;
      } else {
        // `###` with no `##` in this chapter: treat as a section (1.1)
        section += 1;
        subsection = 0;
        num = `${chapter}.${section}`;
      }
    } else {
      subsection += 1;
      num = `${chapter}.${section || 0}.${subsection}`;
    }
    entries.push({ depth, id: match[7], num, text });
  }
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      (e) =>
        `<li class="toc-l${e.depth}"><a href="#${e.id}"><span class="toc-num">${escapeAttr(e.num)}</span><span class="toc-text">${escapeAttr(e.text)}</span><span class="toc-pg"></span></a></li>`,
    )
    .join("");
  return `<nav class="toc" aria-label="Table of contents"><div class="toc-title">Contents</div><ol>${rows}</ol></nav>`;
}

export function hasTocMarker(markdown: string): boolean {
  return (
    /^\[toc\]\s*$/im.test(markdown) || /^<!--\s*toc\s*-->\s*$/im.test(markdown)
  );
}

/**
 * Build a renderer function (markdown → body HTML). The same instance keeps
 * running counters (chapters, figures) across successive calls, exactly like
 * the UI does when compiling a multi-chapter book.
 */
export function createMarkdownRenderer(
  options: { images?: ImageMap } = {},
): (md: string) => string {
  const images = options.images ?? {};
  const usedIds = new Map<string, number>();
  const slugFor = (text: string): string => {
    const base = slugify(text);
    const n = usedIds.get(base) ?? 0;
    usedIds.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
  // Running counters for the technical theme's "Figure N.M —" captions.
  const counters = { fig: 0, chapter: 0 };
  const marked = new Marked(RENDER_OPTIONS).use({
    renderer: {
      image({ href, title, text }) {
        const src = resolveImage(href, images);
        counters.fig += 1;
        const cap = title ? `<figcaption>Figure ${counters.chapter}.${counters.fig} — ${escapeAttr(title)}</figcaption>` : "";
        const img = `<img src="${escapeAttr(src)}" alt="${escapeAttr(text)}"${title ? ` title="${escapeAttr(title)}"` : ""}>`;
        return title
          ? `<figure id="figure-${counters.chapter}-${counters.fig}">${img}${cap}</figure>`
          : img;
      },
      code({ text, lang }) {
        const language = lang ? lang.toLowerCase() : "";
        const className = language
          ? ` class="hljs language-${language}"`
          : ' class="hljs"';
        let highlighted: string;
        try {
          highlighted =
            language && hljs.getLanguage(language)
              ? hljs.highlight(text, {
                  language,
                  ignoreIllegals: true,
                }).value
              : hljs.highlightAuto(text).value;
        } catch {
          highlighted = escapeAttr(text);
        }
        const label = language
          ? `<span class="code-lang">${escapeAttr(language)}</span>`
          : "";
        return `<div class="code-frame">${label}<pre><code${className}>${highlighted}</code></pre></div>`;
      },
      heading(token: Tokens.Heading) {
        const plain = plainHeadingText(token.text);
        const id = slugFor(plain);
        const front = FRONT_MATTER_RE.exec(token.text);
        if (front) {
          const kind = front[1].toLowerCase();
          const label = `${
            kind === "book" ? "Book" : kind === "part" ? "Part" : "Chapter"
          } ${front[2].toUpperCase()}`;
          const rest = token.text
            .slice(front[0].length)
            .replace(/^[\s:·.—–-]+/, "")
            .trim();
          const titleHtml = rest
            ? (marked.parseInline(rest, RENDER_OPTIONS) as string)
            : "";
          if (rest) {
            if (kind === "chapter") {
              counters.chapter = openerNumber(front[2]) || counters.chapter + 1;
              counters.fig = 0;
              return `<div class="chapter-page" style="counter-reset: fig 0"><p class="chapter-label">${escapeAttr(label)}</p><h${token.depth} id="${id}" class="chapter-title" style="counter-reset: fig 0 section 0 subsection 0">${titleHtml}</h${token.depth}><div class="part-ornament chapter-ornament" aria-hidden="true"></div></div>`;
            }
            return `<div class="part-page" style="counter-reset: fig 0"><p class="part-kicker">${escapeAttr(label)}</p><h${token.depth} id="${id}" class="part-title" style="counter-reset: fig 0 section 0 subsection 0">${titleHtml}</h${token.depth}><div class="part-ornament" aria-hidden="true"></div></div>`;
          }
          if (kind === "chapter") {
            counters.chapter = openerNumber(front[2]) || counters.chapter + 1;
            counters.fig = 0;
          }
          return `<div class="${kind === "chapter" ? "chapter-page" : "part-page"}"><p class="${kind === "chapter" ? "chapter-label" : "part-kicker"}">${escapeAttr(label)}</p><h${token.depth} id="${id}" class="${kind === "chapter" ? "chapter-title" : "part-title"}">${escapeAttr(plain)}</h${token.depth}></div>`;
        }
        const inner = Parser.parseInline(token.tokens, RENDER_OPTIONS);
        const counterReset =
          token.depth === 1 ? ' style="counter-reset: fig 0 section 0 subsection 0"' : "";
        return `<h${token.depth} id="${id}"${counterReset}>${inner}</h${token.depth}>`;
      },
      blockquote(token: Tokens.Blockquote) {
        const ad = admonitionOf(token.tokens[0]);
        if (ad) {
          const para = token.tokens[0] as Tokens.Paragraph;
          const rest: Token[] = token.tokens.slice(1);
          const keptInline = para.tokens.slice(ad.dropTokens);
          if (keptInline.length > 0) {
            rest.unshift({
              ...para,
              tokens: keptInline,
            });
          }
          const content = Parser.parse(rest, RENDER_OPTIONS);
          const icon = ADMONITION_ICONS[ad.kind] ?? "";
          return `<div class="callout callout-${ad.kind}"><p class="callout-title"><span class="callout-icon" aria-hidden="true">${icon}</span>${ADMONITION_TITLES[ad.kind]}</p><div class="callout-content">${content}</div></div>`;
        }
        const content = Parser.parse(token.tokens, RENDER_OPTIONS);
        return `<blockquote>${content}</blockquote>`;
      },
      hr(token: Tokens.Hr) {
        return /^(_+|-{4,})\s*$/.test(token.raw.replace(/\n$/g, ""))
          ? '<p class="md-write-line"></p>'
          : "<hr>";
      },
    },
  });
  return (md: string): string => {
    try {
      // ::: therapeutic directives (tool / worksheet / diagram / reflection /
      // summary / quote) expand into styled HTML before markdown parsing.
      const expanded = processDirectives(md, {
        parseInline: (text) =>
          marked.parseInline(text, RENDER_OPTIONS) as string,
      });
      const rendered = marked.parse(expanded, { async: false }) as string;
      if (!hasTocMarker(expanded)) return rendered;
      const toc = buildTocHtml(rendered);
      return rendered
        .replace(/<p>\s*\[toc\]\s*<\/p>/gi, toc)
        .replace(/<!--\s*toc\s*-->/gi, toc);
    } catch {
      return "";
    }
  };
}
