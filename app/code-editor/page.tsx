"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { CodeStudio } from "@/components/editor/code-studio";
import { StudioHeader } from "@/components/studio-header";
import { canStoreCodeProjects } from "@/lib/code-store";

/**
 * The Code Video editor's own route.
 *
 * Its own route for the reason the other studios are: the browser should not
 * load a video encoder, seventeen grammars and a template catalogue while someone
 * is writing a chapter. It also keeps its own store,
 * `book-studio-code-projects`, and never reads the manuscript store - a code
 * video is a separate deliverable from the book it may be about.
 *
 * A client component because the whole tool is one. There is nothing a server
 * component could render on the first pass, because the project list comes out of
 * local storage and every frame is painted to a canvas.
 */
export default function CodeEditorPage() {
  // The one fact about local storage an author cannot see by looking at the app:
  // whether it will accept a write at all. A code project is bigger than a post,
  // so this studio hits the quota sooner, and a silently unsaved project is worse
  // here than anywhere else in the app. Reported once per session.
  const [storageWarned, setStorageWarned] = useState(false);

  useEffect(() => {
    // Deferred one tick, as the other routes do for their own store read: the
    // probe touches an external system, and setting state in the effect body
    // would cascade a render on mount before anything has been painted.
    const t = window.setTimeout(() => {
      if (!canStoreCodeProjects()) setStorageWarned(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      <StudioHeader />
      <div className="flex min-h-0 flex-1 flex-col">
        {storageWarned && (
          <p
            role="status"
            className="flex items-start gap-1.5 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs leading-snug text-amber-200"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              This browser is not letting the studio save anything, so your code
              projects will be lost when you close the tab. Private browsing
              usually causes it. Download each MP4 before you leave.
            </span>
          </p>
        )}
        <CodeStudio />
      </div>
    </>
  );
}
