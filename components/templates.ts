export type BookTemplate = {
  id: string;
  label: string;
  description: string;
  style: string;
  content: string;
  /* Heading depth that starts a new chapter (default 2 = `##`). Templates
     whose sources are structured as `# chapter`, `## 1.1`, `### 1.1.1`
     set this to 1 so the converter numbers chapters/sections accordingly. */
  chapterDepth?: number;
};

const BASE_CSS = `
.markdown-body {
  --md-accent: #4f46e5;
  --md-accent-contrast: #ffffff;
  --md-paper: #ffffff;
  --md-ink: #18181b;
  --md-muted: #52525b;
  --md-soft: rgba(79, 70, 229, 0.08);
  --md-border: rgba(24, 24, 27, 0.12);
  --md-code-bg: rgba(24, 24, 27, 0.055);
  --md-code-ink: #18181b;
  --md-font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --md-font-serif: Georgia, "Times New Roman", "Libre Baskerville", Cambria, serif;
  --md-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --hl-keyword: #cf222e;
  --hl-string: #0a3069;
  --hl-number: #0550ae;
  --hl-comment: #6e7781;
  --hl-function: #8250df;
  --hl-attr: #116329;
  --hl-meta: #8250df;
  --hl-variable: #953800;
  max-width: 72rem;
  margin: 0 auto;
  padding: 3rem 2.25rem 6rem;
  background: var(--md-paper);
  color: var(--md-ink);
  font-family: var(--md-font-sans);
  font-size: 1.06rem;
  line-height: 1.78;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  word-wrap: break-word;
}
.markdown-body > :first-child { margin-top: 0 !important; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  color: var(--md-ink);
  font-weight: 750;
  line-height: 1.28;
  margin: 1.9em 0 0.7em;
  letter-spacing: -0.01em;
}
.markdown-body > h1:first-child {
  font-size: 2.7rem;
  line-height: 1.15;
  letter-spacing: -0.025em;
  text-align: center;
  padding: 3.2rem 0 0.5rem;
  margin-bottom: 1.8rem;
  border-bottom: none;
}
.markdown-body > h1:first-child + p {
  text-align: center;
  color: var(--md-muted);
}
.markdown-body h2 {
  font-size: 1.55rem;
  padding-bottom: 0;
  border-bottom: none;
}
.markdown-body h3 { font-size: 1.2rem; }
.markdown-body h4 { font-size: 1.05rem; }
.markdown-body p { margin: 0.9em 0; }
.markdown-body a {
  color: var(--md-accent);
  text-decoration: none;
  border-bottom: 1px solid var(--md-accent);
  transition: opacity 0.15s ease;
}
.markdown-body a:hover { opacity: 0.75; }
.markdown-body strong { font-weight: 700; }
.markdown-body ul, .markdown-body ol {
  margin: 0.9em 0;
  padding-left: 1.7em;
}
.markdown-body ul { list-style: disc; }
.markdown-body ol { list-style: decimal; }
.markdown-body li { margin: 0.32em 0; }
.markdown-body li::marker { color: var(--md-accent); font-weight: 700; }
.markdown-body blockquote {
  margin: 1.4em 0;
  padding: 1em 1.4em;
  border-left: 4px solid var(--md-accent);
  background: var(--md-soft);
  border-radius: 0 0.6rem 0.6rem 0;
  color: var(--md-ink);
  font-style: italic;
}
.markdown-body blockquote > :first-child { margin-top: 0; }
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body blockquote strong { font-style: normal; }
.markdown-body code {
  background: var(--md-code-bg);
  color: var(--md-accent);
  border-radius: 0.35rem;
  padding: 0.14em 0.42em;
  font-family: var(--md-font-mono);
  font-size: 0.86em;
}
.markdown-body pre {
  background: var(--md-code-bg);
  border: 1px solid var(--md-border);
  border-radius: 0.75rem;
  padding: 1.15rem 1.35rem;
  margin: 1.3em 0;
  overflow-x: auto;
  line-height: 1.65;
}
.markdown-body pre code {
  background: none;
  color: var(--md-ink);
  padding: 0;
  font-size: 0.88rem;
}
.markdown-body pre code .hljs-keyword,
.markdown-body pre code .hljs-selector-tag,
.markdown-body pre code .hljs-literal,
.markdown-body pre code .hljs-built_in,
.markdown-body pre code .hljs-type { color: var(--hl-keyword); }
.markdown-body pre code .hljs-string,
.markdown-body pre code .hljs-regexp,
.markdown-body pre code .hljs-symbol,
.markdown-body pre code .hljs-attribute { color: var(--hl-string); }
.markdown-body pre code .hljs-number,
.markdown-body pre code .hljs-title,
.markdown-body pre code .hljs-selector-id { color: var(--hl-number); }
.markdown-body pre code .hljs-title.function_,
.markdown-body pre code .hljs-function .hljs-title { color: var(--hl-function); }
.markdown-body pre code .hljs-comment,
.markdown-body pre code .hljs-quote { color: var(--hl-comment); font-style: italic; }
.markdown-body pre code .hljs-attr,
.markdown-body pre code .hljs-selector-attr,
.markdown-body pre code .hljs-selector-pseudo { color: var(--hl-attr); }
.markdown-body pre code .hljs-meta { color: var(--hl-meta); }
.markdown-body pre code .hljs-variable,
.markdown-body pre code .hljs-template-variable { color: var(--hl-variable); }
.markdown-body table {
  display: block;
  max-width: 100%;
  width: max-content;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 1.4em 0;
  font-size: 0.95rem;
  border: 1px solid var(--md-border);
  border-radius: 0.6rem;
}
.markdown-body th, .markdown-body td {
  border: 1px solid var(--md-border);
  padding: 0.55em 1em;
  text-align: left;
  vertical-align: top;
}
.markdown-body thead th {
  background: var(--md-accent);
  color: var(--md-accent-contrast);
  font-weight: 650;
  letter-spacing: 0.01em;
}
.markdown-body tbody tr:nth-child(even) { background: var(--md-soft); }
.markdown-body img { max-width: 100%; border-radius: 0.6rem; }
.markdown-body figure { margin: 1.4em 0; text-align: center; }
.markdown-body figure > img { border-radius: 0.6rem; }
.markdown-body figcaption { margin-top: 0.55em; font-size: 0.85em; color: var(--md-muted); }
.markdown-body .code-frame { margin: 1.3em 0; }
.markdown-body .code-lang {
  display: block;
  margin-bottom: 0.4em;
  font-family: var(--md-font-mono);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--md-muted);
}
.markdown-body .callout {
  margin: 1.4em 0;
  padding: 0.9em 1.2em;
  border: 1px solid var(--md-border);
  border-left: 4px solid var(--md-accent);
  border-radius: 0.6rem;
  background: var(--md-soft);
}
.markdown-body .callout-title {
  margin: 0 0 0.4em;
  font-weight: 700;
  color: var(--md-accent);
  display: flex;
  align-items: center;
  gap: 0.5em;
}
.markdown-body .callout-icon { display: inline-flex; flex: none; }
.markdown-body .callout-icon svg {
  width: 1.05em;
  height: 1.05em;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.markdown-body .code-lang::before {
  content: "";
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  margin-right: 0.45em;
  vertical-align: -0.1em;
  background: url("data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23788494'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpolyline%20points='4%2017%2010%2011%204%205'/%3E%3Cline%20x1='12'%20y1='19'%20x2='20'%20y2='19'/%3E%3C/svg%3E") center / contain no-repeat;
}
.markdown-body .toc-title::before {
  content: "";
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 0.5em;
  vertical-align: -0.15em;
  background: url("data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23788494'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M8%206h13'/%3E%3Cpath%20d='M8%2012h13'/%3E%3Cpath%20d='M8%2018h13'/%3E%3Cpath%20d='M3%206h.01'/%3E%3Cpath%20d='M3%2012h.01'/%3E%3Cpath%20d='M3%2018h.01'/%3E%3C/svg%3E") center / contain no-repeat;
}
.markdown-body .callout-content > :first-child { margin-top: 0; }
.markdown-body .callout-content > :last-child { margin-bottom: 0; }
.markdown-body .toc {
  margin: 1.5em 0;
  padding: 1.2em 1.5em;
  border: 1px solid var(--md-border);
  border-radius: 0.75rem;
  background: var(--md-soft);
}
.markdown-body .toc .toc-title { margin: 0 0 0.7em; font-weight: 700; font-size: 1.1rem; }
.markdown-body .toc ol { list-style: none; margin: 0; padding: 0; }
.markdown-body .toc li { margin: 0.25em 0; }
.markdown-body .toc li.toc-l3 { padding-left: 1.5em; }
.markdown-body .toc li.toc-l4 { padding-left: 3em; }
.markdown-body .toc a { text-decoration: none; border-bottom: none; display: flex; align-items: baseline; }
.markdown-body .toc a .toc-fill { flex: 1; }
.markdown-body .toc .toc-num { color: var(--md-accent); min-width: 2.4em; font-variant-numeric: tabular-nums; }
.markdown-body .toc .toc-pg { float: right; }
.markdown-body .toc li.toc-l1 {
  margin-top: 0.7em;
  font-size: 0.85em;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--md-ink);
}
.markdown-body .toc li.toc-l2 { font-weight: 600; }
.markdown-body .part-page {
  text-align: center;
  margin: 3.6em 0 1.6em;
  padding: 3em 0;
}
.markdown-body .chapter-page {
  text-align: center;
  margin: 3em 0 2em;
  padding: 2.4em 0;
}
.markdown-body .part-kicker,
.markdown-body .chapter-label {
  display: inline-block;
  margin: 0 0 1.2em;
  font-family: var(--md-font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--md-accent);
}
.markdown-body .chapter-label {
  padding: 0.5em 1.5em;
  border: 1.5px solid var(--md-border);
  border-radius: 999px;
}
.markdown-body .part-title,
.markdown-body .chapter-title {
  margin: 0 !important;
  padding: 0 !important;
  border-bottom: none !important;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.markdown-body .part-title { font-size: 2.35rem; }
.markdown-body .chapter-title { font-size: 1.95rem; }
.markdown-body .part-ornament,
.markdown-body .chapter-ornament {
  width: 4.6rem;
  height: 1px;
  margin: 1.6em auto 0;
  border-top: 1px solid var(--md-accent);
  position: relative;
}
.markdown-body .part-ornament::after,
.markdown-body .chapter-ornament::after {
  content: "";
  position: absolute;
  left: 50%;
  top: -3.5px;
  width: 6px;
  height: 6px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--md-paper);
  border: 1px solid var(--md-accent);
}
.markdown-body hr {
  margin: 2.2em 0;
  border: 0;
  border-top: 1px solid var(--md-border);
  height: auto;
  opacity: 1;
}
/* Writing line: a run of ___ in Markdown becomes one full-width ruled line
   to write on (journal prompts, worksheets). Titles never get lines. */
.markdown-body p.md-write-line {
  margin: 0.4em 0 1.4em;
  padding-bottom: 0.3em;
  border-bottom: 1.5px solid var(--md-border);
  break-inside: avoid;
  page-break-inside: avoid;
}
.markdown-body ::selection { background: var(--md-accent); color: var(--md-accent-contrast); }
@media (max-width: 640px) {
  .markdown-body { padding: 1.5rem 1rem 4rem; font-size: 1rem; }
  .markdown-body > h1:first-child { font-size: 2rem; padding: 2rem 0 1rem; }
  .markdown-body h2 { font-size: 1.3rem; }
}
@media print {
  .markdown-body { max-width: none; padding: 0; }
  /* Compiled book: every chapter starts on a fresh printed page. */
  .markdown-body .book-chapter { break-before: page; }
  .markdown-body .book-chapter:first-child { break-before: auto; }
  .markdown-body .part-page,
  .markdown-body .chapter-page { break-before: page; }
  .markdown-body .part-page h1,
  .markdown-body .part-page h2,
  .markdown-body .part-page h3,
  .markdown-body .chapter-page h2,
  .markdown-body .chapter-page h3 { break-before: auto; }
  .markdown-body .part-page,
  .markdown-body .chapter-page,
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { break-after: avoid; }
  .markdown-body pre, .markdown-body .code-frame, .markdown-body figure,
  .markdown-body blockquote, .markdown-body .callout, .markdown-body table, .markdown-body .toc { break-inside: avoid; }
}
`;

const THERAPEUTIC_FONTS = `@import url("https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700;800&display=swap");

`;

/* Therapeutic components (::: directives) — tool, worksheet, reflection,
   diagram, summary, feature quote. Uses the template's CSS variables so each
   theme restyles them automatically. */
const THERAPEUTIC_COMPONENTS_CSS = `
.markdown-body .tool {
  margin: 2.4em 0 2.6em;
  padding: 1.6em 1.7em 1.4em;
  border: 1px solid var(--md-border);
  border-radius: 0.8rem;
  background: var(--md-paper);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  break-inside: auto;
}
.markdown-body .tool-number {
  font-family: var(--md-font-sans);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--md-accent);
  margin: 0 0 0.3em;
}
.markdown-body .tool-name {
  font-size: 1.3rem;
  margin: 0 0 0.9em;
  padding-bottom: 0.55em;
  border-bottom: 1px solid var(--md-border);
}
.markdown-body .tool-label {
  font-family: var(--md-font-sans);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--md-accent);
  margin: 1.15em 0 0.3em;
}
.markdown-body .tool-section:first-child .tool-label { margin-top: 0; }
.markdown-body .tool-list {
  list-style: none;
  margin: 0.2em 0;
  padding: 0;
}
.markdown-body .tool-list li {
  position: relative;
  padding-left: 1.25em;
  margin: 0.28em 0;
}
.markdown-body .tool-list li::before {
  content: "";
  position: absolute;
  left: 0.15em;
  top: 0.62em;
  width: 0.38em;
  height: 0.38em;
  border-radius: 50%;
  background: var(--md-accent);
}
.markdown-body .worksheet {
  margin: 2.2em 0;
  padding: 1.5em 1.7em 1.6em;
  border: 1.5px solid var(--md-border);
  border-radius: 0.8rem;
  background: var(--md-soft);
  break-inside: avoid;
}
.markdown-body .worksheet-label {
  display: inline-block;
  font-family: var(--md-font-sans);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--md-accent-contrast);
  background: var(--md-accent);
  border-radius: 999px;
  padding: 0.28em 0.85em;
  margin: 0 0 0.55em;
}
.markdown-body .worksheet-title {
  font-size: 1.18rem;
  margin: 0 0 0.35em;
}
.markdown-body .worksheet-purpose {
  color: var(--md-muted);
  font-size: 0.95em;
  margin: 0 0 1.1em;
}
.markdown-body .worksheet-body p {
  font-family: var(--md-font-sans);
  font-size: 0.86rem;
  font-weight: 600;
  margin: 0.9em 0 0.1em;
  text-align: left;
  hyphens: none;
}
.markdown-body .worksheet-body p.md-write-line { margin: 0.15em 0 1.15em; }
.markdown-body .reflection {
  margin: 2.2em 0;
  padding: 1.35em 1.6em 1.2em;
  border-top: 3px solid var(--md-accent);
  border-bottom: 1px solid var(--md-border);
  background: var(--md-soft);
  break-inside: avoid;
}
.markdown-body .reflection-title {
  font-size: 1.12rem;
  margin: 0 0 0.3em;
}
.markdown-body .reflection-before {
  color: var(--md-muted);
  font-style: italic;
  margin: 0 0 1em;
}
.markdown-body .reflection-question {
  font-weight: 600;
  margin: 0 0 0.1em;
  text-align: left;
}
.markdown-body .reflection-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.55em;
  height: 1.55em;
  margin-right: 0.55em;
  border-radius: 50%;
  background: var(--md-accent);
  color: var(--md-accent-contrast);
  font-family: var(--md-font-sans);
  font-size: 0.72em;
  font-weight: 800;
  text-align: center;
}
.markdown-body .reflection-q { margin: 1.1em 0; }
.markdown-body .reflection-q p.md-write-line { margin: 0.25em 0 0; }
.markdown-body .diagram {
  margin: 2.3em auto;
  max-width: 26rem;
  padding: 1.4em 1.5em 1.1em;
  border: 1px dashed var(--md-border);
  border-radius: 0.8rem;
  break-inside: avoid;
}
.markdown-body .diagram-flow { display: flex; flex-direction: column; align-items: stretch; }
.markdown-body .diagram-node {
  font-family: var(--md-font-sans);
  font-weight: 600;
  font-size: 0.92rem;
  text-align: center;
  padding: 0.62em 1em;
  border: 1px solid var(--md-border);
  border-radius: 0.55rem;
  background: var(--md-paper);
}
.markdown-body .diagram-node-hot {
  border-color: var(--md-accent);
  background: var(--md-accent);
  color: var(--md-accent-contrast);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.markdown-body .diagram-arrow {
  text-align: center;
  color: var(--md-muted);
  font-size: 1.05rem;
  line-height: 1.15;
  padding: 0.12em 0;
}
.markdown-body .diagram-caption {
  font-family: var(--md-font-sans);
  text-align: center;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--md-muted);
  margin-top: 1em;
}
.markdown-body .summary {
  margin: 2.4em 0;
  padding: 1.5em 1.7em 1.3em;
  border: 1px solid var(--md-border);
  border-radius: 0.8rem;
  background: var(--md-soft);
  break-inside: avoid;
}
.markdown-body .summary-kicker {
  font-family: var(--md-font-sans);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--md-accent);
  margin: 0 0 0.8em;
  padding-bottom: 0.5em;
  border-bottom: 1px solid var(--md-border);
}
.markdown-body .summary-label {
  font-family: var(--md-font-sans);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--md-ink);
  margin: 1em 0 0.25em;
}
.markdown-body .summary-group:first-of-type .summary-label { margin-top: 0; }
.markdown-body .summary-list {
  list-style: none;
  margin: 0.15em 0;
  padding: 0;
}
.markdown-body .summary-list li {
  position: relative;
  padding-left: 1.25em;
  margin: 0.25em 0;
}
.markdown-body .summary-list li::before {
  content: "";
  position: absolute;
  left: 0.15em;
  top: 0.6em;
  width: 0.36em;
  height: 0.36em;
  border-radius: 50%;
  background: var(--md-accent);
}
.markdown-body .feature-quote {
  margin: 2.6em auto;
  max-width: 34rem;
  padding: 0;
  border: none;
  border-top: 1px solid var(--md-border);
  border-bottom: 1px solid var(--md-border);
  border-radius: 0;
  background: none;
  text-align: center;
  font-style: italic;
  font-size: 1.18em;
  line-height: 1.6;
  color: var(--md-ink);
  break-inside: avoid;
}
.markdown-body .feature-quote p {
  margin: 1.2em 0;
  text-align: center;
  hyphens: none;
}
.markdown-body .quote-by {
  font-family: var(--md-font-sans);
  font-style: normal;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--md-muted);
}
.markdown-body .directive-list {
  list-style: disc;
  margin: 0.3em 0;
  padding-left: 1.5em;
}
@media print {
  .markdown-body .tool, .markdown-body .worksheet, .markdown-body .summary,
  .markdown-body .reflection, .markdown-body .diagram,
  .markdown-body .feature-quote { break-inside: avoid; }
  .markdown-body .tool { box-shadow: none; }
}
`;

/* Trauma & recovery: calm slate palette, Lora body, Inter structure.
   Callout mapping: note=Insight, tip=Science, best-practice=Therapist Note,
   important/warning=Important, example=Reflection, error=Caution. */
const THEME_TRAUMA = `
.markdown-body {
  --md-accent: #3e5c76;
  --md-accent-contrast: #ffffff;
  --md-paper: #fbfaf7;
  --md-ink: #2a2721;
  --md-muted: #6e675c;
  --md-soft: rgba(62, 92, 118, 0.075);
  --md-border: rgba(42, 39, 33, 0.14);
  --md-code-bg: rgba(42, 39, 33, 0.05);
  --md-font-serif: "Lora", Georgia, "Times New Roman", serif;
  --md-font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --tm-teal: #2f6f6a;
  --tm-green: #4a7c59;
  --tm-amber: #96660f;
  --tm-beige: #8a7355;
  --tm-clay: #8c4a3f;
  font-family: var(--md-font-serif);
  font-size: 1.075rem;
  line-height: 1.82;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  font-family: var(--md-font-sans);
  font-weight: 700;
  letter-spacing: -0.012em;
}
.markdown-body > h1:first-child {
  font-family: var(--md-font-serif);
  font-weight: 600;
  font-size: 2.65rem;
  line-height: 1.16;
  padding: 3.4rem 0 0.6rem;
}
.markdown-body > h1:first-child + p { color: var(--md-muted); font-size: 1rem; }
.markdown-body h2 {
  font-size: 1.45rem;
  margin: 2.6em 0 1em;
  padding-bottom: 0;
  border-bottom: none;
}
.markdown-body h3 { font-size: 1.15rem; }
.markdown-body p { text-align: justify; hyphens: auto; }
.markdown-body blockquote p { text-align: left; hyphens: none; }
.markdown-body li { margin: 0.4em 0; }
.markdown-body .part-kicker, .markdown-body .chapter-label {
  font-family: var(--md-font-sans);
  letter-spacing: 0.32em;
}
.markdown-body .part-title, .markdown-body .chapter-title {
  font-family: var(--md-font-serif);
  font-weight: 600;
}
.markdown-body blockquote {
  margin: 1.9em 0;
  padding: 1.3em 1.5em;
  border: 1px solid rgba(62, 92, 118, 0.18);
  border-left: none;
  border-top: 3px solid var(--md-accent);
  border-radius: 0.75rem;
  background: #f2f5f7;
  font-style: italic;
  font-size: 1.02em;
  color: #35434f;
}
.markdown-body .callout {
  border: 1px solid;
  border-left-width: 3px;
  border-radius: 0.75rem;
  padding: 1.05em 1.3em;
  margin: 1.6em 0;
}
.markdown-body .callout-title {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin: 0 0 0.5em;
}
.markdown-body .callout-content { color: var(--md-ink); }
.markdown-body .callout-note {
  color: var(--md-accent);
  background: rgba(62, 92, 118, 0.07);
  border-color: rgba(62, 92, 118, 0.22);
}
.markdown-body .callout-tip {
  color: var(--tm-teal);
  background: rgba(47, 111, 106, 0.07);
  border-color: rgba(47, 111, 106, 0.24);
}
.markdown-body .callout-best-practice {
  color: var(--tm-green);
  background: rgba(74, 124, 89, 0.08);
  border-color: rgba(74, 124, 89, 0.24);
}
.markdown-body .callout-important,
.markdown-body .callout-warning {
  color: var(--tm-amber);
  background: rgba(150, 102, 15, 0.07);
  border-color: rgba(150, 102, 15, 0.26);
}
.markdown-body .callout-example {
  color: var(--tm-beige);
  background: rgba(138, 115, 85, 0.08);
  border-color: rgba(138, 115, 85, 0.26);
}
.markdown-body .callout-error {
  color: var(--tm-clay);
  background: rgba(140, 74, 63, 0.07);
  border-color: rgba(140, 74, 63, 0.26);
}
.markdown-body .callout-note .callout-title { color: var(--md-accent); }
.markdown-body .callout-tip .callout-title { color: var(--tm-teal); }
.markdown-body .callout-best-practice .callout-title { color: var(--tm-green); }
.markdown-body .callout-important .callout-title,
.markdown-body .callout-warning .callout-title { color: var(--tm-amber); }
.markdown-body .callout-example .callout-title { color: var(--tm-beige); }
.markdown-body .callout-error .callout-title { color: var(--tm-clay); }
.markdown-body .callout-note .callout-content { color: #2f3f4d; }
.markdown-body .callout-tip .callout-content { color: #284b48; }
.markdown-body .callout-best-practice .callout-content { color: #33493a; }
.markdown-body .callout-important .callout-content,
.markdown-body .callout-warning .callout-content { color: #574314; }
.markdown-body .callout-example .callout-content { color: #54483a; }
.markdown-body .callout-error .callout-content { color: #5c3a33; }
.markdown-body table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin: 1.7em 0;
  font-size: 0.92rem;
  border: 1px solid var(--md-border);
  border-radius: 0.6rem;
}
.markdown-body th, .markdown-body td {
  border: none;
  border-bottom: 1px solid var(--md-border);
  padding: 0.62em 0.95em;
  text-align: left;
  vertical-align: top;
}
.markdown-body thead th {
  background: rgba(62, 92, 118, 0.06);
  color: var(--md-accent);
  font-family: var(--md-font-sans);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  border-bottom: 1.5px solid var(--md-accent);
}
.markdown-body tbody tr:last-child td { border-bottom: none; }
.markdown-body tbody tr:nth-child(even) { background: rgba(42, 39, 33, 0.022); }
.markdown-body hr {
  margin: 2.6em auto;
  width: 6.5rem;
  border-top: 1px solid var(--md-border);
}
/* Writing line: a run of ___ in Markdown becomes one full-width ruled line
   to write on (journal prompts, worksheets). Titles never get lines. */
.markdown-body p.md-write-line {
  margin: 0.4em 0 1.4em;
  padding-bottom: 0.3em;
  border-bottom: 1.5px solid var(--md-border);
  break-inside: avoid;
  page-break-inside: avoid;
}
@media print {
  .markdown-body {
    max-width: none;
    padding: 0;
    background: #ffffff;
    font-size: 10.5pt;
    line-height: 1.72;
  }
  @page { size: 6in 9in; margin: 0.6in 0.5in 0.6in 0.75in; }
  .markdown-body .part-page, .markdown-body .chapter-page,
  .markdown-body h1:not(:first-child), .markdown-body h2 { break-before: page; }
  .markdown-body blockquote, .markdown-body .callout, .markdown-body pre,
  .markdown-body .code-frame, .markdown-body table, .markdown-body figure { break-inside: avoid; }
  .markdown-body p, .markdown-body li { orphans: 3; widows: 3; }
}
`;

/* Psychology & healing workbook: cream paper, sage accent, gentle serif.
   Callout mapping: note/best-practice=Science & Therapist, tip=Practice,
   important/warning=Important, example=Reflection, error=Caution. */
const THEME_PSYCHOLOGY = `
.markdown-body {
  --md-accent: #2f6f6a;
  --md-accent-contrast: #ffffff;
  --md-paper: #fbf8f1;
  --md-ink: #2b3130;
  --md-muted: #6b7566;
  --md-soft: rgba(47, 111, 106, 0.08);
  --md-border: rgba(43, 49, 48, 0.14);
  --md-code-bg: rgba(43, 49, 48, 0.05);
  --md-font-serif: "Lora", Georgia, "Times New Roman", serif;
  --md-font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --pw-sage: #4a7c59;
  --pw-amber: #96660f;
  --pw-beige: #8a7355;
  --pw-clay: #8c4a3f;
  font-family: var(--md-font-serif);
  font-size: 1.06rem;
  line-height: 1.8;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  font-family: var(--md-font-sans);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.markdown-body > h1:first-child {
  font-family: var(--md-font-serif);
  font-weight: 600;
  font-size: 2.55rem;
  line-height: 1.18;
  padding: 3.2rem 0 0.6rem;
}
.markdown-body > h1:first-child + p { color: var(--md-muted); font-size: 1rem; }
.markdown-body h2 {
  font-size: 1.42rem;
  margin: 2.5em 0 1em;
  padding-bottom: 0;
  border-bottom: none;
}
.markdown-body h2::before {
  content: "";
  display: block;
  width: 2.4rem;
  margin-bottom: 0.55em;
  border-top: 2.5px solid var(--md-accent);
}
.markdown-body .part-title::before,
.markdown-body .chapter-title::before { content: none; }
.markdown-body h3 { font-size: 1.14rem; }
.markdown-body p { text-align: justify; hyphens: auto; }
.markdown-body blockquote p { text-align: left; hyphens: none; }
.markdown-body li { margin: 0.42em 0; }
.markdown-body .part-kicker, .markdown-body .chapter-label {
  font-family: var(--md-font-sans);
  letter-spacing: 0.32em;
}
.markdown-body .part-title, .markdown-body .chapter-title {
  font-family: var(--md-font-serif);
  font-weight: 600;
}
.markdown-body blockquote {
  margin: 1.8em 0;
  padding: 1.25em 1.45em;
  border: 1px solid rgba(47, 111, 106, 0.16);
  border-left: none;
  border-top: 3px solid var(--md-accent);
  border-radius: 0.9rem;
  background: #f2eee1;
  font-style: italic;
  font-size: 1.02em;
  color: #3c4a44;
}
.markdown-body .callout {
  border: 1px solid;
  border-left-width: 3px;
  border-radius: 0.9rem;
  padding: 1.05em 1.3em;
  margin: 1.6em 0;
}
.markdown-body .callout-title {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin: 0 0 0.5em;
}
.markdown-body .callout-content { color: var(--md-ink); }
.markdown-body .callout-note,
.markdown-body .callout-best-practice {
  color: var(--md-accent);
  background: rgba(47, 111, 106, 0.08);
  border-color: rgba(47, 111, 106, 0.24);
}
.markdown-body .callout-tip {
  color: var(--pw-sage);
  background: rgba(74, 124, 89, 0.08);
  border-color: rgba(74, 124, 89, 0.24);
}
.markdown-body .callout-important,
.markdown-body .callout-warning {
  color: var(--pw-amber);
  background: rgba(150, 102, 15, 0.07);
  border-color: rgba(150, 102, 15, 0.26);
}
.markdown-body .callout-example {
  color: var(--pw-beige);
  background: rgba(138, 115, 85, 0.08);
  border-color: rgba(138, 115, 85, 0.26);
}
.markdown-body .callout-error {
  color: var(--pw-clay);
  background: rgba(140, 74, 63, 0.07);
  border-color: rgba(140, 74, 63, 0.26);
}
.markdown-body .callout-note .callout-title,
.markdown-body .callout-best-practice .callout-title { color: var(--md-accent); }
.markdown-body .callout-tip .callout-title { color: var(--pw-sage); }
.markdown-body .callout-important .callout-title,
.markdown-body .callout-warning .callout-title { color: var(--pw-amber); }
.markdown-body .callout-example .callout-title { color: var(--pw-beige); }
.markdown-body .callout-error .callout-title { color: var(--pw-clay); }
.markdown-body .callout-note .callout-content,
.markdown-body .callout-best-practice .callout-content { color: #284b48; }
.markdown-body .callout-tip .callout-content { color: #33493a; }
.markdown-body .callout-important .callout-content,
.markdown-body .callout-warning .callout-content { color: #574314; }
.markdown-body .callout-example .callout-content { color: #54483a; }
.markdown-body .callout-error .callout-content { color: #5c3a33; }
.markdown-body table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin: 1.7em 0;
  font-size: 0.92rem;
  border: 1px solid var(--md-border);
  border-radius: 0.6rem;
}
.markdown-body th, .markdown-body td {
  border: none;
  border-bottom: 1px solid var(--md-border);
  padding: 0.62em 0.95em;
  text-align: left;
  vertical-align: top;
}
.markdown-body thead th {
  background: rgba(47, 111, 106, 0.07);
  color: var(--md-accent);
  font-family: var(--md-font-sans);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  border-bottom: 1.5px solid var(--md-accent);
}
.markdown-body tbody tr:last-child td { border-bottom: none; }
.markdown-body tbody tr:nth-child(even) { background: rgba(43, 49, 48, 0.022); }
.markdown-body hr {
  margin: 2.6em auto;
  width: 6.5rem;
  border-top: 1px solid var(--md-border);
}
/* Writing line: a run of ___ in Markdown becomes one full-width ruled line
   to write on (journal prompts, worksheets). Titles never get lines. */
.markdown-body p.md-write-line {
  margin: 0.4em 0 1.4em;
  padding-bottom: 0.3em;
  border-bottom: 1.5px solid var(--md-border);
  break-inside: avoid;
  page-break-inside: avoid;
}
@media print {
  .markdown-body {
    max-width: none;
    padding: 0;
    background: #ffffff;
    font-size: 10.5pt;
    line-height: 1.7;
  }
  @page { size: 6in 9in; margin: 0.6in 0.5in 0.6in 0.75in; }
  .markdown-body .part-page, .markdown-body .chapter-page,
  .markdown-body h1:not(:first-child), .markdown-body h2 { break-before: page; }
  .markdown-body blockquote, .markdown-body .callout, .markdown-body pre,
  .markdown-body .code-frame, .markdown-body table, .markdown-body figure { break-inside: avoid; }
  .markdown-body p, .markdown-body li { orphans: 3; widows: 3; }
}
`;

const TECHNICAL_FONTS = `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap");
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap");

`;

const THEME_TECHNICAL = `
.markdown-body {
  --md-accent: #1d4ed8;
  --md-accent-contrast: #ffffff;
  --md-paper: #ffffff;
  --md-ink: #1f2430;
  --md-muted: #4b5563;
  --md-soft: rgba(29, 78, 216, 0.08);
  --md-border: rgba(31, 36, 48, 0.16);
  --md-code-bg: #f5f7fa;
  --md-code-ink: #24292f;
  --md-font-sans: "Inter", "Source Sans Pro", "Lato", ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  --md-font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace;
  font-size: 11pt;
  line-height: 1.68;
  max-width: 68rem;
  color: var(--md-ink);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

@page {
  size: 6in 9in;
  margin: 0.5in 0.5in 0.5in 0.75in;
  @bottom-center {
    content: counter(page);
    font-family: "JetBrains Mono", monospace;
    font-size: 8pt;
    color: #9ca3af;
  }
  @top-center {
    content: string(book-title);
    font-family: "Inter", sans-serif;
    font-size: 7.5pt;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #9ca3af;
  }
}
@page :first {
  @top-center { content: none; }
  @bottom-center { content: none; }
}

.markdown-body > h1:first-child { string-set: book-title content(); }

.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  font-family: "Inter", var(--md-font-sans);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--md-ink);
}
.markdown-body h2, .markdown-body h3, .markdown-body h4 { border-bottom: none; padding-bottom: 0; }
.markdown-body p { margin: 0.7em 0; text-align: justify; hyphens: auto; }
.markdown-body a { color: var(--md-accent); text-decoration: none; border-bottom: 1px solid var(--md-accent); }
.markdown-body li { margin: 0.3em 0; }

.markdown-body h2 {
  font-size: 1.55rem;
  margin: 2.4rem 0 1rem;
}
.markdown-body h3 {
  font-size: 1.12rem;
  margin: 1.7rem 0 0.6rem;
}
.markdown-body h4 {
  font-size: 1.02rem;
  margin: 1.3rem 0 0.5rem;
  font-weight: 650;
  color: var(--md-ink);
}

.markdown-body > h1:first-child {
  font-size: 2.1rem;
  line-height: 1.18;
  letter-spacing: -0.02em;
  text-align: center;
  padding: 2.4rem 0 1rem;
  margin: 0 0 0.5rem;
  border: none;
}
.markdown-body > h1:first-child + p {
  text-align: center;
  font-size: 1.02rem;
  font-style: italic;
  color: var(--md-muted);
}
.markdown-body h1:not(:first-child) {
  font-size: 1.8rem;
  text-align: center;
  margin: 3rem auto 1.6rem;
  border: none;
}

/* Programming-book chapter opening: monospace // ornament instead of the
   diamond used by the therapeutic templates — code, not calligraphy. */
.markdown-body .chapter-label,
.markdown-body .part-kicker {
  font-family: "JetBrains Mono", var(--md-font-mono);
  letter-spacing: 0.34em;
  border: none;
  padding: 0;
}
.markdown-body .chapter-title,
.markdown-body .part-title {
  font-family: "Inter", var(--md-font-sans);
  font-weight: 800;
}
.markdown-body .chapter-ornament,
.markdown-body .part-ornament {
  display: none;
}
.markdown-body .code-frame > pre {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: #f8fafc;
  color: var(--md-code-ink);
  padding: 0.5rem 1.1rem 1.1rem;
  font-size: 0.82rem;
  line-height: 1.62;
  box-shadow: none;
}
.markdown-body .code-frame > pre code {
  background: none;
  color: var(--md-code-ink);
  padding: 0;
  font-size: inherit;
}
.markdown-body .code-frame .code-lang {
  display: block;
  margin: 0;
  padding: 0.55rem 1rem 0.4rem;
  font-family: "JetBrains Mono", var(--md-font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #465266;
  background: #eef1f6;
  border-bottom: 1px solid #e2e8f0;
}
.markdown-body .code-frame .code-lang::before {
  background: url("data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23465266'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpolyline%20points='4%2017%2010%2011%204%205'/%3E%3Cline%20x1='12'%20y1='19'%20x2='20'%20y2='19'/%3E%3C/svg%3E") center / contain no-repeat;
}

.markdown-body .callout {
  border: 1px solid #e2e6ec;
  border-left: 3px solid #1f2430;
  border-radius: 0.4rem;
  padding: 0.85rem 1.1rem;
  margin: 1.3em 0;
  background: #fafbfc;
}
.markdown-body .callout-title {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin: 0 0 0.35rem;
  color: #1f2430;
}
.markdown-body .callout-content { color: #374151; }

.markdown-body table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin: 1.4em 0;
  font-size: 0.88rem;
  border: 1px solid #d3dbe6;
  border-radius: 0.35rem;
  overflow: hidden;
}
.markdown-body th {
  background: #f0f2f5;
  color: #1f2430;
  border: 1px solid #d3dbe6;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
  text-align: left;
}
.markdown-body td {
  border: 1px solid #e1e7ef;
  padding: 0.45rem 0.75rem;
  vertical-align: top;
}
.markdown-body tbody tr:nth-child(even) { background: #fafbfc; }

.markdown-body img {
  display: block;
  margin: 1.5em auto;
  max-width: 100%;
  border-radius: 0.35rem;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.12);
}
.markdown-body figure { margin: 1.8em 0; text-align: center; counter-increment: fig; }
.markdown-body figure img { margin: 0 auto; }
.markdown-body figcaption {
  font-size: 0.82rem;
  font-style: italic;
  color: var(--md-muted);
  margin-top: 0.5rem;
}
.markdown-body figcaption::before {
  content: "Figure " counter(chapter) "." counter(fig) "\\00a0\\2014\\00a0";
  color: var(--md-accent);
}
.markdown-body .markdown-body h4 { counter-increment: none; }
/* Automatic heading numbering is disabled in the technical theme – authors
   keep control of their own section labels. */

.markdown-body hr {
  margin: 2.4em 0;
  border: 0;
  border-top: 1px solid #d3dbe6;
  height: auto;
}
/* Writing line: a run of ___ in Markdown becomes one full-width ruled line
   to write on (journal prompts, worksheets). Titles never get lines. */
.markdown-body p.md-write-line {
  margin: 0.4em 0 1.4em;
  padding-bottom: 0.3em;
  border-bottom: 1.5px solid var(--md-border);
  break-inside: avoid;
  page-break-inside: avoid;
}

.markdown-body .toc {
  margin: 0 0 2.5rem;
  padding: 1.3rem 1.6rem;
  border: 1px solid #e3e8f0;
  border-radius: 0.5rem;
  background: #fbfcfe;
}
.markdown-body .toc .toc-title {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--md-accent);
  margin: 0 0 0.9rem;
}
.markdown-body .toc .toc-title::before {
  background: url("data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%231d4ed8'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M8%206h13'/%3E%3Cpath%20d='M8%2012h13'/%3E%3Cpath%20d='M8%2018h13'/%3E%3Cpath%20d='M3%206h.01'/%3E%3Cpath%20d='M3%2012h.01'/%3E%3Cpath%20d='M3%2018h.01'/%3E%3C/svg%3E") center / contain no-repeat;
}
.markdown-body .toc ol { list-style: none; margin: 0; padding: 0; }
.markdown-body .toc li { margin: 0.35em 0; }
.markdown-body .toc li.toc-l3 { padding-left: 1.8em; }
.markdown-body .toc li.toc-l4 { padding-left: 3.6em; }
.markdown-body .toc a { color: var(--md-ink); border-bottom: none; }
.markdown-body .toc a .toc-text { flex: 1; border-bottom: 1px dotted #c3cad6; margin: 0 0.5em; }
.markdown-body .toc a .toc-num { color: var(--md-accent); min-width: 2.6em; }
.markdown-body .toc a .toc-pg { float: right; }
.markdown-body .toc a::after {
  content: target-counter(attr(href), page);
  font-variant-numeric: tabular-nums;
  color: var(--md-muted);
}

.markdown-body blockquote {
  border-left-color: var(--md-accent);
  background: var(--md-soft);
  font-style: normal;
  font-size: 0.95rem;
}
.markdown-body input[type="checkbox"] { margin-right: 0.4em; }

.markdown-body pre code .hljs-keyword,
.markdown-body pre code .hljs-selector-tag,
.markdown-body pre code .hljs-literal,
.markdown-body pre code .hljs-built_in,
.markdown-body pre code .hljs-type { color: #0a3d91; }
.markdown-body pre code .hljs-string,
.markdown-body pre code .hljs-regexp,
.markdown-body pre code .hljs-symbol,
.markdown-body pre code .hljs-attribute { color: #9a3412; }
.markdown-body pre code .hljs-number,
.markdown-body pre code .hljs-title { color: #0f4c81; }
.markdown-body pre code .hljs-title.function_,
.markdown-body pre code .hljs-function .hljs-title { color: #0f7a3d; }
.markdown-body pre code .hljs-title.class_ { color: #7c2d92; }
.markdown-body pre code .hljs-comment,
.markdown-body pre code .hljs-quote { color: #7c8494; font-style: italic; }
.markdown-body pre code .hljs-attr,
.markdown-body pre code .hljs-selector-attr { color: #0a3d91; }
.markdown-body pre code .hljs-meta { color: #374151; }
.markdown-body pre code .hljs-variable,
.markdown-body pre code .hljs-template-variable { color: #0f4c81; }


@media print {
  .markdown-body .chapter-page,
  .markdown-body .part-page,
  .markdown-body h1:not(:first-child),
  .markdown-body .copyright-page,
  .markdown-body .dedication,
  .markdown-body .restricted,
  .markdown-body .toc { break-before: page; }
  .markdown-body p, .markdown-body li { orphans: 3; widows: 3; }
}
`;

/* Slate Modern — alternative programming-book theme. Inherits the shared
   technical layout and swaps the skin: dark code panels, amber accent,
   chip-style chapter kickers. */
const THEME_SLATE_MODERN = `
.markdown-body {
  --md-accent: #d97706;
  --md-accent-contrast: #fffbeb;
  --md-soft: rgba(217, 119, 6, 0.10);
  --md-code-bg: #0f172a;
  --md-code-ink: #e2e8f0;
  --md-code-lang-ink: #94a3b8;
  --md-code-lang-fill: #1e293b;
}

.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 { color: #0f172a; }

.markdown-body .code-frame {
  border: 0;
  border-radius: 0.55rem;
  overflow: hidden;
  background: #0f172a;
  box-shadow: 0 1px 2px rgba(2, 6, 23, 0.35), 0 4px 12px rgba(2, 6, 23, 0.12);
}
.markdown-body .code-frame > pre {
  background: #0f172a;
  color: var(--md-code-ink);
}
.markdown-body .code-frame .code-lang {
  background: var(--md-code-lang-fill);
  color: var(--md-code-lang-ink);
  border-bottom-color: #334155;
}
.markdown-body .code-frame .code-lang::before {
  background: url("data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%2394a3b8'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpolyline%20points='4%2017%2010%2011%204%205'/%3E%3Cline%20x1='12'%20y1='19'%20x2='20'%20y2='19'/%3E%3C/svg%3E") center / contain no-repeat;
}

.markdown-body pre code .hljs-keyword,
.markdown-body pre code .hljs-selector-tag,
.markdown-body pre code .hljs-literal,
.markdown-body pre code .hljs-built_in,
.markdown-body pre code .hljs-type { color: #fbbf24; }
.markdown-body pre code .hljs-string,
.markdown-body pre code .hljs-regexp,
.markdown-body pre code .hljs-symbol,
.markdown-body pre code .hljs-attribute { color: #86efac; }
.markdown-body pre code .hljs-number,
.markdown-body pre code .hljs-title { color: #93c5fd; }
.markdown-body pre code .hljs-title.function_,
.markdown-body pre code .hljs-function .hljs-title { color: #c4b5fd; }
.markdown-body pre code .hljs-title.class_ { color: #fda4af; }
.markdown-body pre code .hljs-comment,
.markdown-body pre code .hljs-quote { color: #64748b; font-style: italic; }
.markdown-body pre code .hljs-attr,
.markdown-body pre code .hljs-selector-attr { color: #7dd3fc; }
.markdown-body pre code .hljs-meta { color: #94a3b8; }
.markdown-body pre code .hljs-variable,
.markdown-body pre code .hljs-template-variable { color: #93c5fd; }

.markdown-body .toc { border-color: #e2e8f0; background: #f8fafc; }
.markdown-body table { border-color: #cbd5e1; }
.markdown-body th { background: #f1f5f9; color: #0f172a; border-color: #cbd5e1; }
.markdown-body td { border-color: #e2e8f0; }
.markdown-body tbody tr:nth-child(even) { background: #f8fafc; }
.markdown-body .callout {
  border-color: #e2e8f0;
  border-left-color: #d97706;
  background: #fffbeb;
}
.markdown-body .callout-title { color: #92400e; }
.markdown-body .callout-content { color: #44403c; }

.markdown-body .chapter-label,
.markdown-body .part-kicker {
  display: inline-block;
  background: #0f172a;
  color: #fbbf24;
  padding: 0.28rem 0.9rem;
  border-radius: 999px;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
}
.markdown-body .chapter-ornament,
.markdown-body .part-ornament { color: #d97706; }

@media print {
  .markdown-body .code-frame { box-shadow: none; }
  .markdown-body .code-frame > pre {
    background: #0f172a;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
`;

const CYBERSEC_FONTS = `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap");
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap");

`;

/* CyberSec Field Manual — an ops-center look: emerald/cyan signal palette on
   light paper, terminal-style dark code panels, severity-coded callouts and
   monospace kickers. Inspired by SOC runbooks, not marketing. */
const THEME_CYBERSEC = `
.markdown-body {
  --md-accent: #0d9488;
  --md-accent-contrast: #ffffff;
  --md-paper: #fbfdfc;
  --md-ink: #12201c;
  --md-muted: #4b6a5f;
  --md-soft: rgba(13, 148, 136, 0.09);
  --md-border: rgba(18, 32, 28, 0.16);
  --md-code-bg: #0b1620;
  --md-code-ink: #d7e6e0;
  --md-font-sans: "Inter", "Source Sans Pro", "Lato", ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  --md-font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace;
  font-size: 11pt;
  line-height: 1.66;
  max-width: 68rem;
  color: var(--md-ink);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

@page {
  size: 6in 9in;
  margin: 0.5in 0.5in 0.5in 0.75in;
  @bottom-center {
    content: counter(page);
    font-family: "JetBrains Mono", monospace;
    font-size: 8pt;
    color: #6b8a7e;
  }
  @top-center {
    content: string(book-title);
    font-family: "JetBrains Mono", monospace;
    font-size: 7.5pt;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #6b8a7e;
  }
}
@page :first {
  @top-center { content: none; }
  @bottom-center { content: none; }
}

.markdown-body > h1:first-child { string-set: book-title content(); }

.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  font-family: "Inter", var(--md-font-sans);
  font-weight: 700;
  line-height: 1.28;
  letter-spacing: -0.01em;
  color: var(--md-ink);
}
.markdown-body h2, .markdown-body h3, .markdown-body h4 { border-bottom: none; padding-bottom: 0; }
.markdown-body p { margin: 0.65em 0; text-align: justify; hyphens: auto; }
.markdown-body a { color: var(--md-accent); text-decoration: none; border-bottom: 1px solid var(--md-accent); }
.markdown-body li { margin: 0.3em 0; }

.markdown-body h2 {
  font-size: 1.5rem;
  margin: 2.3rem 0 0.95rem;
  padding-bottom: 0.35rem;
  border-bottom: 2px solid var(--md-soft);
}
.markdown-body h3 { font-size: 1.1rem; margin: 1.6rem 0 0.55rem; }
.markdown-body h4 { font-size: 1.0rem; margin: 1.2rem 0 0.45rem; font-weight: 650; }

.markdown-body > h1:first-child {
  font-size: 2.05rem;
  line-height: 1.16;
  letter-spacing: -0.02em;
  text-align: center;
  padding: 2.4rem 0 0.9rem;
  margin: 0 0 0.5rem;
  border: none;
}
.markdown-body > h1:first-child + p {
  text-align: center;
  font-size: 1.0rem;
  font-style: italic;
  color: var(--md-muted);
}
.markdown-body h1:not(:first-child) {
  font-size: 1.75rem;
  text-align: center;
  margin: 3rem auto 1.5rem;
  border: none;
}

/* Ops-style chapter opener: mono kicker, no ornament clutter below the title. */
.markdown-body .chapter-label,
.markdown-body .part-kicker {
  font-family: "JetBrains Mono", var(--md-font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  text-transform: uppercase;
  color: var(--md-accent);
  border: none;
  padding: 0;
}
.markdown-body .chapter-title,
.markdown-body .part-title {
  font-family: "Inter", var(--md-font-sans);
  font-weight: 800;
}
.markdown-body .chapter-ornament,
.markdown-body .part-ornament {
  display: none;
}

/* Terminal-style code panels. */
.markdown-body .code-frame {
  margin: 1.3em 0;
  border-radius: 0.5rem;
  overflow: hidden;
  background: var(--md-code-bg);
  box-shadow: 0 1px 2px rgba(2, 8, 20, 0.3), 0 5px 14px rgba(2, 8, 20, 0.14);
}
.markdown-body .code-frame > pre {
  margin: 0;
  border: 0;
  background: var(--md-code-bg);
  color: var(--md-code-ink);
  padding: 0.55rem 1.15rem 1rem;
  font-size: 0.8rem;
  line-height: 1.6;
  box-shadow: none;
}
.markdown-body .code-frame > pre code {
  background: none;
  color: var(--md-code-ink);
  padding: 0;
  font-size: inherit;
}
.markdown-body .code-frame .code-lang {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.5rem 1rem;
  font-family: "JetBrains Mono", var(--md-font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #7de3c9;
  background: #0d2230;
  border-bottom: 1px solid rgba(125, 227, 201, 0.18);
}
.markdown-body .code-frame .code-lang::before {
  content: "\\25cf";
  color: #10b981;
  letter-spacing: 0;
}
.markdown-body .code-frame .code-lang::after {
  content: "\\25cf  \\25cf";
  margin-left: auto;
  color: #f59e0b;
  letter-spacing: 0.35em;
  font-size: 0.5rem;
}

/* Severity-coded callouts. */
.markdown-body .callout {
  border: 1px solid var(--md-border);
  border-left: 4px solid var(--md-accent);
  border-radius: 0.35rem;
  padding: 0.8rem 1.05rem;
  margin: 1.25em 0;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(18, 32, 28, 0.05);
}
.markdown-body .callout-title {
  font-family: "JetBrains Mono", var(--md-font-mono);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin: 0 0 0.35rem;
  color: var(--md-accent);
}
.markdown-body .callout-content { color: #27453a; }
.markdown-body .callout-note { border-left-color: #0891b2; }
.markdown-body .callout-note .callout-title { color: #0891b2; }
.markdown-body .callout-tip { border-left-color: #10b981; }
.markdown-body .callout-tip .callout-title { color: #059669; }
.markdown-body .callout-warning,
.markdown-body .callout-caution { border-left-color: #f59e0b; }
.markdown-body .callout-warning .callout-title,
.markdown-body .callout-caution .callout-title { color: #b45309; }
.markdown-body .callout-important,
.markdown-body .callout-error { border-left-color: #ef4444; }
.markdown-body .callout-important .callout-title,
.markdown-body .callout-error .callout-title { color: #dc2626; }
.markdown-body .callout-best-practice { border-left-color: #8b5cf6; }
.markdown-body .callout-best-practice .callout-title { color: #7c3aed; }
.markdown-body .callout-example { border-left-color: #14b8a6; }
.markdown-body .callout-example .callout-title { color: #0f766e; }

.markdown-body table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin: 1.4em 0;
  font-size: 0.88rem;
  border: 1px solid #b6c9c1;
  border-radius: 0.3rem;
  overflow: hidden;
}
.markdown-body th {
  background: #0d2230;
  color: #9aefd4;
  font-family: "JetBrains Mono", var(--md-font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1px solid #0d2230;
  padding: 0.5rem 0.75rem;
  font-weight: 700;
  text-align: left;
}
.markdown-body td {
  border: 1px solid #dbe7e2;
  padding: 0.45rem 0.75rem;
  vertical-align: top;
}
.markdown-body tbody tr:nth-child(even) { background: #f3f8f6; }

.markdown-body img {
  display: block;
  margin: 1.5em auto;
  max-width: 100%;
  border-radius: 0.35rem;
  box-shadow: 0 1px 3px rgba(2, 8, 20, 0.16);
}
.markdown-body figure { margin: 1.8em 0; text-align: center; counter-increment: fig; }
.markdown-body figure img { margin: 0 auto; }
.markdown-body figcaption {
  font-size: 0.82rem;
  font-style: italic;
  color: var(--md-muted);
  margin-top: 0.5rem;
}
.markdown-body figcaption::before {
  content: "Figure " counter(chapter) "." counter(fig) "\\00a0\\2014\\00a0";
  color: var(--md-accent);
}

.markdown-body hr {
  margin: 2.4em 0;
  border: 0;
  border-top: 1px dashed #9dbdb2;
  height: auto;
}
.markdown-body p.md-write-line {
  margin: 0.4em 0 1.4em;
  padding-bottom: 0.3em;
  border-bottom: 1.5px solid var(--md-border);
  break-inside: avoid;
  page-break-inside: avoid;
}

.markdown-body .toc {
  margin: 0 0 2.5rem;
  padding: 1.3rem 1.6rem;
  border: 1px solid #c2d6cf;
  border-radius: 0.5rem;
  background: #f6faf8;
}
.markdown-body .toc .toc-title {
  font-family: "JetBrains Mono", var(--md-font-mono);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--md-accent);
  margin: 0 0 0.9rem;
}
.markdown-body .toc ol { list-style: none; margin: 0; padding: 0; }
.markdown-body .toc li { margin: 0.35em 0; }
.markdown-body .toc li.toc-l3 { padding-left: 1.8em; }
.markdown-body .toc li.toc-l4 { padding-left: 3.6em; }
.markdown-body .toc a { color: var(--md-ink); border-bottom: none; }
.markdown-body .toc a .toc-text { flex: 1; border-bottom: 1px dotted #9dbdb2; margin: 0 0.5em; }
.markdown-body .toc a .toc-num { color: var(--md-accent); min-width: 2.6em; }
.markdown-body .toc a .toc-pg { float: right; }
.markdown-body .toc a::after {
  content: target-counter(attr(href), page);
  font-variant-numeric: tabular-nums;
  color: var(--md-muted);
}

.markdown-body blockquote {
  border-left-color: var(--md-accent);
  background: var(--md-soft);
  font-style: normal;
  font-size: 0.95rem;
}
.markdown-body input[type="checkbox"] { margin-right: 0.4em; }

/* Terminal syntax highlighting. */
.markdown-body pre code .hljs-keyword,
.markdown-body pre code .hljs-selector-tag,
.markdown-body pre code .hljs-literal,
.markdown-body pre code .hljs-built_in,
.markdown-body pre code .hljs-type { color: #7dd3fc; }
.markdown-body pre code .hljs-string,
.markdown-body pre code .hljs-regexp,
.markdown-body pre code .hljs-symbol,
.markdown-body pre code .hljs-attribute { color: #6ee7b7; }
.markdown-body pre code .hljs-number,
.markdown-body pre code .hljs-title { color: #fcd34d; }
.markdown-body pre code .hljs-title.function_,
.markdown-body pre code .hljs-function .hljs-title { color: #a5b4fc; }
.markdown-body pre code .hljs-title.class_ { color: #f0abfc; }
.markdown-body pre code .hljs-comment,
.markdown-body pre code .hljs-quote { color: #64748b; font-style: italic; }
.markdown-body pre code .hljs-attr,
.markdown-body pre code .hljs-selector-attr { color: #86efac; }
.markdown-body pre code .hljs-meta { color: #94a3b8; }
.markdown-body pre code .hljs-variable,
.markdown-body pre code .hljs-template-variable { color: #fcd34d; }

@media print {
  .markdown-body .code-frame { box-shadow: none; }
  .markdown-body .code-frame > pre {
    background: #0b1620;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .markdown-body .chapter-page,
  .markdown-body .part-page,
  .markdown-body h1:not(:first-child),
  .markdown-body .copyright-page,
  .markdown-body .dedication,
  .markdown-body .restricted,
  .markdown-body .toc { break-before: page; }
  .markdown-body p, .markdown-body li { orphans: 3; widows: 3; }
}
`;

const TRAUMA = [
  "# Understanding Psychological Trauma",
  "",
  "**Author:** Dr. A. Developer  ",
  "**Specialty:** Traumatology and Psychology  ",
  "**Edition:** 1st edition, 2026",
  "",
  "---",
  "",
  "## Preface",
  "",
  "This book explains how psychological trauma shapes the brain and nervous ",
  "system, and how safety, regulation and connection can restore well-being.",
  "",
  "## How to use this book",
  "",
  "- Each chapter explains a core concept in plain language.",
  "- *Practical exercises* appear in quotation boxes.",
  "- Tables summarize the key ideas for quick reference.",
  "",
  "---",
  "",
  "# Part I \u2014 What Trauma Is",
  "",
  "## Chapter 1. Beyond a Difficult Memory",
  "",
  "Trauma is not just a bad memory. It is the response of the nervous system ",
  "to overwhelming events, stored in the body as much as in the mind.",
  "",
  "### 1.1 Common causes",
  "",
  "| Type | Examples |",
  "| ---- | -------- |",
  "| Single-event | Accidents, assaults, medical emergencies |",
  "| Chronic | Abuse, neglect, bullying |",
  "| Complex | Prolonged or repeated exposure, attachment trauma |",
  "",
  "## Chapter 2. The Trauma Response Cycle",
  "",
  "The brain and body respond to danger with survival strategies:",
  "",
  "- Fight",
  "- Flight",
  "- Freeze",
  "- Fawn",
  "",
  "These are protective adaptations, not character flaws.",
  "",
  "> [!NOTE]",
  "> Trauma responses are survival adaptations, not personal failures.",
  "",
  "> **Key idea:** the response is automatic, but it can be regulated with time.",
  "",
  "---",
  "",
  "# Part II \u2014 The Traumatized Brain",
  "",
  "## Chapter 3. The Three Brain Systems",
  "",
  "| System | Function |",
  "| ------ | -------- |",
  "| **Survival brain** | Detects threats, prepares reactions |",
  "| **Emotional brain** | Processes feelings, memories, attachment |",
  "| **Thinking brain** | Reasoning, planning, regulation |",
  "",
  "## Chapter 4. The Alarm System and Nervous System States",
  "",
  "After trauma the alarm system can become highly sensitive, keeping the ",
  "body in a state of alert even when the danger is over.",
  "",
  "| State | Experience |",
  "| ----- | ---------- |",
  "| Hyperactivation | Anxiety, racing thoughts, tension |",
  "| Regulation | Calm, presence, safety |",
  "| Hypoactivation | Numbness, exhaustion, shutdown |",
  "",
  "---",
  "",
  "# Part III \u2014 Healing",
  "",
  "## Chapter 5. Neuroplasticity and Healing",
  "",
  "The brain can create new connections through repeated experiences of ",
  "safety, regulation and connection.",
  "",
  "> [!TIP]",
  "> The alarm system learns from experience — and it can relearn through repeated moments of safety. That is neuroplasticity at work.",
  "",
  "## Chapter 6. The Healing Pathway",
  "",
  "1. **Safety** \u2014 build predictable, safe environments.",
  "2. **Regulation** \u2014 learn to notice and calm the nervous system.",
  "3. **Connection** \u2014 repair relationships and trust.",
  "4. **Meaning** \u2014 integrate the experience into the life story.",
  "",
  "> Healing is not linear. Small, repeated experiences of safety create",
  "> new neural pathways.",
  "",
  "::: diagram caption=\"The trauma response cycle\" highlight=\"Healing\"",
  "Trigger",
  "↓",
  "Emotional response",
  "↓",
  "Body reaction",
  "↓",
  "Protective behavior",
  "↓",
  "Healing response",
  ":::",
  "",
  "::: tool number=\"01\" title=\"Grounding 5-4-3-2-1\"",
  "**Purpose:** Anchor attention in the present through the five senses.",
  "**How To Use:**",
  "- Name 5 things you can see",
  "- 4 you can feel, 3 you can hear",
  "- 2 you can smell, 1 you can taste",
  "**Journal Space:**",
  "What shifted in your body after practicing?",
  "___",
  ":::",
  "",
  "::: worksheet title=\"Trigger Identification\" purpose=\"Map the situations that precede a strong reaction.\"",
  "Trigger situation (who, where, when)",
  "___",
  "Body sensations I notice first",
  "___",
  "One grounding strategy I will try next time",
  "___",
  ":::",
  "",
  "::: summary",
  "#### What You Learned",
  "- The alarm system learns from experience",
  "#### Key Takeaways",
  "- Safety precedes processing",
  "- The body is an entry point to regulation",
  "#### Practice For This Week",
  "Use 5-4-3-2-1 once a day, even on calm days.",
  ":::",
  "",
  "---",
  "",
  "## Reflection journal",
  "",
  "What feels safe this week:",
  "",
  "___",
  "",
  "What I want my brain to learn next:",
  "",
  "___",
  "",
  "## Key takeaways",
  "",
  "- Trauma affects the brain and the body.",
  "- Survival responses are protective adaptations.",
  "- The nervous system can learn new patterns.",
  "- Healing involves creating safety.",
  "",
  "## Resources",
  "",
  "1. Bessel van der Kolk, *The Body Keeps the Score*.",
  "2. Deb Dana, *The Polyvagal Theory in Therapy*.",
  "",
].join("\n");


const PSYCHOLOGY = [
  "# The Healing Brain",
  "",
  "**Author:** Dr. A. Developer  ",
  "**Theme:** Trauma, identity and post-traumatic growth  ",
  "**Edition:** 1st edition, 2026",
  "",
  "---",
  "",
  "## Preface",
  "",
  "This workbook accompanies the reader through a safety-first approach to",
  "understanding trauma, regulating the nervous system, and rebuilding identity.",
  "",
  "## How to use this workbook",
  "",
  "- Each chapter ends with a *reflection exercise*.",
  "- Write freely; there are no wrong answers.",
  "- Return to the regulation practices whenever needed.",
  "",
  "---",
  "",
  "# Part I \u2014 Understanding Your Story",
  "",
  "## Chapter 1. The Body Remembers",
  "",
  "Trauma is stored in the body as much as in memory. Noticing sensations without",
  "judging them is the first step toward regulation.",
  "",
  "| State | Sensation | Message |",
  "| ----- | --------- | ------- |",
  "| Hyperactivation | Racing heart, tension | \"I'm not safe\" |",
  "| Regulation | Calm, present | \"I am safe now\" |",
  "| Hypoactivation | Numbness, exhaustion | \"I need rest\" |",
  "",
  "> **Practice:** pause for a minute and name one sensation present in your body",
  "> right now, with curiosity instead of alarm.",
  "",
  "## Chapter 2. Safety First",
  "",
  "The brain seeks safety before connection. Build it through routines, stable",
  "relationships, and a paced approach to difficult material.",
  "",
  "### 2.1 A three-step regulation practice",
  "",
  "1. **Ground** \u2014 place your feet on the floor, notice three things you see.",
  "2. **Orient** \u2014 slowly scan the room; you are not in the past.",
  "3. **Soften** \u2014 relax your jaw and shoulders; breathe out longer than you breathe in.",
  "",
  "---",
  "",
  "# Part II \u2014 Rebuilding",
  "",
  "## Chapter 3. Rewriting the Inner Narrative",
  "",
  "Growth after trauma does not mean forgetting. It means the story gains",
  "new chapters: of endurance, learning, and connection.",
  "",
  "## Chapter 4. Post-Traumatic Growth",
  "",
  "- **Relating to others:** deeper, more honest bonds.",
  "- **Personal strength:** \"I survived\" becomes \"I can handle this\".",
  "- **New possibilities:** a renewed sense of purpose.",
  "",
  "---",
  "",
  "## Reflection journal",
  "",
  "What felt safe this week:",
  "",
  "___",
  "",
  "What I want my brain to learn next:",
  "",
  "___",
  "",
  "## Closing notes",
  "",
  "Healing is not linear. Small, repeated experiences of safety build the",
  "new neural pathways that make it possible.",
  "",
].join("\n");

const ARCH_SVG =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'560'%20height%3D'170'%20viewBox%3D'0%200%20560%20170'%3E%3Crect%20x%3D'0'%20y%3D'0'%20width%3D'560'%20height%3D'50'%20rx%3D'4'%20fill%3D'%23eef4ff'%20stroke%3D'%231d4ed8'%2F%3E%3Ctext%20x%3D'16'%20y%3D'31'%20font-family%3D'sans-serif'%20font-size%3D'15'%20fill%3D'%231f2430'%3EAPI%20layer%20-%20HTTP%20handlers%20and%20routing%3C%2Ftext%3E%3Crect%20x%3D'0'%20y%3D'60'%20width%3D'560'%20height%3D'50'%20rx%3D'4'%20fill%3D'%23eef4ff'%20stroke%3D'%231d4ed8'%2F%3E%3Ctext%20x%3D'16'%20y%3D'91'%20font-family%3D'sans-serif'%20font-size%3D'15'%20fill%3D'%231f2430'%3EService%20layer%20-%20business%20rules%20and%20orchestration%3C%2Ftext%3E%3Crect%20x%3D'0'%20y%3D'120'%20width%3D'560'%20height%3D'50'%20rx%3D'4'%20fill%3D'%23eef4ff'%20stroke%3D'%231d4ed8'%2F%3E%3Ctext%20x%3D'16'%20y%3D'151'%20font-family%3D'sans-serif'%20font-size%3D'15'%20fill%3D'%231f2430'%3EData%20layer%20-%20repositories%20and%20database%20access%3C%2Ftext%3E%3C%2Fsvg%3E";

const TECHNICAL = [
  "# The Pragmatic Backend Engineer",
  "",
  "*From clean fundamentals to production-ready systems in Python, TypeScript, and Go.*",
  "",
  '<div class="book-meta">',
  "Publisher: Example Engineering Press",
  "Author: A. Developer",
  "Level: Intermediate to advanced",
  "Edition: First edition, 2026",
  "</div>",
  "",
  '<div class="copyright-page">',
  "Copyright © 2026 Example Engineering Press. All rights reserved.",
  "No part of this book may be reproduced, stored in a retrieval system, or",
  "transmitted in any form without prior written permission of the publisher.",
  "ISBN 978-0-000-000-0",
  "Set in Inter and JetBrains Mono.",
  "</div>",
  "",
  '<div class="dedication">',
  "For everyone who ships, and for those who sleep while others ship.",
  "</div>",
  "",
  "[TOC]",
  "",
  "# Preface",
  "",
  "Why another programming book? Because systems fail in the unexpected places:",
  "a type guessed wrong, a temporary file never cleaned, a query written with",
  "confidence and executed with regret. This book teaches the discipline that",
  "keeps those failures boring and infrequent.",
  "",
  "Every chapter pairs a concept with running code. Finish the book and you",
  "will have built, tested and deployed a small production service.",
  "",
  "# Introduction",
  "",
  "Systems fail in the unexpected places: a type guessed wrong, a temporary",
  "file never cleaned, a query written with confidence and executed with",
  "regret. This book teaches the discipline that keeps those failures boring",
  "and infrequent. Every chapter pairs a concept with running code; finish the",
  "book and you will have built, tested and deployed a small production",
  "service.",
  "",
  "# Chapter 1. Getting Started",
  "",
  "## Conventions used in this book",
  "",
  "This book uses several kinds of callouts. The colors and the icons stay",
  "consistent across the whole book.",
  "",
  "> [!NOTE]",
  "> Text inside **note** boxes adds context worth remembering but not essential",
  "> to continue.",
  "",
  "> [!TIP]",
  "> Tip boxes describe a faster, cleaner or safer way to do the same thing.",
  "",
  "> [!WARNING]",
  "> Warning boxes flag common mistakes that compile, run, and then explode.",
  "",
  "> [!BEST PRACTICE]",
  "> Best practice boxes encode professional habits: names, boundaries and",
  "> review habits you can adopt immediately.",
  "",
  "> [!ERROR]",
  "> Error boxes show a real failure mode and the exact fix for it.",
  "",
  "## Who this book is for",
  "",
  "This book is for developers who already write code and want to understand",
  "how the pieces fit together: type systems, databases, HTTP, packaging and",
  "operations. Familiarity with any programming language is enough to begin.",
  "",
  "## How this book is structured",
  "",
  "The chapters build on each other, but each can be read on its own. Code in",
  "later chapters reuses earlier examples without apology.",
  "",
  "# Chapter 2. Your First Python Program",
  "",
  "## Setting up the environment",
  "",
  "1. Install Python 3.12 or newer.",
  "2. Create a virtual environment: `python -m venv .venv`.",
  "3. Activate it and confirm the interpreter with `which python`.",
  "",
  "> [!NOTE]",
  "> A virtual environment keeps project dependencies isolated from your system",
  "> Python. It is non-negotiable for professional work.",
  "",
  "## Hello, world",
  "",
  "```python",
  "def hello(name: str) -> str:",
  "    return f\"Hello, {name}!\"",
  "",
  "",
  "if __name__ == \"__main__\":",
  "    print(hello(\"Reader\"))",
  "```",
  "",
  "Run it and you should see `Hello, Reader!` on your terminal.",
  "",
  "> [!WARNING]",
  "> Mixing tabs and spaces produces a `TabError`. Configure your editor to",
  "> use spaces and a 4-space indent.",
  "",
  "### Naming things",
  "",
  "Subsections nest under their section and number themselves: this one is",
  "**2.2.1** — heading levels carry the hierarchy, not extra typing.",
  "",
  "# Chapter 3. Control Flow with JavaScript",
  "",
  "## Conditionals",
  "",
  "```javascript",
  "function classify(score) {",
  "  if (score >= 90) return \"distinction\";",
  "  if (score >= 70) return \"pass\";",
  "  return \"review\";",
  "}",
  "```",
  "",
  "## Closures",
  "",
  "```javascript",
  "function counter(start = 0) {",
  "  let value = start;",
  "  return () => ++value;",
  "}",
  "",
  "const next = counter(10);",
  "console.log(next()); // 11",
  "console.log(next()); // 12",
  "```",
  "",
  "> [!BEST PRACTICE]",
  "> Name the closure's captured state explicitly. A later reader should know",
  "> at a glance what `value` means and who can change it.",
  "",
  "# Chapter 4. Persistence with SQL and JSON",
  "",
  "## Modeling a table",
  "",
  "```sql",
  "CREATE TABLE users (",
  "  id BIGINT PRIMARY KEY,",
  "  email VARCHAR(255) NOT NULL UNIQUE,",
  "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  ");",
  "```",
  "",
  "| Concern | Python | TypeScript | Go |",
  "| ------- | ------ | ---------- | - |",
  "| Runtime | CPython | Node.js | Native |",
  "| Typing | Static (mypy) | Static | Static |",
  "| Deploy | Container | Container | Single binary |",
  "",
  "## JSON payloads",
  "",
  "```json",
  "{ \"id\": 42, \"active\": true, \"tags\": [\"api\", \"book\"] }",
  "```",
  "",
  `![The layered architecture used in this book](${ARCH_SVG} "Reference service architecture")`,
  "",
  "> [!NOTE]",
  "> JSON numbers are ambiguous: use *schema versioning* in the field name or",
  "> envelope (`\"v\": 2`) before changing their meaning.",
  "",
  "# Chapter 5. Building the CLI",
  "",
  "```bash",
  "python -m venv .venv && source .venv/bin/activate",
  "pip install -r requirements.txt",
  "python -m app.cli --verbose",
  "```",
  "",
  "```go",
  "package main",
  "",
  "import \"fmt\"",
  "",
  "func main() {",
  "    fmt.Println(\"Hello, Go\")",
  "}",
  "```",
  "",
  "> [!ERROR]",
  "> A common failure: the import path in `go.mod` disagrees with the package",
  "> directory. Keep the module path and the repository path identical.",
  "",
  "# Chapter 6. Web APIs in Practice",
  "",
  "## A typed endpoint",
  "",
  "```typescript",
  "type User = { id: number; name: string };",
  "",
  "export function findUser(db: Database, id: number): Promise<User> {",
  "  return db.one(\"SELECT id, name FROM users WHERE id = $1\", [id]);",
  "}",
  "```",
  "",
  "## The page that renders it",
  "",
  "```html",
  "<main>",
  "  <h1>Profile</h1>",
  "  <dl>",
  "    <dt>Name</dt>",
  "    <dd data-field=\"name\"></dd>",
  "  </dl>",
  "</main>",
  "```",
  "",
  "```css",
  ".card {",
  "  border: 1px solid #e2e8f0;",
  "  border-radius: 0.5rem;",
  "  padding: 1rem;",
  "}",
  "```",
  "",
  "> [!TIP]",
  "> Keep the API contract explicit: validate the request body against a schema",
  "> at the boundary, not deep inside domain code.",
  "",
  "# Chapter 7. Exercises",
  "",
  "> [!EXAMPLE]",
  "> Exercise 1 — Refactor `counter` to accept a step. Write a test that",
  "> increments by `2` twice.",
  "",
  "> [!EXAMPLE]",
  "> Exercise 2 — Add a `paginate` helper that returns pages of `10` rows and",
  "> document its behaviour in a short README paragraph.",
  "",
  "> [!EXAMPLE]",
  "> Exercise 3 — Final project: a `PUT /api/users/:id` endpoint that updates",
  "> only the fields present in the request body, rejects unknown fields, and",
  "> returns the updated row.",
  "",
  "> [!TIP]",
  "> After each exercise, commit. A clean history is its own reward.",
  "",
].join("\n");

const MEDICAL_FONTS = `@import url("https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700;800&display=swap");
@import url("https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap");
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap");

`;

/* Medical Study Guide — a clinical-reference look in the spirit of the
   illustrated ECG/physiology study guides (the NEDU "Made Easy" series): calm
   off-white paper, a deep clinical teal accent, serif body for long study
   sessions, sans headings, and ECG-grid figure panels with a pink trace.
   Panels instead of terminals; clinical caution callouts instead of ops
   severity codes. */
const THEME_MEDICAL = `
.markdown-body {
  --md-accent: #0f766e;
  --md-accent-contrast: #ffffff;
  --md-paper: #fcfcf9;
  --md-ink: #1a2226;
  --md-muted: #4f6268;
  --md-soft: rgba(15, 118, 110, 0.09);
  --md-border: rgba(26, 34, 38, 0.15);
  --md-code-bg: #143a3a;
  --md-code-ink: #d7ece7;
  --md-font-sans: "Source Sans 3", "Source Sans Pro", ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  --md-font-serif: "Source Serif 4", Georgia, "Times New Roman", serif;
  --md-font-mono: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  font-size: 11pt;
  line-height: 1.7;
  max-width: 68rem;
  font-family: var(--md-font-serif);
  color: var(--md-ink);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

@page {
  size: 6in 9in;
  margin: 0.55in 0.5in 0.5in 0.75in;
  @bottom-center {
    content: counter(page);
    font-family: "IBM Plex Mono", monospace;
    font-size: 8pt;
    color: #7c8f8b;
  }
  @top-center {
    content: string(book-title);
    font-family: "Source Sans 3", sans-serif;
    font-size: 7.5pt;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #7c8f8b;
  }
}
@page :first {
  @top-center { content: none; }
  @bottom-center { content: none; }
}

.markdown-body > h1:first-child { string-set: book-title content(); }

.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  font-family: var(--md-font-sans);
  font-weight: 700;
  line-height: 1.28;
  letter-spacing: -0.005em;
  color: var(--md-ink);
}
.markdown-body h2, .markdown-body h3, .markdown-body h4 { border-bottom: none; padding-bottom: 0; }
.markdown-body p { margin: 0.7em 0; text-align: justify; hyphens: auto; }
.markdown-body a { color: var(--md-accent); text-decoration: none; border-bottom: 1px solid var(--md-accent); }
.markdown-body li { margin: 0.32em 0; }
.markdown-body strong { font-weight: 700; }

.markdown-body h2 {
  font-size: 1.5rem;
  margin: 2.3rem 0 0.95rem;
  padding-bottom: 0.35rem;
  border-bottom: 2px solid var(--md-soft);
}
.markdown-body h3 { font-size: 1.1rem; margin: 1.6rem 0 0.55rem; }
.markdown-body h4 { font-size: 1rem; margin: 1.2rem 0 0.45rem; font-weight: 700; color: var(--md-accent); }

.markdown-body > h1:first-child {
  font-size: 2.05rem;
  line-height: 1.16;
  letter-spacing: -0.02em;
  text-align: center;
  padding: 2.4rem 0 0.9rem;
  margin: 0 0 0.5rem;
  border: none;
}
.markdown-body > h1:first-child + p {
  text-align: center;
  font-size: 1.02rem;
  font-style: italic;
  color: var(--md-muted);
}
.markdown-body h1:not(:first-child) {
  font-size: 1.75rem;
  text-align: center;
  margin: 3rem auto 1.5rem;
  border: none;
}

/* Clinical chapter opener: sans caps kicker, no ornament clutter. */
.markdown-body .chapter-label,
.markdown-body .part-kicker {
  font-family: var(--md-font-sans);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  text-transform: uppercase;
  color: var(--md-accent);
  border: none;
  padding: 0;
}
.markdown-body .chapter-title,
.markdown-body .part-title {
  font-family: var(--md-font-sans);
  font-weight: 800;
}
.markdown-body .chapter-ornament,
.markdown-body .part-ornament {
  display: none;
}

/* ECG-grid figure panels: the paper the traces are printed on. */
.markdown-body .code-frame {
  margin: 1.3em 0;
  border-radius: 0.5rem;
  overflow: hidden;
  background: var(--md-code-bg);
  box-shadow: 0 1px 2px rgba(20, 58, 58, 0.3), 0 5px 14px rgba(20, 58, 58, 0.14);
}
.markdown-body .code-frame > pre {
  margin: 0;
  border: 0;
  background: var(--md-code-bg);
  color: var(--md-code-ink);
  padding: 0.55rem 1.15rem 1rem;
  font-size: 0.8rem;
  line-height: 1.6;
  box-shadow: none;
}
.markdown-body .code-frame > pre code {
  background: none;
  color: var(--md-code-ink);
  padding: 0;
  font-size: inherit;
}
.markdown-body .code-frame .code-lang {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.5rem 1rem;
  font-family: "IBM Plex Mono", var(--md-font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #9ad9cd;
  background: #0e2f2e;
  border-bottom: 1px solid rgba(154, 217, 205, 0.2);
}
.markdown-body .code-frame .code-lang::before {
  content: "\\26A5";
  color: #5eead4;
  letter-spacing: 0;
}
.markdown-body .code-frame .code-lang::after {
  content: "\\26A5  \\26A5";
  margin-left: auto;
  color: #f4a7b9;
  letter-spacing: 0.3em;
  font-size: 0.55rem;
}

/* Clinical callouts: caution-coded, calm backgrounds, no terminal feel. */
.markdown-body .callout {
  border: 1px solid var(--md-border);
  border-left: 4px solid var(--md-accent);
  border-radius: 0.35rem;
  padding: 0.8rem 1.05rem;
  margin: 1.25em 0;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(26, 34, 38, 0.05);
  font-family: var(--md-font-sans);
}
.markdown-body .callout-title {
  font-family: var(--md-font-sans);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin: 0 0 0.35rem;
  color: var(--md-accent);
}
.markdown-body .callout-content { color: #2c3f45; }
.markdown-body .callout-note { border-left-color: #0e7490; }
.markdown-body .callout-note .callout-title { color: #0e7490; }
.markdown-body .callout-tip { border-left-color: #14b8a6; }
.markdown-body .callout-tip .callout-title { color: #0d9488; }
.markdown-body .callout-warning,
.markdown-body .callout-caution { border-left-color: #e11d48; }
.markdown-body .callout-warning .callout-title,
.markdown-body .callout-caution .callout-title { color: #be123c; }
.markdown-body .callout-important,
.markdown-body .callout-error { border-left-color: #b45309; }
.markdown-body .callout-important .callout-title,
.markdown-body .callout-error .callout-title { color: #92400e; }
.markdown-body .callout-best-practice { border-left-color: #7c3aed; }
.markdown-body .callout-best-practice .callout-title { color: #6d28d9; }
.markdown-body .callout-example { border-left-color: #059669; }
.markdown-body .callout-example .callout-title { color: #047857; }

.markdown-body table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin: 1.4em 0;
  font-size: 0.88rem;
  border: 1px solid #9fb8b2;
  border-radius: 0.3rem;
  overflow: hidden;
}
.markdown-body th {
  background: #0e2f2e;
  color: #bfe8de;
  font-family: var(--md-font-sans);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid #0e2f2e;
  padding: 0.5rem 0.75rem;
  font-weight: 700;
  text-align: left;
}
.markdown-body td {
  border: 1px solid #d9e5e1;
  padding: 0.45rem 0.75rem;
  vertical-align: top;
}
.markdown-body tbody tr:nth-child(even) { background: #f2f7f5; }

.markdown-body blockquote {
  border-left: 3px solid var(--md-accent);
  padding: 0.2rem 0 0.2rem 1rem;
  color: var(--md-muted);
  font-style: italic;
}

/* Study-guide figure box: ECG paper for any illustration the author drops in. */
.markdown-body figure {
  margin: 1.4em 0;
  padding: 0.9rem;
  background:
    linear-gradient(to bottom, rgba(225, 29, 72, 0.09) 1px, transparent 1px),
    linear-gradient(to right, rgba(225, 29, 72, 0.09) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(225, 29, 72, 0.2) 1px, transparent 1px),
    linear-gradient(to right, rgba(225, 29, 72, 0.2) 1px, transparent 1px),
    #fffdfd;
  background-size:
    6px 6px,
    6px 6px,
    30px 30px,
    30px 30px;
  border: 1px solid #e5b8c0;
  border-radius: 0.35rem;
}
.markdown-body figcaption {
  font-family: var(--md-font-sans);
  font-size: 0.78rem;
  color: #4f6268;
  text-align: center;
  margin-top: 0.55rem;
}

/* Lead labels and measurements read as reference data, not decoration. */
.markdown-body .book-meta {
  text-align: center;
  font-family: var(--md-font-sans);
  font-size: 0.85rem;
  color: var(--md-muted);
  border-top: 2px solid var(--md-accent);
  border-bottom: 1px solid var(--md-border);
  padding: 0.9rem 0;
  margin: 1.4rem auto 2rem;
  max-width: 30rem;
}
.markdown-body .copyright-page {
  text-align: center;
  font-family: var(--md-font-sans);
  font-size: 0.72rem;
  color: var(--md-muted);
  margin: 2.5rem auto;
  max-width: 26rem;
  line-height: 1.7;
}
.markdown-body .dedication {
  text-align: center;
  font-style: italic;
  color: var(--md-muted);
  margin: 3rem auto;
  max-width: 24rem;
}
`;

/* Sample chapter for the medical template: the opening of an ECG study
   guide — how the signal is made, how the strip is read, with the callout
   and table patterns a medical author will actually reach for. */
const MEDICAL = [
  "# ECG Interpretation Made Simple",
  "",
  "*An illustrated study guide for students learning to read the trace.*",
  "",
  '<div class="book-meta">',
  "Series: Clinical Study Guides",
  "Author: Dr. Example",
  "Level: Nursing and medical students",
  "Edition: First edition, 2026",
  "</div>",
  "",
  '<div class="copyright-page">',
  "Copyright © 2026 Clinical Study Guides. All rights reserved.",
  "Educational reference — not a substitute for clinical judgement.",
  "ISBN 978-0-000-000-0",
  "Set in Source Serif and Source Sans.",
  "</div>",
  "",
  '<div class="dedication">',
  "For the students who practise until the squiggles speak.",
  "</div>",
  "",
  "[TOC]",
  "",
  "# Preface",
  "",
  "Electrocardiograms can seem daunting: rows of squiggles in six little",
  "boxes, each one supposedly telling you something vital about a heart.",
  "This guide builds the reading skill in the order the trace itself is",
  "made — first where the signal comes from, then how the machine draws",
  "it, and only then what an abnormal line means.",
  "",
  "> [!NOTE]",
  "> Every chapter ends with a quick-recall table. If you can fill it from",
  "> memory, move on; if not, reread the wave summary before continuing.",
  "",
  "# Chapter 1. Where the Signal Comes From",
  "",
  "## The cardiac conduction system",
  "",
  "The ECG is the body's own electrical story read from the skin. Each",
  "heartbeat starts in the sinoatrial node, spreads across the atria,",
  "pauses at the atrioventricular node, and races down the bundle branches",
  "into the ventricles. The trace you read is that story, drawn by",
  "electrodes, one beat at a time.",
  "",
  "| Wave  | What depolarises      | You see it as            |",
  "| ----- | --------------------- | ------------------------ |",
  "| P     | Atria                 | Small rounded bump       |",
  "| QRS   | Ventricles            | Tall narrow spike        |",
  "| T     | Ventricular recovery  | Broad rounded wave       |",
  "",
  "## From heart to paper",
  "",
  "The machine amplifies the skin-level signal and prints it on paper",
  "ruled at 25 mm per second. One small square is 0.04 seconds, one large",
  "square is 0.2 — the ruler every interval is measured against.",
  "",
  "> [!IMPORTANT]",
  "> Always confirm the paper speed and calibration before interpreting.",
  "> A 50 mm/s strip doubles every interval on the page.",
  "### Rhythm strip or 12-lead?",
  "",
  "A rhythm strip watches one lead over time; a 12-lead looks at the heart",
  "from twelve angles at one instant. Rate and rhythm need time; ischaemia",
  "and axis need angles. Most real questions need both.",
  "",
  "```ecg-parameters",
  "Rhythm strip II  ·  25 mm/s  ·  10 mm/mV",
  "R-R regular  ·  rate 72/min",
  "P before every QRS  ·  PR 0.16 s  ·  QRS 0.09 s",
  "```",
  "",
  "# Chapter 2. Reading the Strip",
  "",
  "## The five questions",
  "",
  "Read every strip in the same order, every time:",
  "",
  "1. **Rate** — 300 over the R-R large squares.",
  "2. **Rhythm** — calipers on the R peaks; regular or not?",
  "3. **P waves** — one per QRS, upright in lead II?",
  "4. **PR interval** — normal, short, or growing?",
  "5. **QRS width** — narrow or wide?",
  "",
  "> [!WARNING]",
  "> An irregularly irregular rhythm with no P waves is atrial",
  "> fibrillation until proven otherwise. Do not anchor on the rate.",
  "",
  "## What normal looks like",
  "",
  "```ecg-trace",
  "  R                    R",
  "  ┃    T               ┃    T",
  "  ┃   ╭╮              ┃   ╭╮",
  " P┃  ╭╯╰╮    S        P┃  ╭╯╰╮    S",
  "  ╰──╯  ╰╮  ╭━━━━━━━━━ ╰──╯  ╰╮  ╭━━━━━",
  "         ╰━━╯                 ╰━━╯",
  "```",
  "",
  "| Interval | Normal range | Measured by             |",
  "| -------- | ------------ | ----------------------- |",
  "| PR       | 0.12–0.20 s  | Start of P to start of QRS |",
  "| QRS      | < 0.12 s     | Q to end of S           |",
  "| QT       | < 0.44 s     | Q to end of T, rate-corrected |",
  "",
  "> [!TIP]",
  "> Measure with calipers, not by eye. Eyes forgive slow drifts that",
  "> calipers do not.",
  "",
  "## Quick recall",
  "",
  "| Question                | Answer to reach for        |",
  "| ----------------------- | -------------------------- |",
  "| Fast and regular?       | Supraventricular tachycardia first |",
  "| Irregularly irregular?  | Atrial fibrillation first  |",
  "| Wide + fast + regular?  | Ventricular tachycardia until proven otherwise |",
  "",
  "---",
  "",
  "## Ischaemia and the ST segment",
  "",
  "The ST segment is the quiet line between the QRS and the T wave. When",
  "the muscle is starved, that line lifts or sags, and the leads that show",
  "it tell you which wall is talking:",
  "",
  "| Leads        | Wall involved  | Typical artery        |",
  "| ------------ | -------------- | --------------------- |",
  "| V1–V4        | Anterior       | Left anterior descending |",
  "| II, III, aVF | Inferior       | Right coronary        |",
  "| I, aVL, V5–V6 | Lateral       | Circumflex            |",
  "",
  "> [!EXAMPLE]",
  "> Exercise: take any strip in this chapter and answer the five questions",
  "> aloud in under sixty seconds. Speed is the skill.",
  "",
].join("\n");

const CYBERSEC = [
  "# The Blue Team Field Manual",
  "",
  "*Practical defense engineering for people who ship secure systems in 2026.*",
  "",
  '<div class="book-meta">',
  "Publisher: OPSEC Books",
  "Author: S. Analyst",
  "Level: Intermediate to advanced",
  "Edition: First edition, 2026",
  "</div>",
  "",
  '<div class="copyright-page">',
  "Copyright © 2026 OPSEC Books. All rights reserved.",
  "No part of this book may be reproduced, stored in a retrieval system, or",
  "transmitted in any form without prior written permission of the publisher.",
  "ISBN 978-0-000-000-0",
  "Set in Inter and JetBrains Mono.",
  "</div>",
  "",
  '<div class="dedication">',
  "For the defenders who read logs at 3 a.m.",
  "</div>",
  "",
  "[TOC]",
  "",
  "# Preface",
  "",
  "Security is not a feature you add at the end. It is a property of how a",
  "system is designed, built, operated and decommissioned. This book is a",
  "field manual for the people who make that happen: engineers, analysts,",
  "incident responders, and the managers who defend them.",
  "",
  "Every chapter pairs a defensive concept with concrete, runnable examples.",
  "By the end you will have built a small detection lab, written a threat",
  "model that people actually use, and run a detection that fires on real",
  "adversary behavior.",
  "",
  "# Introduction",
  "",
  "The defender's job is asymmetric: the attacker only needs one way in,",
  "while the defender must cover every door, window and heat vent. This book",
  "teaches the discipline that makes that impossible job *slightly* more",
  "fair: visibility, automation, and a bias toward boring, repeatable",
  "controls.",
  "",
  "> [!NOTE]",
  "> You do not need to be a penetration tester to benefit from this book.",
  "> The mindset matters more than the toolkit.",
  "",
  "# Chapter 1. Understanding the Adversary",
  "",
  "## Why attackers behave the way they do",
  "",
  "Every intrusion is a sequence of decisions under uncertainty. Attackers",
  "take the path of least resistance that still achieves their objective.",
  "Your job is to make every path expensive, observable, or both.",
  "",
  "> [!IMPORTANT]",
  "> An attacker's objective is rarely \"the box\". It is the data, the",
  "> reputation, or the keys to the kingdom beyond. Model objectives first.",
  "",
  "### The kill chain in practice",
  "",
  "A modern intrusion rarely maps neatly to a single kill-chain variant.",
  "The intention matters more than the name. Use the chain as a checklist,",
  "not a religion:",
  "",
  "| Stage            | Defensive signal                         | Example control          |",
  "| ---------------- | ---------------------------------------- | ------------------------ |",
  "| Reconnaissance   | Port scans, DNS queries                  | Network detection, honeypots |",
  "| Initial access   | Phishing, exposed services               | MFA, email filtering     |",
  "| Execution        | Script interpreters, macros              | AppLocker, EDR          |",
  "| Persistence      | Scheduled tasks, services                | Registry/startup monitoring |",
  "| Exfiltration     | Large outbound transfers                 | DLP, egress filtering    |",
  "",
  "## Defensible assumptions",
  "",
  "Start from a paranoid but useful baseline. Most teams settle on three",
  "assumptions they can actually defend:",
  "",
  "1. **Compromise is inevitable.** The question is *when*, not *if*.",
  "2. **Speed matters.** Detection time beats detection completeness.",
  "3. **Evidence is perishable.** Collect now, analyze later.",
  "",
  "> [!BEST-PRACTICE]",
  "> Write your assumptions down. When a decision is contested, the written",
  "> baseline is what you fall back to, not a memory.",
  "",
  "---",
  "",
  "## Threat modeling",
  "",
  "A threat model is a working document, not a deliverable that dies in a",
  "ticketing system. Keep it short enough to read in one sitting.",
  "",
  "### The four questions",
  "",
  "1. What are we building?",
  "2. What can go wrong?",
  "3. What will we do about it?",
  "4. How will we know it worked?",
  "",
  "> [!CAUTION]",
  "> A threat model that nobody reads is worse than none: it creates a",
  "> false sense of coverage.",
  "",
  "```mermaid-ish",
  "Workflow:",
  "  Attacker -> Perimeter -> Service -> Database -> Backup",
  "  Ensure: MFA, WAF, least privilege, encrypted backups",
  "```",
  "",
  "# Chapter 2. Building a Detection Lab",
  "",
  "## Ingredients",
  "",
  "A detection lab is the cheapest thing that still catches real attacker",
  "behavior. You need:",
  "",
  "- A way to generate attacker telemetry (a small red-team agent)",
  "- A way to collect and store it (a log pipeline)",
  "- A way to ask questions of it (a query layer)",
  "- A way to know it still works (tests)",
  "",
  "## Collecting telemetry",
  "",
  "Start with the sources that answer the highest-value questions:",
  "",
  "| Source                        | Gives you                       |",
  "| ----------------------------- | ------------------------------- |",
  "| Authentication logs           | Credential abuse, brute force   |",
  "| Process creation              | Execution chains                |",
  "| Network egress                | Beaconing, exfiltration         |",
  "| File system (rarely)          | Ransomware-landing indicators   |",
  "",
  "```bash",
  "# example: tail auth into a structured stream",
  "tail -F /var/log/auth.log \\",
  "  | grep -E 'Failed|Accepted' \\",
  "  | jq -R '{src: inputs, ts: now}'",
  "```",
  "",
  "> [!TIP]",
  "> Centralize with a schema from day one. Reshaping logs later is the most",
  "> expensive migration in security.",
  "",
  "## Your first detection",
  "",
  "A detection is a question with a threshold and a destination. Start",
  "simple: detect `dmesg`-style anomalies in authentication velocity.",
  "",
  "```python",
  "from dataclasses import dataclass",
  "",
  "@dataclass",
  "class AuthEvent:",
  "    username: str",
  "    host: str",
  "    ok: bool",
  "    ts: float",
  "",
  "def detect_spray(events, window=300, threshold=15):",
  "    buckets = defaultdict(int)",
  "    for e in events:",
  "        if not e.ok:",
  "            buckets[e.username, e.host] += 1",
  "    return [k for k, n in buckets.items() if n >= threshold]",
  "```",
  "",
  "> [!EXAMPLE]",
  "> Exercise: extend the detector to require distinct source IPs, then add",
  "> a rule that fires once per hour per host instead of once per event.",
  "",
  "---",
  "",
  "## Testing detections",
  "",
  "Detections rot. Log formats change, fields get renamed, and analysts",
  "age out. Treat detection logic like code:",
  "",
  "- Commit it",
  "- Test it",
  "- Document the alert we expect",
  "",
  "> [!TIP]",
  "> A detection with no test is a hypothesis. A detection with a test is a",
  "> control.",
  "",
  "# Chapter 3. Defeating the Common Paths",
  "",
  "## Credential abuse",
  "",
  "Most breaches still involve a valid credential. The single highest-ROI",
  "control is phishing-resistant authentication for anything that touches",
  "customer data.",
  "",
  "### What good looks like",
  "",
  "1. MFA on every interactive sign-in",
  "2. Device trust before access",
  "3. Session risk scoring",
  "4. Stepped-up auth on sensitive actions",
  "",
  "> [!WARNING]",
  "> SMS-based MFA stops casual credential stuffing, not a motivated",
  "> adversary with a SIM-swap. Plan for phishing-resistant factors.",
  "",
  "## Exposure management",
  "",
  "You cannot protect what you do not know exists. Maintain a live inventory",
  "of:",
  "",
  "- Every listening port",
  "- Every SSL cert and its expiry",
  "- Every public repo and CI token",
  "- Every admin account",
  "",
  "```bash",
  "# example: enumerate external attack surface from a known domain",
  "echo 'www.example.com' \\",
  "  | nmap -sV -T4 -p- - --top-ports 100",
  "```",
  "",
  "## Secure defaults",
  "",
  "Boring wins. Turn off what you don't need, introduce least privilege by",
  "default, and make privilege escalation an explicit, audited event.",
  "",
  "> [!BEST-PRACTICE]",
  "> The best defensive control is the one nobody has to think about.",
  "",
  "# Chapter 4. Response and Recovery",
  "",
  "## Golden hour",
  "",
  "The first hour of an incident sets the tone. Have a simple, rehearsed",
  "playbook and a single named incident commander.",
  "",
  "## Stages",
  "",
  "1. Contain",
  "2. Investigate",
  "3. Remediate",
  "4. Communicate",
  "5. Learn",
  "",
  "> [!IMPORTANT]",
  "> Containment is not punishment. Do not let incident response turn into a",
  "> forensic witch hunt; every minute spent hunting blame is a minute the",
  "> adversary keeps using the access you just found.",
  "",
  "### A minimal playbook",
  "",
  "```text",
  "1. Identify scope (hosts + accounts) to the best of current knowledge",
  "2. Isolate the host from the network but preserve memory and logs",
  "3. Reset credentials for every account touched by the attacker",
  "4. Open a timeline; collect evidence in order of volatility",
  "5. Communicate to leadership in plain words, not jargon",
  "```",
  "",
  "## After-action",
  "",
  "The incident is not over when the alert clears. It is over when the team",
  "has written one paragraph about what worked and one about what failed.",
  "",
  "> [!EXAMPLE]",
  "> Exercise: turn one of your real near-misses into a detection test.",
  "",
  "# Appendix A. Reference Tables",
  "",
  "## Severity rubric",
  "",
  "Use one rubric everywhere so that two analysts triage the same alert the",
  "same way.",
  "",
  "| Level  | Meaning                              | SLA        |",
  "| ------ | ------------------------------------ | ---------- |",
  "| S1     | Active, verified compromise          | 15 minutes |",
  "| S2     | High-probability indicator           | 1 hour     |",
  "| S3     | Suspicious but unconfirmed            | 4 hours    |",
  "| S4     | Informational / baseline noise        | 24 hours   |",
  "",
  "## Log quick-reference",
  "",
  "| Field       | Example                 | Why it matters        |",
  "| ----------- | ----------------------- | --------------------- |",
  "| event.time  | 2026-01-15T03:12:44Z   | Correlations need clocks |",
  "| actor.id    | svc-db-01              | Attribution           |",
  "| target      | db-replica-a/3306      | Scope                 |",
  "| outcome     | fail                   | Baseline deviations   |",
  "",
].join("\n");

export const TEMPLATES: BookTemplate[] = [
  {
    id: "trauma",
    label: "Trauma Book",
    description: "Trauma & recovery — therapeutic edition, print-ready (6×9)",
        style: THERAPEUTIC_FONTS + BASE_CSS + THEME_TRAUMA + THERAPEUTIC_COMPONENTS_CSS,
    content: TRAUMA,
  },
  {
    id: "psychology",
    label: "Psychology Book",
    description: "Healing workbook — cream paper, sage palette, gentle serif",
        style: THERAPEUTIC_FONTS + BASE_CSS + THEME_PSYCHOLOGY + THERAPEUTIC_COMPONENTS_CSS,
    content: PSYCHOLOGY,
  },
  {
    id: "technical",
    label: "Programming Book",
    description: "Programming book with auto TOC, callouts and code styling",
    style: TECHNICAL_FONTS + BASE_CSS + THEME_TECHNICAL + THERAPEUTIC_COMPONENTS_CSS,
    content: TECHNICAL,
  },
  {
    id: "slate",
    label: "Programming Book — Slate",
    description: "Dark code panels, amber accents, modern slate typography",
    style: TECHNICAL_FONTS + BASE_CSS + THEME_TECHNICAL + THEME_SLATE_MODERN + THERAPEUTIC_COMPONENTS_CSS,
    content: TECHNICAL,
  },
  {
    id: "cybersec",
    label: "Cybersecurity Book",
    description: "Blue-team field manual — terminal code panels, severity callouts",
    style: CYBERSEC_FONTS + BASE_CSS + THEME_CYBERSEC + THERAPEUTIC_COMPONENTS_CSS,
    content: CYBERSEC,
  },
  {
    id: "medical",
    label: "Medical Study Guide",
    description: "Illustrated clinical reference — ECG-grid figures, teal accents, caution callouts",
    style: MEDICAL_FONTS + BASE_CSS + THEME_MEDICAL + THERAPEUTIC_COMPONENTS_CSS,
    content: MEDICAL,
  },
];

export function getTemplate(id: string): BookTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
