/**
 * Convert JSON content into structured Markdown that the book renderer
 * understands (headings, part/chapter pages, paragraphs, lists, tables,
 * blockquotes, callouts, writing lines, table of contents), so the existing
 * templates, preview and DOCX/HTML/PDF exports apply unchanged — at parity
 * with hand-written Markdown.
 *
 * Two strategies:
 *  - Book schema: `{ title, author?, parts?, chapters: [...] }` → full book
 *    layout (part pages, chapter pages, sections, callouts, write lines,
 *    TOC, takeaways, resources).
 *  - Generic: any other JSON → sections/tables/lists keyed by property names.
 */

export type JsonConversionResult = {
  markdown: string;
  error: string | null;
};

type Json = unknown;

const SECTION_GROUP_KEYS = [
  "sections",
  "subsections",
  "lessons",
  "modules",
] as const;
const EXERCISE_KEYS = ["exercises", "tools", "worksheets", "activities"] as const;
const IMAGE_FIELD_KEYS = [
  "image",
  "cover",
  "photo",
  "figure",
  "illustration",
  "diagram",
  "imagen",
] as const;
const LIST_KEYS = [
  "keyTakeaways",
  "key_takeaways",
  "takeaways",
  "keyPoints",
  "key_points",
  "objectives",
  "highlights",
  "principles",
  "signs",
  "symptoms",
  "strategies",
  "practices",
  "tips",
] as const;
const NUMBERED_KEYS = [
  "resources",
  "references",
  "bibliography",
  "furtherReading",
  "further_reading",
  "recommendedReading",
] as const;

/** JSON keys that map to `> [!KIND]` callout blocks (the same ones the
 *  Markdown renderer understands: note, tip, important, warning, caution,
 *  best-practice, error, example). */
const CALLOUT_KINDS: [string, string][] = [
  ["note", "note"],
  ["notes", "note"],
  ["info", "note"],
  ["tip", "tip"],
  ["tips", "tip"],
  ["important", "important"],
  ["importantNote", "important"],
  ["warning", "warning"],
  ["warnings", "warning"],
  ["caution", "caution"],
  ["cautions", "caution"],
  ["bestPractice", "best-practice"],
  ["best_practice", "best-practice"],
  ["error", "error"],
  ["errors", "error"],
  ["example", "example"],
  ["examples", "example"],
];

/** JSON keys that become full-width writing lines (`___`) under a prompt. */
const WRITE_LINE_KEYS = [
  "journal",
  "reflection",
  "journalPrompts",
  "journal_prompts",
  "writingPrompts",
  "writing_prompts",
  "reflectionPrompts",
  "reflection_prompts",
] as const;

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const table: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let s = "";
  for (const [value, symbol] of table) {
    while (n >= value) {
      s += symbol;
      n -= value;
    }
  }
  return s;
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function inline(value: Json): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => inline(v))
      .filter((s) => s !== "—")
      .join(", ");
  }
  return Object.entries(value)
    .map(([k, v]) => `${humanize(k)}: ${inline(v)}`)
    .join("; ");
}

function cell(value: Json): string {
  return inline(value).replace(/\|/g, "\\|");
}

function heading(level: number, text: string): string {
  return `${"#".repeat(Math.max(2, Math.min(level, 4)))} ${text}`;
}

function firstString(obj: Record<string, Json>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** A JSON string that actually points at an image → Markdown image syntax.
 *  Accepts file names ("brain-map.png" — resolved from uploaded images),
 *  data URLs (images embedded directly in the JSON) and ready `![alt](src)`. */
function imageMarkdown(key: string, value: Json): string | null {
  if (typeof value !== "string") return null;
  const src = value.trim();
  if (!src || /\s/.test(src)) return null;
  if (/^!\[[^\]]*\]\([^)]+\)$/.test(src)) return src;
  const pathOnly = src.split(/[?#]/)[0];
  const isImagePath = /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(pathOnly);
  const isDataUrl = /^data:image\//i.test(src);
  if (!isImagePath && !isDataUrl) return null;
  return `![${key ? humanize(key) : "Image"}](${src})`;
}

/** Render the first image-valued field among `keys` as a real image. */
function pushImageFields(
  obj: Record<string, Json>,
  keys: readonly string[],
  out: string[],
): void {
  for (const key of keys) {
    const img = imageMarkdown(key, obj[key]);
    if (img) {
      out.push(img, "");
      return;
    }
  }
}

function uniformTable(rows: Record<string, Json>[]): string | null {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]).filter((k) => rows.every((r) => k in r));
  if (keys.length === 0) return null;
  const header = `| ${keys.map((k) => cell(humanize(k))).join(" | ")} |`;
  const divider = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${keys.map((k) => cell(row[k])).join(" | ")} |`)
    .join("\n");
  return [header, divider, body].join("\n");
}

function renderArray(rows: Json[], level: number, out: string[]): void {
  const objects = rows.filter(isPlainObject);
  if (rows.length > 0 && objects.length === rows.length) {
    const table = uniformTable(objects);
    if (table) {
      out.push(table, "");
      return;
    }
  }
  if (
    rows.length > 0 &&
    rows.every((r) => typeof r === "string" || typeof r === "number")
  ) {
    for (const r of rows) {
      const img = typeof r === "string" ? imageMarkdown("", r) : null;
      if (img) out.push(img, "");
      else out.push(`- ${inline(r)}`);
    }
    out.push("");
    return;
  }
  for (const row of rows) renderContent(row, level, out);
}

/** Body prose: strings (and arrays of strings) become paragraphs instead
 *  of bullet lists, matching hand-written Markdown. */
function renderProse(value: Json, out: string[]): void {
  if (typeof value === "string") {
    out.push(value.trim(), "");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") out.push(item.trim(), "");
      else renderContent(item, 2, out);
    }
    return;
  }
  renderContent(value, 2, out);
}

/** Generic object → `**Key:** value` lines plus nested sections. */
function renderObject(
  obj: Record<string, Json>,
  level: number,
  out: string[],
): void {
  const scalars: [string, Json][] = [];
  const complex: [string, Json][] = [];
  const images: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === "") continue;
    const img = imageMarkdown(key, value);
    if (img) {
      images.push(img);
      continue;
    }
    (isPlainObject(value) || Array.isArray(value) ? complex : scalars).push([
      key,
      value,
    ]);
  }
  for (const img of images) out.push(img, "");
  for (const [key, value] of scalars) {
    out.push(`**${humanize(key)}:** ${inline(value)}`);
  }
  if (scalars.length > 0) out.push("");
  for (const [key, value] of complex) {
    out.push(heading(level + 1, humanize(key)), "");
    renderContent(value, Math.min(level + 1, 3), out);
  }
}

function renderContent(value: Json, level: number, out: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    const img = imageMarkdown("", value);
    if (img) {
      out.push(img, "");
      return;
    }
    out.push(value.trim(), "");
    return;
  }
  if (Array.isArray(value)) {
    renderArray(value, level, out);
    return;
  }
  // Remaining values from parsed JSON are plain objects.
  renderObject(value as Record<string, Json>, level, out);
}

function pushBulletList(items: Json[], out: string[]): void {
  for (const item of items) {
    if (isPlainObject(item)) {
      const title =
        firstString(item, ["title", "name", "label"]) || inline(item);
      const rest = Object.entries(item).filter(
        ([k]) => k !== "title" && k !== "name" && k !== "label",
      );
      if (rest.length === 0) {
        out.push(`- ${title}`);
      } else {
        out.push(`- **${title}**`);
        for (const [k, v] of rest) out.push(`  - ${humanize(k)}: ${inline(v)}`);
      }
    } else {
      out.push(`- ${inline(item)}`);
    }
  }
  out.push("");
}

function pushNumberedList(items: Json[], out: string[]): void {
  items.forEach((item, i) => {
    if (isPlainObject(item)) {
      const title =
        firstString(item, ["title", "name", "author"]) || inline(item);
      const rest = Object.entries(item).filter(
        ([k]) => k !== "title" && k !== "name",
      );
      out.push(`${i + 1}. ${rest.length > 0 ? `**${title}**` : title}`);
      for (const [k, v] of rest) out.push(`   - ${humanize(k)}: ${inline(v)}`);
    } else {
      out.push(`${i + 1}. ${inline(item)}`);
    }
  });
  out.push("");
}

function renderCallout(out: string[], kind: string, text: string): void {
  const body = text.split(/\n+/).filter((l) => l.trim());
  out.push(`> [!${kind}]`);
  for (const line of body) out.push(`> ${line.trim()}`);
  out.push("");
}

function renderCalloutFields(
  obj: Record<string, Json>,
  out: string[],
): void {
  for (const [key, kind] of CALLOUT_KINDS) {
    const value = obj[key];
    if (value === null || value === undefined || value === "") continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (typeof item === "string") {
        renderCallout(out, kind, item);
      } else if (isPlainObject(item)) {
        const text =
          firstString(item, ["text", "content", "body", "message", "title"]) ||
          inline(item);
        if (text) renderCallout(out, kind, text);
      }
    }
  }
}

function renderWriteLines(
  obj: Record<string, Json>,
  level: number,
  out: string[],
): void {
  for (const key of WRITE_LINE_KEYS) {
    const value = obj[key];
    if (value === null || value === undefined || value === "") continue;
    out.push(heading(level, humanize(key)), "");
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (typeof item === "number") {
        const n = Math.max(1, Math.min(item, 12));
        for (let i = 0; i < n; i++) out.push("___", "");
      } else if (typeof item === "string") {
        out.push(item, "");
        out.push("___", "");
      } else if (isPlainObject(item)) {
        const prompt = firstString(item, ["prompt", "question", "text", "title"]);
        const lines =
          typeof item.lines === "number"
            ? Math.max(1, Math.min(item.lines, 12))
            : 1;
        if (prompt) out.push(prompt, "");
        for (let i = 0; i < lines; i++) out.push("___", "");
      }
    }
  }
}

const pushSteps = (steps: Json[], out: string[]): void => {
  steps.forEach((step, i) => out.push(`${i + 1}. ${inline(step)}`));
  out.push("");
};

function renderNamedCollections(
  obj: Record<string, Json>,
  level: number,
  out: string[],
): void {
  renderCalloutFields(obj, out);
  for (const key of LIST_KEYS) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    out.push(heading(level, humanize(key)), "");
    pushBulletList(value, out);
  }
  for (const key of NUMBERED_KEYS) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    out.push(heading(level, humanize(key)), "");
    pushNumberedList(value, out);
  }
  for (const key of EXERCISE_KEYS) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    value.forEach((item, i) => {
      if (isPlainObject(item)) {
        const title =
          firstString(item, ["title", "name"]) || `${humanize(key)} ${i + 1}`;
        out.push(heading(level + 1, title), "");
        const rest = { ...item };
        delete rest.title;
        delete rest.name;
        if (Array.isArray(rest.steps)) {
          pushSteps(rest.steps as Json[], out);
        } else {
          renderObject(rest, Math.min(level + 1, 3), out);
        }
      } else {
        out.push(`- ${inline(item)}`);
      }
    });
    out.push("");
  }
  renderWriteLines(obj, Math.min(level, 3), out);
}

const FRONT_SECTIONS: [string, string][] = [
  ["preface", "Preface"],
  ["foreword", "Foreword"],
  ["introduction", "Introduction"],
  ["howToUse", "How to use this book"],
  ["how_to_use", "How to use this book"],
  ["aboutThisBook", "About this book"],
  ["about_this_book", "About this book"],
];

function renderChapterSection(
  section: Json,
  index: number,
  out: string[],
): void {
  if (typeof section === "string") {
    out.push(heading(3, section), "");
    return;
  }
  if (!isPlainObject(section)) return;
  const title = firstString(section, ["title", "name", "heading"]) || `${index + 1}`;
  out.push(heading(3, title), "");
  const intro = firstString(section, [
    "intro",
    "introduction",
    "summary",
    "description",
    "overview",
  ]);
  if (intro) out.push(intro, "");
  if ("content" in section) renderProse(section.content, out);
  else if ("body" in section) renderProse(section.body, out);
  renderNamedCollections(section, 4, out);
}

function renderChapter(raw: Json, index: number, out: string[]): void {
  if (typeof raw === "string") {
    out.push(heading(2, `Chapter ${index + 1}. ${raw}`), "");
    return;
  }
  if (!isPlainObject(raw)) return;
  const title = firstString(raw, ["title", "name", "chapter", "heading"]);
  out.push(heading(2, title ? `Chapter ${index + 1}. ${title}` : `Chapter ${index + 1}`), "");
  const subtitle = firstString(raw, ["subtitle", "tagline", "quote"]);
  if (subtitle) out.push(`*${subtitle}*`, "");
  const intro = firstString(raw, [
    "intro",
    "introduction",
    "summary",
    "description",
    "overview",
  ]);
  if (intro) out.push(intro, "");
  pushImageFields(raw, IMAGE_FIELD_KEYS, out);
  if ("content" in raw) renderProse(raw.content, out);
  else if ("body" in raw) renderProse(raw.body, out);
  else if (Array.isArray(raw.paragraphs)) {
    renderProse(raw.paragraphs, out);
  }
  for (const key of SECTION_GROUP_KEYS) {
    const sections = raw[key];
    if (!Array.isArray(sections)) continue;
    sections.forEach((section, i) => renderChapterSection(section, i, out));
  }
  renderNamedCollections(raw, 3, out);
}

function renderPartsOrChapters(book: Record<string, Json>, out: string[]): void {
  let chapterIndex = 0;
  const renderOne = (chapter: Json): void => {
    renderChapter(chapter, chapterIndex, out);
    chapterIndex += 1;
  };

  if (Array.isArray(book.parts) && book.parts.length > 0) {
    book.parts.forEach((part, i) => {
      if (!isPlainObject(part)) return;
      const pTitle =
        firstString(part, ["title", "name", "partTitle", "part_title"]) ||
        `Part ${toRoman(i + 1)}`;
      out.push(`# Part ${toRoman(i + 1)} \u2014 ${pTitle}`, "");
      const partSub = firstString(part, ["subtitle", "intro", "tagline"]);
      if (partSub) out.push(`*${partSub}*`, "");
      pushImageFields(part, ["image", "cover", "photo", "diagram"], out);
      const chapters = Array.isArray(part.chapters) ? part.chapters : [];
      chapters.forEach((chapter) => renderOne(chapter));
      renderNamedCollections(part, 3, out);
    });
    return;
  }

  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const grouped: { title: string; chapters: Json[] }[] = [];
  let current: { title: string; chapters: Json[] } | null = null;
  for (const chapter of chapters) {
    const partLabel = isPlainObject(chapter)
      ? firstString(chapter, ["part", "partTitle", "part_title"])
      : "";
    if (!current || current.title !== partLabel) {
      current = { title: partLabel, chapters: [] };
      grouped.push(current);
    }
    current.chapters.push(chapter);
  }

  const hasParts = grouped.some((g) => g.title);
  if (!hasParts) {
    chapters.forEach((chapter) => renderOne(chapter));
    return;
  }
  let partNum = 0;
  for (const group of grouped) {
    if (!group.title) {
      group.chapters.forEach((chapter) => renderOne(chapter));
      continue;
    }
    partNum += 1;
    out.push(`# Part ${toRoman(partNum)} \u2014 ${group.title}`, "");
    group.chapters.forEach((chapter) => renderOne(chapter));
  }
}

function renderBook(book: Record<string, Json>, out: string[]): void {
  const title = firstString(book, ["title", "name", "bookTitle", "book_title"]);
  const subtitle = firstString(book, ["subtitle", "tagline"]);
  if (title) out.push(`# ${title}`, "");

  const metaKeys = [
    "author",
    "authors",
    "edition",
    "publisher",
    "year",
    "date",
    "language",
    "isbn",
  ];
  const meta = metaKeys
    .filter((k) => book[k] !== null && book[k] !== undefined && book[k] !== "")
    .map((k) => `**${humanize(k)}:** ${inline(book[k])}`);
  if (meta.length > 0) out.push(meta.join("  \n"), "");
  if (subtitle) out.push(`*${subtitle}*`, "");
  pushImageFields(book, ["coverImage", "cover_image", "cover"], out);

  const dedication = firstString(book, ["dedication", "epigraph"]);
  if (dedication) out.push(`> ${dedication}`, "");

  const hasContent =
    (Array.isArray(book.chapters) && book.chapters.length > 0) ||
    (Array.isArray(book.parts) && book.parts.length > 0);
  if (book.toc !== false && hasContent) out.push("[TOC]", "");

  for (const [key, label] of FRONT_SECTIONS) {
    const value = book[key];
    if (typeof value === "string" && value.trim()) {
      out.push(heading(2, label), "", value.trim(), "");
    }
  }

  renderPartsOrChapters(book, out);
  renderNamedCollections(book, 2, out);

  const conclusion = firstString(book, [
    "conclusion",
    "finalThoughts",
    "final_thoughts",
    "closing",
  ]);
  if (conclusion) out.push(heading(2, "Final thoughts"), "", conclusion, "");
  const aboutAuthor = firstString(book, [
    "aboutAuthor",
    "about_the_author",
    "authorBio",
    "author_bio",
  ]);
  if (aboutAuthor) {
    out.push(heading(2, "About the author"), "", aboutAuthor, "");
  }
}

export function jsonToMarkdown(text: string): JsonConversionResult {
  const trimmed = text.trim();
  if (!trimmed) return { markdown: "", error: null };
  let parsed: Json;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      markdown: "",
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
  const out: string[] = [];
  if (
    isPlainObject(parsed) &&
    (Array.isArray(parsed.chapters) || Array.isArray(parsed.parts))
  ) {
    renderBook(parsed, out);
  } else if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(isPlainObject)
  ) {
    renderBook({ chapters: parsed }, out);
  } else {
    renderContent(parsed, 2, out);
  }
  const joined = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { markdown: joined ? `${joined}\n` : "", error: null };
}