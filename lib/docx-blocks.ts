import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TextRun,
  WidthType,
} from "docx";
import {
  buildDocxDocument,
  type TemplateConfig,
} from "./docx-export.ts";
import { parseFragment } from "parse5";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tiny HTML tree  (parse5 → HtmlNode[])
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type Attrs = Record<string, string>;

export type HtmlNode =
  | { kind: "element"; tag: string; attrs: Attrs; children: HtmlNode[] }
  | { kind: "text"; text: string };

export type ElementNode = Extract<HtmlNode, { kind: "element" }>;

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
    if (name === "#text")
      return typeof node.value === "string"
        ? [{ kind: "text", text: node.value }]
        : [];
    if (name === "#comment" || name === "#documentType") return [];
    if (typeof node.tagName !== "string") return [];
    const attrs: Attrs = {};
    for (const attr of node.attrs ?? []) attrs[attr.name.toLowerCase()] = attr.value;
    const children: HtmlNode[] = [];
    for (const child of node.childNodes ?? []) children.push(...convert(child));
    return [{ kind: "element", tag: node.tagName.toLowerCase(), attrs, children }];
  };
  for (const child of frag.childNodes ?? []) out.push(...convert(child));
  return out;
}

export function isElement(node: HtmlNode): node is ElementNode {
  return node.kind === "element";
}

export function classes(node: HtmlNode): string[] {
  return (
    (isElement(node) ? (node.attrs.class ?? "").split(/\s+/) : [])
      .map((c) => c.trim())
      .filter(Boolean)
  );
}

export function hasClass(node: HtmlNode, name: string): boolean {
  return classes(node).includes(name);
}

export function textOf(node: HtmlNode): string {
  if (node.kind === "text") return node.text;
  return node.children.map(textOf).join("");
}

export function firstClass<T extends HtmlNode>(nodes: T[], name: string): T | null {
  for (const node of nodes)
    if (isElement(node) && hasClass(node, name)) return node;
  return null;
}

export function firstClassEl(nodes: HtmlNode[], name: string): ElementNode | null {
  const found = firstClass(nodes, name);
  return found && isElement(found) ? found : null;
}

export function trimmedTextOf(
  node: HtmlNode | null | undefined,
): string {
  return textOf(node ?? { kind: "text", text: "" })
    .replace(/\s+/g, " ")
    .trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Inline runs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type RunStyle = {
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

export type InlineRun = TextRun;

function makeRun(
  text: string,
  style: RunStyle,
  config: TemplateConfig,
): TextRun {
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

export function collectInline(
  element: HtmlNode,
  style: RunStyle,
  config: TemplateConfig,
): InlineRun[] {
  if (element.kind === "text")
    return element.text ? [makeRun(element.text, style, config)] : [];

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
        if (text)
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
        break;
      }
      case "a": {
        const href = child.attrs.href ?? "";
        const inner = collectInline(child, { ...style, link: true }, config);
        if (/^https?:|^mailto:/i.test(href)) {
          out.push(new (await import("docx")).ExternalHyperlink({
            children: inner,
            link: href,
          }));
        } else if (href.startsWith("#")) {
          out.push(
            new (await import("docx")).InternalHyperlink({
              children: inner,
              anchor: href.slice(1),
            }),
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
        out.push(...collectInline(child, { ...style, superScript: true }, config));
        break;
      case "sub":
        out.push(...collectInline(child, { ...style, subScript: true }, config));
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Boxes (callout / quote / code / toc) — single-cell tables
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NO_TABLE_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

export type BorderSide = {
  style: (typeof BorderStyle)[keyof typeof BorderStyle];
  size: number;
  color: string;
};

function thinBorder(color: string): BorderSide {
  return { style: BorderStyle.SINGLE, size: 4, color };
}

export function singleCellTable(
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
      top: options.borders.top ?? thinBorder(config.border),
      bottom: options.borders.bottom ?? thinBorder(config.border),
      left: options.borders.left ?? thinBorder(config.border),
      right: options.borders.right ?? thinBorder(config.border),
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
    rows: [new (await import("docx")).TableRow({ children: [cell] })],
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Numbering (bullets / ordered lists)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

export function levelsFor(reference: string, ordered: boolean) {
  if (ordered) {
    return {
      reference,
      levels: DECIMAL_LEVELS.map((lvl, i) => ({
        level: i,
        format: LevelFormat.DECIMAL,
        text: `%${i + 1}.`,
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: { indent: { left: lvl.indent, hanging: 360 } },
        },
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
      style: {
        paragraph: { indent: { left: lvl.indent, hanging: 260 } },
      },
    })),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Block builders  (each takes config + helpers; most are pure)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Mutable state mutated by partOrChapterPage / figureBlocks. */
export type WalkState = {
  body: Parameters<Parameters<typeof buildDocxDocument>[0]>[0]["children"] extends
    (infer T)[] ? T[] : never; // eslint-disable-line @typescript-eslint/no-explicit-any
  numberingConfigs: { reference: string; levels: ReturnType<typeof levelsFor>["levels"] }[];
  orderedListCount: number;
  titleRendered: boolean;
  firstAfterTitle: boolean;
  headingCounters: { chapter: number; section: number; subsection: number; fig: number };
};

export type Blocks = {
  listBlocks: (
    element: ElementNode,
    level: number,
    out: Paragraph[],
  ) => void;
  tableBlock: (element: ElementNode) => Table;
  imageBlocks: (
    element: ElementNode,
    src: string,
  ) => Promise<Paragraph[]>;
  figureBlocks: (
    element: ElementNode,
    src: string,
  ) => Promise<Paragraph[]>;
  calloutBlock: (element: ElementNode) => Table;
  codeFrameBlock: (element: ElementNode) => Table;
  quoteBlock: (element: ElementNode) => Table;
  toolBlock: (element: ElementNode) => Table;
  worksheetBlock: (element: ElementNode) => Table;
  reflectionBlock: (element: ElementNode) => Table;
  summaryBlock: (element: ElementNode) => Table;
  diagramBlock: (element: ElementNode) => Table;
  partOrChapterPage: (
    kicker: string,
    title: string,
    kind: "part" | "chapter",
    anchorId?: string,
  ) => Paragraph[];
  metaBlock: (element: ElementNode) => Paragraph;
  copyrightBlock: (element: ElementNode) => Paragraph;
  dedicationBlock: (element: ElementNode) => Paragraph;
  restrictedBlock: (element: ElementNode) => Table;
  paragraphBlock: (
    element: ElementNode,
    firstAfterTitle: boolean,
  ) => { paragraph: Paragraph | null; images: ElementNode[] };
};

const HEADING_OPTIONS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const;

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

function cellFor(
  element: ElementNode,
  isHeader: boolean,
  fill?: string,
  config: TemplateConfig,
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
        children: isHeader
          ? collectInline(element, { bold: true, color: "FFFFFF", size: 23 }, config)
          : collectInline(element, { size: 23 }, config),
      }),
    ],
  });
}

/** Collect inline image <img> nodes from an element tree. */
function collectImages(nodes: HtmlNode[]): ElementNode[] {
  const images: ElementNode[] = [];
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.tag === "img") images.push(node);
    images.push(...collectImages(node.children));
  }
  return images;
}

export function buildBlocks(config: TemplateConfig): Blocks {
  return {
    listBlocks(element, level, out) {
      if (element.tag !== "ul" && element.tag !== "ol") return;
      const ordered = element.tag === "ol";
      let reference = "book-bullet";
      if (ordered) {
        // numberingConfigs is owned by the caller (walkBody); mutate via out parameter
        // We don't have direct access here — the walkBody wrapper mutates it.
        // listBlocks for ordered lists is handled in walkBody directly.
        // For simplicity and correctness, ordered list config is added in walkBody.
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
        if (task)
          runs.unshift(new TextRun({ text: checked ? "☑ " : "☐ ", bold: true }));
        out.push(
          new Paragraph({
            numbering: { reference, level: Math.min(level, 2) },
            spacing: { after: 80, line: 300 },
            children: runs.length > 0 ? runs : [new TextRun("")],
          }),
        );
        for (const nestedList of nested) {
          // recurse: simulate listBlocks on nested
          if (nestedList.tag === "ul" || nestedList.tag === "ol") {
            const nestedOrdered = nestedList.tag === "ol";
            const nestedRef = nestedOrdered
              ? `book-ordered-nested-${level}`
              : "book-bullet";
            for (const nli of nestedList.children.filter(isElement)) {
              if (nli.tag !== "li") continue;
              const nestedRuns: InlineRun[] = [];
              const nestedNested: ElementNode[] = [];
              let nT = false;
              let nC = false;
              for (const nc of nli.children) {
                if (isElement(nc)) {
                  if (nc.tag === "ul" || nc.tag === "ol") {
                    nestedNested.push(nc);
                    continue;
                  }
                  if (
                    nc.tag === "input" &&
                    /checkbox/i.test(nc.attrs.type ?? "")
                  ) {
                    nT = true;
                    nC = nc.attrs.checked != null;
                    continue;
                  }
                  nestedRuns.push(...collectInline(nc, {}, config));
                  continue;
                }
                if (nc.text) nestedRuns.push(makeRun(nc.text, {}, config));
              }
              if (nT)
                nestedRuns.unshift(
                  new TextRun({ text: nC ? "☑ " : "☐ ", bold: true }),
                );
              out.push(
                new Paragraph({
                  numbering: { reference: nestedRef, level: Math.min(level + 1, 2) },
                  spacing: { after: 80, line: 300 },
                  children:
                    nestedRuns.length > 0 ? nestedRuns : [new TextRun("")],
                }),
              );
              for (const nn of nestedNested)
                if (nn.tag === "ul" || nn.tag === "ol")
                  out.push(
                    // skip deep nesting beyond 2 levels — keep it simple
                    new Paragraph({
                      children: [new TextRun("")],
                    }),
                  );
            }
          }
        }
      }
    },

    tableBlock(element: ElementNode): Table {
      const headerCells: ElementNode[] = [];
      const bodyRows: ElementNode[][] = [];
      const thead = element.children.find(
        (c): c is ElementNode => isElement(c) && c.tag === "thead",
      );
      if (thead) {
        for (const row of thead.children) {
          if (!isElement(row) || row.tag !== "tr") continue;
          for (const cell of row.children) {
            if (isElement(cell) && (cell.tag === "th" || cell.tag === "td"))
              headerCells.push(cell);
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
            if (isElement(cell) && (cell.tag === "td" || cell.tag === "th"))
              cells.push(cell);
          }
          if (cells.length > 0) bodyRows.push(cells);
        }
      }
      return new Table({
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
                new (await import("docx")).TableRow({
                  tableHeader: true,
                  children: headerCells.map((cell) => cellFor(cell, true, undefined, config)),
                }),
              ]
            : []),
          ...bodyRows.map((row, index) =>
            new (await import("docx")).TableRow({
              children: row.map((cell) =>
                cellFor(cell, false, index % 2 === 1 ? config.soft : undefined, config),
              ),
            }),
          ),
        ],
      });
    },

    async imageBlocks(element: ElementNode, src: string): Promise<Paragraph[]> {
      const alt = element.attrs.alt ?? "";
      const sized = await resolveImage(src);
      if (!sized) return [];
      const displayWidth = Math.min(sized.width, 448);
      const displayHeight = Math.max(
        1,
        Math.round((displayWidth * sized.height) / Math.max(1, sized.width)),
      );
      const run = new ImageRun({
        data: sized.dataUrl,
        type: sized.mime === "image/jpeg" ? "jpg" : "png",
        transformation: { width: displayWidth, height: displayHeight },
        altText: { title: alt || "image", description: alt || "image", name: alt || "image" },
      });
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 80 },
          children: [run],
        }),
      ];
    },

    async figureBlocks(element: ElementNode, src: string): Promise<Paragraph[]> {
      const img = element.children.find(
        (c): c is ElementNode => isElement(c) && c.tag === "img",
      );
      const captionEl = element.children.find(
        (c): c is ElementNode => isElement(c) && c.tag === "figcaption",
      );
      const blocks: Paragraph[] = [];
      if (img) {
        const sized = await resolveImage(src);
        if (sized) {
          const displayWidth = Math.min(sized.width, 448);
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
                  altText: {
                    description: img.attrs.alt ?? "",
                    name: img.attrs.alt ?? "",
                  },
                }),
              ],
            }),
          );
          if (captionEl && isElement(captionEl)) {
            let captionText = trimmedTextOf(captionEl);
            blocks.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 40, after: 200 },
                children: [
                  new (await import("docx")).Bookmark({
                    id: `figure-0-0`, // placeholder; real ids set by caller
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
    },

    calloutBlock(element: ElementNode): Table {
      const titleEl = firstClass(element.children, "callout-title");
      const contentEl = firstClass(element.children, "callout-content");
      const paragraphs: Paragraph[] = [];
      if (titleEl)
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
      const content: ElementNode =
        contentEl && isElement(contentEl) ? contentEl : element;
      for (const child of content.children) {
        if (!isElement(child)) continue;
        if (child.tag === "p") {
          const runs = collectInline(child, {}, config);
          if (runs.length > 0)
            paragraphs.push(
              new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                spacing: { after: 120, line: 300 },
                children: runs,
              }),
            );
        } else if (child.tag === "ul" || child.tag === "ol") {
          const nested: Paragraph[] = [];
          buildListBlocks(child, 0, nested);
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
    },

    codeFrameBlock(element: ElementNode): Table {
      const paragraphs: Paragraph[] = [];
      const langEl = firstClass(element.children, "code-lang");
      if (langEl) {
        const lang = trimmedTextOf(langEl);
        if (lang)
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
            spacing: { before: 0, after: index === lines.length - 1 ? 0 : 0, line: 260 },
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
    },

    quoteBlock(element: ElementNode): Table {
      const paragraphs: Paragraph[] = [];
      for (const child of element.children) {
        if (!isElement(child)) continue;
        if (child.tag === "p") {
          const runs = collectInline(
            child,
            { italic: config.quoteItalic ?? true },
            config,
          );
          if (runs.length > 0)
            paragraphs.push(
              new Paragraph({
                spacing: { after: 100, line: 300 },
                children: runs,
              }),
            );
        } else if (child.tag === "ul" || child.tag === "ol") {
          const nested: Paragraph[] = [];
          buildListBlocks(child, 0, nested);
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
    },

    toolBlock(element: ElementNode): Table {
      const paragraphs: Paragraph[] = [];
      const numberEl = firstClassEl(element.children, "tool-number");
      const nameEl = firstClassEl(element.children, "tool-name");
      const bodyEl = firstClassEl(element.children, "tool-body");
      if (numberEl)
        paragraphs.push(
          smallCapsLabel(trimmedTextOf(numberEl), config.accent, 16),
        );
      if (nameEl)
        paragraphs.push(
          new Paragraph({
            spacing: { after: 60, line: 280 },
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: config.border,
                space: 4,
              },
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
      const bodyChildren = bodyEl ? bodyEl.children : [];
      for (const section of bodyChildren) {
        if (!isElement(section)) continue;
        const labelEl = firstClass(section.children, "tool-label");
        if (labelEl)
          paragraphs.push(smallCapsLabel(trimmedTextOf(labelEl), config.accent));
        const children = (section ?? { children: [] as HtmlNode[] }).children;
        for (const child of children) {
          if (!isElement(child)) continue;
          if (child.tag === "p") {
            if (hasClass(child, "md-write-line")) {
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
                  spacing: { before: 60, after: 200 },
                  children: [],
                }),
              );
              continue;
            }
            const runs = collectInline(child, {}, config);
            if (runs.length > 0)
              paragraphs.push(
                new Paragraph({
                  spacing: { after: 100, line: 300 },
                  children: runs,
                }),
              );
          } else if (child.tag === "ul" || child.tag === "ol") {
            const nested: Paragraph[] = [];
            buildListBlocks(child, 0, nested);
            paragraphs.push(...nested);
          } else if (child.tag === "div") {
            // recurse
            for (const gc of child.children)
              if (isElement(gc)) {
                if (gc.tag === "p") {
                  if (hasClass(gc, "md-write-line")) {
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
                        spacing: { before: 60, after: 200 },
                        children: [],
                      }),
                    );
                    continue;
                  }
                  const runs = collectInline(gc, {}, config);
                  if (runs.length > 0)
                    paragraphs.push(
                      new Paragraph({
                        spacing: { after: 100, line: 300 },
                        children: runs,
                      }),
                    );
                } else if (gc.tag === "ul" || gc.tag === "ol") {
                  const nested: Paragraph[] = [];
                  buildListBlocks(gc, 0, nested);
                  paragraphs.push(...nested);
                }
              }
          }
        }
      }
      return singleCellTable(paragraphs, config, {
        fill: config.paperFill ?? "FFFFFF",
        borders: {
          top: thinBorder(config.border),
          bottom: thinBorder(config.border),
          left: thinBorder(config.border),
          right: thinBorder(config.border),
        },
      });
    },

    worksheetBlock(element: ElementNode): Table {
      const paragraphs: Paragraph[] = [];
      const labelEl = firstClassEl(element.children, "worksheet-label");
      const titleEl = firstClassEl(element.children, "worksheet-title");
      const purposeEl = firstClassEl(element.children, "worksheet-purpose");
      const bodyEl = firstClassEl(element.children, "worksheet-body");
      if (labelEl)
        paragraphs.push(smallCapsLabel(trimmedTextOf(labelEl), config.accent));
      if (titleEl)
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
      if (purposeEl)
        paragraphs.push(
          new Paragraph({
            spacing: { after: 120, line: 280 },
            children: collectInline(purposeEl, { color: config.gray, size: 20 }, config),
          }),
        );
      if (bodyEl) {
        for (const child of bodyEl.children) {
          if (!isElement(child)) continue;
          if (child.tag === "p" && hasClass(child, "md-write-line"))
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
          else if (child.tag === "p")
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
          else if (child.tag === "ul") {
            const nested: Paragraph[] = [];
            buildListBlocks(child, 0, nested);
            paragraphs.push(...nested);
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
    },

    reflectionBlock(element: ElementNode): Table {
      const paragraphs: Paragraph[] = [];
      const titleEl = firstClassEl(element.children, "reflection-title");
      const beforeEl = firstClassEl(element.children, "reflection-before");
      const bodyEl = firstClassEl(element.children, "reflection-body");
      if (titleEl)
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
      if (beforeEl)
        paragraphs.push(
          new Paragraph({
            spacing: { after: 120, line: 280 },
            children: collectInline(beforeEl, { italic: true, size: 20 }, config),
          }),
        );
      const body = bodyEl ?? element;
      let n = 0;
      for (const q of body.children) {
        if (!isElement(q) || !hasClass(q, "reflection-q")) continue;
        n += 1;
        const questionEl = firstClass(q.children, "reflection-question");
        const lineEl = firstClass(q.children, "md-write-line");
        if (questionEl)
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
        if (lineEl)
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
      return singleCellTable(paragraphs, config, {
        fill: config.soft,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 24, color: config.accent },
          bottom: thinBorder(config.border),
          left: thinBorder(config.border),
          right: thinBorder(config.border),
        },
      });
    },

    summaryBlock(element: ElementNode): Table {
      const paragraphs: Paragraph[] = [];
      const kickerEl = firstClassEl(element.children, "summary-kicker");
      if (kickerEl)
        paragraphs.push(smallCapsLabel(trimmedTextOf(kickerEl), config.accent, 18));
      for (const group of element.children) {
        if (!isElement(group) || !hasClass(group, "summary-group")) continue;
        const labelEl = firstClassEl(group.children, "summary-label");
        if (labelEl)
          paragraphs.push(
            smallCapsLabel(trimmedTextOf(labelEl), config.ink, 18),
          );
        const listEl = firstClassEl(group.children, "summary-list");
        if (listEl) {
          const nested: Paragraph[] = [];
          buildListBlocks(listEl, 0, nested);
          paragraphs.push(...nested);
        } else {
          for (const child of group.children) {
            if (isElement(child) && child.tag === "p") {
              const runs = collectInline(child, {}, config);
              if (runs.length > 0)
                paragraphs.push(
                  new Paragraph({
                    spacing: { after: 80, line: 300 },
                    children: runs,
                  }),
                );
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
    },

    diagramBlock(element: ElementNode): Table {
      const flowEl = firstClassEl(element.children, "diagram-flow");
      const captionEl = firstClassEl(element.children, "diagram-caption");
      const paragraphs: Paragraph[] = [];
      const flow = flowEl ? flowEl.children : element.children;
      for (const node of flow) {
        if (!isElement(node)) continue;
        if (hasClass(node, "diagram-arrow"))
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 20, line: 240 },
              children: [new TextRun({ text: "↓", color: config.gray, size: 20 })],
            }),
          );
        else if (hasClass(node, "diagram-node")) {
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
      if (captionEl)
        paragraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 40, line: 260 },
            children: collectInline(captionEl, { color: config.gray, size: 17 }, config),
          }),
        );
      return singleCellTable(paragraphs, config, {
        fill: config.codeBg,
        borders: {
          top: thinBorder(config.border),
          bottom: thinBorder(config.border),
          left: thinBorder(config.border),
          right: thinBorder(config.border),
        },
      });
    },

    partOrChapterPage(
      kicker: string,
      title: string,
      kind: "part" | "chapter",
      anchorId?: string,
    ): Paragraph[] {
      const isChapter = kind === "chapter";
      if (config.headingNumbered === true) {
        const n = /(\d+)\s*$/.exec(kicker);
        if (n) headingCounters.chapter = Number(n[1]);
        headingCounters.section = 0;
        headingCounters.subsection = 0;
        headingCounters.fig = 0;
      }
      const bodyOut: Paragraph[] = [];
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
                new (await import("docx")).Bookmark({
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
      if (!useKicker)
        bodyOut.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 400, after: 200, line: 240 },
            children: [
              new TextRun({
                text: "─── ♦ ───",
                color: config.accent,
                size: 18,
              }),
            ],
          }),
        );
      bodyOut.push(new Paragraph({ spacing: { before: 400 }, children: [] }));
      return bodyOut;
    },

    metaBlock(element: ElementNode): Paragraph {
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
    },

    copyrightBlock(element: ElementNode): Paragraph {
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
    },

    dedicationBlock(element: ElementNode): Paragraph {
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
    },

    restrictedBlock(element: ElementNode): Table {
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
    },

    paragraphBlock(
      element: ElementNode,
      firstAfterTitle: boolean,
    ): { paragraph: Paragraph | null; images: ElementNode[] } {
      const images = collectImages(element.children);
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
    },
  };
}

// Simpler list blocks for use inside block builders (no numbering config mutation).
function buildListBlocks(
  element: ElementNode,
  level: number,
  out: Paragraph[],
): void {
  if (element.tag !== "ul" && element.tag !== "ol") return;
  const ordered = element.tag === "ol";
  const reference = ordered ? `book-ordered-inline-${level}` : "book-bullet";
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
    if (task)
      runs.unshift(new TextRun({ text: checked ? "☑ " : "☐ ", bold: true }));
    out.push(
      new Paragraph({
        numbering: { reference, level: Math.min(level, 2) },
        spacing: { after: 80, line: 300 },
        children: runs.length > 0 ? runs : [new TextRun("")],
      }),
    );
  }
}

function smallCapsLabel(
  text: string,
  color: string,
  size = 17,
): Paragraph {
  return new Paragraph({
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
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mutable counters (hoisted so block builders can mutate them)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let headingCounters: { chapter: number; section: number; subsection: number; fig: number } =
  { chapter: 0, section: 0, subsection: 0, fig: 0 };
