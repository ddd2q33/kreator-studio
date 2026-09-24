"use client";

/** Project / revision / comment models + localStorage persistence. */

export type Chapter = { id: string; title: string; markdown: string };

export type CustomVariant = {
  accent: string | null;
  font: "default" | "serif" | "sans";
  width: "default" | "wide" | "narrow" | "full";
};

/** Everything needed to restore an editor session inside a project. */
export type ProjectDoc = {
  activeTemplate: string;
  markdown: string;
  htmlOverride: string | null;
  jsonText?: string;
  sourceMode?: "markdown" | "json";
  chapters?: Chapter[];
  activeChapter?: number;
  bookMode?: boolean;
  custom?: CustomVariant;
};

export type ProjectComment = {
  id: string;
  /** chapter id when bookMode, otherwise null (whole document). */
  chapterId: string | null;
  body: string;
  resolved: boolean;
  createdAt: number;
};

export type ProjectRevision = {
  id: string;
  label: string;
  doc: ProjectDoc;
  createdAt: number;
};

export type Project = {
  id: string;
  name: string;
  presetId: string | null;
  createdAt: number;
  updatedAt: number;
  doc: ProjectDoc;
  comments: ProjectComment[];
  revisions: ProjectRevision[];
};

export type ProjectStore = {
  activeId: string;
  projects: Project[];
};

const STORE_KEY = "book-studio-projects";

export function uid(prefix = ""): string {
  return `${prefix}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function emptyProjectDoc(templateId: string, markdown: string): ProjectDoc {
  return {
    activeTemplate: templateId,
    markdown,
    htmlOverride: null,
    sourceMode: "markdown",
    chapters: [],
    activeChapter: 0,
    bookMode: false,
    custom: {
      accent: null,
      font: "default",
      width: "default",
    },
  };
}

export function createProject(
  name: string,
  templateId: string,
  markdown: string,
  presetId?: string,
): Project {
  const now = Date.now();
  return {
    id: uid("proj-"),
    name,
    presetId: presetId ?? null,
    createdAt: now,
    updatedAt: now,
    doc: emptyProjectDoc(templateId, markdown),
    comments: [],
    revisions: [],
  };
}

export function loadProjectStore(): ProjectStore {
  if (typeof window === "undefined") {
    return { activeId: "", projects: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { activeId: "", projects: [] };
    const parsed = JSON.parse(raw) as Partial<ProjectStore>;
    if (!Array.isArray(parsed.projects)) {
      return { activeId: "", projects: [] };
    }
    const projects = parsed.projects.filter(
      (p): p is Project =>
        !!p &&
        typeof p === "object" &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        typeof p.doc === "object" &&
        typeof p.doc.activeTemplate === "string" &&
        typeof p.doc.markdown === "string",
    );
    const activeId =
      typeof parsed.activeId === "string" &&
      projects.some((p) => p.id === parsed.activeId)
        ? parsed.activeId
        : projects[0]?.id ?? "";
    return { activeId, projects };
  } catch {
    return { activeId: "", projects: [] };
  }
}

export function saveProjectStore(store: ProjectStore): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function cloneProject(project: Project): Project {
  return {
    ...project,
    id: uid("proj-"),
    name: `${project.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revisions: [],
    comments: [],
    doc: structuredClone(project.doc),
  };
}