import type { IStylesOptions } from "docx";
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  SimpleField,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseFragment } from "parse5";

export type ExportImages = Record<string, string>;

type InlineRun = TextRun | ExternalHyperlink | InternalHyperlink;
type BlockElement = Paragraph | Table | TableOfContents;

/** Run-level formatting accumulated while descending inline DOM nodes. */
type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  link?: boolean;
  superScript?: boolean;
  subScript?: boolean;
  color?: string;
  size?: number;
  font?: string;
};

type TemplateConfig = {
  accent: string;
  soft: string;
  ink: string;
  gray: string;
  codeBg: string;
  border: string;
  serif: string;
  sans: string;
  mono: string;
  headingSerif?: boolean;
  quoteItalic?: boolean;
  blockquoteTop?: boolean;
  runningHeader?: boolean;
  bodySize?: number;
  bodyLine?: number;
  titleSize?: number;
  paperFill?: string;
  /** Render the chapter opener as a kicker + title instead of a boxed label. */
  chapterKicker?: string;
  /**
   * Track hierarchical counters below the chapter opener. Used for figure
   * captions ("Figure 1.2 …"); heading text itself is never prefixed.
   */
  headingNumbered?: boolean;
  /** Code text color (dark-code themes use a light ink on dark fill). */
  codeInk?: string;
  /** Code-language chip text color. */
  codeLangInk?: string;
  /** Code-language chip background fill. */
  codeLangFill?: string;
};

const TEMPLATE_CONFIGS: Record<string, TemplateConfig> = {
  trauma: {
    accent: "3E5C76",
    paperFill: "FBFAF7",
    soft: "F2F5F7",
    ink: "2A2721",
    gray: "6E675C",
    codeBg: "F1F0EC",
    border: "DAD7CF",
    serif: "Georgia",
    sans: "Calibri",
    mono: "Consolas",
    quoteItalic: true,
    blockquoteTop: true,
    titleSize: 60,
  },
  psychology: {
    accent: "2F6F6A",
    paperFill: "FBF8F1",
    soft: "F2EEE1",
    ink: "2B3130",
    gray: "6B7566",
    codeBg: "EFEBE0",
    border: "DEDACF",
    serif: "Georgia",
    sans: "Calibri",
    mono: "Consolas",
    headingSerif: true,
    titleSize: 60,
    blockquoteTop: true,
  },
  technical: {
    accent: "1D4ED8",
    soft: "EDF0FC",
    ink: "1F2430",
    gray: "4B5563",
    codeBg: "F5F7FA",
    border: "DBDCDE",
    serif: "Georgia",
    sans: "Calibri",
    mono: "Consolas",
    runningHeader: true,
    bodySize: 22,
    bodyLine: 403,
    chapterKicker: "CHAPTER",
    headingNumbered: true,
  },
  slate: {
    accent: "B45309",
    paperFill: "FFFFFF",
    soft: "FFFBEB",
    ink: "0F172A",
    gray: "475569",
    codeBg: "0F172A",
    border: "CBD5E1",
    serif: "Georgia",
    sans: "Calibri",
    mono: "Consolas",
    codeInk: "E2E8F0",
    codeLangInk: "94A3B8",
    codeLangFill: "1E293B",
    runningHeader: true,
    bodySize: 22,
    bodyLine: 403,
    chapterKicker: "CHAPTER",
    headingNumbered: true,
  },
  cybersec: {
    accent: "0D9488",
    paperFill: "FBFDFC",
    soft: "E8F3F0",
    ink: "12201C",
    gray: "4B6A5F",
    codeBg: "0B1620",
    border: "B6C9C1",
    serif: "Georgia",
    sans: "Calibri",
    mono: "Consolas",
    codeInk: "D7E6E0",
    codeLangInk: "7DE3C9",
    codeLangFill: "0D2230",
    runningHeader: true,
    bodySize: 22,
    bodyLine: 403,
    chapterKicker: "CHAPTER",
    headingNumbered: true,
  },
};

const DEFAULT_CONFIG: TemplateConfig = {
  accent: "4F46E5",
  soft: "F0F0FD",
  ink: "18181B",
  gray: "52525B",
  codeBg: "F2F2F2",
  border: "E0E0E0",
  serif: "Georgia",
  sans: "Calibri",
  mono: "Consolas",
  bodySize: 26,
  bodyLine: 427,
};

function configFor(templateId?: string): TemplateConfig {
  return (templateId && TEMPLATE_CONFIGS[templateId]) || DEFAULT_CONFIG;
}

const CONTENT_MAX_WIDTH_PX = 448;

const HEADING_OPTIONS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const;

/** Half-point sizes mirroring the base CSS (h2 1.55rem, h3 1.2rem, h4 1.05rem). */
const HEADING_SIZES: Record<number, number> = {
  1: 44,
  2: 37,
  3: 29,
  4: 25,
  5: 24,
  6: 24,
};

const TABLE_ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
};

const BULLET_LEVELS = [
  { text: "•", indent: 720 },
  { text: "◦", indent: 1440 },
  { text: "▪", indent: 2160 },
];

const DECIMAL_LEVELS = [
  { indent: 720 },
  { indent: 1440 },
  { indent: 2160 },
];

function levelsFor(reference: string, ordered: boolean) {
  if (ordered) {
    return {
      reference,
      levels: DECIMAL_LEVELS.map((lvl, i) => ({
        level: i,
        format: LevelFormat.DECIMAL,
        text: `%${i + 1}.`,
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: lvl.indent, hanging: 360 } } },
      })),
    };
  }
  return {
    reference,
    levels: BULLET_LEVELS.map((lvl, i) => ({
      level: i,
      format: LevelFormat.BULLET,
      text: lvl.text,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: lvl.indent, hanging: 260 } } },
    })),
  };
}

// ---------------------------------------------------------------------------
// Tiny HTML tree (parse5 → HtmlNode[])
// ---------------------------------------------------------------------------

type Attrs = Record<string, string>;

type HtmlNode =
  | { kind: "element"; tag: string; attrs: Attrs; children: HtmlNode[] }
  | { kind: "text"; text: string };

type ElementNode = Extract<HtmlNode, { kind: "element" }>;

type ParseNode = {
  nodeName?: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParseNode[];
  value?: string;
  data?: string;
};

function parseHtml(html: string): HtmlNode[] {
  const frag = parseFragment(html) as unknown as { childNodes?: ParseNode[] };
  const out: HtmlNode[] = [];
  const convert = (node: ParseNode): HtmlNode[] => {
    if (!node) return [];
    const name = node.nodeName ?? "";
    if (name === "#text") {
      return typeof node.value === "string"
        ? [{ kind: "text", text: node.value }]
        : [];
    }
    if (name === "#comment" || name === "#documentType") return [];
    if (typeof node.tagName !== "string") return [];
    const attrs: Attrs = {};
    for (const attr of node.attrs ?? []) {
      attrs[attr.name.toLowerCase()] = attr.value;
    }
    const children: HtmlNode[] = [];
    for (const child of node.childNodes ?? []) children.push(...convert(child));
    return [
      { kind: "element", tag: node.tagName.toLowerCase(), attrs, children },
    ];
  };
  for (const child of frag.childNodes ?? []) out.push(...convert(child));
  return out;
}

function isElement(node: HtmlNode): node is ElementNode {
  return node.kind === "element";
}

function classes(node: HtmlNode): string[] {
  return (
    (isElement(node) ? (node.attrs.class ?? "").split(/\s+/) : [])
      .map((c) => c.trim())
      .filter(Boolean)
  );
}

function hasClass(node: HtmlNode, name: string): boolean {
  return classes(node).includes(name);
}

function textOf(node: HtmlNode): string {
  if (node.kind === "text") return node.text;
  return node.children.map(textOf).join("");
}

function firstClass<T extends HtmlNode>(nodes: T[], name: string): T | null {
  for (const node of nodes) {
    if (isElement(node) && hasClass(node, name)) return node;
  }
  return null;
}

/** firstClass narrowed to elements (most block handlers need .children). */
function firstClassEl(nodes: HtmlNode[], name: string): ElementNode | null {
  const found = firstClass(nodes, name);
  return found && isElement(found) ? found : null;
}

/** Balanced plain text of an (otherwise irrelevant) container used for labels. */
function trimmedTextOf(node: HtmlNode | null | undefined): string {
  return textOf(node ?? { kind: "text", text: "" })
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Image helpers (pluggable resolver: browser canvas vs. server/CLI bytes)
// ---------------------------------------------------------------------------

export type ResolvedDocxImage = {
  dataUrl: string;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg";
};

/**
 * Turns an arbitrary <img> src (data:, http(s):, blob:) into an embeddable
 * data URL plus pixel dimensions. The browser default rasterizes through
 * canvas; server code injects its own resolver (see lib/docx-node.ts).
 */
export type DocxImageResolver = (src: string) => Promise<ResolvedDocxImage | null>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function sourceToDataUrl(src: string): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  if (src.startsWith("blob:") || src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const response = await fetch(src);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }
  return null;
}

/** Rasterize any image (SVG included, which docx cannot embed) to a PNG data URL. */
async function toPngWithSize(dataUrl: string): Promise<{
  dataUrl: string;
  width: number;
  height: number;
} | null> {
  if (typeof document === "undefined") return null;
  try {
    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || 600;
    const height = image.naturalHeight || 400;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png"), width, height };
  } catch {
    return null;
  }
}

/** Browser default: fetch to data URL, then rasterize to PNG via canvas. */
async function browserResolveImage(src: string): Promise<ResolvedDocxImage | null> {
  const dataUrl = await sourceToDataUrl(src);
  if (!dataUrl) return null;
  const sized = await toPngWithSize(dataUrl);
  if (!sized) return null;
  return { ...sized, mime: "image/png" };
}

// ---------------------------------------------------------------------------
// Inline runs
// ---------------------------------------------------------------------------

function makeRun(text: string, style: RunStyle, config: TemplateConfig): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italic,
    strike: style.strike,
    ...(style.link ? { color: config.accent, underline: {} } : {}),
    ...(style.superScript ? { superScript: true } : {}),
    ...(style.subScript ? { subScript: true } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.size ? { size: style.size } : {}),
    ...(style.font ? { font: style.font } : {}),
  });
}

function collectInline(
  element: HtmlNode,
  style: RunStyle,
  config: TemplateConfig,
): InlineRun[] {
  if (element.kind === "text") {
    return element.text ? [makeRun(element.text, style, config)] : [];
  }
  const out: InlineRun[] = [];
  for (const child of element.children) {
    if (child.kind === "text") {
      if (child.text) out.push(makeRun(child.text, style, config));
      continue;
    }
    switch (child.tag) {
      case "strong":
      case "b":
        out.push(...collectInline(child, { ...style, bold: true }, config));
        break;
      case "em":
      case "i":
        out.push(...collectInline(child, { ...style, italic: true }, config));
        break;
      case "del":
      case "s":
        out.push(...collectInline(child, { ...style, strike: true }, config));
        break;
      case "u":
        out.push(...collectInline(child, { ...style, link: true }, config));
        break;
      case "code": {
        const text = textOf(child);
        if (text) {
          out.push(
            new TextRun({
              text,
              font: config.mono,
              size: style.size ?? 20,
              color: config.accent,
              shading: { type: ShadingType.CLEAR, fill: config.codeBg },
              bold: style.bold,
            }),
          );
        }
        break;
      }
      case "a": {
        const href = child.attrs.href ?? "";
        const inner = collectInline(child, { ...style, link: true }, config);
        if (/^https?:|^mailto:/i.test(href)) {
          out.push(new ExternalHyperlink({ children: inner, link: href }));
        } else if (href.startsWith("#")) {
          out.push(
            new InternalHyperlink({ children: inner, anchor: href.slice(1) }),
          );
        } else {
          out.push(...inner);
        }
        break;
      }
      case "br":
        out.push(new TextRun({ break: 1 }));
        break;
      case "sup":
        out.push(
          ...collectInline(child, { ...style, superScript: true }, config),
        );
        break;
      case "sub":
        out.push(
          ...collectInline(child, { ...style, subScript: true }, config),
        );
        break;
      case "mark":
      case "kbd":
      case "samp":
      case "span":
      case "small":
      case "abbr":
      case "cite":
      case "q":
      case "p":
      case "div":
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
      case "li":
        out.push(...collectInline(child, style, config));
        break;
      case "img":
      case "input":
      case "svg":
        break;
      default:
        out.push(...collectInline(child, style, config));
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Boxes (callout / quote / code / toc) rendered as single-cell tables so the
// background fills a continuous area, like the preview.
// ---------------------------------------------------------------------------

const NO_TABLE_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

type BorderSide = {
  style: (typeof BorderStyle)[keyof typeof BorderStyle];
  size: number;
  color: string;
};

function singleCellTable(
  cellParagraphs: Paragraph[],
  config: TemplateConfig,
  options: {
    fill: string;
    borders: {
      top?: BorderSide;
      bottom?: BorderSide;
      left?: BorderSide;
      right?: BorderSide;
    };
  },
): Table {
  const cell = new TableCell({
    shading: { type: ShadingType.CLEAR, fill: options.fill },
    borders: {
      top: options.borders.top ?? {
        style: BorderStyle.SINGLE,
        size: 4,
        color: config.border,
      },
      bottom: options.borders.bottom ?? {
        style: BorderStyle.SINGLE,
        size: 4,
        color: config.border,
      },
      left: options.borders.left ?? {
        style: BorderStyle.SINGLE,
        size: 4,
        color: config.border,
      },
      right: options.borders.right ?? {
        style: BorderStyle.SINGLE,
        size: 4,
        color: config.border,
      },
    },
    margins: { top: 170, bottom: 170, left: 220, right: 220 },
    children: cellParagraphs,
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_TABLE_BORDER,
      bottom: NO_TABLE_BORDER,
      left: NO_TABLE_BORDER,
      right: NO_TABLE_BORDER,
      insideHorizontal: NO_TABLE_BORDER,
      insideVertical: NO_TABLE_BORDER,
    },
    rows: [new TableRow({ children: [cell] })],
  });
}

function thinBorder(color: string) {
  return { style: BorderStyle.SINGLE, size: 4, color };
}

// ---------------------------------------------------------------------------
// Document conversion
// ---------------------------------------------------------------------------

/** Derive a safe filename from the document's first heading. */
export function suggestedFilename(markdown: string): string {
  const heading = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+/.test(line));
  const raw = heading ? heading.replace(/^#{1,6}\s*/, "") : "document";
  const slug = raw
    .replace(/[*_`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "document";
}

/**
 * Convert the rendered document HTML (the same string shown in the preview and
 * used for the .html download) into a docx Document, mirroring the preview's
 * look: title page, front matter, table of contents, part/chapter pages,
 * callouts, code frames, tables, images and page-numbered footers.
 *
 * Isomorphic entry point: pass `resolveImage` to embed images without a DOM
 * (headless API routes, the book-author CLI — see lib/docx-node.ts).
 */
export async function buildDocxDocument(
  html: string,
  templateId?: string,
  options: { resolveImage?: DocxImageResolver } = {},
): Promise<Document> {
  const resolve = options.resolveImage ?? browserResolveImage;
  const config = configFor(templateId);
  const nodes = parseHtml(html);

  const body: BlockElement[] = [];
  const numberingConfigs: {
    reference: string;
    levels: ReturnType<typeof levelsFor>["levels"];
  }[] = [];
  let orderedListCount = 0;
  let titleRendered = false;
  let firstAfterTitle = false;
  // Hierarchical heading numbers (1.1, 1.1.1 …) below the chapter opener.
  const headingCounters = { chapter: 0, section: 0, subsection: 0, fig: 0 };

  const firstH1 = (() => {
    const find = (list: HtmlNode[]): HtmlNode | null => {
      for (const node of list) {
        if (isElement(node)) {
          if (/^h[1-6]$/.test(node.tag)) return node;
          const nested = find(node.children);
          if (nested) return nested;
        }
      }
      return null;
    };
    return find(nodes);
  })();

  // -- Lists ----------------------------------------------------------------

  function listBlocks(
    element: ElementNode,
    level: number,
    out: BlockElement[],
  ): void {
    if (element.tag !== "ul" && element.tag !== "ol") return;
    const ordered = element.tag === "ol";
    let reference = "book-bullet";
    if (ordered) {
      orderedListCount += 1;
      reference = `book-ordered-${orderedListCount}`;
      numberingConfigs.push(levelsFor(reference, true));
    }
    const items = element.children.filter(isElement);
    for (const li of items) {
      if (li.tag !== "li") continue;
      const runs: InlineRun[] = [];
      const nested: ElementNode[] = [];
      let task = false;
      let checked = false;
      for (const child of li.children) {
        if (isElement(child)) {
          if (child.tag === "ul" || child.tag === "ol") {
            nested.push(child);
            continue;
          }
          if (
            child.tag === "input" &&
            /checkbox/i.test(child.attrs.type ?? "")
          ) {
            task = true;
            checked = child.attrs.checked != null;
            continue;
          }
          runs.push(...collectInline(child, {}, config));
          continue;
        }
        if (child.text) runs.push(makeRun(child.text, {}, config));
      }
      if (task) {
        runs.unshift(new TextRun({ text: checked ? "☑ " : "☐ ", bold: true }));
      }
      out.push(
        new Paragraph({
          numbering: { reference, level: Math.min(level, 2) },
          spacing: { after: 80, line: 300 },
          children: runs.length > 0 ? runs : [new TextRun("")],
        }),
      );
      for (const nestedList of nested) listBlocks(nestedList, level + 1, out);
    }
  }

  // -- Tables ---------------------------------------------------------------

  function cellFor(
    element: ElementNode,
    isHeader: boolean,
    fill?: string,
  ): TableCell {
    const alignRaw = element.attrs.align;
    const styleRaw = element.attrs.style ?? "";
    const alignMatch = /text-align:\s*(left|center|right)/i.exec(styleRaw);
    const align = alignRaw ?? alignMatch?.[1] ?? undefined;
    const shadingFill = fill ?? (isHeader ? config.accent : undefined);
    return new TableCell({
      shading: shadingFill
        ? { type: ShadingType.CLEAR, fill: shadingFill }
        : undefined,
      margins: { top: 90, bottom: 90, left: 130, right: 130 },
      children: [
        new Paragraph({
          alignment: align ? TABLE_ALIGN[align] : undefined,
          children:
            isHeader
              ? collectInline(element, { bold: true, color: "FFFFFF", size: 23 }, config)
              : collectInline(element, { size: 23 }, config),
        }),
      ],
    });
  }

  function tableBlock(element: ElementNode): BlockElement {
    const headerCells: ElementNode[] = [];
    const bodyRows: ElementNode[][] = [];
    const thead = element.children.find(
      (c): c is ElementNode => isElement(c) && c.tag === "thead",
    );
    if (thead) {
      for (const row of thead.children) {
        if (!isElement(row) || row.tag !== "tr") continue;
        for (const cell of row.children) {
          if (isElement(cell) && (cell.tag === "th" || cell.tag === "td")) {
            headerCells.push(cell);
          }
        }
      }
    }
    const tbody = element.children.find(
      (c): c is ElementNode => isElement(c) && c.tag === "tbody",
    );
    if (tbody) {
      for (const row of tbody.children) {
        if (!isElement(row) || row.tag !== "tr") continue;
        const cells: ElementNode[] = [];
        for (const cell of row.children) {
          if (isElement(cell) && (cell.tag === "td" || cell.tag === "th")) {
            cells.push(cell);
          }
        }
        if (cells.length > 0) bodyRows.push(cells);
      }
    }
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: thinBorder(config.border),
        bottom: thinBorder(config.border),
        left: thinBorder(config.border),
        right: thinBorder(config.border),
        insideHorizontal: thinBorder(config.border),
        insideVertical: thinBorder(config.border),
      },
      rows: [
        ...(headerCells.length > 0
          ? [
              new TableRow({
                tableHeader: true,
                children: headerCells.map((cell) => cellFor(cell, true)),
              }),
            ]
          : []),
        ...bodyRows.map((row, index) =>
          new TableRow({
            children: row.map((cell) =>
              cellFor(cell, false, index % 2 === 1 ? config.soft : undefined),
            ),
          }),
        ),
      ],
    });
    return table;
  }

  // -- Images ---------------------------------------------------------------

  async function imageBlocks(
    element: ElementNode,
  ): Promise<BlockElement[]> {
    const src = element.attrs.src ?? "";
    const alt = element.attrs.alt ?? "";
    const sized = await resolve(src);
    if (!sized) return [];
    const displayWidth = Math.min(sized.width, CONTENT_MAX_WIDTH_PX);
    const displayHeight = Math.max(
      1,
      Math.round((displayWidth * sized.height) / Math.max(1, sized.width)),
    );
    const run = new ImageRun({
      data: sized.dataUrl,
      type: sized.mime === "image/jpeg" ? "jpg" : "png",
      transformation: { width: displayWidth, height: displayHeight },
      altText: {
        title: alt || "image",
        description: alt || "image",
        name: alt || "image",
      },
    });
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 80 },
        children: [run],
      }),
    ];
  }

  async function figureBlocks(element: ElementNode): Promise<BlockElement[]> {
    const img = element.children.find(
      (c): c is ElementNode => isElement(c) && c.tag === "img",
    );
    const captionEl = element.children.find(
      (c): c is ElementNode => isElement(c) && c.tag === "figcaption",
    );
    const blocks: BlockElement[] = [];
    if (img) {
      const src = img.attrs.src ?? "";
      const sized = await resolve(src);
      if (sized) {
        const displayWidth = Math.min(sized.width, CONTENT_MAX_WIDTH_PX);
        const displayHeight = Math.max(
          1,
          Math.round((displayWidth * sized.height) / Math.max(1, sized.width)),
        );
        blocks.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 40 },
            children: [
              new ImageRun({
                data: sized.dataUrl,
                type: sized.mime === "image/jpeg" ? "jpg" : "png",
                transformation: { width: displayWidth, height: displayHeight },
                altText: { description: img.attrs.alt ?? "", name: img.attrs.alt ?? "" },
              }),
            ],
          }),
        );
        if (captionEl && isElement(captionEl)) {
          let captionText = trimmedTextOf(captionEl);
          // Technical template: auto-numbered captions "Figure N.M — …".
          if (config.headingNumbered === true) {
            headingCounters.fig += 1;
            captionText = `Figure ${headingCounters.chapter}.${headingCounters.fig}. — ${captionText}`;
          }
          blocks.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 40, after: 200 },
              children: [
                new Bookmark({
                  id: `figure-${headingCounters.chapter}-${headingCounters.fig}`,
                  children: [
                    new TextRun({
                      text: captionText,
                      size: 17,
                      color: config.gray,
                    }),
                  ],
                }),
              ],
            }),
          );
        }
      }
    }
    return blocks;
  }

  // -- Callouts & code & quotes ---------------------------------------------

  function calloutBlock(element: ElementNode): BlockElement {
    const titleEl = firstClass(element.children, "callout-title");
    const contentEl = firstClass(element.children, "callout-content");
    const paragraphs: Paragraph[] = [];
    if (titleEl) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 120, line: 280 },
          children: [
            new TextRun({
              text: trimmedTextOf(titleEl),
              bold: true,
              color: config.accent,
              size: 20,
            }),
          ],
        }),
      );
    }
    const content: ElementNode =
      contentEl && isElement(contentEl) ? contentEl : element;
    for (const child of content.children) {
      if (!isElement(child)) continue;
      if (child.tag === "p") {
        const runs = collectInline(child, {}, config);
        if (runs.length > 0) {
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 120, line: 300 },
              children: runs,
            }),
          );
        }
      } else if (child.tag === "ul" || child.tag === "ol") {
        const nested: Paragraph[] = [];
        listBlocks(child, 0, nested);
        paragraphs.push(...nested);
      }
    }
    return singleCellTable(paragraphs, config, {
      fill: config.soft,
      borders: {
        top: thinBorder(config.border),
        bottom: thinBorder(config.border),
        left: { style: BorderStyle.SINGLE, size: 24, color: config.accent },
        right: thinBorder(config.border),
      },
    });
  }

  function codeFrameBlock(element: ElementNode): BlockElement {
    const paragraphs: Paragraph[] = [];
const langEl = firstClass(element.children, "code-lang");
    if (langEl) {
      const lang = trimmedTextOf(langEl);
      if (lang) {
        paragraphs.push(
          new Paragraph({
            spacing: { after: 0, line: 260 },
            border: { bottom: thinBorder("E2E8F0") },
            shading: { type: ShadingType.CLEAR, fill: "EEF1F6" },
            children: [
              new TextRun({
                text: lang,
                font: config.mono,
                size: 15,
                bold: true,
                color: config.codeLangInk ?? "465266",
                allCaps: true,
                characterSpacing: 27,
                shading: {
                  type: ShadingType.CLEAR,
                  fill: config.codeLangFill ?? "EEF1F6",
                },
              }),
            ],
          }),
        );
      }
    }
    const pre = element.children.find(
      (c): c is ElementNode => isElement(c) && c.tag === "pre",
    );
    const code = pre
      ? pre.children.find(
          (c): c is ElementNode => isElement(c) && c.tag === "code",
        )
      : null;
    const raw = code ? textOf(code) : "";
    const lines = raw.replace(/\n$/, "").split("\n");
    lines.forEach((line, index) => {
      paragraphs.push(
        new Paragraph({
          spacing: {
            before: 0,
            after: index === lines.length - 1 ? 0 : 0,
            line: 260,
          },
          children: [
            new TextRun({
              text: line.length > 0 ? line : " ",
              font: config.mono,
              size: 18,
              color: config.codeInk ?? "1F2430",
            }),
          ],
        }),
      );
    });
    return singleCellTable(paragraphs, config, {
      fill: config.codeBg,
      borders: {
        top: thinBorder(config.border),
        bottom: thinBorder(config.border),
        left: thinBorder(config.border),
        right: thinBorder(config.border),
      },
    });
  }

  function quoteBlock(element: ElementNode): BlockElement {
    const paragraphs: Paragraph[] = [];
    for (const child of element.children) {
      if (!isElement(child)) continue;
      if (child.tag === "p") {
        const runs = collectInline(child, { italic: config.quoteItalic ?? true }, config);
        if (runs.length > 0) {
          paragraphs.push(
            new Paragraph({
              spacing: { after: 100, line: 300 },
              children: runs,
            }),
          );
        }
      } else if (child.tag === "ul" || child.tag === "ol") {
        const nested: Paragraph[] = [];
        listBlocks(child, 0, nested);
        paragraphs.push(...nested);
      }
    }
    return singleCellTable(paragraphs, config, {
      fill: config.soft,
      borders:
        config.blockquoteTop === true
          ? {
              top: { style: BorderStyle.SINGLE, size: 32, color: config.accent },
              bottom: thinBorder(config.border),
              left: thinBorder(config.border),
              right: thinBorder(config.border),
            }
          : {
              top: thinBorder(config.border),
              bottom: thinBorder(config.border),
              left: { style: BorderStyle.SINGLE, size: 24, color: config.accent },
              right: thinBorder(config.border),
            },
    });
  }

  // -- Table of contents ----------------------------------------------------

  function tocBlock(element: ElementNode): BlockElement[] {
    const entries: { level: number; num: string; text: string; id: string }[] =
      [];
    const collect = (list: HtmlNode[]): void => {
      for (const node of list) {
        if (!isElement(node)) continue;
        if (node.tag === "li") {
          const levelMatch = /(?:^|\s)toc-l([1-6])(?:\s|$)/.exec(
            node.attrs.class ?? "",
          );
          if (levelMatch) {
            const anchorEl = node.children.find(
              (c): c is ElementNode => isElement(c) && c.tag === "a",
            );
            const href = anchorEl?.attrs.href ?? "";
            const id = href.startsWith("#") ? href.slice(1) : "";
            entries.push({
              level: Number(levelMatch[1]),
              num: trimmedTextOf(
                node.children.find(
                  (c): c is ElementNode =>
                    isElement(c) && hasClass(c, "toc-num"),
                ),
              ),
              text: trimmedTextOf(
                node.children.find(
                  (c): c is ElementNode =>
                    isElement(c) && hasClass(c, "toc-text"),
                ),
              ),
              id,
            });
          }
        }
        collect(node.children);
      }
    };
    collect(element.children);
    const cachedEntries = entries.map((entry) => ({
      title: `${entry.num ? `${entry.num}\t` : ""}${entry.text}`,
      level: entry.level,
      ...(entry.id ? { href: entry.id } : {}),
    }));
    const titleText =
      trimmedTextOf(firstClass(element.children, "toc-title")) || "Contents";
    const titleParagraph = new Paragraph({
      spacing: { after: 160 },
      border: { bottom: thinBorder(config.accent) },
      children: [
        new TextRun({
          text: titleText,
          bold: true,
          color: config.ink,
          size: 26,
          font: config.serif,
        }),
      ],
    });
    return [
      titleParagraph,
      new TableOfContents("Contents", {
        cachedEntries,
        hyperlink: true,
        headingStyleRange: "1-3",
      }),
    ];
  }

  // -- Therapeutic directive components (tool / worksheet / reflection /
  // summary / diagram). Rendered as shaded single-cell tables, mirroring the
  // preview's bordered components. -------------------------------------------

  const smallCapsLabel = (
    text: string,
    color: string,
    size = 17,
  ): Paragraph =>
    new Paragraph({
      spacing: { after: 60, line: 260 },
      children: [
        new TextRun({
          text: text.toUpperCase(),
          font: config.sans,
          bold: true,
          size,
          color,
          characterSpacing: 34,
        }),
      ],
    });

  /** Paragraphs for directive block content: ps, lists, write lines. */
  async function directiveContent(
    container: ElementNode | null,
    out: Paragraph[],
  ): Promise<void> {
    const children = (container ?? { children: [] as HtmlNode[] }).children;
    for (const child of children) {
      if (!isElement(child)) continue;
      if (child.tag === "p") {
        if (hasClass(child, "md-write-line")) {
          out.push(
            new Paragraph({
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: config.border,
                  space: 4,
                },
              },
              spacing: { before: 60, after: 200 },
              children: [],
            }),
          );
          continue;
        }
        const runs = collectInline(child, {}, config);
        if (runs.length > 0) {
          out.push(
            new Paragraph({
              spacing: { after: 100, line: 300 },
              children: runs,
            }),
          );
        }
      } else if (child.tag === "ul" || child.tag === "ol") {
        listBlocks(child, 0, out);
      } else if (child.tag === "div") {
        // reflection-q wrapper: recurse into its question + write line
        await directiveContent(child, out);
      }
    }
  }

  async function toolBlock(element: ElementNode): Promise<BlockElement[]> {
    const paragraphs: Paragraph[] = [];
    const numberEl = firstClassEl(element.children, "tool-number");
    const nameEl = firstClassEl(element.children, "tool-name");
    const bodyEl = firstClassEl(element.children, "tool-body");
    if (numberEl)
      paragraphs.push(smallCapsLabel(trimmedTextOf(numberEl), config.accent, 16));
    if (nameEl) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 60, line: 280 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: config.border, space: 4 },
          },
          children: [
            new TextRun({
              text: trimmedTextOf(nameEl),
              font: config.sans,
              bold: true,
              size: 26,
              color: config.ink,
            }),
          ],
        }),
      );
    }
    const bodyChildren = bodyEl ? bodyEl.children : [];
    for (const section of bodyChildren) {
      if (!isElement(section)) continue;
      const labelEl = firstClass(section.children, "tool-label");
      if (labelEl)
        paragraphs.push(smallCapsLabel(trimmedTextOf(labelEl), config.accent));
      await directiveContent(section, paragraphs);
    }
    return [
      singleCellTable(paragraphs, config, {
        fill: config.paperFill ?? "FFFFFF",
        borders: {
          top: thinBorder(config.border),
          bottom: thinBorder(config.border),
          left: thinBorder(config.border),
          right: thinBorder(config.border),
        },
      }),
    ];
  }

  function worksheetBlock(element: ElementNode): BlockElement {
    const paragraphs: Paragraph[] = [];
    const labelEl = firstClassEl(element.children, "worksheet-label");
    const titleEl = firstClassEl(element.children, "worksheet-title");
    const purposeEl = firstClassEl(element.children, "worksheet-purpose");
    const bodyEl = firstClassEl(element.children, "worksheet-body");
    if (labelEl)
      paragraphs.push(smallCapsLabel(trimmedTextOf(labelEl), config.accent));
    if (titleEl) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 40, line: 280 },
          children: [
            new TextRun({
              text: trimmedTextOf(titleEl),
              font: config.sans,
              bold: true,
              size: 25,
              color: config.ink,
            }),
          ],
        }),
      );
    }
    if (purposeEl) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 120, line: 280 },
          children: collectInline(purposeEl, { color: config.gray, size: 20 }, config),
        }),
      );
    }
    // worksheet-body prompt paragraphs are bold Inter in the preview.
    if (bodyEl) {
      for (const child of bodyEl.children) {
        if (!isElement(child)) continue;
        if (child.tag === "p" && hasClass(child, "md-write-line")) {
          paragraphs.push(
            new Paragraph({
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: config.border,
                  space: 4,
                },
              },
              spacing: { before: 20, after: 180 },
              children: [],
            }),
          );
        } else if (child.tag === "p") {
          paragraphs.push(
            new Paragraph({
              spacing: { before: 60, after: 20, line: 280 },
              children: collectInline(
                child,
                { bold: true, size: 19, font: config.sans },
                config,
              ),
            }),
          );
        } else if (child.tag === "ul") {
          listBlocks(child, 0, paragraphs);
        }
      }
    }
    return singleCellTable(paragraphs, config, {
      fill: config.soft,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 8, color: config.accent },
        bottom: thinBorder(config.border),
        left: thinBorder(config.border),
        right: thinBorder(config.border),
      },
    });
  }

  function reflectionBlock(element: ElementNode): BlockElement {
    const paragraphs: Paragraph[] = [];
    const titleEl = firstClassEl(element.children, "reflection-title");
    const beforeEl = firstClassEl(element.children, "reflection-before");
    const bodyEl = firstClassEl(element.children, "reflection-body");
    if (titleEl) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 40, line: 280 },
          children: [
            new TextRun({
              text: trimmedTextOf(titleEl),
              font: config.sans,
              bold: true,
              size: 24,
              color: config.ink,
            }),
          ],
        }),
      );
    }
    if (beforeEl) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 120, line: 280 },
          children: collectInline(beforeEl, { italic: true, size: 20 }, config),
        }),
      );
    }
    const body = bodyEl ?? element;
    let n = 0;
    for (const q of body.children) {
      if (!isElement(q) || !hasClass(q, "reflection-q")) continue;
      n += 1;
      const questionEl = firstClass(q.children, "reflection-question");
      const lineEl = firstClass(q.children, "md-write-line");
      if (questionEl) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 100, after: 20, line: 280 },
            children: [
              new TextRun({
                text: `${n}.  `,
                font: config.sans,
                bold: true,
                color: config.accent,
                size: 20,
              }),
              ...collectInline(questionEl, { bold: true, size: 20 }, config),
            ],
          }),
        );
      }
      if (lineEl) {
        paragraphs.push(
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: config.border,
                space: 4,
              },
            },
            spacing: { after: 120 },
            children: [],
          }),
        );
      }
    }
    return singleCellTable(paragraphs, config, {
      fill: config.soft,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 24, color: config.accent },
        bottom: thinBorder(config.border),
        left: thinBorder(config.border),
        right: thinBorder(config.border),
      },
    });
  }

  function summaryBlock(element: ElementNode): BlockElement {
    const paragraphs: Paragraph[] = [];
    const kickerEl = firstClassEl(element.children, "summary-kicker");
    if (kickerEl)
      paragraphs.push(smallCapsLabel(trimmedTextOf(kickerEl), config.accent, 18));
    for (const group of element.children) {
      if (!isElement(group) || !hasClass(group, "summary-group")) continue;
      const labelEl = firstClassEl(group.children, "summary-label");
      if (labelEl)
        paragraphs.push(smallCapsLabel(trimmedTextOf(labelEl), config.ink, 18));
      const listEl = firstClassEl(group.children, "summary-list");
      if (listEl) {
        listBlocks(listEl, 0, paragraphs);
      } else {
        for (const child of group.children) {
          if (isElement(child) && child.tag === "p") {
            const runs = collectInline(child, {}, config);
            if (runs.length > 0) {
              paragraphs.push(
                new Paragraph({ spacing: { after: 80, line: 300 }, children: runs }),
              );
            }
          }
        }
      }
    }
    return singleCellTable(paragraphs, config, {
      fill: config.soft,
      borders: {
        top: thinBorder(config.border),
        bottom: thinBorder(config.border),
        left: thinBorder(config.border),
        right: thinBorder(config.border),
      },
    });
  }

  function diagramBlock(element: ElementNode): BlockElement {
    const flowEl = firstClassEl(element.children, "diagram-flow");
    const captionEl = firstClassEl(element.children, "diagram-caption");
    const paragraphs: Paragraph[] = [];
    const flow = flowEl ? flowEl.children : element.children;
    for (const node of flow) {
      if (!isElement(node)) continue;
      if (hasClass(node, "diagram-arrow")) {
        paragraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 20, after: 20, line: 240 },
            children: [
              new TextRun({ text: "↓", color: config.gray, size: 20 }),
            ],
          }),
        );
      } else if (hasClass(node, "diagram-node")) {
        const hot = hasClass(node, "diagram-node-hot");
        paragraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 30, after: 30, line: 280 },
            children: collectInline(
              node,
              {
                bold: true,
                size: 21,
                font: config.sans,
                ...(hot ? { color: "FFFFFF" } : {}),
              },
              config,
            ),
          }),
        );
      }
    }
    if (captionEl) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 40, line: 260 },
          children: collectInline(captionEl, { color: config.gray, size: 17 }, config),
        }),
      );
    }
    return singleCellTable(paragraphs, config, {
      fill: config.codeBg,
      borders: {
        top: thinBorder(config.border),
        bottom: thinBorder(config.border),
        left: thinBorder(config.border),
        right: thinBorder(config.border),
      },
    });
  }

  // -- Part / chapter pages -------------------------------------------------

  function partOrChapterPage(
    kicker: string,
    title: string,
    kind: "part" | "chapter",
    anchorId?: string,
  ): BlockElement[] {
    const isChapter = kind === "chapter";
    // Hierarchical numbering starts (or restarts) at every opener page.
    if (config.headingNumbered === true) {
      const n = /(\d+)\s*$/.exec(kicker);
      if (n) headingCounters.chapter = Number(n[1]);
      headingCounters.section = 0;
      headingCounters.subsection = 0;
      headingCounters.fig = 0;
    }
    const bodyOut: BlockElement[] = [];
    // Programming books use a plain monospace kicker + `//` ornament instead
    // of the boxed pill + diamond used by the therapeutic templates.
    const useKicker = config.chapterKicker != null;
    const labelRuns = [
      new TextRun({
        text: useKicker ? kicker.replace(/\s+/g, " ").trim() : `  ${kicker}  `,
        font: config.mono,
        bold: true,
        color: config.accent,
        size: useKicker ? 20 : 17,
        allCaps: true,
        characterSpacing: 52,
        ...(useKicker
          ? {}
          : {
              border: {
                style: BorderStyle.SINGLE,
                size: 9,
                color: config.border,
                space: 8,
              },
            }),
      }),
    ];
    bodyOut.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        pageBreakBefore: true,
        spacing: { before: isChapter ? 1800 : 2600, after: 0, line: 260 },
        children: labelRuns,
      }),
    );
    bodyOut.push(
      new Paragraph({
        heading: isChapter ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 260, after: 0, line: 320 },
        children: anchorId
          ? [
              new Bookmark({
                id: anchorId,
                children: [
                  new TextRun({
                    text: title,
                    font: config.headingSerif ? config.serif : config.sans,
                    size: isChapter ? 47 : 56,
                    bold: true,
                    color: config.ink,
                  }),
                ],
              }),
            ]
          : [
              new TextRun({
                text: title,
                font: config.headingSerif ? config.serif : config.sans,
                size: isChapter ? 47 : 56,
                bold: true,
                color: config.ink,
              }),
            ],
      }),
    );
    // The monospace `//` ornament used by programming templates is no longer
    // emitted; therapeutic templates keep their ``——– ♦ ——–`` divider.
    if (!useKicker) {
      bodyOut.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 400, after: 200, line: 240 },
          children: [
            new TextRun({
              text: "\u2014\u2014\u2014 \u25C6 \u2014\u2014\u2014",
              color: config.accent,
              size: 18,
            }),
          ],
        }),
      );
    }
    bodyOut.push(
      new Paragraph({ spacing: { before: 400 }, children: [] }),
    );
    return bodyOut;
  }

  // -- Front matter blocks --------------------------------------------------

  function metaBlock(element: ElementNode): BlockElement {
    const text = textOf(element)
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 400, line: 420 },
      children: [new TextRun({ text, size: 18, color: config.gray })],
    });
  }

  function copyrightBlock(element: ElementNode): BlockElement {
    const text = textOf(element)
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    return new Paragraph({
      pageBreakBefore: true,
      spacing: { before: 600, after: 200, line: 360 },
      children: [new TextRun({ text, size: 16, color: config.gray })],
    });
  }

  function dedicationBlock(element: ElementNode): BlockElement {
    const text = textOf(element)
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacing: { before: 3000, after: 200, line: 360 },
      children: [
        new TextRun({
          text,
          italics: true,
          size: 20,
          color: config.gray,
        }),
      ],
    });
  }

  function restrictedBlock(element: ElementNode): BlockElement {
    const text = textOf(element)
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    const labelRuns: InlineRun[] = [
      new TextRun({
        text: "  Restricted  ",
        font: config.mono,
        bold: true,
        color: config.accent,
        size: 16,
        characterSpacing: 52,
        allCaps: true,
        border: {
          style: BorderStyle.SINGLE,
          size: 7,
          color: config.border,
          space: 6,
        },
      }),
    ];
    return singleCellTable(
      [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 120, line: 260 },
          children: labelRuns,
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0, line: 340 },
          children: [
            new TextRun({ text, size: 17, color: config.gray, italics: true }),
          ],
        }),
      ],
      config,
      {
        fill: config.codeBg,
        borders: {
          top: thinBorder(config.border),
          bottom: thinBorder(config.border),
          left: thinBorder(config.border),
          right: thinBorder(config.border),
        },
      },
    );
  }

  // -- Paragraph ------------------------------------------------------------

  function paragraphBlock(
    element: ElementNode,
    firstAfterTitle: boolean,
  ): { paragraph: Paragraph | null; images: ElementNode[] } {
    const images: ElementNode[] = [];
    const collectImages = (list: HtmlNode[]): void => {
      for (const node of list) {
        if (!isElement(node)) continue;
        if (node.tag === "img") images.push(node);
        collectImages(node.children);
      }
    };
    collectImages(element.children);

    const style: RunStyle = firstAfterTitle ? { color: config.gray } : {};

    const runs = collectInline(element, style, config);
    if (runs.length === 0) return { paragraph: null, images };
    return {
      paragraph: new Paragraph({
        alignment: firstAfterTitle ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        spacing: { after: 160, line: config.bodyLine ?? 427 },
        children: runs,
      }),
      images,
    };
  }

  // -- Top-level walk -------------------------------------------------------

  const dispatch = async (node: HtmlNode): Promise<void> => {
    if (!isElement(node)) {
      const text = textOf(node);
      if (text.trim()) {
        const runsIn = collectInline(node, {}, config);
        if (runsIn.length > 0) {
          body.push(new Paragraph({ children: runsIn }));
        }
      }
      return;
    }

    const tag = node.tag;
    const nextAfterTitle = firstAfterTitle;
    firstAfterTitle = false;

    if (/^h[1-6]$/.test(tag)) {
      const depth = Number(tag[1]);
      const isTitle = depth === 1 && !titleRendered;

      if (
        hasClass(node, "part-title") ||
        hasClass(node, "chapter-title")
      ) {
        firstAfterTitle = false;
        body.push(
          ...partOrChapterPage(
            hasClass(node, "chapter-title") ? "Chapter" : "Part",
            trimmedTextOf(node),
            hasClass(node, "chapter-title") ? "chapter" : "part",
          ),
        );
        return;
      }

      const titleText = trimmedTextOf(node);
      if (depth === 1 && config.headingNumbered === true) {
        // Plain `# Opener` heading: advance and restart the numbering.
        headingCounters.chapter += 1;
        headingCounters.section = 0;
        headingCounters.subsection = 0;
        headingCounters.fig = 0;
      }
      // Counters are kept for figure captions only; heading text stays clean.
      if (config.headingNumbered === true && depth === 2) {
        headingCounters.section += 1;
        headingCounters.subsection = 0;
      } else if (config.headingNumbered === true && depth === 3) {
        headingCounters.subsection += 1;
      }
      const headingText = titleText;
      if (isTitle) {
        body.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 600, after: 900, line: 300 },
            children: [
              new TextRun({
                text: titleText,
                font: config.serif,
                size: config.titleSize ?? 64,
                bold: true,
                color: config.ink,
              }),
            ],
          }),
        );
        titleRendered = true;
        firstAfterTitle = true;
        return;
      }

      firstAfterTitle = false;
      const headingAnchor = node.attrs.id;
      const headingRuns: InlineRun[] = [
        new TextRun({
          text: headingText,
          size: HEADING_SIZES[depth] ?? 24,
          font: config.headingSerif ? config.serif : config.sans,
          color: config.ink,
        }),
      ];
      body.push(
        new Paragraph({
          heading:
            HEADING_OPTIONS[
              (depth > 6 ? 6 : depth) as keyof typeof HEADING_OPTIONS
            ],
          pageBreakBefore: depth === 1,
          spacing: {
            before: depth === 1 ? 0 : 320,
            after: 200,
          },
          children: headingAnchor
            ? [new Bookmark({ id: headingAnchor, children: headingRuns })]
            : headingRuns,
        }),
      );
      return;
    }

    switch (tag) {
      case "p": {
        // Writing line (___ in Markdown): full-width ruled line to write on.
        if (hasClass(node, "md-write-line")) {
          body.push(
            new Paragraph({
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: config.border,
                  space: 4,
                },
              },
              spacing: { before: 120, after: 240 },
              children: [],
            }),
          );
          return;
        }
        const { paragraph, images } = paragraphBlock(node, nextAfterTitle);
        if (paragraph) body.push(paragraph);
        for (const img of images) {
          body.push(...(await imageBlocks(img)));
        }
        return;
      }
      case "ul":
      case "ol":
        listBlocks(node, 0, body);
        return;
      case "table":
        body.push(tableBlock(node));
        body.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
        return;
      case "blockquote":
        body.push(quoteBlock(node));
        body.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
        return;
      case "hr":
        body.push(
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: config.border,
                space: 8,
              },
            },
            spacing: { before: 240, after: 240 },
            children: [],
          }),
        );
        return;
      case "img":
        body.push(...(await imageBlocks(node)));
        return;
      case "figure":
        body.push(...(await figureBlocks(node)));
        return;
      case "div":
      case "nav": {
        const has = (name: string) => hasClass(node, name);
        if (has("part-page") || has("chapter-page")) {
          const isChapter = has("chapter-page");
          const kicker = trimmedTextOf(
            firstClass(
              node.children,
              isChapter ? "chapter-label" : "part-kicker",
            ),
          );
          let title = trimmedTextOf(
            node.children.find(
              (c) => isElement(c) && /^h[1-6]$/.test(c.tag),
            ),
          );
          if (!title) {
            title = trimmedTextOf(
              firstClass(
                node.children,
                isChapter ? "chapter-title" : "part-title",
              ),
            );
          }
          body.push(
            ...partOrChapterPage(
              kicker,
              title,
              isChapter ? "chapter" : "part",
              node.attrs.id,
            ),
          );
          return;
        }
        if (has("book-meta") || has("book-cover")) {
          body.push(metaBlock(node));
          return;
        }
        if (has("copyright-page") || has("copyright")) {
          body.push(copyrightBlock(node));
          return;
        }
        if (has("dedication")) {
          body.push(dedicationBlock(node));
          return;
        }
        if (has("restricted") || has("restricted-notice")) {
          body.push(restrictedBlock(node));
          return;
        }
        if (has("callout")) {
          body.push(calloutBlock(node));
          body.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
          return;
        }
        if (has("code-frame")) {
          body.push(codeFrameBlock(node));
          body.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
          return;
        }
        if (has("toc")) {
          body.push(...tocBlock(node));
          body.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
          return;
        }
        if (has("tool")) {
          body.push(...(await toolBlock(node)));
          body.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
          return;
        }
        if (has("worksheet")) {
          body.push(worksheetBlock(node));
          body.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
          return;
        }
        if (has("reflection")) {
          body.push(reflectionBlock(node));
          body.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
          return;
        }
        if (has("summary")) {
          body.push(summaryBlock(node));
          body.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
          return;
        }
        if (has("diagram")) {
          body.push(diagramBlock(node));
          body.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
          return;
        }
        if (hasClass(node, "feature-quote")) {
          body.push(quoteBlock(node));
          body.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
          return;
        }
        // Generic container: emit its children as blocks.
        for (const child of node.children) {
          if (!isElement(child) && !textOf(child).trim()) continue;
          await dispatch(child);
        }
        return;
      }
      default: {
        const runs = collectInline(node, {}, config);
        if (runs.length > 0) {
          body.push(
            new Paragraph({
              spacing: { after: 160, line: 300 },
              children: runs,
            }),
          );
        }
        return;
      }
    }
  };

  for (const node of nodes) {
    await dispatch(node);
  }

  // -- Document assembly ----------------------------------------------------

  const configs = [
    ...numberingConfigs,
    levelsFor("book-bullet", false),
  ];

  const headStyles = (): IStylesOptions => ({
    default: {
      document: {
        run: {
          font: config.sans,
          size: config.bodySize ?? 26,
          color: config.ink,
        },
        paragraph: { spacing: { line: config.bodyLine ?? 427 } },
      },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          font: config.headingSerif ? config.serif : config.sans,
          size: 44,
          bold: true,
          color: config.ink,
        },
        paragraph: { spacing: { before: 0, after: 200, line: 300 } },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          font: config.headingSerif ? config.serif : config.sans,
          size: 37,
          bold: true,
          color: config.ink,
        },
        paragraph: { spacing: { before: 340, after: 160, line: 300 } },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          font: config.headingSerif ? config.serif : config.sans,
          size: 29,
          bold: true,
          color: config.ink,
        },
        paragraph: { spacing: { before: 280, after: 120, line: 300 } },
      },
      {
        id: "Heading4",
        name: "Heading 4",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          font: config.headingSerif ? config.serif : config.sans,
          size: 25,
          bold: true,
          color: config.ink,
        },
        paragraph: { spacing: { before: 240, after: 100, line: 300 } },
      },
      {
        id: "Heading5",
        name: "Heading 5",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          font: config.headingSerif ? config.serif : config.sans,
          size: 24,
          bold: true,
          color: config.ink,
        },
        paragraph: { spacing: { before: 220, after: 90, line: 300 } },
      },
      {
        id: "Heading6",
        name: "Heading 6",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          font: config.headingSerif ? config.serif : config.sans,
          size: 24,
          bold: true,
          italics: true,
          color: config.ink,
        },
        paragraph: { spacing: { before: 200, after: 90, line: 300 } },
      },
      {
        id: "Caption",
        name: "Caption",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          size: 17,
          color: config.gray,
          italics: true,
        },
        paragraph: { spacing: { before: 40, after: 200 } },
      },
      {
        id: "Quote",
        name: "Quote",
        next: "Normal",
        quickFormat: true,
        basedOn: "Normal",
        run: {
          size: config.bodySize ?? 26,
          color: config.gray,
          italics: config.quoteItalic ?? true,
        },
        paragraph: { spacing: { before: 160, after: 160, line: 300 } },
      },
    ],
  });

  const bookTitle = firstH1 ? trimmedTextOf(firstH1) : "document";

  const footerDefault = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `${bookTitle.toUpperCase()}\t`,
            size: 16,
            color: config.gray,
            characterSpacing: 20,
          }),
          new TextRun({
            text: "Page ",
            size: 18,
            color: config.gray,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            size: 18,
            color: config.gray,
          }),
          new TextRun({
            text: " of ",
            size: 18,
            color: config.gray,
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: 18,
            color: config.gray,
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "book-studio",
    title: bookTitle,
    numbering: { config: configs },
    styles: headStyles(),
    features: { updateFields: true },
    sections: [
      {
        properties: {
          titlePage: config.runningHeader === true,
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers:
          config.runningHeader === true
            ? {
                default: new Header({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        // Reusable live header: Word re-runs the STYLEREF field
                        // so the current chapter title appears on every page.
                        new SimpleField(
                          ` STYLEREF "Heading 2" `,
                          bookTitle.toUpperCase(),
                        ),
                      ],
                    }),
                  ],
                }),
                first: new Header({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: bookTitle.toUpperCase(),
                          size: 16,
                          color: "9CA3AF",
                          characterSpacing: 20,
                        }),
                      ],
                    }),
                  ],
                }),
              }
            : undefined,
        footers: {
          default: footerDefault,
          first: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "·",
                    size: 18,
                    color: config.gray,
                  }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  return doc;
}

/**
 * Browser entry point: renders the HTML to a .docx Blob (downloads come from
 * the DOM). Server code should call buildDocxDocument with its own image
 * resolver and pack with Packer.toBuffer instead (see lib/docx-node.ts).
 */
export async function htmlToDocxBlob(
  html: string,
  templateId?: string,
): Promise<Blob> {
  const doc = await buildDocxDocument(html, templateId);
  return Packer.toBlob(doc);
}

/** Trigger a browser download for a generated Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}