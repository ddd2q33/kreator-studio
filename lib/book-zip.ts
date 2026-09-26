/**
 * Zip packaging for the git-friendly book format (book.json + chapters/*.md).
 *
 * Used by the UI's "Export chapters (.zip)" button so books can be committed
 * to a repository — one .md file per chapter, one diff per paragraph — and
 * re-imported later (or edited by hand / built with `book-author build`).
 *
 * JSZip is already a dependency (lib/epub-export.ts) and works in both the
 * browser and Node, so no platform-specific packing is needed.
 */

import JSZip from "jszip";
import {
  chapterFileName,
  type BookFile,
  type BookFileChapter,
} from "./book-files.ts";

/** Build a downloadable zip with book.json + chapters/*.md (+ images/). */
export async function bookToZip(
  book: BookFile,
  images: Record<string, string> = {},
): Promise<Blob> {
  const zip = new JSZip();
  const manifest = {
    name: book.name,
    templateId: book.templateId,
    presetId: book.presetId,
    bookMode: book.bookMode,
    // chapters[] carries only metadata; bodies live in chapters/*.md so git
    // diffs stay readable. The loader reads bodies from the zip's files.
    chapters: book.chapters.map((ch, i) => ({
      id: ch.id,
      file: `chapters/${chapterFileName(ch.title, i)}`,
      title: ch.title,
    })),
  };
  zip.file("book.json", JSON.stringify(manifest, null, 2) + "\n");
  const chaptersDir = zip.folder("chapters");
  book.chapters.forEach((ch, i) => {
    chaptersDir?.file(
      chapterFileName(ch.title, i),
      ch.markdown.trim() + "\n",
    );
  });
  const imageNames = Object.keys(images);
  if (imageNames.length > 0) {
    const imagesDir = zip.folder("images");
    for (const name of imageNames) {
      const dataUrl = images[name];
      const comma = dataUrl.indexOf(",");
      if (comma === -1) continue;
      const meta = dataUrl.slice(0, comma);
      const base64 = dataUrl.slice(comma + 1);
      const ext = /image\/png/i.test(meta)
        ? "png"
        : /image\/jpe?g/i.test(meta)
          ? "jpg"
          : /image\/gif/i.test(meta)
            ? "gif"
            : /image\/svg/i.test(meta)
              ? "svg"
              : /image\/webp/i.test(meta)
                ? "webp"
                : "bin";
      const safeName = name.toLowerCase().replace(/\.[a-z0-9]+$/, "") + "." + ext;
      imagesDir?.file(safeName, base64, { base64: true });
    }
  }
  return zip.generateAsync({ type: "blob" });
}

export type ZipLoadResult = {
  book: BookFile;
  images: Record<string, string>;
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** Read a .zip (book.json + chapters/*.md + images/) back into a book. */
export async function zipToBook(file: Blob | File): Promise<ZipLoadResult> {
  const zip = await JSZip.loadAsync(file);
  const manifestEntry =
    zip.file("book.json") ?? zip.file(/^[^/]*\/book\.json$/)[0] ?? null;
  const root = manifestEntry ? manifestEntry.name.replace(/book\.json$/, "") : "";

  type Meta = { id?: string; title?: string; file?: string };
  let metas: Meta[] = [];
  let name = "Book";
  let templateId: string | null = null;
  let presetId: string | null = null;
  let bookMode = false;

  if (manifestEntry) {
    try {
      const parsed = JSON.parse(await manifestEntry.async("string")) as {
        name?: unknown;
        templateId?: unknown;
        presetId?: unknown;
        bookMode?: unknown;
        chapters?: unknown;
      };
      if (typeof parsed.name === "string") name = parsed.name;
      if (typeof parsed.templateId === "string") templateId = parsed.templateId;
      if (typeof parsed.presetId === "string") presetId = parsed.presetId;
      if (parsed.bookMode === true) bookMode = true;
      if (Array.isArray(parsed.chapters)) {
        metas = parsed.chapters.filter(
          (c): c is Meta => !!c && typeof c === "object",
        );
      }
    } catch {
      throw new Error("book.json inside the zip is not valid JSON.");
    }
  }

  // Chapter bodies: every .md under chapters/ (root-level fallback).
  let chapterEntries = zip.file(/^chapters\/[^/]+\.md$/i);
  if (chapterEntries.length === 0) {
    chapterEntries = zip.file(new RegExp(`^${root}chapters/[^/]+\\.md$`, "i"));
  }
  if (chapterEntries.length === 0) {
    chapterEntries = zip.file(/[^/]+\.md$/i);
  }
  if (chapterEntries.length === 0) {
    throw new Error("No chapter .md files found in the zip.");
  }

  const chapters: BookFileChapter[] = [];
  const byFile = new Map(chapterEntries.map((e) => [e.name, e]));
  const used = new Set<string>();

  // Manifest order first (titles/ids honored), then any leftovers by name.
  for (const meta of metas) {
    if (!meta.file) continue;
    const candidates = [
      meta.file,
      `${root}${meta.file}`,
      meta.file.replace(/^chapters\//, `${root}chapters/`),
    ];
    for (const candidate of candidates) {
      const entry = byFile.get(candidate);
      if (entry && !used.has(entry.name)) {
        used.add(entry.name);
        chapters.push({
          id: meta.id || `ch-${chapters.length + 1}`,
          title: meta.title || `Chapter ${chapters.length + 1}`,
          markdown: (await entry.async("string")).trim(),
        });
        break;
      }
    }
  }
  for (const entry of chapterEntries) {
    if (used.has(entry.name)) continue;
    const md = (await entry.async("string")).trim();
    const heading = /^#\s+(.+)$/m.exec(md);
    chapters.push({
      id: `ch-${chapters.length + 1}`,
      title: heading ? heading[1].trim() : `Chapter ${chapters.length + 1}`,
      markdown: md,
    });
  }

  if (chapters.length === 0) {
    throw new Error("No readable chapter content in the zip.");
  }
  if (chapters.length > 1) bookMode = true;

  // Images folder → data URLs keyed by lowercase file name (UI convention).
  const images: Record<string, string> = {};
  const imageEntries = zip.file(new RegExp(`^${root}images/[^/]+$`, "i"));
  for (const entry of imageEntries) {
    const base = entry.name.split("/").pop() ?? entry.name;
    const dot = base.lastIndexOf(".");
    const ext = (dot === -1 ? "" : base.slice(dot + 1)).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) continue;
    const base64 = await entry.async("base64");
    const lower = base.toLowerCase();
    images[lower] = `data:${mime};base64,${base64}`;
  }

  return {
    book: { name, templateId, presetId, bookMode, chapters },
    images,
  };
}
