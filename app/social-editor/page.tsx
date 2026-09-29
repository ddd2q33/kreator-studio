"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { SocialStudio } from "@/components/editor/social-studio";
import { StudioHeader } from "@/components/studio-header";

/**
 * The Post Editor's own route.
 *
 * Like /video-editor, it exists as a separate route rather than as a panel in
 * the manuscript editor, for the reason that page already documents: the browser
 * should only load the code for the tool in use. Six character counters, a
 * template catalogue and a JSON round trip are a lot of bundle to carry around
 * while someone is writing a chapter.
 *
 * It also keeps its own store, `book-studio-social-drafts`, and does not read the
 * book project store at all. The posts are written to be published, not filed
 * against a manuscript, and an author with twelve drafts of one chapter and one
 * post about something else entirely should not have those tangled together.
 *
 * A client component because the whole tool is one: the store is local storage,
 * so there is nothing a server component could render on the first pass.
 */
export default function SocialEditorPage() {
  // The quota warning is the one thing about local storage an author cannot
  // discover by looking at the app, so it is the one thing this page puts on
  // screen. Reported once per session rather than on every render.
  const [storageWarned, setStorageWarned] = useState(false);

  useEffect(() => {
    // Deferred one tick, as /video-editor does for its own store read: this
    // probe touches an external system, and setting state in the effect body
    // would cascade a render on mount before anything has been painted.
    const t = window.setTimeout(() => {
      try {
        const probe = "__kreator-social-probe__";
        window.localStorage.setItem(probe, "1");
        window.localStorage.removeItem(probe);
      } catch {
        setStorageWarned(true);
      }
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
              This browser is not letting the studio save anything, so posts will
              be lost when you close the tab. Private browsing usually causes it.
              Copy each post out before you leave.
            </span>
          </p>
        )}
        <SocialStudio />
      </div>
    </>
  );
}
