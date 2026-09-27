"use client";

import { useCallback, useEffect, useState } from "react";

import { VideoStudio } from "@/components/editor/video-studio";
import { StudioHeader } from "@/components/studio-header";
import type { Chapter } from "@/lib/projects";

/** Kept in sync with components/markdown-converter.tsx so both editors share the pool. */
const STORAGE_KEY_IMAGES = "markdown-converter-images";

function persistImages(images: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY_IMAGES,
      JSON.stringify({ images }),
    );
  } catch {
    // Quota exceeded — the scene still points at the image for this session.
  }
}

/**
 * The video tool used to mount inside the manuscript editor and receive the
 * book data as props. Now it is its own route: it reads the same persisted
 * store (book-studio-projects) that the editor keeps in sync, so edits made in
 * /manuscript-editor show up here — without loading the editor bundle at all.
 */
export default function VideoEditorPage() {
  const [state, setState] = useState<{
    bookTitle: string;
    chapters: Chapter[];
    sourceMarkdown: string;
    images: Record<string, string>;
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

    let images: Record<string, string> = {};
    try {
      const rawImages = window.localStorage.getItem("markdown-converter-images");
      if (rawImages) {
        const parsed = JSON.parse(rawImages) as { images?: Record<string, string> };
        if (parsed.images && typeof parsed.images === "object") images = parsed.images;
      }
    } catch {
      // Non-critical.
    }

    // Deferred one tick so the effect does not setState synchronously.
    const t = window.setTimeout(() => {
      setState({ bookTitle, chapters, sourceMarkdown, images });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const addImage = useCallback(
    (image: { key: string; dataUrl: string; aliasKey?: string }) => {
      setState((prev) => {
        if (!prev) return prev;
        const images = { ...prev.images, [image.key]: image.dataUrl };
        if (image.aliasKey) images[image.aliasKey] = image.dataUrl;
        persistImages(images);
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
      persistImages(images);
      return { ...prev, images };
    });
  }, []);

  return (
    <>
      <StudioHeader />
      <div className="flex min-h-0 flex-1 flex-col">
        {state ? (
          <VideoStudio
            chapters={state.chapters}
            images={state.images}
      onAddImage={addImage}
      onAddImages={addImages}
      />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading book data…
          </div>
        )}
      </div>
    </>
  );
}
