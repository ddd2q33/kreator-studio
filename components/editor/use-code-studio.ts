"use client";

/**
 * The code studio's project state, over local storage.
 *
 * Split out of the component for the reason `use-social-studio.ts` gives: the
 * parts worth knowing about - what happens on a quota failure, what happens to
 * an open textarea when a save is rejected - cannot be reached from inside a
 * render, and one of them is the difference between a tool and a trap.
 *
 * The debounce lives here rather than in the store because it belongs next to
 * the keystroke that causes it. Pasting a file fires one change, but a title
 * being typed fires one per character, and a code project is big enough that
 * writing it on every keystroke would be felt.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  defaultProject,
  normalizeProject,
  newBeat,
  newScene,
  BEAT_DEFAULT,
  type CodeBeat,
  type CodeProject,
  type CodeScene,
} from "@/lib/code-art";
import type { ParseResult } from "@/lib/code-script";
import { templateById, templateProject } from "@/lib/code-templates";
import {
  CODE_PROJECTS_KEY,
  emptyCodeStore,
  loadCodeProjects,
  pruneCodeAudio,
  writeCodeProjects,
  type CodeStore,
} from "@/lib/code-store";

/**
 * 900 ms, longer than the post editor's 600.
 *
 * A code project is tens of kilobytes of JSON, and a paste is the common case
 * rather than typing. Waiting a beat longer costs nothing the author notices and
 * saves a write per character on a long paste.
 */
const SAVE_DEBOUNCE_MS = 900;

export type CodeStudioState = {
  /** False until the store has been read, so the first paint is never a guess. */
  hydrated: boolean;
  projects: CodeProject[];
  project: CodeProject | null;
  update: (patch: Partial<CodeProject>) => void;
  updateScene: (id: string, patch: Partial<CodeScene>) => void;
  updateBeat: (sceneId: string, beatId: string, patch: Partial<CodeBeat>) => void;
  /** The new scene's id, so the caller can open it. Null when there is no project. */
  addScene: () => string | null;
  duplicateScene: (id: string) => void;
  removeScene: (id: string) => void;
  /** Moves a scene within the timeline. Reordering is part of editing a script. */
  moveScene: (id: string, offset: number) => void;
  /** The new sub-scene's id. Null when the scene does not exist. */
  addBeat: (sceneId: string, lines?: number[]) => string | null;
  duplicateBeat: (sceneId: string, beatId: string) => void;
  removeBeat: (sceneId: string, beatId: string) => void;
  moveBeat: (sceneId: string, beatId: string, offset: number) => void;
  /**
   * Applies a pasted script.
   *
   * `append` adds the scenes to the end of the timeline instead of replacing it,
   * which is the difference between "here is the next section" and "I just lost
   * my work" when somebody pastes the wrong half of a script. Returns the id of
   * the first scene created, so the studio can open it; null when the script held
   * no scenes.
   */
  applyScript: (parsed: ParseResult, append: boolean) => string | null;
  select: (id: string) => void;
  newProject: (templateId: string) => void;
  removeProject: (id: string) => void;
  /** True while a debounced save is still pending. */
  saving: boolean;
};

/**
 * The project the studio is editing.
 *
 * One helper for the display and for every mutation, on purpose. These two used
 * to disagree - the returned `project` fell back to the first project when
 * `activeId` did not match, while the mutators looked only at `activeId` - and a
 * seeded store with a null `activeId` therefore rendered a project that could not
 * be edited at all: the line picker, the style and the format all silently did
 * nothing. Making both sides call this is the fix, and it is a fix that cannot be
 * undone by adding a fourth mutator.
 */
function activeProject(store: CodeStore): CodeProject | null {
  return store.projects.find((p) => p.id === store.activeId) ?? store.projects[0] ?? null;
}

export function useCodeStudio(): CodeStudioState {
  // `emptyCodeStore` is a function, and passing one straight to useState would be
  // read as a lazy initialiser that happens to work. Wrapped so the intent is
  // the factory, not the value.
  const [store, setStore] = useState<CodeStore>(() => emptyCodeStore());
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Read after mount, never during render: the project list is content React
    // will complain about if it differs between the server and the client. The
    // setState is deferred a tick for the reason app/video-editor gives.
    const t = window.setTimeout(() => {
      const loaded = loadCodeProjects(window.localStorage.getItem(CODE_PROJECTS_KEY));
      // An empty studio on a first visit would be the least inviting screen in
      // the app, and "paste your code" is not a demo. The seeded project is a
      // worked example the author can delete in one click.
      const withSeed =
        loaded.projects.length > 0
          ? loaded
          : {
              activeId: null,
              projects: [templateProject(templateById("explain"))],
            };
      // The seed is written with an explicit activeId rather than a null one:
      // a null is what made the first project's edits vanish before `activeProject`
      // learned to cope with it, and being explicit keeps the stored state
      // readable on its own.
      const settled: CodeStore = {
        ...withSeed,
        activeId: activeProject(withSeed)?.id ?? null,
      };
      setStore(settled);
      setHydrated(true);
      if (loaded.projects.length === 0) writeCodeProjects(settled);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const pending = useRef<CodeStore | null>(null);
  const timer = useRef<number | null>(null);

  const persist = useCallback((next: CodeStore): CodeStore => {
    pending.current = next;
    setSaving(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const target = pending.current;
      pending.current = null;
      if (!target) {
        setSaving(false);
        return;
      }
      if (!writeCodeProjects(target)) {
        // The one failure a local-first tool has to be honest about: the project
        // works in this session and is gone after a reload.
        toast.error(
          "Your code project could not be saved - browser storage is full. Export the MP4 before you close the tab.",
        );
      }
      setSaving(false);
    }, SAVE_DEBOUNCE_MS);
    return next;
  }, []);

  // A pending save is flushed on unmount, so closing the tab inside the debounce
  // window does not lose the last paste.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (pending.current) writeCodeProjects(pending.current);
    },
    [],
  );

  const update = useCallback(
    (patch: Partial<CodeProject>) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        const next = normalizeProject({ ...current, ...patch });
        return persist({ ...prev, projects: prev.projects.map((p) => (p.id === current.id ? next : p)) });
      });
    },
    [persist],
  );

  const commit = useCallback(
    (prev: CodeStore, current: CodeProject, scenes: CodeScene[], extra?: Partial<CodeProject>): CodeStore => {
      // Renormalised rather than spliced: a scene whose code is retyped can end
      // up pointing at lines that no longer exist, and the normalizer is what
      // guarantees a scene never renders a line from the wrong file.
      const next = normalizeProject({ ...current, ...extra, scenes });
      return persist({ ...prev, projects: prev.projects.map((p) => (p.id === current.id ? next : p)) });
    },
    [persist],
  );

  const updateScene = useCallback(
    (id: string, patch: Partial<CodeScene>) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        return commit(
          prev,
          current,
          current.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        );
      });
    },
    [commit],
  );

  const updateBeat = useCallback(
    (sceneId: string, beatId: string, patch: Partial<CodeBeat>) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        return commit(
          prev,
          current,
          current.scenes.map((scene) =>
            scene.id === sceneId
              ? { ...scene, beats: scene.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b)) }
              : scene,
          ),
        );
      });
    },
    [commit],
  );

  const addScene = useCallback((): string | null => {
    // The id is minted outside the state update so it can be handed back: a newly
    // added scene has to open in the editor, and waiting for the re-render to
    // learn which one it was means the author is left looking at the old scene
    // wondering whether the button worked.
    const id = `scene_${Math.random().toString(36).slice(2, 10)}`;
    setStore((prev) => {
      const current = activeProject(prev);
      if (!current) return prev;
      // A new scene inherits the file of the scene before it. Cutting a second
      // view of the same file is the common case by a long way, and re-pasting it
      // is a chore. It starts with no lines: copying the previous selection would
      // put a duplicate in the video if the author walked away to make coffee, and
      // an empty sub-scene stays out of the export until lines are ticked.
      const last = current.scenes[current.scenes.length - 1];
      const scene: CodeScene = {
        ...newScene(last?.code ?? "", last?.language ?? "text", last?.fileName ?? "code"),
        id,
      };
      scene.beats = [newBeat([], BEAT_DEFAULT)];
      return commit(prev, current, [...current.scenes, scene]);
    });
    return id;
  }, [commit]);

  const duplicateScene = useCallback(
    (id: string) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        const source = current.scenes.find((s) => s.id === id);
        if (!source) return prev;
        // Fresh ids all the way down, so duplicating twice does not leave two
        // sub-scenes fighting over one id and editing the wrong one.
        const copy: CodeScene = {
          ...source,
          id: `scene_${Math.random().toString(36).slice(2, 10)}`,
          beats: source.beats.map((b) => ({ ...b, id: `beat_${Math.random().toString(36).slice(2, 10)}` })),
        };
        const at = current.scenes.findIndex((s) => s.id === id) + 1;
        const scenes = [...current.scenes];
        scenes.splice(at, 0, copy);
        return commit(prev, current, scenes);
      });
    },
    [commit],
  );

  const removeScene = useCallback(
    (id: string) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        return commit(prev, current, current.scenes.filter((s) => s.id !== id));
      });
    },
    [commit],
  );

  const moveScene = useCallback(
    (id: string, offset: number) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        const at = current.scenes.findIndex((s) => s.id === id);
        const to = at + offset;
        if (at < 0 || to < 0 || to >= current.scenes.length) return prev;
        const scenes = [...current.scenes];
        const [moved] = scenes.splice(at, 1);
        scenes.splice(to, 0, moved!);
        return commit(prev, current, scenes);
      });
    },
    [commit],
  );

  const addBeat = useCallback(
    (sceneId: string, lines: number[] = []): string | null => {
      const id = `beat_${Math.random().toString(36).slice(2, 10)}`;
      setStore((prev) => {
        const current = activeProject(prev);
        const scene = current?.scenes.find((s) => s.id === sceneId);
        if (!current || !scene) return prev;
        return commit(
          prev,
          current,
          current.scenes.map((s) =>
            s.id === sceneId ? { ...s, beats: [...s.beats, { ...newBeat(lines), id }] } : s,
          ),
        );
      });
      return id;
    },
    [commit],
  );

  const duplicateBeat = useCallback(
    (sceneId: string, beatId: string) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        return commit(
          prev,
          current,
          current.scenes.map((scene) => {
            if (scene.id !== sceneId) return scene;
            const at = scene.beats.findIndex((b) => b.id === beatId);
            if (at < 0) return scene;
            const copy = {
              ...scene.beats[at]!,
              id: `beat_${Math.random().toString(36).slice(2, 10)}`,
            };
            const beats = [...scene.beats];
            beats.splice(at + 1, 0, copy);
            return { ...scene, beats };
          }),
        );
      });
    },
    [commit],
  );

  const removeBeat = useCallback(
    (sceneId: string, beatId: string) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        return commit(
          prev,
          current,
          current.scenes.map((scene) =>
            scene.id === sceneId
              ? { ...scene, beats: scene.beats.filter((b) => b.id !== beatId) }
              : scene,
          ),
        );
      });
    },
    [commit],
  );

  const moveBeat = useCallback(
    (sceneId: string, beatId: string, offset: number) => {
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        return commit(
          prev,
          current,
          current.scenes.map((scene) => {
            if (scene.id !== sceneId) return scene;
            const at = scene.beats.findIndex((b) => b.id === beatId);
            const to = at + offset;
            if (at < 0 || to < 0 || to >= scene.beats.length) return scene;
            const beats = [...scene.beats];
            const [moved] = beats.splice(at, 1);
            beats.splice(to, 0, moved!);
            return { ...scene, beats };
          }),
        );
      });
    },
    [commit],
  );

  const applyScript = useCallback(
    (parsed: ParseResult, append: boolean): string | null => {
      // Fresh ids on the way in: a script pasted twice must not produce two
      // copies of a project fighting over one scene id, where editing one edits
      // both and the timeline shows the change twice. Generated before the store
      // write rather than inside it, so the caller can select the scene that was
      // actually created - the state update has not happened yet when it needs to
      // answer.
      const scenes = parsed.scenes.map((scene) => ({
        ...scene,
        id: `scene_${Math.random().toString(36).slice(2, 10)}`,
        beats: scene.beats.map((b) => ({
          ...b,
          id: `beat_${Math.random().toString(36).slice(2, 10)}`,
        })),
      }));
      if (scenes.length === 0) return null;
      setStore((prev) => {
        const current = activeProject(prev);
        if (!current) return prev;
        const next = append ? [...current.scenes, ...scenes] : scenes;
        return commit(prev, current, next, parsed.settings ?? undefined);
      });
      return scenes[0].id;
    },
    [commit],
  );

  const select = useCallback((id: string) => {
    setStore((prev) => (prev.projects.some((p) => p.id === id) ? { ...prev, activeId: id } : prev));
  }, []);

  const newProject = useCallback(
    (templateId: string) => {
      const created = templateProject(templateById(templateId));
      setStore((prev) => persist({ ...prev, activeId: created.id, projects: [...prev.projects, created] }));
    },
    [persist],
  );

  const removeProject = useCallback(
    (id: string) => {
      setStore((prev) => {
        const remaining = prev.projects.filter((p) => p.id !== id);
        // Deleting a project you are not editing should not move you off the one
        // you are. Only when the active one goes does the studio move on, and
        // only when nothing is left does it start again from a blank take.
        const stillActive = remaining.find((p) => p.id === prev.activeId);
        const withSeed: CodeStore = {
          activeId: stillActive?.id ?? remaining[0]?.id ?? null,
          projects: remaining.length > 0 ? remaining : [templateProject(templateById("empty"))],
        };
        // The deleted project's voice-over is now unreferenced, and IndexedDB
        // has no idea. Pruning here is the only chance to reclaim it.
        pruneCodeAudio(withSeed.projects);
        return persist(withSeed);
      });
    },
    [persist],
  );

  return {
    hydrated,
    projects: store.projects,
    project: activeProject(store),
    update,
    updateScene,
    updateBeat,
    addScene,
    duplicateScene,
    removeScene,
    moveScene,
    addBeat,
    duplicateBeat,
    removeBeat,
    moveBeat,
    applyScript,
    select,
    newProject,
    removeProject,
    saving,
  };
}

/** A blank project, for the "start from nothing" button. */
export function blankProject(): CodeProject {
  return defaultProject();
}
