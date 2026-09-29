/**
 * Keeping a code project in the browser, and nowhere else.
 *
 * localStorage, like the other two studios, because a code project is a
 * paragraph of source code and a list of integers - there is nothing here big
 * enough to justify a server, and a tool that needs an account to film a
 * fifteen-second clip about a for-loop is a tool nobody opens twice.
 *
 * The one thing that does not fit is the voice-over, which is far too large for
 * the 5 MB an origin gets. Those bytes live in IndexedDB under the key held in
 * the project (see `lib/audio-store.ts`), and only the file name and its length
 * are written here, so a project survives a reload and the audio can be re-read
 * on the next export.
 */

import { normalizeProject, type CodeProject } from "./code-art.ts";
import { pruneAudioClips } from "./audio-store.ts";

/** Own key, so clearing the code tool cannot take a manuscript with it. */
export const CODE_PROJECTS_KEY = "book-studio-code-projects";

/** How many projects are kept before the oldest is dropped. */
export const MAX_PROJECTS = 20;

export type CodeStore = {
  activeId: string | null;
  projects: CodeProject[];
};

export function emptyCodeStore(): CodeStore {
  return { activeId: null, projects: [] };
}

/**
 * Reads the store, repairing anything malformed.
 *
 * A corrupt entry is dropped rather than allowed to throw: a bad save should
 * cost the author the last edit, not the whole tool. The stored shape is always
 * run back through `normalizeProject`, so a project written by an older build
 * opens without complaint.
 */
export function loadCodeProjects(raw: string | null): CodeStore {
  if (!raw) return emptyCodeStore();
  try {
    const parsed = JSON.parse(raw) as { activeId?: unknown; projects?: unknown };
    const list = Array.isArray(parsed.projects) ? parsed.projects : [];
    // Every stored entry goes back through the same normalizer the editor uses,
    // so a project written by an older build opens without complaint and a
    // half-written one loses its broken fields instead of the whole project.
    const projects = list
      .slice(0, MAX_PROJECTS)
      .map((entry) => normalizeProject(entry));
    const activeId =
      typeof parsed.activeId === "string" &&
      projects.some((p) => p.id === parsed.activeId)
        ? parsed.activeId
        : null;
    return { activeId, projects };
  } catch {
    return emptyCodeStore();
  }
}

export function writeCodeProjects(store: CodeStore): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(CODE_PROJECTS_KEY, JSON.stringify(store));
    return true;
  } catch {
    // A full quota is the only realistic failure here, and it is the author's
    // problem to see and not ours to swallow: the caller reports it.
    return false;
  }
}

/**
 * Whether this browser will let the studio keep anything at all.
 *
 * Worth a one-off probe on the page, like the other two studios do, because it
 * is the one storage failure an author cannot discover by looking at the app.
 */
export function canStoreCodeProjects(): boolean {
  if (typeof localStorage === "undefined") return false;
  const probe = "__kreator-code-probe__";
  try {
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drops clips no live project points at any more.
 *
 * Without this, deleting a project would leave its voice-over in IndexedDB
 * forever - a few megabytes per project, invisible, and impossible for the
 * author to clear from inside the app.
 */
export function pruneCodeAudio(projects: readonly CodeProject[]): void {
  const keys: string[] = [];
  for (const project of projects) {
    if (project.audio) keys.push(project.audio.key);
  }
  pruneAudioClips(keys);
}
