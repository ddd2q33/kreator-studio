#!/usr/bin/env node
/**
 * trauma-book-template build script
 * ---------------------------------
 * manuscript/book.md  →  html/book.html (+ html/preview.html for screen QA)
 *
 * Directive syntax:
 *   ::: name attr="value" number=7     → opens a block
 *   ::: name ... :::                   → self-closing one-liner
 *   :::                                → closes the innermost open block
 *   ::: end                            → closes the innermost open block (legacy)
 *
 * Blocks:
 *   titlepage, copyright, disclaimer, dedication,
 *   page heading="..", chapter number=1 title=".." intro=".." quote="..",
 *   tool number=01 title="..", box insight|science|reflection|therapist|important [title=".."],
 *   worksheet title=".." purpose="..", reflection title=".." before="..",
 *   summary, quote [by=".."], diagram [caption=".." highlight=".."],
 *   figure src=".." caption="..", table caption=".." columns="A|B|C",
 *   resources [heading=".."]
 *
 * Inline: **bold**, *italic*, `code`, [links](..), ==highlight==
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const OPEN = /^:::\s*([a-zA-Z-]+)\s*(.*)$/;
const CLOSE = /^:::\s*$/;
const END = /^:::\s*end\s*$/i;
const SELFCLOSE = /^:::\s*([a-zA-Z-]+)\s*(.*?)\s*:::\s*$/;
const HR = /^(---+|\*\*\*+)\s*$/;
const WRITELINE = /^_{3,}\s*$/;

/* ---------------- Tiny markdown ---------------- */

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(md) {
  let s = escapeHtml(md);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/==([^=]+)==/g, '<mark class="hl">$1</mark>');
  return s;
}

/** Paragraphs, headings, lists, writing lines and pipe tables — index-based scan. */
function mdBlocks(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let para = [];
  let listType = null;
  let listItems = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listType) {
      out.push(
        `<${listType} class="therapy-list">` +
          listItems.map((li) => `<li>${inline(li)}</li>`).join("") +
          `</${listType}>`,
      );
      listType = null;
      listItems = [];
    }
  };
  const flushAll = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (HR.test(line)) { flushAll(); out.push(`<hr class="section-rule">`); continue; }

    if (WRITELINE.test(line)) { flushAll(); out.push(`<div class="write-line"></div>`); continue; }

    // Pipe table: header row, |---| separator, then body rows
    if (
      /^\|.+\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")
    ) {
      flushAll();
      const rows = [];
      let j = i;
      while (j < lines.length && /^\|.*\|\s*$/.test(lines[j])) { rows.push(lines[j]); j++; }
      const cells = (r) => r.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
      const headers = cells(rows[0]);
      const bodyRows = rows.slice(2).map(cells);
      out.push(
        `<div class="table-wrap"><table class="therapy-table">` +
          `<thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>` +
          `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>` +
          `</table></div>`,
      );
      i = j - 1;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (listType !== type) flushList();
      listType = type;
      listItems.push(ul ? ul[1] : ol[1]);
      continue;
    }

    if (line.trim() === "") { flushAll(); continue; }

    if (listType) flushList();
    para.push(line.trim());
  }
  flushAll();
  return out.join("\n");
}

/* ---------------- Directive parsing (stack-based, nested) ---------------- */

/** Attrs: quoted, unquoted, and bare words (stored in _bare array). */
function parseAttrs(str) {
  const attrs = { _bare: [] };
  const re = /([a-zA-Z_-]+)\s*=\s*"([^"]*)"|([a-zA-Z_-]+)\s*=\s*'([^']*)'|([a-zA-Z_-]+)\s*=\s*([^\s"']+)|(?<=\s|^)([a-zA-Z_-]+)(?=\s|$)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1]) attrs[m[1]] = m[2];
    else if (m[3]) attrs[m[3]] = m[4];
    else if (m[5]) attrs[m[5]] = m[6];
    else if (m[7]) attrs._bare.push(m[7]);
  }
  return attrs;
}

/** Split source into a tree of {type, attrs, children: (Token|string)[], content}. */
function parseDirectives(src) {
  const lines = src.split(/\r?\n/);
  let frontmatter = {};
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const kv = l.match(/^([a-zA-Z_-]+):\s*(.*)$/);
        if (kv) frontmatter[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
      }
      i = end + 1;
    }
  }

  const root = { type: "root", attrs: { _bare: [] }, children: [] };
  const stack = [root];
  let buf = [];
  const flushBuf = () => {
    if (buf.length) {
      stack[stack.length - 1].children.push(buf.join("\n"));
      buf = [];
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];

    if (CLOSE.test(line) || END.test(line)) {
      if (stack.length > 1) { flushBuf(); stack.pop(); }
      continue;
    }

    const self = line.match(SELFCLOSE);
    if (self) {
      flushBuf();
      stack[stack.length - 1].children.push({
        type: self[1].toLowerCase(),
        attrs: parseAttrs(self[2] || ""),
        children: [],
      });
      continue;
    }

    const open = line.match(OPEN);
    if (open) {
      flushBuf();
      const node = {
        type: open[1].toLowerCase(),
        attrs: parseAttrs(open[2] || ""),
        children: [],
      };
      // `::: box-reflection` → box with type reflection
      if (node.type.startsWith("box-")) {
        node.attrs._type = node.type.slice(4);
        node.type = "box";
      }
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }

    buf.push(line);
  }
  flushBuf();
  return { frontmatter, root };
}

/* ---------------- Renderers ---------------- */

const BOX_META = {
  insight:    { label: "Insight",           cls: "box-insight" },
  science:    { label: "Science Behind It", cls: "box-science" },
  reflection: { label: "Reflection",        cls: "box-reflection" },
  therapist:  { label: "Therapist Note",    cls: "box-therapist" },
  important:  { label: "Important",         cls: "box-important" },
};

function renderers() {
  return {
    markdown: (tok) => mdBlocks(tok.content),

    titlepage: (tok) => {
      const a = tok.attrs;
      return `<section class="fm-titlepage">
  ${a.kicker ? `<p class="fm-kicker">${escapeHtml(a.kicker)}</p>` : ""}
  <h1 class="fm-title">${inline(a.title || "")}</h1>
  ${a.subtitle ? `<p class="fm-subtitle">${inline(a.subtitle)}</p>` : ""}
  ${a.author ? `<p class="fm-author">${escapeHtml(a.author)}</p>` : ""}
  ${a.publisher ? `<p class="fm-publisher">${escapeHtml(a.publisher)}</p>` : ""}
</section>`;
    },

    copyright: (tok) => `<section class="fm-page fm-copyright">${mdBlocks(tok.content)}</section>`,

    disclaimer: (tok) => `<section class="fm-page fm-disclaimer-page">${mdBlocks(tok.content)}</section>`,

    dedication: (tok) => `<section class="fm-dedication">${mdBlocks(tok.content)}</section>`,

    page: (tok) => `<section class="fm-page">
  ${tok.attrs.heading ? `<h2 class="fm-heading">${escapeHtml(tok.attrs.heading)}</h2>` : ""}
  ${mdBlocks(tok.content)}
</section>`,

    chapter: (tok) => {
      const a = tok.attrs;
      const kicker = a.number ? `Chapter ${a.number}` : a.kicker || "Chapter";
      return `<section class="chapter-opener">
  <hr class="opener-rule">
  <p class="opener-kicker">${escapeHtml(kicker)}</p>
  <h1 class="opener-title">${inline(a.title || "")}</h1>
  ${a.intro ? `<p class="opener-intro">${inline(a.intro)}</p>` : ""}
  ${a.quote ? `<p class="opener-reflection">\u201C${inline(a.quote)}\u201D</p>` : ""}
</section>`;
    },

    tool: (tok) => {
      const html = renderChildren(tok, "\n  ");
      // `**Purpose:**`-style paragraphs become labeled tool sections
      const labeled = html.replace(
        /<p><strong>(Purpose|Why This Matters|How To Use|Reflection Questions|Practice|Journal Space):?<\/strong>/g,
        '<p class="tool-para"><span class="tool-label">$1</span> ',
      );
      return `<section class="tool">
  <header class="tool-head">
    <p class="tool-kicker">Tool #${escapeHtml(tok.attrs.number || "")}</p>
    <h2 class="tool-title">${inline(tok.attrs.title || "")}</h2>
  </header>
  ${labeled}
</section>`;
    },

    box: (tok) => {
      const typeName = tok.attrs._bare?.[0] || tok.attrs._type || "insight";
      const meta = BOX_META[typeName] || BOX_META.insight;
      const label = tok.attrs.title || meta.label;
      return `<aside class="box ${meta.cls}">
  <p class="box-label">${escapeHtml(label)}</p>
  ${mdBlocks(tok.content)}
</aside>`;
    },

    worksheet: (tok) => {
      const a = tok.attrs;
      return `<section class="worksheet">
  <header class="worksheet-head">
    <p class="worksheet-kicker">Worksheet</p>
    <h3 class="worksheet-title">${inline(a.title || "")}</h3>
    ${a.purpose ? `<p class="ws-purpose"><strong>Purpose:</strong> ${inline(a.purpose)}</p>` : ""}
  </header>
  ${renderChildren(tok, "\n  ")}
</section>`;
    },

    reflection: (tok) => {
      const a = tok.attrs;
      return `<section class="reflection-exercise">
  <p class="refl-title">${inline(a.title || "Reflection Exercise")}</p>
  ${a.before ? `<p class="refl-before"><em>Before you begin:</em> ${inline(a.before)}</p>` : ""}
  ${renderChildren(tok, "\n  ")}
</section>`;
    },

    summary: (tok) => `<section class="chapter-summary">
  <p class="summary-title">Chapter Summary</p>
  ${mdBlocks(tok.content)}
</section>`,

    quote: (tok) => {
      const text = (tok.content || "").trim();
      return `<blockquote class="pull-quote">
  <p>${inline(text.replace(/^["\u201C]|["\u201D]$/g, ""))}</p>
  ${tok.attrs.by ? `<footer class="quote-attribution">\u2014 ${escapeHtml(tok.attrs.by)}</footer>` : ""}
</blockquote>`;
    },

    diagram: (tok) => {
      const nodes = tok.content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const html = nodes
        .map((n) => {
          if (/^(↓|->|v|\|)$/.test(n)) return `<span class="diagram-arrow">↓</span>`;
          const accent = tok.attrs.highlight && n.toLowerCase().includes(tok.attrs.highlight.toLowerCase());
          return `<div class="diagram-node${accent ? " diagram-accent" : ""}">${inline(n)}</div>`;
        })
        .join("\n");
      return `<figure class="diagram">
  ${html}
  ${tok.attrs.caption ? `<figcaption class="diagram-caption">${inline(tok.attrs.caption)}</figcaption>` : ""}
</figure>`;
    },

    figure: (tok) => `<figure class="figure">
  <img src="${escapeHtml(tok.attrs.src || "")}" alt="${escapeHtml(tok.attrs.caption || "")}">
  ${tok.attrs.caption ? `<figcaption class="figure-caption">${inline(tok.attrs.caption)}</figcaption>` : ""}
</figure>`,

    table: (tok) => {
      const rows = tok.content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("<!--"));
      const headers = (tok.attrs.columns || "").split("|").map((h) => h.trim()).filter(Boolean);
      const bodyRows = rows.map((r) => r.split("|").map((c) => c.trim()));
      return `<div class="table-wrap"><table class="therapy-table">
  ${tok.attrs.caption ? `<caption>${inline(tok.attrs.caption)}</caption>` : ""}
  ${headers.length ? `<thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>` : ""}
  <tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>
</table></div>`;
    },

    resources: (tok) => `<section class="fm-page resources-page">
  ${tok.attrs.heading ? `<h2 class="fm-heading">${escapeHtml(tok.attrs.heading)}</h2>` : ""}
  ${mdBlocks(tok.content).replace(/class="therapy-list"/g, 'class="resource-list"')}
</section>`,
  };
}

const RENDERERS = renderers();

/** Render a token's children (strings → markdown chunks, tokens → dispatch). */
function renderChildren(tok, joiner = "\n") {
  return tok.children
    .map((c) => (typeof c === "string" ? mdBlocks(c) : renderToken(c)))
    .filter(Boolean)
    .join(joiner);
}

function renderToken(tok) {
  if (typeof tok === "string") return mdBlocks(tok);
  tok.content ??= tok.children.filter((c) => typeof c === "string").join("\n");
  const renderer = RENDERERS[tok.type];
  if (!renderer) return mdBlocks(tok.content);
  return renderer(tok);
}

function renderTree(root) {
  return root.children.map((c) => renderToken(c)).join("\n");
}

/* ---------------- Shell ---------------- */

function shell(title, body, { preview = false } = {}) {
  const cssFiles = ["css/main.css", "css/workbook.css", ...(preview ? [] : ["css/print.css"])];
  const css = cssFiles
    .map((f) => readFileSync(join(ROOT, f), "utf8"))
    .join("\n\n");
  const fontLink = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;
  const previewPad = preview
    ? `@media screen { body { padding: 24px 0; } }`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${fontLink}
<style>
${previewPad}
${css}
</style>
</head>
<body>
<main class="book">
${body}
</main>
</body>
</html>`;
}

/* ---------------- Main ---------------- */

function main() {
  const manuscriptPath = join(ROOT, "manuscript", "book.md");
  if (!existsSync(manuscriptPath)) {
    console.error(`No manuscript found at ${manuscriptPath}`);
    process.exit(1);
  }
  const src = readFileSync(manuscriptPath, "utf8");
  const { frontmatter, root } = parseDirectives(src);
  const title = frontmatter.title || "Untitled Book";
  const body = renderTree(root);

  mkdirSync(join(ROOT, "html"), { recursive: true });
  writeFileSync(join(ROOT, "html", "book.html"), shell(title, body, { preview: false }));
  writeFileSync(join(ROOT, "html", "preview.html"), shell(title, body, { preview: true }));
  console.log(`✔ html/book.html + html/preview.html built (${body.length} bytes of body)`);
}

main();
