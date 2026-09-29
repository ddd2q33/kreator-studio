"use client";

/**
 * The Code Video studio: scenes in the middle, the film on the right.
 *
 * This tool exists because explaining code is mostly editing, not filming. A real
 * file is sixty lines long and a phone screen shows maybe eight of them legibly,
 * so the work an author actually does is deciding what the viewer is looking at
 * second by second, and then typing it out on camera. So the left rail holds the
 * things you switch between, the middle column is the scene, its sub-scenes and
 * the lines each one keeps, and the right column is the video, drawn by the same
 * painter the export will use.
 *
 * A scene is one file and one idea. A sub-scene inside it is one thing the viewer
 * is meant to notice, and it is where the timing lives: a sub-scene lasts the
 * number of seconds it was given, and the typing is fitted inside that. That is
 * why the model has no derived durations and why the sub-scene is the unit you
 * author in - the script is the same idea, in JSON, for when the timeline is
 * easier to write than to click.
 *
 * The export is the whole point, so it is not behind a menu. `renderVideoToFile`
 * is the Video Editor's, unchanged: it walks the timeline as fast as the encoder
 * will go, painting each frame on demand, which means the encode finishes well
 * before the video is over and nothing has to play in real time. The audio is
 * the author's own recording, mixed with `OfflineAudioContext` for the same
 * reason the Video Editor does it that way - a scheduled live graph drifts
 * against the picture, and this is a download, not a performance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Clapperboard,
  Copy,
  Download,
  FileJson,
  FileText,
  Film,
  Gauge,
  Layers,
  ListVideo,
  LoaderCircle,
  Mic,
  Palette,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  exportFormat,
  probeTarget,
  unavailableReason,
  type ExportTarget,
} from "@/lib/export-formats";
import { AUDIO_ACCEPT, MAX_AUDIO_BYTES, formatAudioDuration, isAudioFile } from "@/lib/scene-audio";
import { deleteAudioClip, getAudioClip, putAudioClip } from "@/lib/audio-store";
import { paintCodeFrame } from "@/lib/code-frames";
import {
  CODE_FORMATS,
  CODE_REVEALS,
  CODE_STYLES,
  SPEED_MAX,
  SPEED_MIN,
  formatById,
  projectDuration,
  sceneTiming,
  type CodeProject,
} from "@/lib/code-art";
import {
  outlineCodeScript,
  parseCodeScriptText,
  serializeCodeScript,
} from "@/lib/code-script";
import { CODE_TEMPLATES } from "@/lib/code-templates";
import { EXPORT_FPS, VideoExportError, renderVideoToFile, webCodecsProbe } from "@/lib/video-export";
import { PreviewCanvas } from "./preview-canvas";
import { ShotEditor } from "./shot-editor";
import { useCodeStudio } from "./use-code-studio";

type Rail = "projects" | "scenes" | "script" | "templates" | "look" | null;

export function CodeStudio() {
  const {
    hydrated,
    projects,
    project,
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
  } = useCodeStudio();

  const [rail, setRail] = useState<Rail>("templates");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [target, setTarget] = useState<ExportTarget>("mp4");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<null | "encode" | "audio">(null);
  const [progress, setProgress] = useState(0);
  const [support, setSupport] = useState<{ probed: boolean; webCodecs: boolean; can: Record<string, boolean> }>({
    probed: false,
    webCodecs: false,
    can: {},
  });
  /**
   * A target the browser has actually refused, learned from a real failure.
   *
   * The capability probe asks whether a codec is encodable and this browser has
   * been observed answering yes and then refusing: `VideoEncoder` reports H.264
   * as supported and Mediabunny's own preflight agrees, and the first frame
   * still fails. The probe is not wrong about what it checked, it is just less
   * strict than the encoder. So when an export really fails, the reason is kept
   * and the option is disabled, rather than the author spending another
   * three minutes to be told the same thing.
   */
  const [refused, setRefused] = useState<Record<string, string>>({});

  // Derived, not synchronised. `selectedId` is only a preference: when it points
  // at a scene that has been deleted, or at nothing yet on a freshly opened
  // project, this falls back to the first scene. An effect that wrote the repaired
  // id back into state would render the same thing one render later, and every
  // writer here goes through the scene the memo returned, so there is nothing left
  // for the write-back to fix.
  const scene = useMemo(
    () => project?.scenes.find((s) => s.id === selectedId) ?? project?.scenes[0] ?? null,
    [project, selectedId],
  );

  const format = project ? formatById(project.formatId) : CODE_FORMATS[0];
  const duration = project ? projectDuration(project) : 0;

  /* --------------------------------------------------- encoder capability */

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const probe = webCodecsProbe();
    const context = {
      width: format.width,
      height: format.height,
      frameRate: EXPORT_FPS,
      withAudio: !!project.audio,
    };
    const ask = (id: ExportTarget) => probeTarget(exportFormat(id), context, probe);
    Promise.all([ask("mp4"), ask("webm")])
      .then(([mp4, webm]) => {
        if (cancelled) return;
        setSupport({ probed: true, webCodecs: probe.webCodecs, can: { mp4, webm } });
      })
      .catch(() => {
        // A probe that rejects knows nothing, so nothing is disabled: the export
        // itself will report the real error if it turns out to be one.
        if (cancelled) return;
        setSupport({ probed: true, webCodecs: probe.webCodecs, can: { mp4: true, webm: true } });
      });
    return () => {
      cancelled = true;
    };
  }, [project, format.width, format.height]);

  /* --------------------------------------------------------------- audio */

  /**
   * Reads the narrator's clip and lays it under the whole timeline.
   *
   * Returned as a finished AudioBuffer rather than scheduled live, because a
   * file whose picture and sound drift apart is the one fault nobody forgives in
   * an explainer. 48 kHz because that is what AAC is happiest with.
   */
  const buildAudio = useCallback(
    async (target: CodeProject): Promise<AudioBuffer | null> => {
      if (!target.audio) return null;
      const blob = await getAudioClip(target.audio.key);
      if (!blob) return null;
      const Ctor =
        window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      if (!Ctor) return null;
      const total = Math.max(0.1, projectDuration(target));
      const sampleRate = 48_000;
      const ctx = new Ctor(2, Math.ceil(total * sampleRate), sampleRate);
      try {
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctx.destination);
        // A voice longer than the video is trimmed rather than the video
        // stretched: a still frame at the end is less bad than a cut-off
        // sentence, and the author can hold the last take longer.
        node.start(0, 0, total);
        return await ctx.startRendering();
      } catch {
        return null;
      }
    },
    [],
  );

  const attachAudio = useCallback(
    async (file: File | undefined, current: CodeProject) => {
      if (!file || !current) return;
      if (!isAudioFile(file)) {
        toast.error("That is not an audio file. MP3, WAV, M4A and OGG work.");
        return;
      }
      // Checked before decoding because a 200 MB file should not be read into
      // memory to be measured and then rejected.
      if (file.size > MAX_AUDIO_BYTES) {
        toast.error(
          `That recording is over the ${Math.round(MAX_AUDIO_BYTES / 1_048_576)} MB limit for a voice-over. Trim it, or record it in parts.`,
        );
        return;
      }
      setBusy("audio");
      try {
        // Measured in a throwaway context so the duration can be shown and the
        // timeline laid out before anything is committed to storage.
        const Ctor =
          window.OfflineAudioContext ??
          (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext;
        if (!Ctor) throw new Error("This browser cannot read audio.");
        const probe = new Ctor(1, 48_000, 48_000);
        const decoded = await probe.decodeAudioData(await file.arrayBuffer());
        const key = `code_${Math.random().toString(36).slice(2, 10)}`;
        const saved = await putAudioClip(key, file);
        if (!saved) {
          toast.error("The voice-over is too large to keep in this browser.");
          return;
        }
        if (current.audio) void deleteAudioClip(current.audio.key);
        update({ audio: { key, name: file.name, duration: decoded.duration } });
        toast.success(`Voice-over attached - ${formatAudioDuration(decoded.duration)}.`);
      } catch {
        toast.error("This browser could not read that audio file.");
      } finally {
        setBusy(null);
      }
    },
    [update],
  );

  const clearAudio = useCallback(() => {
    if (project?.audio) void deleteAudioClip(project.audio.key);
    update({ audio: null });
  }, [project, update]);

  /* -------------------------------------------------------------- export */

  const exportVideo = useCallback(async () => {
    if (!project) return;
    if (project.scenes.length === 0) {
      setStatus("Add a scene before exporting.");
      return;
    }
    const fmt = formatById(project.formatId);
    const total = projectDuration(project);
    if (!(total > 0)) {
      setStatus("The timeline is empty, so there is nothing to export.");
      return;
    }

    setBusy("encode");
    setProgress(0);
    setStatus(`Rendering .${exportFormat(target).extension}…`);
    try {
      const audio = await buildAudio(project);
      // A canvas of the real output size, not the preview's element: the
      // encoder samples this one, so its dimensions are the video's.
      const canvas = document.createElement("canvas");
      canvas.width = fmt.width;
      canvas.height = fmt.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new VideoExportError("This browser blocked the 2D canvas.");

      const result = await renderVideoToFile({
        target,
        canvas,
        width: fmt.width,
        height: fmt.height,
        duration: total,
        audio,
        paintFrame: (t) => {
          paintCodeFrame(ctx, project, t, fmt.width, fmt.height);
        },
        onProgress: (f) => {
          setProgress(f);
          setStatus(`Rendering .${exportFormat(target).extension}… ${Math.round(f * 100)}%`);
        },
      });

      const base = (project.name.trim() || "code-video").replace(/[^\w.-]+/g, "-");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(result.blob);
      a.download = `${base}.${result.extension}`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(
        result.audioDropped
          ? `Saved .${result.extension} without audio: this browser cannot encode ${exportFormat(target).audioCodec?.toUpperCase()}.`
          : `Saved .${result.extension}${audio ? " with your voice" : ""}.`,
      );
      toast.success(`Saved ${base}.${result.extension}`);
    } catch (error) {
      const message =
        error instanceof VideoExportError ? error.message : "The export failed for an unknown reason.";
      setStatus(message);
      // Only an encoder refusal is worth remembering. A cancelled or interrupted
      // export is not a statement about what this browser can do, and treating it
      // as one would disable a format that works.
      if (/not supported|encoder|codec/i.test(message)) {
        setRefused((prev) => ({ ...prev, [target]: message }));
      }
    } finally {
      setBusy(null);
    }
  }, [buildAudio, project, target]);

  /* ---------------------------------------------------------------- view */

  if (!hydrated || !project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading your code projects…
      </div>
    );
  }

  const refusal = refused[target];
  const canExport = support.can[target] !== false && !refusal;
  const blocked = refusal ?? unavailableReason(target, { webCodecs: support.webCodecs, probed: support.probed });

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ------------------------------------------------------ left rail */}
      <nav
        aria-label="Code video sections"
        className="flex w-40 shrink-0 flex-col gap-1 border-r bg-muted/20 p-2"
      >
        {(
          [
            { id: "projects" as const, label: "Projects", icon: Film },
            { id: "scenes" as const, label: "Scenes", icon: ListVideo },
            { id: "script" as const, label: "Script", icon: FileJson },
            { id: "templates" as const, label: "Templates", icon: Layers },
            { id: "look" as const, label: "Look", icon: Palette },
          ]
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setRail(rail === id ? null : id)}
            aria-pressed={rail === id}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
              rail === id ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
        <div className="mt-auto space-y-1 text-[10px] text-muted-foreground">
          {saving ? <p>Saving…</p> : <p>{projects.length} project{projects.length === 1 ? "" : "s"}</p>}
          <p>
            {project.scenes.length} scene{project.scenes.length === 1 ? "" : "s"}
          </p>
        </div>
      </nav>

      {rail && (
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r p-3">
          {rail === "projects" && (
            <>
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Projects
              </h2>
              <ul className="space-y-1">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => select(p.id)}
                      aria-current={p.id === project.id ? "true" : undefined}
                      className={cn(
                        "flex-1 truncate rounded border px-2 py-1 text-left text-[11px]",
                        p.id === project.id ? "border-ring bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      {p.name || "Untitled"}
                    </button>
                    {projects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProject(p.id)}
                        aria-label={`Delete ${p.name}`}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted-foreground">Name</span>
                <input
                  value={project.name}
                  onChange={(e) => update({ name: e.target.value })}
                  aria-label="Project name"
                  className="h-7 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </>
          )}

          {rail === "scenes" && (
            <>
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Scenes
              </h2>
              <p className="text-[10px] leading-snug text-muted-foreground">
                The whole video as a list. A scene with no sub-scene holding
                lines is marked, and stays out of the export until you finish it.
              </p>
              <ol className="space-y-1" aria-label="Scenes in the video">
                {project.scenes.map((s, index) => {
                  const playable = s.beats.filter((b) => b.lines.length > 0);
                  const empty = playable.length === 0;
                  return (
                    <li key={s.id} className="rounded border px-2 py-1.5">
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(s.id);
                            setRail(null);
                          }}
                          aria-current={s.id === scene?.id ? "true" : undefined}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate text-[11px]">
                            <span className="mr-1 tabular-nums text-muted-foreground">{index + 1}.</span>
                            {s.title || "Untitled scene"}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {empty ? (
                              <span className="text-amber-500">no lines yet</span>
                            ) : (
                              `${playable.length} sub-scene${playable.length === 1 ? "" : "s"} · ${sceneTiming(s, project).total.toFixed(1)}s`
                            )}
                          </span>
                        </button>
                        <span className="flex shrink-0 flex-col">
                          <button
                            type="button"
                            onClick={() => moveScene(s.id, -1)}
                            disabled={index === 0}
                            aria-label={`Move ${s.title || "scene"} up`}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          >
                            <ArrowUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveScene(s.id, 1)}
                            disabled={index === project.scenes.length - 1}
                            aria-label={`Move ${s.title || "scene"} down`}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          >
                            <ArrowDown className="size-3" />
                          </button>
                        </span>
                        <button
                          type="button"
                          onClick={() => duplicateScene(s.id)}
                          aria-label={`Duplicate ${s.title || "scene"}`}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                        >
                          <Copy className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeScene(s.id)}
                          aria-label={`Delete ${s.title || "scene"}`}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
                {project.scenes.length === 0 && (
                  <li className="rounded border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
                    No scenes yet.
                  </li>
                )}
              </ol>
            </>
          )}

          {rail === "script" && (
            <ScriptPanel
              project={project}
              onApply={(parsed, append) => {
                const first = applyScript(parsed, append);
                // Opening what was just built, because applying a script and then
                // looking at the old timeline is how a person concludes nothing
                // happened.
                if (first) {
                  setSelectedId(first);
                  setSelectedBeatId(null);
                }
                if (parsed.warnings.length > 0) {
                  toast.warning(
                    `Script read with ${parsed.warnings.length} thing${parsed.warnings.length === 1 ? "" : "s"} to check - see the Script rail.`,
                  );
                } else {
                  toast.success(
                    `${parsed.scenes.length} scene${parsed.scenes.length === 1 ? "" : "s"} in the video.`,
                  );
                }
                setRail(null);
              }}
            />
          )}

          {rail === "templates" && (
            <>
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Start from a template
              </h2>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Each one is a worked example with its scenes already cut. Replace
                the code with yours and the scenes keep their lines.
              </p>
              <ul className="space-y-1.5">
                {CODE_TEMPLATES.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => newProject(t.id)}
                      className="w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="block text-[11px] font-medium">{t.label}</span>
                      <span className="block text-[10px] leading-snug text-muted-foreground">
                        {t.hint}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {rail === "look" && (
            <>
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                How it appears
              </h2>
              <ul className="space-y-1.5">
                {CODE_STYLES.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => update({ styleId: s.id })}
                      aria-pressed={project.styleId === s.id}
                      className={cn(
                        "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                        project.styleId === s.id ? "border-ring bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-medium">
                        <Swatch styleId={s.id} />
                        {s.label}
                      </span>
                      <span className="block text-[10px] leading-snug text-muted-foreground">
                        {s.hint}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                How it appears over time
              </h3>
              <ul className="space-y-1">
                {CODE_REVEALS.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => update({ reveal: r.id })}
                      aria-pressed={project.reveal === r.id}
                      className={cn(
                        "w-full rounded border px-2 py-1 text-left text-[10px]",
                        project.reveal === r.id ? "border-ring bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="block font-medium">{r.label}</span>
                      <span className="block text-muted-foreground">{r.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Where it is going
              </h3>
              <ul className="space-y-1">
                {CODE_FORMATS.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => update({ formatId: f.id })}
                      aria-pressed={project.formatId === f.id}
                      className={cn(
                        "w-full rounded border px-2 py-1 text-left text-[10px]",
                        project.formatId === f.id ? "border-ring bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="block font-medium">
                        {f.label} · {f.width}×{f.height}
                      </span>
                      <span className="block text-muted-foreground">{f.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label
                    htmlFor="typing-speed"
                    className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    <Gauge className="size-3" />
                    Typing speed
                  </label>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {project.speed} chars/s
                  </span>
                </div>
                <input
                  id="typing-speed"
                  type="range"
                  min={SPEED_MIN}
                  max={SPEED_MAX}
                  step={1}
                  value={project.speed}
                  onChange={(e) => update({ speed: Number(e.target.value) })}
                  aria-label="Typing speed"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
                />
              </div>

              <div className="space-y-1">
                <Toggle
                  label="Blinking cursor"
                  checked={project.cursor}
                  onChange={(cursor) => update({ cursor })}
                />
                <Toggle
                  label="Show the caption"
                  checked={project.captions}
                  onChange={(captions) => update({ captions })}
                />
              </div>
            </>
          )}
        </aside>
      )}

      {/* ----------------------------------------------- scenes + sub-scenes */}
      <section className="flex w-96 shrink-0 flex-col border-r">
        <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold">
            <Clapperboard className="size-3.5" />
            Scenes
          </h2>
          <Button
            type="button"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            onClick={() => {
              // Opens the new scene straight away: a button that adds something
              // invisible reads as a broken button, and picking the lines is the
              // whole point of adding one.
              const id = addScene();
              if (id) {
                setSelectedId(id);
                setSelectedBeatId(null);
              }
            }}
          >
            <Plus className="size-3" />
            Add
          </Button>
        </header>

        <ol className="max-h-40 shrink-0 overflow-y-auto border-b" aria-label="Scenes in the video">
          {project.scenes.map((s, index) => {
            const playable = s.beats.filter((b) => b.lines.length > 0);
            return (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-1 border-b px-2 py-1 last:border-b-0",
                  s.id === scene?.id && "bg-muted",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id);
                    setSelectedBeatId(null);
                  }}
                  aria-current={s.id === scene?.id ? "true" : undefined}
                  className="flex-1 truncate text-left text-[11px]"
                >
                  <span className="mr-1 tabular-nums text-muted-foreground">{index + 1}.</span>
                  {s.title || "Untitled scene"}
                  {playable.length === 0 && (
                    <span className="ml-1 text-[10px] text-amber-500">no lines yet</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => duplicateScene(s.id)}
                  aria-label={`Duplicate ${s.title || "scene"}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <Copy className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeScene(s.id)}
                  aria-label={`Delete ${s.title || "scene"}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            );
          })}
          {project.scenes.length === 0 && (
            <li className="px-3 py-3 text-[11px] text-muted-foreground">
              No scenes yet. Add one, paste your code, then tick the lines each
              sub-scene is about.
            </li>
          )}
        </ol>

        {scene ? (
          <ShotEditor
            scene={scene}
            project={project}
            selectedBeatId={selectedBeatId}
            onSelectBeat={setSelectedBeatId}
            onSceneChange={(patch) => updateScene(scene.id, patch)}
            onBeatChange={(beatId, patch) => updateBeat(scene.id, beatId, patch)}
            onAddBeat={() => setSelectedBeatId(addBeat(scene.id))}
            onDuplicateBeat={(beatId) => duplicateBeat(scene.id, beatId)}
            onRemoveBeat={(beatId) => removeBeat(scene.id, beatId)}
            onMoveBeat={(beatId, offset) => moveBeat(scene.id, beatId, offset)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
            Add a scene to start.
          </div>
        )}
      </section>

      {/* ------------------------------------------------- preview + export */}
      <section className="flex min-w-0 flex-1 flex-col p-3">
        <PreviewCanvas
          project={project}
          selectedSceneId={scene?.id ?? null}
          onSelectScene={setSelectedId}
        />

        <div className="mt-3 shrink-0 space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold">
              <Download className="size-3.5" />
              Export
            </h2>
            <div className="flex gap-1" role="group" aria-label="Download format">
              {(["mp4", "webm"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTarget(id)}
                  aria-pressed={target === id}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[10px] uppercase",
                    target === id ? "border-ring bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {format.width}×{format.height} · {duration.toFixed(1)}s · {EXPORT_FPS}fps
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 px-3 text-xs"
              onClick={exportVideo}
              disabled={busy !== null || !canExport || project.scenes.length === 0}
            >
              {busy === "encode" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {busy === "encode" ? `Rendering ${Math.round(progress * 100)}%` : `Download .${exportFormat(target).extension}`}
            </Button>
            {!canExport && blocked && (
              <span className="text-[10px] text-amber-500">{blocked}</span>
            )}
          </div>

          {busy === "encode" && (
            <div
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-foreground transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Mic className="size-3" />
              Your voice
            </span>
            {project.audio ? (
              <>
                <span className="truncate text-[10px]">
                  {project.audio.name} · {formatAudioDuration(project.audio.duration)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={clearAudio}
                >
                  Remove
                </Button>
              </>
            ) : (
              <label className="flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[10px] hover:bg-muted/50">
                {busy === "audio" ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <AudioLines className="size-3" />
                )}
                Attach a recording
                <input
                  type="file"
                  accept={AUDIO_ACCEPT}
                  className="sr-only"
                  aria-label="Attach a voice-over"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void attachAudio(file, project);
                  }}
                />
              </label>
            )}
            <span className="text-[10px] text-muted-foreground">
              Optional. Mixed into the MP4, not recorded live.
            </span>
          </div>

          {status && (
            <p role="status" className="text-[10px] text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The script, as text.
 *
 * The list of scenes is the working surface and the JSON is the exchange one, so
 * this panel is deliberately not a second editor: it is a place to paste a
 * script someone sent you, to read back what a project actually is, and to hand
 * the whole thing to whoever is reviewing the explanation. Both directions are
 * here because a format you can only read is not a format you can review.
 */
function ScriptPanel({
  project,
  onApply,
}: {
  project: CodeProject;
  /** Replaces the timeline with the parsed scenes, or adds them to the end. */
  onApply: (parsed: ReturnType<typeof parseCodeScriptText>, append: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [outline, setOutline] = useState(false);
  const [append, setAppend] = useState(false);

  // Checked as the author types, so a missing brace is caught while it is being
  // written rather than after the whole explanation has been pasted in.
  const parsed = text.trim() ? parseCodeScriptText(text) : null;
  const error = parsed?.error ?? null;
  const replaceable = (parsed?.scenes.length ?? 0) > 0;

  const reset = () => {
    setText("");
    setOutline(false);
  };

  return (
    <div className="flex flex-1 flex-col gap-2">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Script
      </h2>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Every scene and sub-scene, as JSON. Paste one in and the timeline becomes
        it; copy one out and the video is described without reading the code.
        Numbers are one-based, and <code>lines</code> takes a range
        (<code>&quot;12-18&quot;</code>) or a list.
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          disabled={!replaceable || !!error}
          onClick={() => {
            if (!parsed) return;
            onApply(parsed, append);
            setText("");
          }}
        >
          <FileJson className="size-3" />
          {append ? "Add these scenes" : "Build video from this"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          onClick={() => setText(serializeCodeScript(project))}
        >
          <FileText className="size-3" />
          Load current script
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          onClick={() => {
            setOutline(true);
            setText(outlineCodeScript(project));
          }}
        >
          <Gauge className="size-3" />
          Read the timings
        </Button>
        {text && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => {
                void navigator.clipboard?.writeText(text);
                toast.success("Copied.");
              }}
            >
              <Copy className="size-3" />
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={reset}
            >
              Clear
            </Button>
          </>
        )}
        {replaceable && (
          <Toggle
            label="add to the end instead of replacing"
            checked={append}
            onChange={setAppend}
          />
        )}
      </div>

      {outline && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          A reading order, with the running time at the left of each line. The
          timings are the part a second pair of eyes is most useful on.
        </p>
      )}

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (outline) setOutline(false);
        }}
        spellCheck={false}
        placeholder={'{\n  "scenes": [\n    {\n      "title": "The bug",\n      "file": "checkout.ts",\n      "language": "typescript",\n      "code": "…",\n      "subscenes": [\n        { "lines": "12-14", "note": "…", "duration": 3 }\n      ]\n    }\n  ]\n}'}
        aria-label="Project script as JSON"
        className="min-h-64 flex-1 resize-none font-mono text-[11px] leading-relaxed"
      />

      {error && (
        <p role="alert" className="text-[10px] text-destructive">
          {error}
        </p>
      )}
      {parsed && !error && parsed.scenes.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {parsed.scenes.length} scene{parsed.scenes.length === 1 ? "" : "s"} ready
          {parsed.settings ? ", and the look will change too" : ""}. Building
          replaces every scene in the current video.
        </p>
      )}
      {parsed && !error && parsed.warnings.length > 0 && (
        <ul className="space-y-0.5 text-[10px] text-amber-600 dark:text-amber-500">
          {parsed.warnings.slice(0, 6).map((warning) => (
            <li key={warning}>· {warning}</li>
          ))}
          {parsed.warnings.length > 6 && (
            <li className="text-muted-foreground">
              · and {parsed.warnings.length - 6} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[10px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3 accent-foreground"
      />
      {label}
    </label>
  );
}

/** A two-tone chip so a style is recognisable before it is chosen. */
function Swatch({ styleId }: { styleId: string }) {
  const style = CODE_STYLES.find((s) => s.id === styleId);
  if (!style) return null;
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-black/20"
      style={{
        background: `linear-gradient(135deg, ${style.palette.background} 0 50%, ${style.palette.accent} 50% 100%)`,
      }}
    />
  );
}
