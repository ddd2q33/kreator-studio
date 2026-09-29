"use client";

/**
 * The preview: a canvas, a playhead, and a transport under it.
 *
 * The canvas is the project's real output size - 1920x1080 for a landscape
 * video - with CSS scaling it down to fit. Painting at the real size is what
 * makes the preview evidence rather than an impression: the same
 * `paintCodeFrame` call with the same width and height the encoder will use, so
 * a line that fits here fits in the file. Scaling the backing store down to the
 * window instead would be faster and would quietly re-wrap every caption,
 * because text measurement depends on the size it is measured at.
 *
 * The playhead lives in a ref and is read by the animation frame, not in state.
 * Advancing a 40-second timeline at 30 fps through `setState` would re-render
 * the whole studio a hundred times a second to move a bar; the state copy is
 * mirrored to the UI a few times a second instead, which is all a scrubber
 * needs to look smooth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { paintCodeFrame } from "@/lib/code-frames";
import {
  formatById,
  playableScenes,
  projectDuration,
  sceneAt,
  timeline,
  type CodeProject,
} from "@/lib/code-art";

/** How often the scrubber is told where the playhead is, in milliseconds. */
const MIRROR_MS = 70;

function clock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function PreviewCanvas({
  project,
  selectedSceneId,
  onSelectScene,
  onDuration,
  className,
}: {
  project: CodeProject;
  /** The take open in the editor, so the preview can show where it is. */
  selectedSceneId: string | null;
  /** Takes with no lines on screen are not in the video, so they are not here either. */
  onSelectScene?: (shotId: string) => void;
  onDuration?: (seconds: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const format = formatById(project.formatId);
  const total = useMemo(() => projectDuration(project), [project]);
  // The playable takes, which is the same list `timeline` lays out and the same
  // one `shotAt` indexes into. Walking `project.shots` instead would put the
  // take buttons out of step with the progress bar as soon as one had no lines.
  const scenes = useMemo(() => playableScenes(project), [project]);
  const marks = useMemo(
    () => timeline(project).map((t) => ({ start: t.start, end: t.start + t.total })),
    [project],
  );

  // A shorter timeline, or a different one, must not leave the playhead past the
  // end where nothing is drawn and the export would be a black file.
  useEffect(() => {
    if (timeRef.current > total) {
      timeRef.current = total;
      setTime(total);
    }
  }, [total]);

  useEffect(() => {
    onDuration?.(total);
  }, [total, onDuration]);

  // The paint. A dependency on the whole project is correct and cheap: the
  // painter is a few dozen fillText calls, and re-running it on any change is
  // what keeps the preview from ever disagreeing with the export.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintCodeFrame(ctx, project, timeRef.current, canvas.width, canvas.height);
  }, [project, time, selectedSceneId]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let mirrored = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      // A tab that was in the background comes back with a huge dt. Advancing by
      // it would skip most of the video in one frame, which looks like the
      // preview skipping rather than time having passed.
      const next = timeRef.current + Math.min(dt, 0.25);
      if (next >= total) {
        timeRef.current = total;
        setTime(total);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      if (now - mirrored > MIRROR_MS) {
        mirrored = now;
        setTime(next);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const seek = useCallback(
    (value: number) => {
      const clamped = Math.min(total, Math.max(0, value));
      timeRef.current = clamped;
      setTime(clamped);
    },
    [total],
  );

  const toggle = useCallback(() => {
    setPlaying((prev) => {
      // Restarting from the end is what a play button on a finished preview
      // should do; starting from the end would look broken.
      if (!prev && timeRef.current >= total - 0.01) timeRef.current = 0;
      return !prev;
    });
  }, [total]);

  // Space plays and pauses, the way every video tool behaves, but only when the
  // author is not typing into a field: stealing space from a textarea is the
  // fastest way to make a shortcut hated.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const active = sceneAt(project, time);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted/30 p-3">
        <canvas
          ref={canvasRef}
          width={format.width}
          height={format.height}
          className="max-h-full max-w-full rounded-md shadow-sm ring-1 ring-black/10"
          // The canvas is the video, so it is described rather than labelled:
          // there is no accessible way to say "a frame of code at 4.2 seconds"
          // that helps anyone, and the shot list below carries the same content.
          role="img"
          aria-label={`Preview of the code video, ${format.label}, ${active ? active.scene.title || "untitled scene" : "empty"}`}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Back to the start"
          onClick={() => seek(0)}
        >
          <SkipBack className="size-3.5" />
        </Button>
        <Button type="button" size="sm" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="To the end"
          onClick={() => seek(total)}
        >
          <SkipForward className="size-3.5" />
        </Button>

        <input
          type="range"
          min={0}
          max={Math.max(0.1, total)}
          step={0.01}
          value={Math.min(time, total)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Playhead"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        />
        <span className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
          {clock(time)} / {clock(total)}
        </span>
      </div>

      {marks.length > 0 && (
        <ol className="flex flex-wrap gap-1" aria-label="Scenes in order">
          {scenes.map((scene, index) => {
            const slice = marks[index];
            const isActive = active?.index === index;
            return (
              <li key={scene.id}>
                <button
                  type="button"
                  onClick={() => {
                    seek(slice.start + 0.001);
                    onSelectScene?.(scene.id);
                  }}
                  aria-label={`Play scene ${index + 1}: ${scene.title || "untitled"}, ${(slice.end - slice.start).toFixed(1)} seconds`}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "max-w-40 truncate rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                    isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-muted",
                    scene.id === selectedSceneId && "ring-1 ring-ring",
                  )}
                >
                  {index + 1}. {scene.title || "Untitled"}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
