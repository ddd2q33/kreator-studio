"use client";

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FilePlus,
  FileText,
  Folder,
  ImagePlus,
  Palette,
  Plus,
  RotateCcw,
  Trash2,
  X,
  Library,
  History,
  MessageSquarePlus,
  Blocks,
  FolderOpen,
} from "lucide-react";
import { TEMPLATES, getTemplate } from "./templates";
import {
  downloadBlob,
  htmlToDocxBlob,
  suggestedFilename,
} from "@/lib/docx-export";
import { jsonToMarkdown } from "@/lib/json-to-markdown";
import { processDirectives } from "@/lib/directives";
import {
  createProject,
  loadProjectStore,
  saveProjectStore,
  uid,
  type Project,
  type ProjectComment,
  type ProjectDoc,
  type ProjectRevision,
} from "@/lib/projects";
import { MarkdownToolbar } from "@/components/editor/writer-toolbar";
import { ProjectManager } from "@/components/editor/project-manager";
import { PresetsPanel } from "@/components/editor/presets-panel";
import { BlocksPanel } from "@/components/editor/blocks-panel";
import { RevisionsPanel } from "@/components/editor/revisions-panel";
import { CommentsPanel } from "@/components/editor/comments-panel";
import { BOOK_PRESETS, presetById } from "@/components/editor/book-presets";

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

type ImageMap = Record<string, string>;

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resolveImage(href: string, images: ImageMap): string {
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

const RENDER_OPTIONS = { gfm: true, breaks: true } as const;

function slugify(text: string): string {
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
type Openers = { chapter: number; part: number };
const CHAPTER_TITLE_RE = /^(chapter)\s+(\d+|[ivxlcdm]+)(?::|\.|—|–|-|\s)\s*/i;
const PART_TITLE_RE = /^(part)\s+(\d+|[ivxlcdm]+)(?::|\.|—|–|-|\s)\s*/i;
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
function openersFromHtml(html: string): Openers {
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

function plainHeadingText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

const ADMONITION_TITLES: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
  "best-practice": "Best Practice",
  error: "Error",
  example: "Example",
};

const ADMONITION_ICONS: Record<string, string> = {
  note: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  tip: `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>`,
  important: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  warning: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
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
function titleFromMarkdown(md: string): string | null {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].trim() : null;
}

function hexToRgba(hex: string, alpha: number): string {
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

const ACCENT_SWATCHES = [
  "#3E5C76",
  "#2F6F6A",
  "#4A7C59",
  "#7C6A46",
  "#96660F",
  "#8C4A3F",
  "#5B4A8A",
  "#4F46E5",
];

const FRONT_MATTER_RE = /^(part|book|chapter)\s+(\d+|[ivxlcdm]+)/i;

function buildTocHtml(
  rendered: string,
  chapterDepth = 2,
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

function hasTocMarker(markdown: string): boolean {
  return (
    /^\[toc\]\s*$/im.test(markdown) || /^<!--\s*toc\s*-->\s*$/im.test(markdown)
  );
}

const STORAGE_KEY_TEXT = "markdown-converter-text";
const STORAGE_KEY_IMAGES = "markdown-converter-images";
const STORAGE_KEY_CUSTOM = "markdown-converter-custom";

type Chapter = { id: string; title: string; markdown: string };

type CustomVariant = {
  accent: string | null;
  font: "default" | "serif" | "sans";
  width: "default" | "wide" | "narrow" | "full";
};

const DEFAULT_CUSTOM: CustomVariant = {
  accent: null,
  font: "default",
  width: "default",
};

type PersistedText = {
  activeTemplate: string;
  markdown: string;
  htmlOverride: string | null;
  jsonText?: string;
  sourceMode?: "markdown" | "json";
  chapters?: Chapter[];
  activeChapter?: number;
  bookMode?: boolean;
};

function loadPersistedText(): PersistedText | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_TEXT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedText;
    if (typeof parsed.markdown !== "string") return null;
    if (typeof parsed.activeTemplate !== "string") return null;
    return {
      activeTemplate: parsed.activeTemplate,
      markdown: parsed.markdown,
      htmlOverride:
        typeof parsed.htmlOverride === "string" ? parsed.htmlOverride : null,
      jsonText: typeof parsed.jsonText === "string" ? parsed.jsonText : "",
      sourceMode: parsed.sourceMode === "json" ? "json" : "markdown",
      chapters: Array.isArray(parsed.chapters)
        ? parsed.chapters.filter(
            (c): c is Chapter =>
              !!c &&
              typeof c === "object" &&
              typeof (c as Chapter).markdown === "string" &&
              typeof (c as Chapter).id === "string",
          )
        : [],
      activeChapter:
        typeof parsed.activeChapter === "number" ? parsed.activeChapter : 0,
      bookMode: parsed.bookMode === true,
    };
  } catch {
    return null;
  }
}

function loadPersistedImages(): ImageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_IMAGES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { images?: ImageMap };
    return parsed.images && typeof parsed.images === "object"
      ? parsed.images
      : {};
  } catch {
    return {};
  }
}

function loadPersistedCustom(): CustomVariant {
  if (typeof window === "undefined") return DEFAULT_CUSTOM;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (!raw) return DEFAULT_CUSTOM;
    const parsed = JSON.parse(raw) as Partial<CustomVariant>;
    return {
      accent:
        typeof parsed.accent === "string" ? parsed.accent : null,
      font:
        parsed.font === "serif" || parsed.font === "sans"
          ? parsed.font
          : "default",
      width:
        parsed.width === "wide" ||
        parsed.width === "narrow" ||
        parsed.width === "full"
          ? parsed.width
          : "default",
    };
  } catch {
    return DEFAULT_CUSTOM;
  }
}

function savePersisted(value: { text?: PersistedText; images?: ImageMap }): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (value.text !== undefined) {
      window.localStorage.setItem(STORAGE_KEY_TEXT, JSON.stringify(value.text));
    }
    if (value.images !== undefined) {
      window.localStorage.setItem(
        STORAGE_KEY_IMAGES,
        JSON.stringify({ images: value.images }),
      );
    }
    return true;
  } catch {
    return false;
  }
}

const JSON_EXAMPLE = JSON.stringify(
  {
    title: "The Healing Brain",
    subtitle: "A workbook for trauma, identity and post-traumatic growth",
    author: "Dr. Alex Rivera",
    edition: "1st edition, 2026",
    toc: true,
    dedication: "For everyone finding their way back to safety.",
    preface: "This workbook accompanies the reader through a safety-first approach to understanding trauma, regulating the nervous system, and rebuilding identity.",
    howToUse: [
      "Each chapter ends with a reflection exercise.",
      "Write freely; there are no wrong answers.",
    ],
    parts: [
      {
        title: "Understanding Your Story",
        chapters: [
          {
            title: "Understanding Trauma Responses",
            intro: "Trauma responses are survival adaptations, not personal failures.",
            content: [
              "When the amygdala senses threat, the body reacts before thought.",
              "Regulation begins with naming what is happening.",
            ],
            note: "Trauma responses are survival adaptations, not personal failures.",
            sections: [
              {
                heading: "The alarm system",
                content: [
                  "The brain and body respond to danger with survival strategies: fight, flight, freeze or fawn.",
                ],
                warning: "These are protective adaptations, not character flaws.",
              },
            ],
            keyTakeaways: ["Name it to tame it", "Safety precedes processing"],
            journal: [
              "What does your body notice when you feel safe?",
              "What feeling is hardest to name right now?",
            ],
          },
          {
            title: "Building Safety",
            content: [
              "The brain seeks safety before connection. Build it through routines, stable relationships, and a paced approach to difficult material.",
            ],
            exercises: [
              {
                title: "Three-step regulation practice",
                steps: [
                  "Ground — place your feet on the floor.",
                  "Orient — slowly scan the room.",
                  "Soften — relax your jaw and shoulders.",
                ],
              },
            ],
          },
        ],
      },
      {
        title: "Rebuilding",
        chapters: [
          {
            title: "Post-Traumatic Growth",
            content: [
              "Growth after trauma does not mean forgetting. It means the story gains new chapters: of endurance, learning, and connection.",
            ],
            strategies: [
              "Relating to others: deeper, more honest bonds.",
              "Personal strength: \u201CI survived\u201D becomes \u201CI can handle this\u201D.",
              "New possibilities: a renewed sense of purpose.",
            ],
            tip: "Growth is not linear. Small, repeated experiences of safety create new neural pathways.",
            journal: [
              "What is one strength you discovered this week?",
              "What new possibility has opened for you?",
            ],
          },
        ],
      },
    ],
    resources: [
      { title: "The Body Keeps the Score", author: "Bessel van der Kolk" },
      { title: "The Polyvagal Theory in Therapy", author: "Deb Dana" },
    ],
  },
  null,
  2,
);

export default function MarkdownConverter() {
  const defaultTemplate = TEMPLATES[0];
  const [activeTemplate, setActiveTemplate] = useState(defaultTemplate.id);
  const [markdown, setMarkdown] = useState(defaultTemplate.content);
  const [sourceMode, setSourceMode] = useState<"markdown" | "json">("markdown");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapter, setActiveChapter] = useState(0);
  const [bookMode, setBookMode] = useState(false);
  const [custom, setCustom] = useState<CustomVariant>(DEFAULT_CUSTOM);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [htmlOverride, setHtmlOverride] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "html">("preview");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [images, setImages] = useState<ImageMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const lastSourceRef = useRef(markdown);
  const [store, setStore] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [panel, setPanel] = useState<
    "projects" | "presets" | "blocks" | "revisions" | "notes" | null
  >(null);

  const hydrateFromDoc = useCallback((doc: ProjectDoc) => {
    const template = getTemplate(doc.activeTemplate);
    if (template) setActiveTemplate(template.id);
    setMarkdown(doc.markdown);
    setHtmlOverride(doc.htmlOverride ?? null);
    setJsonText(doc.jsonText ?? "");
    setSourceMode(doc.sourceMode === "json" ? "json" : "markdown");
    const savedChapters = doc.chapters ?? [];
    if (savedChapters.length > 0) {
      setChapters(savedChapters);
      const idx = Math.min(
        Math.max(doc.activeChapter ?? 0, 0),
        savedChapters.length - 1,
      );
      setActiveChapter(idx);
      setBookMode(doc.bookMode === true);
      lastSourceRef.current =
        savedChapters[idx]?.markdown ?? doc.markdown;
    } else {
      setChapters([]);
      setActiveChapter(0);
      setBookMode(false);
      lastSourceRef.current = doc.markdown;
    }
    if (doc.custom) setCustom(doc.custom);
  }, []);

  useEffect(() => {
    const saved = loadPersistedText();
    const savedImages = loadPersistedImages();
    const store = loadProjectStore();
    const activeProject = store.projects.find((p) => p.id === store.activeId);

    queueMicrotask(() => {
      if (activeProject) {
        hydrateFromDoc(activeProject.doc);
      } else if (saved) {
        // Migrate the legacy single-document payload into a project.
        const template = getTemplate(saved.activeTemplate);
        if (template) setActiveTemplate(template.id);
        setMarkdown(saved.markdown);
        setHtmlOverride(saved.htmlOverride);
        const restoredJson = saved.jsonText ?? "";
        const restoredMode = saved.sourceMode === "json" ? "json" : "markdown";
        setJsonText(restoredJson);
        setSourceMode(restoredMode);
        const savedChapters = saved.chapters ?? [];
        if (savedChapters.length > 0) {
          setChapters(savedChapters);
          const savedIndex = Math.min(
            Math.max(saved.activeChapter ?? 0, 0),
            savedChapters.length - 1,
          );
          setActiveChapter(savedIndex);
          setBookMode(saved.bookMode === true);
          lastSourceRef.current =
            restoredMode === "json"
              ? jsonToMarkdown(restoredJson).markdown
              : (savedChapters[savedIndex]?.markdown ?? saved.markdown);
        } else {
          lastSourceRef.current =
            restoredMode === "json"
              ? jsonToMarkdown(restoredJson).markdown
              : saved.markdown;
        }
      } else if (TEMPLATES[0]) {
        setMarkdown(TEMPLATES[0].content);
        lastSourceRef.current = TEMPLATES[0].content;
      }
      setCustom(loadPersistedCustom());
      if (Object.keys(savedImages).length > 0) setImages(savedImages);

      if (store.projects.length === 0) {
        const doc: ProjectDoc = {
          activeTemplate: saved
            ? saved.activeTemplate
            : (TEMPLATES[0]?.id ?? activeTemplate),
          markdown: saved ? saved.markdown : (TEMPLATES[0]?.content ?? markdown),
          htmlOverride: saved?.htmlOverride ?? null,
          jsonText: saved?.jsonText ?? "",
          sourceMode: saved?.sourceMode === "json" ? "json" : "markdown",
          chapters: saved?.chapters ?? [],
          activeChapter: saved?.activeChapter ?? 0,
          bookMode: saved?.bookMode === true,
          custom: loadPersistedCustom(),
        };
        const project = createProject(
          "My first book",
          doc.activeTemplate,
          doc.markdown,
        );
        project.doc = doc;
        setStore([project]);
        setActiveProjectId(project.id);
        saveProjectStore({ activeId: project.id, projects: [project] });
      } else {
        setStore(store.projects);
        setActiveProjectId(activeProject ? store.activeId : null);
      }
      setHydrated(true);
      setStoreReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const textPayload = {
      activeTemplate,
      markdown,
      htmlOverride,
      jsonText,
      sourceMode,
      chapters,
      activeChapter,
      bookMode,
    };
    const withText = savePersisted({ text: textPayload, images });
    const ok = withText || savePersisted({ text: textPayload });
    queueMicrotask(() => {
      setAutoSaved(ok);
      if (!withText) {
        if (ok) {
          toast.warning(
            "Storage full: images could not be saved, but your text is safe after refresh.",
          );
        } else {
          toast.warning("Could not auto-save your changes in this browser.");
        }
      }
    });
  }, [
    hydrated,
    activeTemplate,
    markdown,
    htmlOverride,
    jsonText,
    sourceMode,
    chapters,
    activeChapter,
    bookMode,
    images,
  ]);

  // In JSON mode the source of truth is the converted, structured Markdown;
  // everything downstream (preview, templates, HTML tab, exports) is unchanged.
  const jsonConversion = useMemo(() => jsonToMarkdown(jsonText), [jsonText]);
  const activeMarkdown =
    sourceMode === "json"
      ? jsonConversion.markdown
      : bookMode
        ? (chapters[activeChapter]?.markdown ?? markdown)
        : markdown;

  // Persist the active project document into the project store.
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);
  useEffect(() => {
    if (!storeReady || !activeProjectId) return;
    const doc: ProjectDoc = {
      activeTemplate,
      markdown,
      htmlOverride,
      jsonText,
      sourceMode,
      chapters,
      activeChapter,
      bookMode,
      custom,
    };
    const projects = storeRef.current.map((p) =>
      p.id === activeProjectId ? { ...p, doc, updatedAt: Date.now() } : p,
    );
    saveProjectStore({ activeId: activeProjectId, projects });
  }, [
    storeReady,
    activeProjectId,
    activeTemplate,
    markdown,
    htmlOverride,
    jsonText,
    sourceMode,
    chapters,
    activeChapter,
    bookMode,
    custom,
  ]);

  // Persist the custom template variant separately (small, never evicted).
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(custom));
    } catch {
      /* non-critical */
    }
  }, [hydrated, custom]);

  // Live theme overrides appended after the template CSS: same specificity,
  // later wins, so each rule just overrides the variable it names.
  const themeOverrideCss = useMemo(() => {
    const hasAccent = custom.accent !== null;
    const untouched =
      !hasAccent && custom.font === "default" && custom.width === "default";
    if (untouched) return "";
    const rules: string[] = ["\n/* Custom variant */", ".markdown-body {"];
    if (hasAccent && custom.accent) {
      rules.push(`  --md-accent: ${custom.accent};`);
      rules.push(`  --md-soft: ${hexToRgba(custom.accent, 0.08)};`);
    }
    if (custom.font === "serif") {
      rules.push(
        '  --md-font-sans: "Lora", Georgia, "Times New Roman", serif;',
      );
    }
    if (custom.font === "sans") {
      rules.push(
        '  --md-font-serif: "Inter", ui-sans-serif, system-ui, sans-serif;',
      );
    }
    if (custom.width === "wide") rules.push("  max-width: 88rem;");
    if (custom.width === "narrow") rules.push("  max-width: 56rem;");
    if (custom.width === "full") {
      rules.push("  max-width: none;");
      rules.push("  padding-left: 6vw;");
      rules.push("  padding-right: 6vw;");
    }
    rules.push("}");
    return rules.join("\n");
  }, [custom]);

  // Markdown → HTML pipeline shared by the preview, the compiled book and
  // (via the same functions) every export.
  const renderMarkdown = useMemo(() => {
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
            ? `<figure>${img}${cap}</figure>`
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
  }, [images, bookMode]);

  const generatedHtml = useMemo(
    () => renderMarkdown(activeMarkdown),
    [renderMarkdown, activeMarkdown],
  );

  // Once the user edits the HTML tab directly, that version becomes the source
  // of truth for preview, copy and both export formats until regenerated.
  // In book mode the whole book (every chapter, each on its own printed
  // page) is what preview and exports use.
  const compiledBookHtml = useMemo(() => {
    if (!bookMode || chapters.length === 0) return "";
    return chapters
      .map((ch, i) => {
        const md = ch.markdown.trim()
          ? ch.markdown
          : `# ${ch.title || `Chapter ${i + 1}`}`;
        return `<section class="book-chapter">\n${renderMarkdown(md)}\n</section>`;
      })
      .join("\n\n");
  }, [bookMode, chapters, renderMarkdown]);

  const html = useMemo(
    () =>
      htmlOverride ??
      (bookMode && compiledBookHtml ? compiledBookHtml : generatedHtml),
    [htmlOverride, bookMode, compiledBookHtml, generatedHtml],
  );

  // Editing the Markdown invalidates a manual HTML override so the preview
  // never shows stale hand-edited markup. Image-map changes are allowed to
  // keep a manual override (it already contains the embedded data URLs).
  useEffect(() => {
    if (lastSourceRef.current === activeMarkdown) return;
    lastSourceRef.current = activeMarkdown;
    setHtmlOverride(null);
  }, [activeMarkdown]);

  const editorText =
    sourceMode === "json"
      ? jsonText
      : bookMode
        ? (chapters[activeChapter]?.markdown ?? "")
        : markdown;

  const stats = useMemo(() => {
    const trimmed = editorText.trim();
    const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
    return {
      chars: editorText.length,
      words,
      lines: editorText.split("\n").length,
    };
  }, [editorText]);

  const loadTemplate = useCallback(
    (id: string, force = false) => {
      if (id === activeTemplate && !force) return;
      if (!getTemplate(id)) return;
      // Templates restyle the output only; the content stays as-is.
      // (Load an example explicitly with the Example button.)
      setActiveTemplate(id);
    },
    [activeTemplate],
  );

  const loadTemplateExample = useCallback(() => {
    const example = getTemplate(activeTemplate) ?? TEMPLATES[0];
    setHtmlOverride(null);
    setMarkdown(example.content);
  }, [activeTemplate]);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const mdFiles = list.filter((f) =>
        /\.(md|markdown|mdown)$/i.test(f.name),
      );
      const jsonFiles = list.filter((f) => /\.json$/i.test(f.name));
      const imgFiles = list.filter((f) => f.type.startsWith("image/"));

      if (
        mdFiles.length === 0 &&
        imgFiles.length === 0 &&
        jsonFiles.length === 0
      ) {
        toast.warning("No Markdown, JSON or image files found.");
        return;
      }

      if (imgFiles.length > 0) {
        const next: ImageMap = { ...images };
        for (const file of imgFiles) {
          const dataUrl = await fileToDataURL(file);
          const base = file.name.toLowerCase();
          next[base] = dataUrl;
          if (file.webkitRelativePath) {
            next[file.webkitRelativePath.replace(/\\/g, "/")] = dataUrl;
          }
        }
        setImages(next);
      }

      if (mdFiles.length > 0) {
        const sorted = [...mdFiles].sort((a, b) =>
          (a.webkitRelativePath || a.name).localeCompare(
            b.webkitRelativePath || b.name,
          ),
        );
        const contents = await Promise.all(sorted.map((f) => f.text()));
        const combined = contents
          .map((c) => c.trim().replace(/\n+$/, ""))
          .filter(Boolean)
          .join("\n\n");
        setMarkdown(combined);
        setSourceMode("markdown");
        setTab("preview");
        toast.success(
          `Imported ${sorted.length} Markdown file(s)${sorted.length > 1 ? ` (${sorted.map((f) => f.name).join(", ")})` : ""}${imgFiles.length > 0 ? ` with ${imgFiles.length} image(s).` : "."}`,
        );
      } else if (jsonFiles.length > 0) {
        const main = jsonFiles[0];
        const content = await main.text();
        setJsonText(content);
        setSourceMode("json");
        setTab("preview");
        toast.success(
          `Imported "${main.name}" — converted to structured Markdown.`,
        );
      } else if (imgFiles.length > 0) {
        toast.success(`Embedded ${imgFiles.length} image(s).`);
      }
    },
    [images],
  );

  const clearImages = useCallback(() => {
    setImages({});
    setHtmlOverride(null);
    toast.success("Uploaded images cleared.");
  }, []);

  const insertImageReference = useCallback(
    (name: string) => {
      const ref = `![${name.replace(/\.[a-z0-9]+$/i, "")}](${name})`;
      if (sourceMode === "json") {
        // Inserting Markdown into a JSON document would corrupt it — offer
        // the reference on the clipboard instead.
        void navigator.clipboard
          .writeText(ref)
          .then(() =>
            toast.success(
              "Image reference copied — paste it into your JSON content.",
            ),
          )
          .catch(() => toast.error("Could not copy the image reference."));
        return;
      }
      const el = editorRef.current;
      const start = el?.selectionStart ?? markdown.length;
      const end = el?.selectionEnd ?? start;
      // Keep the reference on its own paragraph: pad with blank lines so it
      // never glues to surrounding text (e.g. a heading on the same line).
      const before = markdown.slice(0, start);
      const after = markdown.slice(end);
      const padBefore =
        before.length === 0
          ? ""
          : /\n\n$/.test(before)
            ? ""
            : /\n$/.test(before)
              ? "\n"
              : "\n\n";
      const padAfter =
        after.length === 0
          ? ""
          : /^\n\n/.test(after)
            ? ""
            : /^\n/.test(after)
              ? "\n"
              : "\n\n";
      setMarkdown((m) => `${m.slice(0, start)}${padBefore}${ref}${padAfter}${m.slice(end)}`);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const pos = start + padBefore.length + ref.length + padAfter.length;
        el.setSelectionRange(pos, pos);
      });
    },
    [markdown, sourceMode],
  );

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const imgFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imgFiles.length === 0) {
        toast.warning("No image files found.");
        return;
      }
      const next: ImageMap = { ...images };
      for (const file of imgFiles) {
        const dataUrl = await fileToDataURL(file);
        const base = file.name.toLowerCase();
        next[base] = dataUrl;
        if (file.webkitRelativePath) {
          next[file.webkitRelativePath.replace(/\\/g, "/")] = dataUrl;
        }
      }
      setImages(next);
      if (imgFiles.length === 1) {
        insertImageReference(imgFiles[0].name);
        toast.success(`Embedded "${imgFiles[0].name}".`);
      } else {
        toast.success(
          `Embedded ${imgFiles.length} images. Click a thumbnail below to insert it.`,
        );
      }
    },
    [images, insertImageReference],
  );

  const removeImage = useCallback((name: string) => {
    setImages((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setHtmlOverride(null);
  }, []);

  const regenerateHtml = useCallback(() => {
    setHtmlOverride(null);
    setTab("preview");
    toast.success("HTML regenerated from Markdown.");
  }, []);

  const isHtmlOverride = htmlOverride !== null;

  // -- Book (multi-chapter) mode --------------------------------------------

  const addChapter = useCallback(() => {
    const chapter: Chapter = {
      id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: `Chapter ${chapters.length + 1}`,
      markdown: `# Chapter ${chapters.length + 1}\n\nStart writing…`,
    };
    setChapters((prev) => [...prev, chapter]);
    setActiveChapter(chapters.length);
    setSourceMode("markdown");
    setBookMode(true);
  }, [chapters.length]);

  const removeChapter = useCallback(
    (index: number) => {
      setChapters((prev) => {
        const next = prev.filter((_, i) => i !== index);
        if (next.length === 0) {
          setBookMode(false);
          setActiveChapter(0);
          return next;
        }
        setActiveChapter((a) => Math.min(Math.max(a, 0), next.length - 1));
        return next;
      });
    },
    [],
  );

  const renameChapter = useCallback((index: number, title: string) => {
    setChapters((prev) =>
      prev.map((c, i) => (i === index ? { ...c, title } : c)),
    );
  }, []);

  const moveChapter = useCallback((index: number, dir: -1 | 1) => {
    setChapters((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      setActiveChapter(target);
      return next;
    });
  }, []);

  const toggleBookMode = useCallback(() => {
    setBookMode((on) => {
      if (on) return false;
      // Turning it on: take the current editor content as the first chapter.
      if (chapters.length === 0 && markdown.trim() !== "") {
        setChapters([
          {
            id: `ch-${Date.now()}`,
            title: titleFromMarkdown(markdown) ?? "Chapter 1",
            markdown,
          },
        ]);
        setActiveChapter(0);
      }
      setSourceMode("markdown");
      return true;
    });
  }, [chapters.length, markdown]);

  const updateBookEditor = useCallback(
    (value: string) => {
      setChapters((prev) =>
        prev.map((c, i) =>
          i === activeChapter ? { ...c, markdown: value } : c,
        ),
      );
    },
    [activeChapter],
  );

  const compileBook = useCallback(() => {
    if (chapters.length === 0) {
      toast.warning("Add chapters before compiling the book.");
      return;
    }
    setHtmlOverride(null);
    setTab("preview");
    toast.success(
      `Book compiled — ${chapters.length} chapter(s), each starting on a new page.`,
    );
  }, [chapters.length]);

  const copyHtml = useCallback(async () => {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("HTML copied to clipboard.");
  }, [html]);

  const copyMarkdown = useCallback(async () => {
    await navigator.clipboard.writeText(editorText);
    toast.success(
      sourceMode === "json"
        ? "JSON copied to clipboard."
        : "Markdown copied to clipboard.",
    );
  }, [editorText, sourceMode]);

  const fullDocFor = useCallback(
    (bodyHtml: string) => {
      const template = getTemplate(activeTemplate);
      const documentTitle =
        titleFromMarkdown(activeMarkdown) ??
        (bookMode ? "My Book" : null) ??
        template?.label ??
        "document";
      const css = `${template?.style ?? ""}${themeOverrideCss}`;
      return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${documentTitle}</title>\n  <style>\n${css}\n  </style>\n</head>\n<body class="markdown-body theme-${activeTemplate}">\n${bodyHtml}\n</body>\n</html>`;
    },
    [activeTemplate, themeOverrideCss, activeMarkdown, bookMode],
  );  const downloadHtml = useCallback(() => {
    const doc = fullDocFor(html);
    const documentTitle =
      titleFromMarkdown(activeMarkdown) ??
      (bookMode ? "my-book" : null) ??
      getTemplate(activeTemplate)?.label ??
      "document";
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${documentTitle}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fullDocFor, html, activeMarkdown, bookMode, activeTemplate]);

  const clearEditor = useCallback(() => {
    setHtmlOverride(null);
    if (sourceMode === "json") setJsonText("");
    else setMarkdown("");
  }, [sourceMode]);

  const downloadDocx = useCallback(async () => {
    if (isExportingDocx) return;
    setIsExportingDocx(true);
    try {
      const blob = await htmlToDocxBlob(html, activeTemplate);
      downloadBlob(blob, `${suggestedFilename(activeMarkdown)}.docx`);
      toast.success(`Exported "${suggestedFilename(activeMarkdown)}.docx".`);
    } catch (error) {
      console.error("DOCX export failed:", error);
      toast.error("DOCX export failed. Check the console for details.");
    } finally {
      setIsExportingDocx(false);
    }
  }, [html, activeTemplate, isExportingDocx, activeMarkdown]);

  const downloadPdf = useCallback(async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: fullDocFor(html) }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`PDF export failed (${response.status}): ${text}`);
      }
      const blob = await response.blob();
      downloadBlob(blob, `${suggestedFilename(activeMarkdown)}.pdf`);
      toast.success(`Exported "${suggestedFilename(activeMarkdown)}.pdf".`);
    } catch (error) {
      console.error("PDF export failed:", error);
      const detail =
        error instanceof Error && error.message
          ? error.message.replace(/^Error: /i, "")
          : "unknown error";
      toast.error(`PDF export failed: ${detail}`);
    } finally {
      setIsExportingPdf(false);
    }
  }, [fullDocFor, html, isExportingPdf, activeMarkdown]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void importFiles(e.dataTransfer.files);
      }
    },
    [importFiles],
  );

  // -- Projects ---------------------------------------------------------------

  const currentProject = store.find((p) => p.id === activeProjectId) ?? null;

  const persistStore = useCallback(
    (projects: Project[]) => {
      const activeId =
        activeProjectId && projects.some((p) => p.id === activeProjectId)
          ? activeProjectId
          : (projects[0]?.id ?? "");
      setStore(projects);
      setActiveProjectId(projects.length > 0 ? (activeId || null) : null);
      saveProjectStore({ activeId, projects });
    },
    [activeProjectId],
  );

  const createProjectHandler = useCallback(
    (name: string) => {
      const example = presetById("therapy") ?? BOOK_PRESETS[0];
      const project = createProject(
        name || "Untitled book",
        example.templateId,
        example.starter,
        example.id,
      );
      persistStore([...store, project]);
      setActiveProjectId(project.id);
      hydrateFromDoc(project.doc);
      setPanel(null);
      toast.success(`Created "${project.name}".`);
    },
    [store, persistStore, hydrateFromDoc],
  );

  const selectProject = useCallback(
    (id: string) => {
      const target = store.find((p) => p.id === id);
      if (!target) return;
      setActiveProjectId(id);
      hydrateFromDoc(target.doc);
      setPanel(null);
    },
    [store, hydrateFromDoc],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      persistStore(
        store.map((p) => (p.id === id ? { ...p, name: clean } : p)),
      );
    },
    [store, persistStore],
  );

  const deleteProject = useCallback(
    (id: string) => {
      if (store.length === 1) {
        toast.warning("Keep at least one project.");
        return;
      }
      const next = store.filter((p) => p.id !== id);
      persistStore(next);
      setActiveProjectId(null);
      const fallback = next[0];
      if (fallback) {
        setActiveProjectId(fallback.id);
        hydrateFromDoc(fallback.doc);
      }
      toast.success("Project deleted.");
    },
    [store, persistStore, hydrateFromDoc],
  );

  const duplicateProject = useCallback(
    (id: string) => {
      const src = store.find((p) => p.id === id);
      if (!src) return;
      const copy: Project = {
        ...src,
        id: uid("proj-"),
        name: `${src.name} (copy)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        revisions: [],
        comments: [],
        doc: {
          ...src.doc,
          chapters: src.doc.chapters?.map((c) => ({ ...c })),
        },
      };
      persistStore([...store, copy]);
      setActiveProjectId(copy.id);
      hydrateFromDoc(copy.doc);
      toast.success(`Duplicated "${src.name}".`);
    },
    [store, persistStore, hydrateFromDoc],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = presetById(presetId);
      if (!preset) return;
      const template = getTemplate(preset.templateId);
      if (template) setActiveTemplate(template.id);
      setCustom(preset.custom);
      // Only replace content when the editor is effectively empty or the
      // current project was never started (matches empty template content).
      if (currentProject && currentProject.doc.markdown.trim() === "") {
        setMarkdown(preset.starter);
        setHtmlOverride(null);
      }
      if (currentProject) {
        persistStore(
          store.map((p) =>
            p.id === currentProject.id
              ? {
                  ...p,
                  presetId: preset.id,
                  doc: {
                    ...p.doc,
                    activeTemplate: preset.templateId,
                    custom: preset.custom,
                  },
                }
              : p,
          ),
        );
      }
      setPanel(null);
      toast.success(`Applied preset "${preset.label}".`);
    },
    [currentProject, store, persistStore],
  );

  // -- Revisions ---------------------------------------------------------------

  const revisionTargetDoc = useCallback((): string => {
    if (bookMode) {
      return chapters.map((c) => c.markdown).join("\n\n");
    }
    return sourceMode === "json" ? jsonConversion.markdown : markdown;
  }, [bookMode, chapters, sourceMode, jsonConversion.markdown, markdown]);

  const saveRevision = useCallback(
    (label: string) => {
      if (!currentProject) return;
      const revision: ProjectRevision = {
        id: uid("rev-"),
        label: label || `Version ${currentProject.revisions.length + 1}`,
        doc: {
          activeTemplate,
          markdown,
          htmlOverride,
          jsonText,
          sourceMode,
          chapters: chapters.map((c) => ({ ...c })),
          activeChapter,
          bookMode,
          custom,
        },
        createdAt: Date.now(),
      };
      persistStore(
        store.map((p) =>
          p.id === currentProject.id
            ? { ...p, revisions: [...p.revisions, revision] }
            : p,
        ),
      );
      toast.success("Revision saved.");
    },
    [
      currentProject,
      store,
      persistStore,
      activeTemplate,
      markdown,
      htmlOverride,
      jsonText,
      sourceMode,
      chapters,
      activeChapter,
      bookMode,
      custom,
    ],
  );

  const restoreRevision = useCallback(
    (revision: ProjectRevision) => {
      if (!currentProject) return;
      hydrateFromDoc(revision.doc);
      toast.success("Revision restored.");
    },
    [currentProject, hydrateFromDoc],
  );

  // -- Notes -------------------------------------------------------------------

  const addComment = useCallback(
    (body: string) => {
      if (!currentProject) return;
      const comment: ProjectComment = {
        id: uid("note-"),
        chapterId: bookMode ? (chapters[activeChapter]?.id ?? null) : null,
        body,
        resolved: false,
        createdAt: Date.now(),
      };
      persistStore(
        store.map((p) =>
          p.id === currentProject.id
            ? { ...p, comments: [...p.comments, comment] }
            : p,
        ),
      );
    },
    [currentProject, store, persistStore, bookMode, chapters, activeChapter],
  );

  const toggleCommentResolved = useCallback(
    (id: string) => {
      if (!currentProject) return;
      persistStore(
        store.map((p) =>
          p.id === currentProject.id
            ? {
                ...p,
                comments: p.comments.map((c) =>
                  c.id === id ? { ...c, resolved: !c.resolved } : c,
                ),
              }
            : p,
        ),
      );
    },
    [currentProject, store, persistStore],
  );

  const deleteComment = useCallback(
    (id: string) => {
      if (!currentProject) return;
      persistStore(
        store.map((p) =>
          p.id === currentProject.id
            ? { ...p, comments: p.comments.filter((c) => c.id !== id) }
            : p,
        ),
      );
    },
    [currentProject, store, persistStore],
  );

  const chapterComments = useMemo(() => {
    if (!currentProject) return [];
    const chapterId = bookMode ? (chapters[activeChapter]?.id ?? null) : null;
    return currentProject.comments.filter((c) => c.chapterId === chapterId);
  }, [currentProject, bookMode, chapters, activeChapter]);

  const notesChapterTitle = currentProject
    ? (chapters[activeChapter]?.title ?? currentProject.name)
    : "Document";

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/70 text-lg font-semibold text-white backdrop-blur-sm">
          Drop your chapter (.md / .json + images) here
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-semibold tracking-tight">
            Markdown / JSON → HTML
          </h1>
          <Badge variant="secondary">prototype</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Template
            </span>
            <Select value={activeTemplate} onValueChange={loadTemplate}>
              <SelectTrigger aria-label="Select a book template" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator orientation="vertical" className="h-6" />

          <Button
            variant={bookMode ? "default" : "outline"}
            onClick={toggleBookMode}
            title="Multi-chapter mode: reorder chapters and compile the whole book"
          >
            <BookOpen />
            Book
          </Button>
          {bookMode && (
            <>
              <Button variant="outline" onClick={addChapter}>
                <Plus />
                Chapter
              </Button>
              <Button variant="secondary" onClick={compileBook}>
                <FileText />
                Compile book
              </Button>
            </>
          )}
          <Button
            variant={customizerOpen ? "default" : "outline"}
            onClick={() => setCustomizerOpen((o) => !o)}
            title="Customize accent color, fonts and line width live"
          >
            <Palette />
            Style
          </Button>

          <Separator orientation="vertical" className="h-6" />

          <Button variant="outline" asChild>
            <label>
              <ImagePlus />
              Add images
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    void addImageFiles(e.target.files);
                  }
                  e.target.value = "";
                }}
                className="hidden"
              />
            </label>
          </Button>
          <Button variant="outline" asChild>
            <label>
              <Folder />
              Import folder
              <input
                type="file"
                multiple
                {...({ webkitdirectory: "" } as Record<string, string>)}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    void importFiles(e.target.files);
                  }
                  e.target.value = "";
                }}
                className="hidden"
              />
            </label>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (sourceMode === "json") {
                if (
                  jsonText.trim() !== "" &&
                  !window.confirm(
                    "Loading the example will replace your current JSON. Continue?",
                  )
                ) {
                  return;
                }
                setJsonText(JSON_EXAMPLE);
                return;
              }
              loadTemplateExample();
            }}
          >
            <FilePlus />
            Example
          </Button>
          <Button variant="ghost" onClick={clearEditor}>
            <Trash2 />
            Clear
          </Button>
          <Button variant="secondary" onClick={copyHtml}>
            <Copy />
            {copied ? "Copied!" : "Copy HTML"}
          </Button>
          <Button variant="outline" onClick={downloadHtml}>
            <FileCode2 />
            Download .html
          </Button>
          <Button onClick={downloadDocx} disabled={isExportingDocx}>
            {isExportingDocx ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Exporting…
              </span>
            ) : (
              <>
                <Download />
                Download .docx
              </>
            )}
          </Button>
          <Button variant="outline" onClick={downloadPdf} disabled={isExportingPdf}>
            {isExportingPdf ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Printing…
              </span>
            ) : (
              <>
                <FileText />
                Download PDF
              </>
            )}
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
        <section className="flex min-h-0 flex-row border-b lg:border-b-0 lg:border-r">
          <nav
            className="flex w-10 shrink-0 flex-col items-center gap-1 border-r bg-muted/40 py-2"
            aria-label="Editor panels"
          >
            {[
              { id: "projects", icon: FolderOpen, label: "Projects", count: store.length },
              { id: "presets", icon: Library, label: "Presets" },
              { id: "blocks", icon: Blocks, label: "Blocks" },
              { id: "revisions", icon: History, label: "Revisions", count: currentProject?.revisions.length },
              { id: "notes", icon: MessageSquarePlus, label: "Notes", count: currentProject?.comments.filter((c) => !c.resolved).length },
            ].map(({ id, icon: RailIcon, label, count }) => (
              <button
                key={id}
                type="button"
                title={label}
                aria-pressed={panel === id}
                onClick={() => setPanel(panel === id ? null : (id as typeof panel))}
                className={`relative flex w-full flex-col items-center gap-0.5 border-l-2 py-1.5 text-[10px] transition-colors ${
                  panel === id
                    ? "border-amber-500 bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <RailIcon className="size-4" />
                {label}
                {typeof count === "number" && count > 0 && (
                  <span className="absolute top-1 right-2 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-semibold text-white">
                    {count}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {panel && (
            <aside className="w-72 shrink-0 overflow-hidden border-r bg-muted/20">
              {panel === "projects" && (
                <ProjectManager
                  projects={store}
                  activeId={activeProjectId}
                  onSelect={selectProject}
                  onCreate={createProjectHandler}
                  onRename={renameProject}
                  onDelete={deleteProject}
                  onDuplicate={duplicateProject}
                />
              )}
              {panel === "presets" && (
                <PresetsPanel
                  currentTemplateId={activeTemplate}
                  onApply={applyPreset}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === "blocks" && (
                <BlocksPanel
                  textareaRef={editorRef}
                  value={editorText}
                  onChange={(next) => {
                    if (sourceMode === "json") setJsonText(next);
                    else if (bookMode) updateBookEditor(next);
                    else setMarkdown(next);
                  }}
                  onClose={() => setPanel(null)}
                  disabled={!hydrated}
                />
              )}
              {panel === "revisions" &&
                currentProject && (
                  <RevisionsPanel
                    revisions={currentProject.revisions}
                    currentDoc={revisionTargetDoc()}
                    onSaveRevision={saveRevision}
                    onRestore={restoreRevision}
                    onClose={() => setPanel(null)}
                  />
                )}
              {panel === "notes" &&
                currentProject && (
                  <CommentsPanel
                    chapterTitle={notesChapterTitle}
                    comments={chapterComments}
                    onAdd={addComment}
                    onToggleResolved={toggleCommentResolved}
                    onDelete={deleteComment}
                    onClose={() => setPanel(null)}
                  />
                )}
            </aside>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
            {bookMode ? (
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Chapters ({chapters.length})
              </span>
            ) : (
              <div
                className="flex items-center gap-0.5 rounded-md border bg-background p-0.5"
                role="group"
                aria-label="Source format"
              >
                <button
                  type="button"
                  onClick={() => setSourceMode("markdown")}
                  aria-pressed={sourceMode === "markdown"}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    sourceMode === "markdown"
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Markdown
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("json")}
                  aria-pressed={sourceMode === "json"}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    sourceMode === "json"
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  JSON
                </button>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={copyMarkdown}
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Copy />
              Copy
            </Button>
          </div>
          {bookMode && (
            <ul
              className="max-h-40 shrink-0 list-none overflow-y-auto border-b bg-muted/20 p-1.5"
              aria-label="Book chapters"
            >
              {chapters.map((ch, i) => (
                <li
                  key={ch.id}
                  className={`group flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                    i === activeChapter ? "bg-background shadow-sm" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveChapter(i)}
                    className="min-w-0 flex-1 truncate text-left font-medium"
                    title="Edit this chapter"
                  >
                    <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                    {ch.title || `Chapter ${i + 1}`}
                  </button>
                  <span
                    className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                    aria-label="Reorder chapter"
                  >
                    <button
                      type="button"
                      onClick={() => moveChapter(i, -1)}
                      disabled={i === 0}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label={`Move ${ch.title || `Chapter ${i + 1}`} up`}
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveChapter(i, 1)}
                      disabled={i === chapters.length - 1}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label={`Move ${ch.title || `Chapter ${i + 1}`} down`}
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </span>
                  <input
                    value={ch.title}
                    onChange={(e) => renameChapter(i, e.target.value)}
                    className="w-24 rounded border bg-background px-1 py-0.5 text-[11px] outline-none focus:border-ring"
                    aria-label={`Rename ${ch.title || `Chapter ${i + 1}`}`}
                    placeholder={`Chapter ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeChapter(i)}
                    className="rounded p-0.5 text-muted-foreground hover:text-red-600"
                    aria-label={`Delete ${ch.title || `Chapter ${i + 1}`}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hydrated && sourceMode !== "json" && (
            <MarkdownToolbar
              textareaRef={editorRef}
              value={editorText}
              onChange={(next) => {
                if (bookMode) updateBookEditor(next);
                else setMarkdown(next);
              }}
            />
          )}
          <textarea
            ref={editorRef}
            value={editorText}
            onChange={(e) => {
              if (sourceMode === "json") setJsonText(e.target.value);
              else if (bookMode) updateBookEditor(e.target.value);
              else setMarkdown(e.target.value);
            }}
            spellCheck={false}
            placeholder={
              sourceMode === "json"
                ? '{ "title": "My Book", "cover": "cover.png", "chapters": [{ "title": "Chapter One", "image": "photo.png", "content": "Your text here…" }] }'
                : "# Write your Markdown here…"
            }
            aria-label={
              sourceMode === "json"
                ? "JSON editor"
                : bookMode
                  ? "Chapter editor"
                  : "Markdown editor"
            }
            className="min-h-64 flex-1 resize-none bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-3 border-t bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground">
            <span>{stats.chars} characters</span>
            <Separator orientation="vertical" className="h-3" />
            <span>{stats.words} words</span>
            <Separator orientation="vertical" className="h-3" />
            <span>{stats.lines} lines</span>
            {sourceMode === "json" &&
              (jsonConversion.error ? (
                <span className="font-medium text-red-600 dark:text-red-400">
                  Invalid JSON — {jsonConversion.error}
                </span>
              ) : (
                jsonText.trim() !== "" && (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    ✓ Converted to structured Markdown
                  </span>
                )
              ))}
            {hydrated && (
              <span className="ml-auto flex items-center gap-1.5 font-medium">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${autoSaved ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {autoSaved ? "Autosaved" : "Auto-save off"}
              </span>
            )}
          </div>
          {Object.keys(images).length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto border-t bg-muted/30 px-4 py-2">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Images
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearImages}
                className="ml-auto h-5 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 />
                Clear all
              </Button>
              {Object.entries(images).map(([name, src]) => (
                <div
                  key={name}
                  className="group relative shrink-0"
                  title={`${name} — click to insert at cursor`}
                >
                  <button
                    type="button"
                    onClick={() => insertImageReference(name)}
                    className="block size-11 overflow-hidden rounded border bg-background transition-colors hover:border-ring"
                    aria-label={`Insert ${name} at cursor`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={name}
                      className="size-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeImage(name)}
                    className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full bg-zinc-900 text-white group-hover:flex"
                    aria-label={`Remove ${name}`}
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          {customizerOpen && (
            <div className="border-b bg-muted/30 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Accent
                  </span>
                  <div className="flex items-center gap-1">
                    {ACCENT_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() =>
                          setCustom((c) => ({
                            ...c,
                            accent: c.accent === hex ? null : hex,
                          }))
                        }
                        style={{ background: hex }}
                        className={`size-5 rounded-full border transition-transform hover:scale-110 ${
                          custom.accent === hex
                            ? "ring-2 ring-ring ring-offset-1 ring-offset-background"
                            : "border-black/10"
                        }`}
                        aria-label={`Accent ${hex}`}
                        aria-pressed={custom.accent === hex}
                      />
                    ))}
                    <input
                      type="color"
                      value={custom.accent ?? "#3e5c76"}
                      onChange={(e) =>
                        setCustom((c) => ({ ...c, accent: e.target.value }))
                      }
                      className="size-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
                      aria-label="Custom accent color"
                      title="Custom accent color"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Fonts
                  </span>
                  <div
                    className="flex items-center gap-0.5 rounded-md border bg-background p-0.5"
                    role="group"
                    aria-label="Font pairing"
                  >
                    {(
                      [
                        ["default", "Default"],
                        ["serif", "All serif"],
                        ["sans", "All sans"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setCustom((c) => ({ ...c, font: value }))
                        }
                        aria-pressed={custom.font === value}
                        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                          custom.font === value
                            ? "bg-secondary text-secondary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Lines
                  </span>
                  <div
                    className="flex items-center gap-0.5 rounded-md border bg-background p-0.5"
                    role="group"
                    aria-label="Line width"
                  >
                    {(
                      [
                        ["default", "Default"],
                        ["narrow", "Narrow"],
                        ["wide", "Wide"],
                        ["full", "Full"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setCustom((c) => ({ ...c, width: value }))
                        }
                        aria-pressed={custom.width === value}
                        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                          custom.width === value
                            ? "bg-secondary text-secondary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCustom(DEFAULT_CUSTOM)}
                  className="ml-auto h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw />
                  Reset
                </Button>
              </div>
            </div>
          )}
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "preview" | "html")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center border-b bg-muted/50 px-3 py-1.5">
              <TabsList className="h-7">
                <TabsTrigger value="preview">
                  <Eye />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="html">
                  <Code2 />
                  HTML
                </TabsTrigger>
              </TabsList>
              {isHtmlOverride && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={regenerateHtml}
                  className="ml-auto h-6 gap-1 px-2 text-xs"
                >
                  <RotateCcw />
                  Regenerate from Markdown
                </Button>
              )}
            </div>
            <TabsContent
              value="preview"
              className="min-h-0 flex-1 overflow-auto bg-background p-4"
            >
              <style>
                {(getTemplate(activeTemplate)?.style ?? "") + themeOverrideCss}
              </style>
              <article
                className={`markdown-body theme-${activeTemplate}`}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </TabsContent>
            <TabsContent
              value="html"
              className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
            >
              {isHtmlOverride ? (
                <p className="border-b bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                  Manual edits active — this HTML is what Preview, Copy and both
                  exports use. Edit the Markdown or press Regenerate to go back
                  to the generated version.
                </p>
              ) : (
                <p className="border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
                  Editing this HTML takes over the preview and exports. Edit the
                  Markdown (or press Regenerate) to return to the generated
                  version.
                </p>
              )}
              <textarea
                value={html}
                onChange={(e) => setHtmlOverride(e.target.value)}
                spellCheck={false}
                aria-label="HTML editor"
                placeholder="<!-- Generated HTML appears here — edit freely -->"
                className="min-h-64 flex-1 resize-none bg-background p-4 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground"
              />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}