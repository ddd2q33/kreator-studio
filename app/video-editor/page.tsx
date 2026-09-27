"use client";

import { useCallback, useEffect, useState } from "react";

import { VideoStudio } from "@/components/editor/video-studio";
import { StudioHeader } from "@/components/studio-header";
import type { Chapter } from "@/lib/projects";
import {
  loadVideoImages,
  writeVideoImages,
  type ImagePool,
} from "@/lib/video-image-store";

/**
 * The video tool used to mount inside the manuscript editor and receive the
 * book data as props. Now it is its own route: it reads the same persisted
 * store (book-studio-projects) that the editor keeps in sync, so edits made in
 * /manuscript-editor show up here — without loading the editor bundle at all.
 *
 * The text still comes from the manuscript, but the images no longer do. Both
 * studios used to share one image pool, which meant an image dropped on a scene
 * card also appeared in the manuscript gallery, and clearing images in the
 * manuscript orphaned every saved scene. This route now owns its pool, seeded
 * once from the old shared key; see lib/video-image-store.ts.
 */
export default function VideoEditorPage() {
  const [state, setState] = useState<{
    bookTitle: string;
    chapters: Chapter[];
    sourceMarkdown: string;
    images: ImagePool;
    /** Non-null only on the load that seeded the pool from the manuscript. */
    migration: { seeded: boolean; persisted: boolean } | null;
  } | null>(null);

  useEffect(() => {
    let bookTitle = "Untitled book";
    let chapters: Chapter[] = [];
    let sourceMarkdown = "";

    try {
      const raw = window.localStorage.getItem("book-studio-projects");
      if (raw) {
        const store = JSON.parse(raw) as {
          activeId?: string;
          projects?: { id: string; name: string; doc?: { chapters?: Chapter[]; markdown?: string } }[];
        };
        const project =
          store.projects?.find((p) => p.id === store.activeId) ??
          store.projects?.[0];
        if (project) {
          bookTitle = project.name;
          chapters = (project.doc?.chapters ?? []).filter(
            (c): c is Chapter =>
              !!c && typeof c.markdown === "string" && typeof c.id === "string",
          );
          sourceMarkdown = chapters
            .map((c) => c.markdown)
            .join("\n\n") || project.doc?.markdown || "";
        }
      }
    } catch {
      // Corrupt store: fall back to an empty promo project.
    }

    const { images, migration } = loadVideoImages();

    // Deferred one tick so the effect does not setState synchronously.
    const t = window.setTimeout(() => {
      setState({ bookTitle, chapters, sourceMarkdown, images, migration });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const addImage = useCallback(
    (image: { key: string; dataUrl: string; aliasKey?: string }) => {
      setState((prev) => {
        if (!prev) return prev;
        const images = { ...prev.images, [image.key]: image.dataUrl };
        if (image.aliasKey) images[image.aliasKey] = image.dataUrl;
        writeVideoImages(images);
        return { ...prev, images };
      });
    },
    [],
  );

  const addImages = useCallback((incoming: { key: string; dataUrl: string }[]) => {
    if (incoming.length === 0) return;
    setState((prev) => {
      if (!prev) return prev;
      // One spread, one storage write: a video can drop a dozen frames at once
      // and rewriting the whole pool per frame is both slow and quota-hungry.
      const images = { ...prev.images };
      for (const { key, dataUrl } of incoming) images[key] = dataUrl;
      writeVideoImages(images);
      return { ...prev, images };
    });
  }, []);

  return (
    <>
      <StudioHeader />
      <div className="flex min-h-0 flex-1 flex-col">
        {state ? (
          <>
            {state.migration && !state.migration.persisted ? (
              // The pool was seeded but the copy did not stick, so a reload
              // would lose the pictures the saved scenes point at. Only this
              // case is worth interrupting for: a migration that succeeded is
              // the expected path and stays silent.
              <p
                role="status"
                className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
              >
                Your video images were copied from the manuscript studio, but
                browser storage is full, so that copy will not survive a reload.
                Re-add the images or free up some space.
              </p>
            ) : null}
            <VideoStudio
              chapters={state.chapters}
              images={state.images}
              onAddImage={addImage}
              onAddImages={addImages}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading book data…
          </div>
        )}
      </div>
    </>
  );
}
