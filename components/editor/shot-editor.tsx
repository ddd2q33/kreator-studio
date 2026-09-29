"use client";

/**
 * Editing one scene: its words, its file, and the lines each of its sub-scenes
 * keeps.
 *
 * The line picker is the reason this tool exists, so it is the part of this file
 * with the most care in it. Filming code is mostly an editing decision - sixty
 * lines of a real file are unreadable on a phone, and a viewer cannot be handed a
 * scroll - and that decision needs to be two clicks, not a text selection the
 * author has to hold while the font is small.
 *
 * So the picker works on a list of the file's lines with the kept ones ticked,
 * plus a range box for the common case of "lines 12 to 18, in one go". The
 * numbers shown are the real line numbers of the file, never positions in the
 * kept list, because the author is looking at their own code and needs to find
 * the line they mean in the file they know.
 *
 * What a sub-scene keeps is stored as a list of file line numbers in its own
 * order, so showing lines 40 to 12 is allowed. Reordering is deliberately not
 * offered: a sub-scene whose lines are out of file order is almost always a
 * mistake, and the one case where it is not is better served by a second
 * sub-scene.
 *
 * The beats are listed before the code, because the beat is what the author is
 * thinking about. Picking the lines is editing a sub-scene; the file itself is
 * shared by all of them, so it sits at the bottom where changing it is a
 * deliberate act rather than the first thing that happens.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Copy,
  Eraser,
  ListPlus,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CODE_LANGUAGES } from "@/lib/code-highlight";
import {
  BEAT_MAX,
  BEAT_MIN,
  CODE_MAX_CHARS,
  HOLD_MAX,
  HOLD_MIN,
  linesFor,
  sceneTiming,
  visibleLines,
  type CodeBeat,
  type CodeProject,
  type CodeScene,
} from "@/lib/code-art";

/** A shared empty list, so a scene with no sub-scene does not rebuild one per render. */
const EMPTY_LINES: number[] = [];

export function ShotEditor({
  scene,
  project,
  selectedBeatId,
  onSelectBeat,
  onSceneChange,
  onBeatChange,
  onAddBeat,
  onDuplicateBeat,
  onRemoveBeat,
  onMoveBeat,
}: {
  scene: CodeScene;
  project: CodeProject;
  /** Which sub-scene is open, so the picker edits the right one. */
  selectedBeatId: string | null;
  onSelectBeat: (beatId: string) => void;
  onSceneChange: (patch: Partial<CodeScene>) => void;
  onBeatChange: (beatId: string, patch: Partial<CodeBeat>) => void;
  onAddBeat: () => void;
  onDuplicateBeat: (beatId: string) => void;
  onRemoveBeat: (beatId: string) => void;
  onMoveBeat: (beatId: string, offset: number) => void;
}) {
  // Scenes are replaced wholesale on every edit, so a new `scene` identity means
  // new lines. Naming the two fields instead would be the same recompute, but
  // reads as a claim that nothing else in the scene can affect the parse.
  const fileLines = useMemo(() => linesFor(scene), [scene]);
  const [range, setRange] = useState("");

  const timing = useMemo(() => sceneTiming(scene, project), [scene, project]);
  // The first sub-scene is the default rather than nothing: a scene with beats on
  // it and no open one has nothing to edit, and the picker below would be editing
  // lines that belong to nowhere.
  const beat =
    scene.beats.find((b) => b.id === selectedBeatId) ??
    scene.beats.find((b) => b.lines.length > 0) ??
    scene.beats[0] ??
    null;

  const kept = useMemo(() => new Set(beat?.lines ?? []), [beat]);
  const keptOrder = beat?.lines ?? EMPTY_LINES;
  const keptIndexOf = useCallback(
    (fileIndex: number) => keptOrder.indexOf(fileIndex),
    [keptOrder],
  );

  const toggle = useCallback(
    (fileIndex: number) => {
      if (!beat) return;
      const next = kept.has(fileIndex)
        ? beat.lines.filter((n) => n !== fileIndex)
        : // Inserted in file order rather than appended, so ticking lines out of
          // order still produces a readable sub-scene.
          [...beat.lines, fileIndex].sort((a, b) => a - b);
      onBeatChange(beat.id, { lines: next });
    },
    [beat, kept, onBeatChange],
  );

  const setRangeLines = useCallback(() => {
    if (!beat) return;
    const match = /^(\d+)\s*(?:-|\.\.|to)\s*(\d+)$/i.exec(range.trim());
    if (!match) return;
    const from = Math.max(0, Number(match[1]) - 1);
    const to = Math.min(fileLines.length - 1, Number(match[2]) - 1);
    if (from > to) return;
    const picked: number[] = [];
    for (let i = from; i <= to; i++) picked.push(i);
    onBeatChange(beat.id, {
      lines: [...new Set([...beat.lines, ...picked])].sort((a, b) => a - b),
    });
    setRange("");
  }, [beat, fileLines.length, onBeatChange, range]);

  const keepOnly = useCallback(() => {
    if (beat && beat.lines.length > 0) onBeatChange(beat.id, { lines: [], marks: [] });
  }, [beat, onBeatChange]);

  const addAll = useCallback(() => {
    if (!beat) return;
    onBeatChange(beat.id, {
      lines: fileLines.map((_, i) => i),
      marks: [],
    });
  }, [beat, fileLines, onBeatChange]);

  const toggleMark = useCallback(
    (keptPosition: number) => {
      if (!beat) return;
      const next = beat.marks.includes(keptPosition)
        ? beat.marks.filter((m) => m !== keptPosition)
        : [...beat.marks, keptPosition].sort((a, b) => a - b);
      onBeatChange(beat.id, { marks: next });
    },
    [beat, onBeatChange],
  );

  const shown = beat ? visibleLines(scene, beat) : [];
  const trimmed = scene.code.length > CODE_MAX_CHARS;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Title
          </span>
          <input
            value={scene.title}
            onChange={(e) => onSceneChange({ title: e.target.value })}
            placeholder="The bug"
            aria-label="Scene title"
            className="h-7 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            File name
          </span>
          <input
            value={scene.fileName}
            onChange={(e) => onSceneChange({ fileName: e.target.value })}
            placeholder="checkout.ts"
            aria-label="File name shown in the editor bar"
            className="h-7 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Language
          </span>
          <select
            value={scene.language}
            onChange={(e) => onSceneChange({ language: e.target.value })}
            aria-label="Code language"
            className="h-7 w-full rounded-md border bg-transparent px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {CODE_LANGUAGES.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            What you say over it
          </span>
          <input
            value={scene.caption}
            onChange={(e) => onSceneChange({ caption: e.target.value })}
            placeholder="Refunds were adding instead of subtracting."
            aria-label="Scene caption"
            className="h-7 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      {/* ---------------------------------------------- the sub-scene list */}

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sub-scenes
          </span>
          <Button
            type="button"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10px]"
            onClick={onAddBeat}
          >
            <Plus className="size-3" />
            Add
          </Button>
        </div>

        <ol className="flex flex-col gap-1" aria-label="Sub-scenes in this scene">
          {scene.beats.map((entry, index) => {
            const isOpen = entry.id === beat?.id;
            const isEmpty = entry.lines.length === 0;
            return (
              <li
                key={entry.id}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-1.5 py-1",
                  isOpen ? "border-ring bg-muted/60" : "border-border",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectBeat(entry.id)}
                  aria-current={isOpen ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                >
                  <span className="w-4 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {index + 1}.
                  </span>
                  <span
                    className={cn(
                      "truncate text-[11px]",
                      isEmpty ? "italic text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {entry.note || (isEmpty ? "no lines yet" : "untitled")}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {entry.duration.toFixed(1)}s
                  </span>
                </button>
                <span className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-5 p-0"
                    aria-label={`Move sub-scene ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => onMoveBeat(entry.id, -1)}
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-5 p-0"
                    aria-label={`Move sub-scene ${index + 1} down`}
                    disabled={index === scene.beats.length - 1}
                    onClick={() => onMoveBeat(entry.id, 1)}
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-5 p-0"
                    aria-label={`Duplicate sub-scene ${index + 1}`}
                    onClick={() => onDuplicateBeat(entry.id)}
                  >
                    <Copy className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-5 p-0"
                    aria-label={`Delete sub-scene ${index + 1}`}
                    disabled={scene.beats.length <= 1}
                    onClick={() => onRemoveBeat(entry.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </span>
              </li>
            );
          })}
          {scene.beats.length === 0 && (
            <li className="rounded-md border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
              No sub-scenes yet. Add one, or paste a script.
            </li>
          )}
        </ol>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          One sub-scene is one thing the viewer is meant to notice. A sub-scene
          with no lines stays out of the video until you tick some, so you can
          leave half of it written.
        </p>
      </div>

      {/* ------------------------------------------- the open sub-scene */}

      {beat && (
        <div className="flex flex-col gap-3 rounded-md border border-dashed p-2">
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                What this sub-scene is for
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {beat.duration.toFixed(1)}s
              </span>
            </div>
            <input
              value={beat.note}
              onChange={(e) => onBeatChange(beat.id, { note: e.target.value })}
              placeholder="the guard clause that was missing"
              aria-label="Sub-scene note"
              className="h-7 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Drawn as a badge over the code, so the viewer knows what the next
              few seconds are about.
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label
                htmlFor={`beat-${beat.id}`}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                <Clock className="size-3" />
                Seconds
              </label>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {timing.beats[scene.beats.indexOf(beat)]?.total.toFixed(1) ?? beat.duration.toFixed(1)}s
                in the video
              </span>
            </div>
            <input
              id={`beat-${beat.id}`}
              type="range"
              min={BEAT_MIN}
              max={BEAT_MAX}
              step={0.1}
              value={beat.duration}
              onChange={(e) => onBeatChange(beat.id, { duration: Number(e.target.value) })}
              aria-label="Sub-scene duration in seconds"
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
            />
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Authored, not derived: the script decides how long this runs and the
              typing is fitted to fit inside it. This is the number to set first
              when you are timing against a voice-over.
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Lines in this sub-scene
              </span>
              <span className="text-[10px] text-muted-foreground">
                {shown.length} of {fileLines.length} kept
              </span>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <input
                value={range}
                onChange={(e) => setRange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setRangeLines();
                  }
                }}
                placeholder="12-18"
                aria-label="Line range to keep"
                className="h-7 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="button" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={setRangeLines}>
                <ListPlus className="size-3" />
                Keep range
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={addAll}
                disabled={fileLines.length === 0}
              >
                <Sparkles className="size-3" />
                Keep all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={keepOnly}
                disabled={beat.lines.length === 0}
              >
                <Eraser className="size-3" />
                Keep none
              </Button>
            </div>

            <ul className="max-h-64 overflow-y-auto rounded-md border font-mono text-[11px]">
              {fileLines.map((line, index) => {
                const isKept = kept.has(index);
                const position = keptIndexOf(index);
                return (
                  <li key={index} className="flex items-start gap-1 border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggle(index)}
                      aria-pressed={isKept}
                      aria-label={`Line ${index + 1}${isKept ? ", in this sub-scene" : ""}`}
                      className={cn(
                        "flex w-11 shrink-0 items-center justify-end gap-1 border-r py-0.5 pr-1.5 text-[10px] tabular-nums",
                        isKept ? "bg-muted text-foreground" : "text-muted-foreground/60 hover:bg-muted/50",
                      )}
                    >
                      {isKept ? <Check className="size-2.5" /> : null}
                      {index + 1}
                    </button>
                    {isKept && (
                      <button
                        type="button"
                        onClick={() => toggleMark(position)}
                        aria-pressed={beat.marks.includes(position)}
                        aria-label={`Emphasise line ${index + 1}`}
                        title="Emphasise this line in the video"
                        className={cn(
                          "my-0.5 size-4 shrink-0 rounded-sm border",
                          beat.marks.includes(position)
                            ? "border-ring bg-ring"
                            : "border-muted-foreground/40 hover:border-ring",
                        )}
                      />
                    )}
                    <code
                      className={cn(
                        "flex-1 overflow-x-auto whitespace-pre py-0.5 pr-2",
                        isKept ? "text-foreground" : "text-muted-foreground/50",
                      )}
                    >
                      {line.text || " "}
                    </code>
                  </li>
                );
              })}
              {fileLines.length === 0 && (
                <li className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                  Paste some code below and the lines appear here.
                </li>
              )}
            </ul>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Tick the lines this sub-scene is about. The square that appears
              beside a kept line marks it, which puts an accent bar in the video.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ the file */}

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            The file
          </span>
          <span className="text-[10px] text-muted-foreground">
            {fileLines.length} lines{trimmed ? " - truncated" : ""}
          </span>
        </div>
        <Textarea
          value={scene.code}
          onChange={(e) => onSceneChange({ code: e.target.value })}
          spellCheck={false}
          placeholder={"Paste the file here.\n\nEvery sub-scene below picks lines out of it."}
          aria-label="Source code"
          className="h-40 resize-y font-mono text-[11px] leading-relaxed"
        />
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          Paste the whole file once. Each sub-scene decides which lines of it are
          on screen, so the same paste serves every step of the explanation.
        </p>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <label
            htmlFor={`hold-${scene.id}`}
            className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Hold at the end
          </label>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {scene.hold.toFixed(1)}s
          </span>
        </div>
        <input
          id={`hold-${scene.id}`}
          type="range"
          min={HOLD_MIN}
          max={HOLD_MAX}
          step={0.1}
          value={scene.hold}
          onChange={(e) => onSceneChange({ hold: Number(e.target.value) })}
          aria-label="Hold at the end"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        />
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          Seconds the scene stays on screen after its last sub-scene. This is the
          time the viewer has to read the result, so it is usually longer than you
          think.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-2 text-[10px] text-muted-foreground">
        <span>
          {scene.beats.length} sub-scene{scene.beats.length === 1 ? "" : "s"}
        </span>
        {/* The scene's own length, so the pacing decision is made next to the
            words rather than discovered after the encode. */}
        <span className="tabular-nums">{timing.total.toFixed(1)}s in the video</span>
      </div>
    </div>
  );
}
