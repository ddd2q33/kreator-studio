/**
 * Git-friendly book format shared by the UI, the REST API and the CLI.
 *
 * A book is a folder of individual .md chapter files (one diff per chapter,
 * per paragraph) plus an optional book.json manifest:
 *
 *   book.json           ← { name, templateId, bookMode, chapters[] }
 *   chapters/01-intro.md
 *   chapters/02-building-safety.md
 *
 * The same module can also produce one combined Markdown string (the
 * `<!-- chapter: Title -->` separator format the UI already exports) and the
 * standalone .html document used by /api/preview, /api/convert-docx and the CLI.
 */

import { getTemplate, TEMPLATES } from "../components/templates.ts";
import {
  createMarkdownRenderer,
  titleFromMarkdown,
  type ImageMap,
} from "./render-engine.ts";

export type BookFileChapter = { id: string; title: string; markdown: string };

export type BookFile = {
  name: string;
  templateId: string | null;
  presetId: string | null;
  bookMode: boolean;
  chapters: BookFileChapter[];
};

/** Marker line the UI's Download .md already emits between chapters. */
export const CHAPTER_MARKER_RE = /^<!--\s*chapter:\s*(.*?)\s*-->\s*$/;

function slugifyFile(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[*_`~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${String(index + 1).padStart(2, "0")}-${slug || "chapter"}.md`;
}

export function chapterFileName(title: string, index: number): string {
  return slugifyFile(title, index);
}

/**
 * Parse a combined Markdown document into chapters. Splits on the
 * `<!-- chapter: Title -->` markers; without markers the whole document is a
 * single chapter titled from its first `#` heading.
 */
export function bookFromMarkdown(markdown: string, name = "Book"): BookFile {
  const lines = markdown.split("\n");
  const chapters: BookFileChapter[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const marker = CHAPTER_MARKER_RE.exec(line.trim());
    if (marker) {
      if (current) {
        // Strip the `---` separators markdownFromBook inserts between chapters
        // so bookFromMarkdown(markdownFromBook(book)) round-trips exactly.
        while (
          current.lines.length > 0 &&
          (/^\s*$/.test(current.lines[current.lines.length - 1]) ||
            /^-{3,}$/.test(current.lines[current.lines.length - 1].trim()))
        ) {
          current.lines.pop();
        }
        chapters.push(toChapter(current, chapters.length));
      }
      current = { title: marker[1] || `Chapter ${chapters.length + 1}`, lines: [] };
      continue;
    }
    if (!current) current = { title: "", lines: [] };
    current.lines.push(line);
  }
  if (current) {
    while (
      current.lines.length > 0 &&
      (/^\s*$/.test(current.lines[current.lines.length - 1]) ||
        /^-{3,}$/.test(current.lines[current.lines.length - 1].trim()))
    ) {
      current.lines.pop();
    }
    chapters.push(toChapter(current, chapters.length));
  }

  // Structure is preserved even for blank chapters (a marker with no body is
  // a deliberate empty page — renderBookHtml fills in a placeholder heading);
  // dropping them would silently lose pages on round-trip.
  return {
    name,
    templateId: null,
    presetId: null,
    bookMode: chapters.length > 1,
    chapters,
  };

  function toChapter(
    part: { title: string; lines: string[] },
    index: number,
  ): BookFileChapter {
    const markdown2 = part.lines.join("\n").replace(/^\n+|\s+$/g, "");
    const title =
      part.title ||
      titleFromMarkdown(markdown2) ||
      `Chapter ${index + 1}`;
    return {
      id: `ch-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      markdown: markdown2,
    };
  }
}

/** Combined Markdown with `<!-- chapter: -->` markers (matches the UI export). */
export function markdownFromBook(book: BookFile): string {
  if (!book.bookMode || book.chapters.length <= 1) {
    return book.chapters[0]?.markdown ?? "";
  }
  return book.chapters
    .map(
      (ch) =>
        `<!-- chapter: ${ch.title || "Untitled"} -->\n\n${ch.markdown.trim()}`,
    )
    .join("\n\n---\n\n");
}

/** Parse a book.json manifest (throws with a readable message on bad input). */
export function bookFileFromJson(json: string, fallbackName = "Book"): BookFile {
  const parsed = JSON.parse(json) as Partial<BookFile>;
  // chapters[] is optional: folder/zip loaders supply chapters from separate
  // .md files; single-file manifests embed the markdown directly.
  const chapters = Array.isArray(parsed.chapters)
    ? parsed.chapters
      .filter(
        (c): c is BookFileChapter =>
          !!c && typeof c === "object" && typeof (c as BookFileChapter).markdown === "string",
      )
      .map((c, i) => ({
        id: typeof c.id === "string" ? c.id : `ch-${i + 1}`,
        title: typeof c.title === "string" ? c.title : `Chapter ${i + 1}`,
        markdown: c.markdown,
      }))
    : [];
  return {
    name: typeof parsed.name === "string" ? parsed.name : fallbackName,
    templateId:
      typeof parsed.templateId === "string" ? parsed.templateId : null,
    presetId:
      typeof parsed.presetId === "string" ? parsed.presetId : null,
    bookMode: parsed.bookMode === true || chapters.length > 1,
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Full-document HTML assembly (shared by /api/preview, /api/convert-docx, CLI)
// ---------------------------------------------------------------------------

export type RenderBookResult = {
  /** Body HTML only (what the preview <article> renders). */
  bodyHtml: string;
  /** Complete standalone .html document with the template CSS inlined. */
  fullHtml: string;
  title: string;
  templateId: string;
};

export type RenderBookOptions = {
  templateId?: string;
  /** Extra CSS appended after the template (custom accent/font/width). */
  themeCss?: string;
  images?: ImageMap;
  /** Wrap each chapter in <section class="book-chapter"> (print page breaks). */
  asChapters?: boolean;
};

/** Default template id (first template, same default the UI uses). */
export function defaultTemplateId(): string {
  return TEMPLATES[0]?.id ?? "trauma";
}

/**
 * Render Markdown (combined or marker-separated) into the same standalone
 * HTML document the browser UI produces — one engine, byte-for-byte.
 */
export function renderBookHtml(
  markdown: string,
  options: RenderBookOptions = {},
): RenderBookResult {
  const templateId = options.templateId ?? defaultTemplateId();
  const template = getTemplate(templateId);
  const render = createMarkdownRenderer({ images: options.images });

  let bodyHtml: string;
  let title: string;
  const book = bookFromMarkdown(markdown);
  if (book.chapters.length > 1) {
    bodyHtml = book.chapters
      .map((ch, i) => {
        const md = ch.markdown.trim() ? ch.markdown : `# ${ch.title || `Chapter ${i + 1}`}`;
        return `<section class="book-chapter">\n${render(md)}\n</section>`;
      })
      .join("\n\n");
    title = titleFromMarkdown(book.chapters[0]?.markdown ?? "") ?? book.name;
  } else {
    bodyHtml = render(markdown);
    title = titleFromMarkdown(markdown) ?? "document";
  }

  const css = `${template?.style ?? ""}${options.themeCss ?? ""}`;
  const fullHtml = `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${title}</title>\n  <style>\n${css}\n  </style>\n</head>\n<body class="markdown-body theme-${templateId}">\n${bodyHtml}\n</body>\n</html>`;

  return { bodyHtml, fullHtml, title, templateId };
}
