"use client";

/**
 * The Post Editor.
 *
 * One draft, edited in markdown or JSON, and dressed as a picture. The layout is
 * the manuscript editor's, reduced to what a post needs: a rail on the left for
 * the things you switch between (posts, templates, design), the source in the
 * middle, and the result on the right.
 *
 * The right column is the image first and the text second, because that is the
 * order the work happens in. A caption written for X still has to be a caption;
 * most of what gets posted from here is a picture with a few words on it, and
 * the network-by-network copy panels are still one click away for when that is
 * not what is wanted.
 *
 * Why a single source pane rather than one field per box: a post is a piece of
 * writing, and writing it in four labelled fields is how it stops reading like
 * writing. The field names exist as fences in the markdown and as keys in the
 * JSON, which is enough structure to keep them apart and light enough that the
 * author can paste a whole chapter in and see what falls out.
 *
 * The two views are projections of one draft, never the stored truth. That is
 * why both parsers take the open draft as a base: a view must not be able to
 * destroy state it does not display, or editing a post's markdown would quietly
 * wipe the design and the per-network versions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Braces,
  FileText,
  Files,
  ImageIcon,
  Info,
  Library,
  Maximize2,
  Minimize2,
  Palette,
  Plus,
} from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BackgroundDropzone } from "./background-dropzone";
import { DesignPanel, StylePanel } from "./design-panel";
import { ImageCanvas } from "./image-canvas";
import {
  draftToJson,
  draftToMarkdown,
  jsonToDraft,
  markdownToDraft,
  type SocialDraft,
} from "@/lib/social-draft";
import { NETWORKS } from "@/lib/social-networks";
import { socialTemplateById } from "@/lib/social-templates";
import { artFor, layoutById, type PostArt } from "@/lib/social-art";
import { DraftsPanel } from "./drafts-panel";
import { NetworkCard } from "./network-card";
import { Resizer } from "./resizer";
import { TemplatesPanel } from "./templates-panel";
import { useSocialStudio } from "./use-social-studio";

type SourceMode = "markdown" | "json";
type Rail = "drafts" | "templates" | "design" | null;
/** Which of the two outputs the right column is showing. */
type Output = "image" | "text";

export function SocialStudio() {
  const { hydrated, drafts, draft, update, select, newDraft, duplicate, remove, saving } =
    useSocialStudio();
  const [mode, setMode] = useState<SourceMode>("markdown");
  const [rail, setRail] = useState<Rail>("drafts");
  const [output, setOutput] = useState<Output>("image");
  const [source, setSource] = useState("");
  /** Set only while the JSON does not parse, so the author keeps their text. */
  const [error, setError] = useState<string | null>(null);

  /* --- comfort: sizes and focus mode ------------------------------------- */

  /** Hard bounds for the two resizable panels, in CSS pixels. */
  const RAIL_MIN = 232;
  const RAIL_MAX = 460;
  const OUT_MIN = 300;
  const OUT_MAX = 720;

  /**
   * Panel widths, remembered across visits the way an editor's layout is.
   *
   * One key rather than two, so the layout is adjusted as a whole; a half-saved
   * layout is a layout that fights the window.
   */
  const LAYOUT_KEY = "tryhard.social.layout";
  const [railWidth, setRailWidth] = useState(288);
  const [outWidth, setOutWidth] = useState(432);
  const [focusMode, setFocusMode] = useState(false);

  // Restored after mount, in the same deferred tick the drafts use, so the
  // first paint never disagrees with what the server rendered.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(LAYOUT_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as {
          railWidth?: number;
          outWidth?: number;
          focus?: boolean;
        };
        if (typeof saved.railWidth === "number") {
          setRailWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, saved.railWidth)));
        }
        if (typeof saved.outWidth === "number") {
          setOutWidth(Math.min(OUT_MAX, Math.max(OUT_MIN, saved.outWidth)));
        }
        if (saved.focus === true) setFocusMode(true);
      } catch {
        // Junk under the key is treated as "no preference", not as an error.
      }
    }, 0);
    return () => window.clearTimeout(t);
    // The bounds are module-shaped constants; the linter cannot see that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Written debounced, because a drag fires dozens of updates and a write per
  // pointermove would churn storage for numbers nobody reads that fast.
  const layoutTimer = useRef<number | null>(null);
  const saveLayout = useCallback(
    (next: { railWidth?: number; outWidth?: number; focus?: boolean }) => {
      if (layoutTimer.current !== null) window.clearTimeout(layoutTimer.current);
      layoutTimer.current = window.setTimeout(() => {
        layoutTimer.current = null;
        try {
          const raw = window.localStorage.getItem(LAYOUT_KEY);
          const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          window.localStorage.setItem(
            LAYOUT_KEY,
            JSON.stringify({ ...prev, ...next }),
          );
        } catch {
          // Storage may be unavailable (private mode, quota). The layout still
          // works; it just is not remembered.
        }
      }, 400);
    },
    // LAYOUT_KEY is a constant; reading it through the closure is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Grows or shrinks the left panel. The clamp lives here, not in the handle. */
  const nudgeRail = useCallback(
    (delta: number) => {
      setRailWidth((w) => {
        const next = Math.min(RAIL_MAX, Math.max(RAIL_MIN, w + delta));
        saveLayout({ railWidth: next });
        return next;
      });
    },
    [saveLayout],
  );

  /**
   * Grows or shrinks the output column.
   *
   * The handle sits on the column's left edge, so dragging left widens the
   * column — the reported delta is negated, which is the one piece of geometry
   * this callback knows and the reason the Resizer stays dumb.
   */
  const nudgeOut = useCallback(
    (delta: number) => {
      setOutWidth((w) => {
        const next = Math.min(OUT_MAX, Math.max(OUT_MIN, w - delta));
        saveLayout({ outWidth: next });
        return next;
      });
    },
    [saveLayout],
  );

  const toggleFocus = useCallback(() => {
    setFocusMode((f) => {
      saveLayout({ focus: !f });
      return !f;
    });
  }, [saveLayout]);

  // A linear find over eleven templates, called once per render. A useMemo here
  // would need `draft` as a dependency to be correct, and depending on the whole
  // draft means recomputing on every keystroke anyway.
  const template = socialTemplateById(draft?.templateId);

  /**
   * The design, repaired on read.
   *
   * `normalizeArt` rather than a plain `draft.art ?? defaultArt()` because the
   * value arrives from localStorage, from a hand-edited JSON file, and from
   * drafts written by an earlier version — all three can hold a font id that no
   * longer exists, and every consumer below can then assume it is one of ours.
   */
  const art = useMemo(() => artFor(draft), [draft]);

  /**
   * The latest draft, readable from an effect that must not depend on it.
   *
   * The source pane is regenerated from the draft whenever the post or the view
   * changes — but never while the author is typing in it. Depending on the draft
   * itself would re-render the textarea out from under the cursor on every
   * keystroke, so the dependency list is deliberately the draft's *id* and the
   * mode, and the value is read from here instead. Written as an effect rather
   * than during render so React is not asked to do anything with a ref.
   */
  const latest = useRef<SocialDraft | null>(null);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  /**
   * Writes one field of the design.
   *
   * Reads the open draft from the ref rather than the render's `draft`, so a
   * click that lands between a keystroke and its state flush merges onto what is
   * actually open instead of onto a stale copy.
   */
  const setArt = useCallback(
    (patch: Partial<PostArt>) => {
      const current = latest.current;
      if (!current) return;
      update({ art: { ...artFor(current), ...patch } });
    },
    [update],
  );

  const layoutUsesPhoto = layoutById(art.layout).usesPhoto;

  const draftId = draft?.id;
  useEffect(() => {
    const current = latest.current;
    if (!current) return;
    setSource(mode === "markdown" ? draftToMarkdown(current) : draftToJson(current));
    setError(null);
  }, [draftId, mode]);

  const onSourceChange = useCallback(
    (text: string) => {
      setSource(text);
      const current = latest.current;
      if (!current) return;
      if (mode === "json") {
        const result = jsonToDraft(text, current);
        if (!result.ok) {
          // The text stays in the box. A thrown exception or a cleared field
          // here would lose a post the author is in the middle of writing.
          setError(result.error);
          return;
        }
        setError(null);
        update(result.draft);
        return;
      }
      setError(null);
      update(markdownToDraft(text, current));
    },
    [mode, update],
  );

  const applyTemplate = (templateId: string) => {
    // A template always starts a *new* post rather than overwriting the open
    // one. Rewriting in place would be one keystroke from losing a paragraph,
    // and a post list that is a week old is worth exactly nothing if the
    // template picker can eat it. The footer of the picker says so out loud.
    newDraft(templateId);
  };

  if (!hydrated || !draft) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading your posts…
      </div>
    );
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-hidden"
      style={{
        display: "grid",
        // Columns appear in DOM order: the icon rail, the side panel and its
        // drag handle when open, the source, and the handle plus the output
        // column unless focus mode has parked them. `minmax(0, 1fr)` is what
        // lets the source shrink instead of forcing the window wide.
        gridTemplateColumns: [
          "auto",
          ...(rail ? [`${railWidth}px`, "auto"] : []),
          "minmax(0, 1fr)",
          ...(focusMode ? [] : ["auto", `${outWidth}px`]),
        ].join(" "),
      }}
    >
      <nav
        className="flex w-10 shrink-0 flex-col items-center gap-1 border-r bg-muted/40 py-2"
        aria-label="Post editor panels"
      >
        {[
          { id: "drafts", icon: Files, label: "Posts", count: drafts.length },
          { id: "templates", icon: Library, label: "Templates" },
          { id: "design", icon: Palette, label: "Design" },
        ].map(({ id, icon: RailIcon, label, count }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-pressed={rail === id}
            onClick={() => setRail(rail === id ? null : (id as Rail))}
            className={cn(
              "relative flex w-full flex-col items-center gap-0.5 border-l-2 py-1.5 text-[10px] transition-colors",
              rail === id
                ? "border-amber-500 bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
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

      {rail && (
        <>
          <aside
            className="flex shrink-0 flex-col overflow-hidden border-r bg-muted/20"
            style={{ width: railWidth }}
          >
          {rail === "drafts" ? (
            <DraftsPanel
              drafts={drafts}
              activeId={draft.id}
              onSelect={select}
              onNew={() => setRail("templates")}
              onDuplicate={duplicate}
              onRemove={remove}
              onClose={() => setRail(null)}
            />
          ) : rail === "templates" ? (
            <TemplatesPanel
              currentTemplateId={draft.templateId}
              onApply={applyTemplate}
              onClose={() => setRail(null)}
            />
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              <DesignPanel art={art} onChange={setArt} />
              <div className="space-y-2 border-t pt-3">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Colours
                </h3>
                <StylePanel art={art} onChange={setArt} />
              </div>
            </div>
          )}
          </aside>
          <Resizer
            value={railWidth}
            min={RAIL_MIN}
            max={RAIL_MAX}
            onDelta={nudgeRail}
            onReset={() => {
              setRailWidth(288);
              saveLayout({ railWidth: 288 });
            }}
            ariaLabel="Resize the side panel"
          />
        </>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
          <Tabs value={mode} onValueChange={(v) => setMode(v as SourceMode)}>
            <TabsList className="h-7">
              <TabsTrigger value="markdown" className="gap-1 text-xs">
                <FileText className="size-3" />
                Markdown
              </TabsTrigger>
              <TabsTrigger value="json" className="gap-1 text-xs">
                <Braces className="size-3" />
                JSON
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setRail("templates")}
          >
            <Plus className="size-3" />
            {template?.label ?? "New post"}
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {saving ? "Saving…" : "Saved"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            aria-pressed={focusMode}
            title={focusMode ? "Show the image column" : "Focus on writing"}
            onClick={toggleFocus}
          >
            {focusMode ? (
              <Minimize2 className="size-3" />
            ) : (
              <Maximize2 className="size-3" />
            )}
            {focusMode ? "Show image" : "Focus"}
          </Button>
        </header>

        {error && mode === "json" && (
          <p
            role="alert"
            className="flex items-start gap-1.5 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] leading-snug text-red-700 dark:text-red-300"
          >
            <AlertCircle className="mt-px size-3 shrink-0" />
            <span>
              {error} — your text is safe, the post has not changed yet. Fix the
              JSON and the previews will catch up.
            </span>
          </p>
        )}

        {/* Focus mode keeps the measure readable: the textarea grows as wide
            as the window gives it, but its line length is capped, because a
            full-width line of prose is harder to read, not easier. */}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto p-3",
            focusMode && "mx-auto w-full max-w-[56rem]",
          )}
        >
          <Textarea
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            spellCheck={mode === "markdown"}
            aria-label={mode === "markdown" ? "Post source, markdown" : "Post source, JSON"}
            className={cn(
              "min-h-[26rem] resize-none font-mono text-xs leading-relaxed",
              mode === "json" && "text-[11px]",
            )}
            placeholder={
              mode === "markdown"
                ? "Write the post. The fields are fenced below, or just paste the text and it becomes the body."
                : '{\n  "hook": "The opening line",\n  "body": "The post",\n  "hashtags": ["trauma"]\n}'
            }
          />
          {mode === "markdown" && template && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              <Info className="mt-px size-3 shrink-0" />
              <span>{template.rationale}</span>
            </p>
          )}
        </div>
      </section>

      {!focusMode && (
        <>
          <Resizer
            value={outWidth}
            min={OUT_MIN}
            max={OUT_MAX}
            onDelta={nudgeOut}
            onReset={() => {
              setOutWidth(432);
              saveLayout({ outWidth: 432 });
            }}
            ariaLabel="Resize the output panel"
          />
          <section
            className="flex shrink-0 flex-col overflow-hidden border-l bg-muted/20"
            style={{ width: outWidth }}
            aria-label="The finished post"
          >
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <Tabs value={output} onValueChange={(v) => setOutput(v as Output)}>
            <TabsList className="h-7">
              <TabsTrigger value="image" className="gap-1 text-xs">
                <ImageIcon className="size-3" />
                Image
              </TabsTrigger>
              <TabsTrigger value="text" className="gap-1 text-xs">
                <FileText className="size-3" />
                Text
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {output === "image" ? "PNG" : `${NETWORKS.length} networks`}
          </span>
        </header>

        {output === "image" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {/*
              The photo lives here, beside the picture, rather than in the
              Design rail. It is the one control that changes what the image is,
              and burying it one click deep in a side panel is how a feature ends
              up looking like it does not exist.
            */}
            <BackgroundDropzone
              background={art.background}
              disabled={!layoutUsesPhoto}
              onPick={(background) => setArt({ background })}
              onClear={() => setArt({ background: undefined })}
            />
            <ImageCanvas
              draft={draft}
              art={art}
              onArtChange={setArt}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {NETWORKS.map((network) => (
              <NetworkCard
                key={network.id}
                draft={draft}
                network={network}
                onChange={update}
              />
            ))}
          </div>
        )}
          </section>
        </>
      )}
    </div>
  );
}
