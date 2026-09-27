"use client";

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookMarked,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Eye,
  Keyboard,
  FileCode2,
  FileDown,
  FilePlus,
  FileText,
  Folder,
  ImagePlus,
  Palette,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  X,
  Library,
  History,
  MessageSquarePlus,
  Blocks,
  FolderOpen,
  FolderDown,
  FolderUp,
  ListTree,
} from "lucide-react";
import { TEMPLATES, getTemplate } from "./templates";
import {
  downloadBlob,
  htmlToDocxBlob,
  suggestedFilename,
} from "@/lib/docx-export";
import { jsonToMarkdown } from "@/lib/json-to-markdown";
import { htmlToEpubBlob } from "@/lib/epub-export";
import {
  createMarkdownRenderer,
  hexToRgba,
  titleFromMarkdown,
  type ImageMap,
} from "@/lib/render-engine";
import { bookFromMarkdown, type BookFile } from "@/lib/book-files";
import { bookToZip, zipToBook } from "@/lib/book-zip";
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
import { MarkdownToolbar, applyMarkdown } from "@/components/editor/writer-toolbar";
import { StudioHeader } from "@/components/studio-header";
import { ProjectManager } from "@/components/editor/project-manager";
import { PresetsPanel } from "@/components/editor/presets-panel";
import { BlocksPanel } from "@/components/editor/blocks-panel";
import { RevisionsPanel } from "@/components/editor/revisions-panel";
import { CommentsPanel } from "@/components/editor/comments-panel";
import { QualityPanel } from "@/components/editor/quality-panel";
import { OutlinePanel } from "@/components/editor/outline-panel";
import { WritingMetrics } from "@/components/editor/writing-metrics";
import { checkQuality } from "@/lib/quality-check";
import { BOOK_PRESETS, presetById } from "@/components/editor/book-presets";

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

type StylePreset = {
  id: string;
  label: string;
  swatch: string;
  custom: CustomVariant;
};

const STYLE_PRESETS: StylePreset[] = [
  {
    id: "classic",
    label: "Classic",
    swatch: "#3E5C76",
    custom: { accent: "#3E5C76", font: "serif", width: "narrow" },
  },
  {
    id: "modern",
    label: "Modern",
    swatch: "#4F46E5",
    custom: { accent: "#4F46E5", font: "sans", width: "wide" },
  },
  {
    id: "minimal",
    label: "Minimal",
    swatch: "#52525B",
    custom: { accent: "#52525B", font: "default", width: "default" },
  },
  {
    id: "warm",
    label: "Warm",
    swatch: "#8C4A3F",
    custom: { accent: "#8C4A3F", font: "serif", width: "default" },
  },
  {
    id: "bold",
    label: "Bold",
    swatch: "#96660F",
    custom: { accent: "#96660F", font: "sans", width: "full" },
  },
];

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
  const PAPER_SIZES = [
    { id: "none", label: "No fixed page", widthMm: 0, heightMm: 0 },
    { id: "a4", label: "A4", widthMm: 210, heightMm: 297 },
    { id: "letter", label: "US Letter", widthMm: 216, heightMm: 279 },
    { id: "legal", label: "US Legal", widthMm: 216, heightMm: 356 },
    { id: "a5", label: "A5", widthMm: 148, heightMm: 210 },
  ];
  const toPx = (mm: number) => Math.round((mm / 25.4) * 96);
  const PAGE_BREAK_CSS = [
    ".book-chapter",
    ".part-page",
    ".chapter-page",
    ".copyright-page",
    ".dedication",
    ".restricted",
    ".toc",
    "h1:not(:first-child)",
  ].join(", ");
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
  const [paperMode, setPaperMode] = useState<string>("none");
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [images, setImages] = useState<ImageMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const lastSourceRef = useRef(markdown);
  const [store, setStore] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [panel, setPanel] = useState<
    | "projects"
    | "presets"
    | "blocks"
    | "revisions"
    | "notes"
    | "quality"
    | "outline"
    | null
  >(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const [editorSplit, setEditorSplit] = useState(50);

  const beginResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startW = startX / container.getBoundingClientRect().width;
    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = Math.min(0.85, Math.max(0.15, startW + (ev.clientX - startX) / rect.width));
      setEditorSplit(Math.round(ratio * 100));
    };
    const onUp = () => {
      document.body.classList.remove("cursor-col-resize", "select-none");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.classList.add("cursor-col-resize", "select-none");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShortcutsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutsOpen]);

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

  // Markdown → HTML pipeline shared by the preview, the compiled book, every
  // export and the headless API/CLI via lib/render-engine.ts.
  const renderMarkdown = useMemo(
    () => createMarkdownRenderer({ images }),
    [images],
  );

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

  const emitEditorChange = useCallback((next: string) => {
    if (sourceMode === "json") setJsonText(next);
    else if (bookMode) updateBookEditor(next);
    else setMarkdown(next);
  }, [sourceMode, bookMode, updateBookEditor]);

  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && key === "b") {
        e.preventDefault();
        applyMarkdown(
          editorRef,
          editorText,
          (sel) => (sel ? `**${sel}**` : "**bold text**"),
          emitEditorChange,
        );
        return;
      }
      if (mod && !e.shiftKey && key === "i") {
        e.preventDefault();
        applyMarkdown(
          editorRef,
          editorText,
          (sel) => (sel ? `*${sel}*` : "*italic text*"),
          emitEditorChange,
        );
        return;
      }
      if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        applyMarkdown(
          editorRef,
          editorText,
          (sel) => `[${sel || "link text"}](https://)`,
          emitEditorChange,
        );
        return;
      }
      if (mod && e.shiftKey && key === "2") {
        e.preventDefault();
        applyMarkdown(
          editorRef,
          editorText,
          (sel) => (sel ? sel : "## Heading\n\n"),
          emitEditorChange,
        );
        return;
      }
      if (mod && e.shiftKey && key === "3") {
        e.preventDefault();
        applyMarkdown(
          editorRef,
          editorText,
          (sel) => (sel ? sel : "### Heading\n\n"),
          emitEditorChange,
        );
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const lineStart = editorText.lastIndexOf("\n", start - 1) + 1;
        let lineEnd = editorText.indexOf("\n", end);
        if (lineEnd === -1) lineEnd = editorText.length;
        const lines = editorText.slice(lineStart, lineEnd).split("\n");
        const dedent = e.shiftKey;
        const nextBlock = lines
          .map((l) =>
            dedent
              ? l.startsWith("  ")
                ? l.slice(2)
                : l.startsWith("- ") || l.startsWith("* ")
                  ? l.slice(2)
                  : l
              : `  ${l}`,
          )
          .join("\n");
        const next =
          editorText.slice(0, lineStart) + nextBlock + editorText.slice(lineEnd);
        emitEditorChange(next);
        requestAnimationFrame(() => {
          el.focus();
          const pos = lineStart + nextBlock.length;
          el.setSelectionRange(pos, pos);
        });
      }
    },
    [editorText, emitEditorChange],
  );

  const stats = useMemo(() => {
    const trimmed = editorText.trim();
    const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
    return {
      chars: editorText.length,
      words,
      lines: editorText.split("\n").length,
    };
  }, [editorText]);

  const qualityIssues = useMemo(() => {
    const effectiveMarkdown =
      sourceMode === "json"
        ? jsonConversion.markdown
        : bookMode
          ? chapters
              .map((ch, i) =>
                ch.markdown.trim()
                  ? ch.markdown
                  : `# ${ch.title || `Chapter ${i + 1}`}`,
              )
              .join("\n\n")
          : markdown;
    return checkQuality(effectiveMarkdown, html);
  }, [
    sourceMode,
    bookMode,
    chapters,
    markdown,
    jsonConversion.markdown,
    html,
  ]);

  useLayoutEffect(() => {
    const paper = PAPER_SIZES.find((p) => p.id === paperMode);
    const host = paperRef.current;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (paperMode === "none" || !paper || !host) {
          setPageBreaks([]);
          return;
        }
        const pageHeightPx = toPx(paper.heightMm);
        const article = host.querySelector<HTMLElement>(".markdown-body");
        if (!article) return;
        const total = article.scrollHeight;
        const breaks: number[] = [];
        for (let y = 0; y < total; y += pageHeightPx) breaks.push(y);
        setPageBreaks(breaks);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (host) observer.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperMode, html, activeTemplate, themeOverrideCss]);

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
      const zipFiles = list.filter((f) => /\.zip$/i.test(f.name));
      const mdFiles = list.filter((f) =>
        /\.(md|markdown|mdown)$/i.test(f.name),
      );
      const jsonFiles = list.filter((f) => /\.json$/i.test(f.name));
      const imgFiles = list.filter((f) => f.type.startsWith("image/"));

      if (
        mdFiles.length === 0 &&
        imgFiles.length === 0 &&
        jsonFiles.length === 0 &&
        zipFiles.length === 0
      ) {
        toast.warning("No Markdown, JSON, zip or image files found.");
        return;
      }

      // Git-friendly book zip: book.json + chapters/*.md (+ images/).
      if (zipFiles.length > 0) {
        try {
          const { book, images: zipImages } = await zipToBook(zipFiles[0]);
          setMarkdown(book.chapters.map((c) => c.markdown).join("\n\n"));
          setChapters(book.chapters);
          setBookMode(book.bookMode || book.chapters.length > 1);
          setActiveChapter(0);
          setSourceMode("markdown");
          setHtmlOverride(null);
          setTab("preview");
          if (book.templateId && getTemplate(book.templateId)) {
            setActiveTemplate(book.templateId);
          }
          if (Object.keys(zipImages).length > 0) {
            setImages((prev) => ({ ...prev, ...zipImages }));
          }
          toast.success(
            `Imported book "${book.name}" — ${book.chapters.length} chapter(s)${Object.keys(zipImages).length > 0 ? ` and ${Object.keys(zipImages).length} image(s)` : ""}.`,
          );
        } catch (error) {
          console.error("Zip import failed:", error);
          toast.error(
            error instanceof Error ? error.message : "Could not import the book zip.",
          );
        }
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

  const downloadMarkdown = useCallback(() => {
    const template = getTemplate(activeTemplate);
    const documentTitle =
      titleFromMarkdown(activeMarkdown) ??
      (bookMode ? "book" : null) ??
      template?.label ??
      "document";
    const source = bookMode
      ? chapters
          .map((ch, i) => {
            const md = ch.markdown.trim()
              ? ch.markdown
              : `# ${ch.title || `Chapter ${i + 1}`}`;
            return `<!-- chapter: ${ch.title || `Chapter ${i + 1}`} -->\n\n${md}`;
          })
          .join("\n\n---\n\n")
      : activeMarkdown;
    const blob = new Blob([source], {
      type: "text/markdown;charset=utf-8",
    });
    downloadBlob(blob, `${documentTitle}.md`);
    toast.success(`Exported "${documentTitle}.md".`);
  }, [activeMarkdown, activeTemplate, bookMode, chapters]);

  // -- Git-friendly zip export (book.json + chapters/*.md + images/) ---------

  const currentBookFile = useCallback((): BookFile => {
    // currentProject is declared further down (Projects section); resolve it
    // from the store here so this callback can live next to the exports.
    const project = store.find((p) => p.id === activeProjectId) ?? null;
    if (bookMode && chapters.length > 0) {
      return {
        name: project?.name ?? "My book",
        templateId: activeTemplate,
        presetId: project?.presetId ?? null,
        bookMode: true,
        chapters: chapters.map((ch) => ({ ...ch })),
      };
    }
    return bookFromMarkdown(activeMarkdown, project?.name ?? "My book");
  }, [store, activeProjectId, bookMode, chapters, activeTemplate, activeMarkdown]);

  const downloadBookZip = useCallback(async () => {
    if (isExportingZip) return;
    setIsExportingZip(true);
    try {
      const book = currentBookFile();
      const blob = await bookToZip(book, images);
      const safe = book.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "book";
      downloadBlob(blob, `${safe}-chapters.zip`);
      toast.success(
        `Exported "${safe}-chapters.zip" — ${book.chapters.length} chapter file(s). Commit it to git or build with book-author.`,
      );
    } catch (error) {
      console.error("Zip export failed:", error);
      toast.error("Zip export failed. Check the console for details.");
    } finally {
      setIsExportingZip(false);
    }
  }, [currentBookFile, images, isExportingZip]);


  const [isExportingEpub, setIsExportingEpub] = useState(false);
  const downloadEpub = useCallback(async () => {
    if (isExportingEpub) return;
    setIsExportingEpub(true);
    try {
      const template = getTemplate(activeTemplate);
      const css = `${template?.style ?? ""}${themeOverrideCss}`;
      const bodyHtml = bookMode ? compiledBookHtml : generatedHtml;
      const documentTitle =
        titleFromMarkdown(activeMarkdown) ??
        (bookMode ? "my-book" : null) ??
        template?.label ??
        "document";
      const epubChapters = bookMode
        ? chapters
            .map((ch, i) => ({
              id: `chapter-${i + 1}-${ch.id.slice(-6)}`,
              title: ch.title || `Chapter ${i + 1}`,
              html: renderMarkdown(
                ch.markdown.trim()
                  ? ch.markdown
                  : `# ${ch.title || `Chapter ${i + 1}`}\n\n`,
              ),
            }))
            .filter((ch) => ch.html.trim() !== "")
        : [
            {
              id: "chapter-1",
              title: titleFromMarkdown(activeMarkdown) ?? documentTitle,
              html: bodyHtml,
            },
          ];
      const blob = await htmlToEpubBlob({
        title: documentTitle,
        chapters: epubChapters,
        css,
        description: template?.description ?? "",
      });
      downloadBlob(blob, `${documentTitle}.epub`);
      toast.success(`Exported "${documentTitle}.epub".`);
    } catch (error) {
      console.error("EPUB export failed:", error);
      toast.error("EPUB export failed. Check the console for details.");
    } finally {
      setIsExportingEpub(false);
    }
  }, [
    isExportingEpub,
    activeTemplate,
    themeOverrideCss,
    bookMode,
    compiledBookHtml,
    generatedHtml,
    activeMarkdown,
    chapters,
    renderMarkdown,
  ]);

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

      <StudioHeader
        right={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {bookMode && (
            <Badge variant="secondary">book mode</Badge>
          )}
          <span className="hidden items-center gap-1.5 sm:flex">
            <span
              className={`size-1.5 rounded-full ${
                autoSaved ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {autoSaved ? "Autosaved" : "Editing"}
          </span>
        </div>
        }
      />

      <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b bg-muted/40 px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Template
          </span>
          <Select value={activeTemplate} onValueChange={loadTemplate}>
            <SelectTrigger aria-label="Select a book template" className="h-8 w-44">
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

        <Separator orientation="vertical" className="h-5" />

        <div className="flex items-center gap-1.5 rounded-lg border bg-background/50 p-0.5">
          <Button size="sm" variant={bookMode ? "default" : "outline"} onClick={toggleBookMode} title="Multi-chapter mode: reorder chapters and compile the whole book">
            <BookOpen />
            Book
          </Button>
          {bookMode && (
            <>
              <Button size="sm" variant="outline" onClick={addChapter}>
                <Plus />
                Chapter
              </Button>
              <Button size="sm" variant="secondary" onClick={compileBook}>
                <FileText />
                Compile book
              </Button>
            </>
          )}
          <Button size="sm" variant={customizerOpen ? "default" : "outline"} onClick={() => setCustomizerOpen((o) => !o)} title="Customize accent color, fonts and line width live">
            <Palette />
            Style
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5" />

        <div className="flex items-center gap-1.5 rounded-lg border bg-background/50 p-0.5">
          <Button size="sm" variant="outline" asChild>
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
          <Button size="sm" variant="outline" asChild>
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
          <Button size="sm" variant="outline" asChild>
            <label>
              <FolderUp />
              Import .zip
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void (async () => {
                      try {
                        const { book, images: zipImages } = await zipToBook(file);
                        setChapters(book.chapters);
                        setBookMode(book.bookMode || book.chapters.length > 1);
                        setActiveChapter(0);
                        setSourceMode("markdown");
                        setHtmlOverride(null);
                        setMarkdown(book.chapters.map((c) => c.markdown).join("\n\n"));
                        setTab("preview");
                        if (book.templateId && getTemplate(book.templateId)) {
                          setActiveTemplate(book.templateId);
                        }
                        if (Object.keys(zipImages).length > 0) {
                          setImages((prev) => ({ ...prev, ...zipImages }));
                        }
                        toast.success(
                          `Imported book "${book.name}" — ${book.chapters.length} chapter(s).`,
                        );
                      } catch (error) {
                        console.error("Zip import failed:", error);
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Could not import the book zip.",
                        );
                      }
                    })();
                  }
                  e.target.value = "";
                }}
                className="hidden"
              />
            </label>
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="default" title="Export the book">
              {isExportingDocx || isExportingPdf || isExportingEpub || isExportingZip ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Download />
              )}
              Export
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={downloadDocx} disabled={isExportingDocx}>
              <Download />
              DOCX
              {isExportingDocx && <span className="ml-auto text-xs text-muted-foreground">Exporting…</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadPdf} disabled={isExportingPdf}>
              <FileText />
              PDF
              {isExportingPdf && <span className="ml-auto text-xs text-muted-foreground">Printing…</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadEpub} disabled={isExportingEpub}>
              <BookMarked />
              EPUB
              {isExportingEpub && <span className="ml-auto text-xs text-muted-foreground">Exporting…</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadMarkdown}>
              <FileDown />
              Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadHtml}>
              <FileCode2 />
              HTML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadBookZip} disabled={isExportingZip}>
              <FolderDown />
              Chapters .zip
              {isExportingZip && <span className="ml-auto text-xs text-muted-foreground">Zipping…</span>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5" />

        <div className="flex items-center gap-1.5 rounded-lg border bg-background/50 p-0.5">
          <Button size="sm" variant="outline" onClick={() => {
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
          }}>
            <FilePlus />
            Example
          </Button>
          <Button size="sm" variant="ghost" onClick={clearEditor}>
            <Trash2 />
            Clear
          </Button>
        </div>
      </div>

      <div
        ref={splitRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
      >
        <section
          className="flex min-h-0 shrink-0 flex-row border-b lg:w-[var(--editor-w)] lg:border-b-0"
          style={{ "--editor-w": `${editorSplit}%` } as React.CSSProperties}
        >
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
              { id: "outline", icon: ListTree, label: "Outline" },
              { id: "quality", icon: ShieldAlert, label: "Quality", count: qualityIssues.length, isQuality: true },
            ].map(({ id, icon: RailIcon, label, count, isQuality }) => (
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
                  <span
                    className={`absolute top-1 right-2 flex size-4 items-center justify-center rounded-full text-[9px] font-semibold text-white ${
                      isQuality === true && qualityIssues.some((i) => i.severity === "error")
                        ? "bg-red-600"
                        : "bg-amber-500"
                    }`}
                  >
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
              {panel === "quality" && (
                <QualityPanel
                  issues={qualityIssues}
                  text={editorText}
                  onApplyReplacement={(offset, length, replacement) => {
                    const next = editorText;
                    const updated =
                      next.slice(0, offset) +
                      replacement +
                      next.slice(offset + length);
                    if (sourceMode === "json") setJsonText(updated);
                    else if (bookMode) updateBookEditor(updated);
                    else setMarkdown(updated);
                  }}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === "outline" && (
                <OutlinePanel
                  text={editorText}
                  onNavigate={(offset) => {
                    const el = editorRef.current;
                    if (!el) return;
                    el.focus();
                    el.setSelectionRange(offset, offset);
                    const line = editorText.slice(0, offset).split("\n").length - 1;
                    const lineHeight = 21;
                    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 2);
                  }}
                  onClose={() => setPanel(null)}
                />
              )}
            </aside>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
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
            {hydrated && !bookMode && sourceMode === "markdown" && (
              <WritingMetrics text={editorText} hydrated={hydrated} />
            )}
            <span className="ml-auto flex items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={copyMarkdown}
                className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Copy />
                Copy
              </Button>
            </span>
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
            onKeyDown={handleEditorKeyDown}
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
            {sourceMode !== "json" && (
              <>
                <Separator orientation="vertical" className="hidden h-3 md:block" />
                <button
                  type="button"
                  onClick={() => setShortcutsOpen(true)}
                  className="hidden items-center gap-1 rounded border bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground md:inline-flex"
                  aria-label="Keyboard shortcuts"
                >
                  <Keyboard className="size-3" />
                  Shortcuts
                </button>
              </>
            )}
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

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor"
          onPointerDown={beginResize}
          className="hidden w-1 shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-border/60 transition-colors hover:bg-border lg:flex"
        />
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {customizerOpen && (
            <div className="border-b bg-muted/30 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Style
                  </span>
                  <div className="flex items-center gap-1" role="group" aria-label="Style preset">
                    {STYLE_PRESETS.map((preset) => {
                      const active =
                        custom.accent === preset.custom.accent &&
                        custom.font === preset.custom.font &&
                        custom.width === preset.custom.width;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setCustom(preset.custom)}
                          aria-pressed={active}
                          title={`${preset.label} — accent ${preset.custom.accent ?? "default"}, ${preset.custom.font} font, ${preset.custom.width} width`}
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                            active
                              ? "border-ring bg-background text-foreground shadow-sm"
                              : "border-border bg-background/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <span
                            className="size-2.5 rounded-full border border-black/10"
                            style={{
                              background: preset.swatch,
                            }}
                          />
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
            <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5">
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
              <Button
                variant="outline"
                size="sm"
                onClick={copyHtml}
                className="h-6 gap-1 px-2 text-xs"
              >
                <Copy />
                {copied ? "Copied!" : "Copy HTML"}
              </Button>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="size-3.5" />
                <Select
                  value={paperMode}
                  onValueChange={(v) => setPaperMode(v)}
                >
                  <SelectTrigger
                    aria-label="Page size"
                    className="h-6 w-36 gap-1 px-2 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAPER_SIZES.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {paperMode !== "none" && pageBreaks.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    ≈{pageBreaks.length} page
                    {pageBreaks.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
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
                {paperMode !== "none" &&
                  `
            .paper-preview .${PAGE_BREAK_CSS.replace(/,\s*/g, ", .paper-preview ")} {
              break-before: page;
            }
            .paper-preview::before {
              content: attr(data-page-label);
            }
          `}
              </style>
              <div
                ref={paperRef}
                className={
                  paperMode !== "none"
                    ? "paper-preview relative mx-auto px-2 py-4 transition-[max-width]"
                    : ""
                }
                style={
                  paperMode !== "none"
                    ? {
                        maxWidth: toPx(
                          PAPER_SIZES.find((p) => p.id === paperMode)
                            ?.widthMm ?? 0,
                        ),
                      }
                    : undefined
                }
              >
                <article
                  className={`markdown-body theme-${activeTemplate}`}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {paperMode !== "none" && (
                  <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-0">
                    {pageBreaks.slice(1).map((y, index) => (
                      <div
                        key={`${y}-${index}`}
                        className="absolute left-0 flex w-full items-center gap-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400"
                        style={{ top: y - 1 }}
                      >
                        <span className="rounded bg-sky-500/10 px-1 py-px">
                          Page {index + 2}
                        </span>
                        <span className="h-px flex-1 border-b border-dashed border-sky-500/40" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShortcutsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-lg border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Keyboard className="size-4" />
                Keyboard Shortcuts
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close keyboard shortcuts"
              >
                <X />
                Close
              </Button>
            </div>
            <div className="p-4">
              <ul className="space-y-1.5">
                {[
                  { keys: ["Ctrl", "B"], label: "Bold" },
                  { keys: ["Ctrl", "I"], label: "Italic" },
                  { keys: ["Ctrl", "K"], label: "Insert link" },
                  { keys: ["Ctrl", "⇧", "2"], label: "Heading 2" },
                  { keys: ["Ctrl", "⇧", "3"], label: "Heading 3" },
                  { keys: ["Tab"], label: "Indent selected lines" },
                  { keys: ["⇧", "Tab"], label: "Dedent selected lines" },
                ].map(({ keys, label }) => (
                  <li
                    key={label}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="flex items-center gap-0.5">
                      {keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground shadow-sm"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
                Mac: use <kbd className="rounded border bg-muted/50 px-1 font-mono text-[10px]">⌘</kbd> instead
                of <kbd className="rounded border bg-muted/50 px-1 font-mono text-[10px]">Ctrl</kbd>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}