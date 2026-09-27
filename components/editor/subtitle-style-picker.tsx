"use client";

/**
 * Template picker with live previews.
 *
 * A dropdown list of names makes a subtitle template impossible to choose:
 * "Viral Shorts" could be anything until it is on the frame. So every option
 * here renders a small canvas through the very same painter the preview and
 * the exports use (`paintSubtitle`, borrowed from video-studio), fed a fixed
 * cue with the karaoke word lit. What the thumbnail shows is what the video
 * gets, stroke, plate, glow and all — there is no second styling path to keep
 * in sync.
 *
 * The thumbnails are painted as the lower band of a 9:16 frame and then
 * cropped, because a subtitle drawn at true scale inside a 130px-tall full
 * frame is a smudge: at 1080×1920 the type is ~45px, which is 2.3% of the
 * frame and invisible at thumbnail size. Cropping to the bottom half keeps
 * the real proportions while letting the text stay legible.
 *
 * The cue's clock is arranged so the line has fully arrived (later words are
 * past their entrance) and the last word is the one being spoken — the honest
 * frame for "this is what a caption looks like mid-read" — while the cue's
 * own window runs longer than the words so the `progress` effect draws its
 * bar partway rather than full.
 */

import { useEffect, useRef, useState } from "react";
import { Captions, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import {
  SUBTITLE_STYLES,
  SUBTITLE_STYLE_GROUPS,
  subtitleStyleById,
  type SubtitleCue,
  type SubtitleStyle,
} from "@/lib/subtitles";
import { paintSubtitle } from "./video-studio";

/** Frame the painter draws into, matching the portrait preview it feeds. */
const SRC_W = 1080;
const SRC_H = 1920;

/** The crop keeps the lower 48% — the zone every template lives in. */
const BAND_TOP = Math.round(SRC_H * 0.52);

/** Displayed width of one thumbnail in CSS pixels. */
const THUMB_W = 280;
const THUMB_H = Math.round((THUMB_W * (SRC_H - BAND_TOP)) / SRC_W);

/** Where the sample frame sits on the sample cue (see the header note). */
const SAMPLE_NOW = 4.2;

const SAMPLE_TEXT = "Tu voz ilumina cada palabra";

function sampleCue(): SubtitleCue {
  const words = SAMPLE_TEXT.split(" ");
  return {
    lines: [SAMPLE_TEXT],
    start: 0,
    // Longer than the words: the progress effect reads this window, and a
    // partway bar is more informative than a finished one.
    end: 10,
    words: words.map((text, i) => ({
      text,
      start: i * 0.9,
      end: i * 0.9 + 0.9,
    })),
    lineStarts: [0],
  };
}

const SAMPLE_CUE = sampleCue();

/** Backdrop behind the sample text: calm footage-ish blues with a warm key. */
function paintBackdrop(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, SRC_H);
  bg.addColorStop(0, "#26354f");
  bg.addColorStop(0.55, "#1a2438");
  bg.addColorStop(1, "#0c1220");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SRC_W, SRC_H);

  const key = ctx.createRadialGradient(
    SRC_W * 0.72,
    SRC_H * 0.16,
    40,
    SRC_W * 0.72,
    SRC_H * 0.16,
    SRC_H * 0.5,
  );
  key.addColorStop(0, "rgba(255, 208, 150, 0.26)");
  key.addColorStop(1, "rgba(255, 208, 150, 0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, SRC_W, SRC_H);

  // A soft ground darkening, so templates without a plate still sit on
  // something that reads as an image rather than flat colour.
  const ground = ctx.createLinearGradient(0, SRC_H * 0.6, 0, SRC_H);
  ground.addColorStop(0, "rgba(0, 0, 0, 0)");
  ground.addColorStop(1, "rgba(0, 0, 0, 0.42)");
  ctx.fillStyle = ground;
  ctx.fillRect(0, SRC_H * 0.6, SRC_W, SRC_H * 0.4);
}

function StylePreview({ style }: { style: SubtitleStyle }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // One offscreen frame at true scale, then the band is blitted onto the
    // visible canvas. Painting the band directly cannot work: the painter
    // sizes its type from the full frame it is given.
    const frame = document.createElement("canvas");
    frame.width = SRC_W;
    frame.height = SRC_H;
    const ctx = frame.getContext("2d");
    if (!ctx) return;
    paintBackdrop(ctx);
    paintSubtitle(ctx, SRC_W, SRC_H, SAMPLE_CUE, style, SAMPLE_NOW);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(THUMB_W * dpr);
    canvas.height = Math.round(THUMB_H * dpr);
    const out = canvas.getContext("2d");
    if (!out) return;
    out.drawImage(
      frame,
      0,
      BAND_TOP,
      SRC_W,
      SRC_H - BAND_TOP,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [style]);

  return (
    <canvas
      ref={ref}
      className="block w-full rounded-md border border-black/20 bg-zinc-900"
      style={{ aspectRatio: `${THUMB_W} / ${THUMB_H}` }}
      aria-hidden
    />
  );
}

export function SubtitleStylePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = subtitleStyleById(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="secondary"
        size="sm"
        className="h-6 max-w-36 gap-1 px-2 text-[11px]"
        disabled={disabled}
        aria-label="Subtitle style template"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={
          current
            ? `${current.label} — ${current.description}`
            : "Subtitle style template"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <Captions className="size-3.5 shrink-0" />
        <span className="truncate">{current?.label ?? "Template"}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </Button>

      {open ? (
        <div
          role="listbox"
          aria-label="Subtitle style templates"
          className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-88 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-background p-2 shadow-lg"
        >
          {SUBTITLE_STYLE_GROUPS.map((group) => (
            <div key={group.label} className="mb-1 last:mb-0">
              <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SUBTITLE_STYLES.filter((s) => s.category === group.label).map(
                  (style) => {
                    const selected = style.id === value;
                    return (
                      <button
                        key={style.id}
                        role="option"
                        aria-selected={selected}
                        title={`${style.label} — ${style.description}`}
                        onClick={() => {
                          onChange(style.id);
                          // Deliberately stays open: comparing templates by
                          // clicking through them is the whole point of the
                          // previews. Click elsewhere or press Escape to close.
                        }}
                        className={cn(
                          "rounded-md border p-1 text-left transition-colors hover:border-ring",
                          selected && "border-ring ring-1 ring-ring",
                        )}
                      >
                        <StylePreview style={style} />
                        <div className="mt-1 flex items-center gap-1 px-0.5">
                          <span
                            className="size-2 shrink-0 rounded-full border border-black/20"
                            style={{
                              background: style.highlightColor ?? style.color,
                            }}
                            aria-hidden
                          />
                          <span className="truncate text-[11px] font-medium">
                            {style.label}
                          </span>
                          <span className="ml-auto shrink-0 rounded border px-1 text-[9px] text-muted-foreground">
                            {style.recommended.format}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 px-0.5 text-[10px] leading-snug text-muted-foreground">
                          {style.description}
                        </p>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
