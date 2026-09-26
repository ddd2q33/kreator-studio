import JSZip from "jszip";

export type EpubChapter = {
  /** Safe, unique id used for the file name. */
  id: string;
  title: string;
  /** Rendered body HTML (without <html>/<body> wrappers). */
  html: string;
};

export type EpubOptions = {
  title: string;
  author?: string;
  language?: string;
  description?: string;
  chapters: EpubChapter[];
  /** Full CSS (template style + overrides), embedded verbatim. */
  css: string;
};

function escXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A stable pseudo-UUID (EPUB requires a unique identifier each run). */
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function documentXhtml(chapter: EpubChapter, cssPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
<meta charset="UTF-8"/>
<title>${escXml(chapter.title)}</title>
<link rel="stylesheet" type="text/css" href="${cssPath}"/>
</head>
<body>
<div class="markdown-body">
${chapter.html}
</div>
</body>
</html>`;
}

/**
 * Build a valid EPUB 3 (EPUB2-compatible: OPF 2 + NCX + nav document) package
 * from rendered chapter HTML, and return it as a Blob ready to download.
 *
 * Input is the same body HTML shown in the preview / used by DOCX & PDF, so the
 * single upstream markdown → HTML pipeline feeds every export format.
 */
export async function htmlToEpubBlob(options: EpubOptions): Promise<Blob> {
  const title = options.title || "Book";
  const author = options.author ?? "";
  const language = options.language ?? "en";
  const description = options.description ?? "";
  const bookId = `urn:uuid:${uuid()}`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const cssPath = "styles/book.css";
  zip.file(`OEBPS/${cssPath}`, options.css);

  const chapterFiles: { id: string; href: string; title: string }[] = [];
  options.chapters.forEach((chapter, index) => {
    const href = `text/${chapter.id || `chapter-${index + 1}`}.xhtml`;
    chapterFiles.push({ id: chapter.id, href, title: chapter.title });
    zip.file(
      `OEBPS/${href}`,
      documentXhtml(chapter, cssPath),
    );
  });

  const spineIdRefs = chapterFiles
    .map((c) => `<itemref idref="${escXml(c.id)}"/>`)
    .join("\n    ");

  const manifestItems = chapterFiles
    .map(
      (c) =>
        `<item id="${escXml(c.id)}" href="${escXml(c.href)}" media-type="application/xhtml+xml"/>`,
    )
    .join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${bookId}</dc:identifier>
    <dc:title>${escXml(title)}</dc:title>
    ${author ? ` <dc:creator>${escXml(author)}</dc:creator>` : ""}
    <dc:language>${escXml(language)}</dc:language>
    ${description ? ` <dc:description>${escXml(description)}</dc:description>` : ""}
    <dc:date>${new Date().toISOString().slice(0, 10)}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="${cssPath}" media-type="text/css"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineIdRefs}
  </spine>
</package>`,
  );

  const navList = chapterFiles
    .map(
      (c) =>
        `      <li><a href="${escXml(c.href)}">${escHtml(c.title)}</a></li>`,
    )
    .join("\n");
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escXml(language)}">
<head>
<meta charset="UTF-8"/>
<title>Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>${escHtml(title)}</h1>
    <p>Contents</p>
    <ol>
${navList}
    </ol>
  </nav>
</body>
</html>`,
  );

  const navPoints = chapterFiles
    .map(
      (c, index) => `    <navPoint id="np-${index + 1}">
      <navLabel><text>${escXml(c.title)}</text></navLabel>
      <content src="${escXml(c.href)}"/>
    </navPoint>`,
    )
    .join("\n");
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
  </head>
  <docTitle><text>${escXml(title)}</text></docTitle>
  <docAuthor><text>${escXml(author || "")}</text></docAuthor>
  <navMap>
${navPoints}
  </navMap>
</ncx>`,
  );

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });
}