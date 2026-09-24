/**
 * Therapeutic block directives, ported from trauma-book-template.
 *
 * Syntax:
 *   ::: name attr="value"   ← opens a block (attrs optional)
 *   ...markdown...
 *   :::                     ← closes the innermost open block
 *
 * Supported blocks (rendered with the template's therapeutic components):
 *   tool      numbered therapeutic tool with Purpose / Why This Matters /
 *             How To Use / Reflection Questions / Practice / Journal Space
 *             sections (bold labels inside the block)
 *   worksheet title + purpose + writing lines (___)
 *   reflection  reflection exercise: before-text + numbered questions
 *   diagram   vertical flow: nodes are lines, ↓ is the arrow connector;
 *             `highlight="node"` accentuates one node (e.g. "Healing")
 *   summary   chapter summary: #### What You Learned / Key Takeaways /
 *             Practice For This Week become labeled groups
 *   quote     centered highlighted phrase, optional by="author"
 *
 * A single line of 3+ underscores (___) inside any block becomes a
 * full-width writing line (the renderer maps it to <p class="md-write-line">).
 */

export type DirectiveParser = {
  /** Parse inline markdown (bold, links, code…) to HTML. */
  parseInline: (text: string) => string;
};

const WRITE_LINE_HTML = '<p class="md-write-line"></p>';

const OPEN_RE = /^:::\s*([a-zA-Z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*$/;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

function attr(attrs: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    if (attrs[key]) return attrs[key];
  }
  return "";
}

/** Inline-render a line, honoring a leading bold label like **Purpose:** */
function rich(line: string, parser: DirectiveParser): string {
  return parser.parseInline(line.trim());
}

/** Group tool-section lines under their bold labels into labeled paragraphs. */
function toolSections(
  lines: string[],
  parser: DirectiveParser,
): string {
  const out: string[] = [];
  let label = "";
  let buf: string[] = [];
  const flush = () => {
    if (!label && buf.length === 0) return;
    const body = buf
      .map((l) => {
        if (/^_{3,}\s*$/.test(l.trim())) return WRITE_LINE_HTML;
        const bullet = /^[-*]\s+(.*)$/.exec(l.trim());
        if (bullet) {
          return `<li>${parser.parseInline(bullet[1])}</li>`;
        }
        const ordered = /^(\d+)[.)]\s+(.*)$/.exec(l.trim());
        if (ordered) {
          return `<li data-n="${ordered[1]}">${parser.parseInline(ordered[2])}</li>`;
        }
        return `<p>${rich(l, parser)}</p>`;
      })
      .join("");
    const isList = /^\s*<(li\b|p class="md-write-line")/.test(body);
    out.push(
      `<div class="tool-section${label ? "" : " tool-section-plain"}">` +
        (label
          ? `<p class="tool-label">${escapeHtml(label)}</p>`
          : "") +
        (isList ? `<ul class="tool-list">${body}</ul>` : body) +
        `</div>`,
    );
    label = "";
    buf = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const labeled = /^\*\*(.+?):?\*\*:?(.*)$/.exec(line);
    if (labeled && labeled[1].length < 60) {
      flush();
      label = labeled[1].replace(/:$/, "");
      if (labeled[2].trim()) buf.push(labeled[2]);
      continue;
    }
    if (line.length === 0) {
      // blank line: keep section content flowing
      if (buf.length > 0 && buf[buf.length - 1] !== "") buf.push("");
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function processDirectives(
  markdown: string,
  parser: DirectiveParser,
): string {
  if (!/^\s*:::/m.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];

  type Open = { name: string; attrs: Record<string, string>; lines: string[] };
  const stack: Open[] = [];
  let toolNo = 0;

  const closeTop = () => {
    const top = stack.pop();
    if (!top) return;
    const rendered = renderBlock(top, parser);
    if (stack.length > 0) stack[stack.length - 1].lines.push(rendered);
    else out.push(rendered);
  };

  for (const line of lines) {
    const open = OPEN_RE.exec(line.trim());
    if (open) {
      const name = open[1].toLowerCase();
      const attrs = parseAttrs(open[2] ?? "");
      if (name === "tool") {
        toolNo += 1;
        if (attrs.number === undefined) attrs.number = String(toolNo).padStart(2, "0");
      }
      stack.push({ name, attrs, lines: [] });
      continue;
    }
    if (/^:::\s*$/.test(line.trim())) {
      closeTop();
      continue;
    }
    if (stack.length > 0) stack[stack.length - 1].lines.push(line);
    else out.push(line);
  }
  while (stack.length > 0) closeTop();
  return out.join("\n");
}

function renderBlock(
  block: { name: string; attrs: Record<string, string>; lines: string[] },
  parser: DirectiveParser,
): string {
  const { name, attrs, lines } = block;
  const body = lines;

  switch (name) {
    case "tool": {
      const number = attr(attrs, "number") || "01";
      const title = attr(attrs, "title") || "Therapeutic tool";
      return (
        `<section class="tool">` +
        `<p class="tool-number">Tool #${escapeHtml(number)}</p>` +
        `<h3 class="tool-name">${escapeHtml(title)}</h3>` +
        `<div class="tool-body">${toolSections(body, parser)}</div>` +
        `</section>`
      );
    }
    case "worksheet": {
      const title = attr(attrs, "title") || "Worksheet";
      const purpose = attr(attrs, "purpose");
      return (
        `<section class="worksheet">` +
        `<p class="worksheet-label">Worksheet</p>` +
        `<h3 class="worksheet-title">${escapeHtml(title)}</h3>` +
        (purpose
          ? `<p class="worksheet-purpose">${escapeHtml(purpose)}</p>`
          : "") +
        `<div class="worksheet-body">${bodyContent(body, parser)}</div>` +
        `</section>`
      );
    }
    case "reflection": {
      const title = attr(attrs, "title") || "Reflection exercise";
      const before = attr(attrs, "before");
      return (
        `<section class="reflection">` +
        `<h3 class="reflection-title">${escapeHtml(title)}</h3>` +
        (before
          ? `<p class="reflection-before">${escapeHtml(before)}</p>`
          : "") +
        `<div class="reflection-body">${numberedQuestions(body, parser)}</div>` +
        `</section>`
      );
    }
    case "diagram": {
      const caption = attr(attrs, "caption");
      const highlight = (attr(attrs, "highlight") || "healing").toLowerCase();
      const nodes: string[] = [];
      for (const raw of body) {
        const line = raw.trim();
        if (!line) continue;
        if (/^[↓|v]+$/.test(line)) {
          nodes.push(`<div class="diagram-arrow" aria-hidden="true">↓</div>`);
          continue;
        }
        const nodeHtml = parser.parseInline(line);
        const isHot = line.toLowerCase().includes(highlight) && highlight !== "";
        nodes.push(
          `<div class="diagram-node${isHot ? " diagram-node-hot" : ""}">${nodeHtml}</div>`,
        );
      }
      return (
        `<figure class="diagram">` +
        `<div class="diagram-flow">${nodes.join("")}</div>` +
        (caption
          ? `<figcaption class="diagram-caption">${escapeHtml(caption)}</figcaption>`
          : "") +
        `</figure>`
      );
    }
    case "summary": {
      const groups: { label: string; items: string[] }[] = [];
      let current: { label: string; items: string[] } | null = null;
      for (const raw of body) {
        const line = raw.trim();
        const heading = /^#{2,5}\s+(.+)$/.exec(line);
        if (heading) {
          current = { label: heading[1].trim(), items: [] };
          groups.push(current);
          continue;
        }
        if (!line) continue;
        if (!current) {
          current = { label: "Summary", items: [] };
          groups.push(current);
        }
        current.items.push(line);
      }
      const sections = groups
        .map((g) => {
          const items = g.items
            .map((l) => {
              const t = l.trim();
              if (/^_{3,}\s*$/.test(t)) return WRITE_LINE_HTML;
              const bullet = /^[-*]\s+(.*)$/.exec(t);
              if (bullet) return `<li>${parser.parseInline(bullet[1])}</li>`;
              return `<p>${rich(l, parser)}</p>`;
            })
            .join("");
          const isList = /^<li\b/.test(items);
          return (
            `<div class="summary-group">` +
            `<p class="summary-label">${escapeHtml(g.label)}</p>` +
            (isList ? `<ul class="summary-list">${items}</ul>` : items) +
            `</div>`
          );
        })
        .join("");
      return (
        `<section class="summary">` +
        `<p class="summary-kicker">Chapter Summary</p>` +
        (sections || "") +
        `</section>`
      );
    }
    case "quote": {
      const by = attr(attrs, "by");
      const text = body
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `<p>${rich(l, parser)}</p>`)
        .join("");
      return (
        `<blockquote class="feature-quote">` +
        text +
        (by ? `<p class="quote-by">— ${parser.parseInline(by)}</p>` : "") +
        `</blockquote>`
      );
    }
    default: {
      // Unknown directive: render as a generic callout box so content is
      // never lost.
      const title = attr(attrs, "title") || name;
      return (
        `<div class="callout callout-note">` +
        `<p class="callout-title">${escapeHtml(title)}</p>` +
        `<div class="callout-content">${bodyContent(body, parser)}</div>` +
        `</div>`
      );
    }
  }
}

/** Render plain markdown-ish block content (paragraphs, lists, write lines). */
function bodyContent(lines: string[], parser: DirectiveParser): string {
  const out: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^_{3,}\s*$/.test(line)) {
      closeList();
      out.push(WRITE_LINE_HTML);
      continue;
    }
    if (!line) {
      closeList();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      if (!listOpen) {
        out.push('<ul class="directive-list">');
        listOpen = true;
      }
      out.push(`<li>${parser.parseInline((bullet ?? ordered)![1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${rich(line, parser)}</p>`);
  }
  closeList();
  return out.join("");
}

/** Numbered questions with a writing line after each one. */
function numberedQuestions(lines: string[], parser: DirectiveParser): string {
  const out: string[] = [];
  let n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^_{3,}\s*$/.test(line) || !line) continue;
    n += 1;
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    const text = ordered ? ordered[2] : line;
    out.push(
      `<div class="reflection-q">` +
        `<p class="reflection-question"><span class="reflection-num">${n}</span>${parser.parseInline(text)}</p>` +
        WRITE_LINE_HTML +
        `</div>`,
    );
  }
  return out.join("");
}

/** Demo markdown exercising every directive (used by the "Example" button). */
export const DIRECTIVE_EXAMPLE = [
  "# Grounding Skills",
  "",
  "This chapter demonstrates the therapeutic components. Every block below",
  "is plain markdown with `:::` directives — no HTML involved.",
  "",
  '::: tool number="01" title="Grounding 5-4-3-2-1"',
  "**Purpose:** Interrupt dissociation or spiraling anxiety by anchoring",
  "attention in the present moment through the five senses.",
  "**Why This Matters:** Panic lives in the past and the future; the senses",
  "only exist now. Sensory attention downshifts the amygdala.",
  "**How To Use:**",
  "- Name 5 things you can see",
  "- 4 things you can feel",
  "- 3 things you can hear",
  "- 2 things you can smell",
  "- 1 thing you can taste",
  "**Journal Space:**",
  "After practicing, what shifted in your body?",
  "___",
  ":::",
  "",
  '::: worksheet title="Trigger Identification" purpose="Map the situations, sensations and thoughts that precede a strong reaction."',
  "Trigger situation (who, where, when)",
  "___",
  "Body sensations I notice first",
  "___",
  "The story my mind tells",
  "___",
  "One grounding strategy I will try next time",
  "___",
  ":::",
  "",
  "::: diagram caption=\"The trauma response cycle — regulation turns survival into healing\" highlight=\"Healing\"",
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
  "::: reflection title=\"Reflection exercise\" before=\"Take three slow breaths before answering. There are no wrong answers.\"",
  "What does safety feel like in my body?",
  "Who helps my nervous system settle?",
  "What is one boundary I can practice this week?",
  ":::",
  "",
  "::: quote by=\"Peter A. Levine\"",
  "Trauma is a fact of life. It does not, however, have to be a life sentence.",
  ":::",
  "",
  "::: summary",
  "#### What You Learned",
  "- Grounding interrupts the survival loop through the senses",
  "#### Key Takeaways",
  "- Safety precedes processing",
  "- The body is an entry point to regulation",
  "#### Practice For This Week",
  "Use 5-4-3-2-1 once a day, even on calm days.",
  "___",
  ":::",
  "",
].join("\n");
