"use client";

/**
 * The picture, and the button that saves it.
 *
 * The preview is an <iframe srcDoc> holding the exact string that gets sent to
 * the headless renderer. That is the whole WYSIWYG guarantee, and it is worth
 * being explicit about why it is an iframe rather than a React subtree: the
 * document that draws the preview is the same document that draws the PNG, down
 * to the fit script that shrinks the text. A React version would be a second
 * implementation of the same layout, and the two would disagree the first time
 * one of them was edited.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ElementLayer } from "@/components/editor/element-layer";
import { ElementPalette } from "@/components/editor/element-palette";
import { buildPostHtml, canvasById, copyForImage, pngFilename } from "@/lib/social-image";
import { normalizeArt, type PostArt } from "@/lib/social-art";
import type { SocialDraft } from "@/lib/social-draft";

/**
 * The budget the preview is drawn inside when the column's width cannot be
 * measured (first paint, older engines). Both are floors, not ceilings: the
 * measured width below can only grow the preview beyond them, never shrink
 * below what the artwork needs to stay legible.
 */
const PREVIEW_MIN_WIDTH = 320;
/** Height budget for the artwork, so a Story never crowds out the palette. */
const PREVIEW_HEIGHT_BUDGET = 460;
/** The preview is never allowed to render larger than life. */
const PREVIEW_MAX_SCALE = 1;

/** The preview's own padding, doubled for the two sides when sizing the frame. */
const PREVIEW_PADDING = 12;

export function ImageCanvas({
  draft,
  art,
  onArtChange,
}: {
  draft: SocialDraft;
  art: PostArt;
  onArtChange: (patch: Partial<PostArt>) => void;
}) {
  const [busy, setBusy] = useState(false);
  /**
   * The measured width of the column this preview lives in.
   *
   * The output column is resizable now, so a fixed budget would either waste
   * the space the author just dragged out or overflow the one they dragged in.
   * A ResizeObserver on the container answers with the real number, whatever
   * the column is dragged to.
   */
  const stageWrap = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    const node = stageWrap.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasured(entry.contentRect.width);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  /**
   * Which mark the author is working on. Lived here rather than in the panel
   * because the two halves have to agree: the palette needs it to decide which
   * row is open, and the layer needs it to draw the outline. Splitting the state
   * would mean one of them guessing.
   */
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * The design as it is at the moment of the click, kept in a ref so the
   * download never renders a stale version of the post. Written from an effect
   * rather than during render, which is both the rule and the honest ordering:
   * the effect has run by the time a click can arrive.
   */
  const live = useRef({ art, draft });
  useEffect(() => {
    live.current = { art, draft };
  }, [art, draft]);

  const safe = useMemo(() => normalizeArt(art), [art]);
  const canvas = canvasById(safe.canvas);
  const html = useMemo(
    () => buildPostHtml({ art: safe, draft }),
    [safe, draft],
  );
  const copy = useMemo(() => copyForImage(draft), [draft]);

  // The document is rendered at full size and scaled with a transform, so
  // the browser lays it out at the real pixel dimensions and the author still
  // sees the true line breaks and font sizes.
  //
  // The scale answers to the column the author dragged, not to a constant: a
  // wider output column is a bigger picture, which is most of why anyone drags
  // it at all. The drag overlay reads the same scale, so the marks keep their
  // one-to-one with the artwork at every width.
  const scale = useMemo(() => {
    const budgetWidth =
      Math.max(PREVIEW_MIN_WIDTH, measured ?? PREVIEW_MIN_WIDTH) - PREVIEW_PADDING * 2;
    const fit = Math.min(budgetWidth / canvas.width, PREVIEW_HEIGHT_BUDGET / canvas.height);
    return Math.min(PREVIEW_MAX_SCALE, fit);
  }, [canvas.width, canvas.height, measured]);
  const shownWidth = Math.round(canvas.width * scale);
  const shownHeight = Math.round(canvas.height * scale);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const { art: currentArt, draft: currentDraft } = live.current;
      const current = normalizeArt(currentArt);
      const size = canvasById(current.canvas);
      const body = JSON.stringify({
        html: buildPostHtml({ art: current, draft: currentDraft }),
        width: size.width,
        height: size.height,
        filename: pngFilename(currentDraft, current),
      });

      const response = await fetch("/api/export-png", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!response.ok) {
        // The route answers with a plain sentence on purpose; surfacing it beats
        // a generic "download failed" the author can do nothing with.
        const message = (await response.text().catch(() => "")).trim();
        toast.error(message || "The image could not be rendered.");
        return;
      }

      const blob = await response.blob();
      const name = pngFilename(currentDraft, current);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking immediately can cancel the download in some browsers, so the
      // object URL is released on the next turn instead.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`Saved ${name} — ${size.width}×${size.height}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The image could not be downloaded.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const nothingToSay = !safe.handle && !copy.hook && copy.paragraphs.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={stageWrap}
        // Its own width is the measured budget: the frame takes what the column
        // gives (minus padding), and the artwork scales to fit inside it.
        className="mx-auto w-full shrink-0 overflow-hidden rounded-lg border bg-muted/30 p-3"
        style={{ maxWidth: "100%" }}
      >
        <div
          className="relative mx-auto overflow-hidden rounded-md shadow-sm ring-1 ring-black/10"
          style={{ width: shownWidth, height: shownHeight }}
        >
          <iframe
            title={`Preview of the ${canvas.label} image`}
            srcDoc={html}
            sandbox="allow-scripts"
            // The document is fixed at the canvas size and scaled visually; the
            // width/height attributes are what give the iframe its layout box.
            width={canvas.width}
            height={canvas.height}
            style={{
              width: canvas.width,
              height: canvas.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              border: 0,
              display: "block",
            }}
            className="bg-transparent"
          />
          <ElementLayer
            art={safe}
            scale={scale}
            selected={selected}
            onSelect={setSelected}
            onChange={onArtChange}
          />
        </div>
      </div>

      <ElementPalette
        art={safe}
        selected={selected}
        onSelect={setSelected}
        onChange={onArtChange}
      />

      <div className="flex items-center gap-2">
        <Button
          onClick={download}
          disabled={busy || nothingToSay}
          className="h-8 flex-1 gap-1.5 text-sm"
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {busy ? "Rendering…" : "Download PNG"}
        </Button>
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground",
          )}
        >
          {canvas.width}×{canvas.height}
        </span>
      </div>

      {copy.bodyTruncated && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>
            The image only holds a few short lines, so the rest of the body is
            not shown. The full text is still in the post, and still copied with
            the text.
          </span>
        </p>
      )}

      {nothingToSay && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Write a hook on the left and the image will have something to say.
        </p>
      )}
    </div>
  );
}
