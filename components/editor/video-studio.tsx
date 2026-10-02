"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Braces,
  Captions,
  CaseSensitive,
  Check,
  Clapperboard,
  Clock3,
  Copy,
  CornerUpLeft,
  Download,
  GripVertical,
  Image as ImageIcon,
  LibraryBig,
  Mic,
  Maximize,
  Minimize,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Square,
  SquareTerminal,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Upload,
  Redo2,
  Repeat,
  Volume2,
  VolumeX,
  Wand2,
} from "lucide-react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { uid } from "@/lib/projects";
import {
  DEFAULT_BRAND,
  DURATION_MAX,
  DURATION_MIN,
  IMAGE_FITS,
  CODE_REVEALS,
  CODE_SCALE_MAX,
  CODE_SCALE_MIN,
  DEFAULT_CODE_THEME,
  SCENE_CODE_MODES,
  SCENE_FORMAT_VERSION,
  TRANSITIONS as TRANSITION_IDS,
  normalizeFirstScene,
  normalizeSceneTerminal,
  normalizeScenes,
  normalizeSceneDocument,
  normalizeSceneInput,
} from "@/lib/scene-schema";
import {
  CODE_LANGUAGES,
  CODE_PANEL_THEMES,
  CODE_REVEAL_LABELS,
  paintCodePanel,
} from "@/lib/code-panel";
import { paintTerminal } from "@/lib/code-terminal";
import type {
  CodeMode,
  CodeReveal,
  ImageFit,
  SceneCode,
  SceneDocument,
  SceneTerminal,
  Transition,
  VideoScene,
} from "@/lib/scene-schema";
import { crossfadeAt, sceneStart, timeForScene } from "@/lib/scene-transition";
import { NOTES_MAX } from "@/lib/scene-schema";
import {
  DEFAULT_SCENE_JSON_TEMPLATE_ID,
  SCENE_JSON_TEMPLATES,
  sceneJsonTemplate,
} from "@/lib/scene-templates";
import {
  type History,
  type CommitMode,
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  undo,
} from "@/lib/scene-history";
import {
  canMoveSceneStep,
  groupLabels,
  moveRunTo,
  moveSceneStep,
  runOfScene,
  scenesOfRun,
  sectionSlug,
  splitScene,
} from "@/lib/scene-groups";
import { frameKey } from "@/lib/frame-sampling";
import { extractVideoFrames } from "@/lib/video-frames";
import {
  deleteAudioClip,
  getAudioClip,
  isAudioStoreAvailable,
  pruneAudioClips,
  putAudioClip,
} from "@/lib/audio-store";
import {
  AUDIO_ACCEPT,
  buildAudioSchedule,
  formatAudioDuration,
  isAudioFile,
  MAX_AUDIO_BYTES,
  targetSceneDuration,
} from "@/lib/scene-audio";
import {
  buildTimelineCues,
  activeWordIndex,
  cueAt,
  toSrt,
  regionsFromWords,
  estimateNarrationSeconds,
  DEFAULT_SUBTITLE_STYLE_ID,
  subtitleStyleById,
  entranceSecondsFor,
} from "@/lib/subtitles";
import type { SubtitleCue, SubtitleStyle } from "@/lib/subtitles";
import { SubtitleStylePicker } from "./subtitle-style-picker";
import {
  composeTransform,
  cuePhaseAt,
  entranceScope,
  IDENTITY,
  keywordMotion,
  wordEntrance,
  wordPhaseAt,
  type EntranceScope,
  type WordPhase,
  type WordTransform,
} from "@/lib/subtitle-motion";
import {
  detectSpeechRegions,
  frameEnergy,
  framePeaks,
  packPeaks,
  splitWords,
  unpackPeaks,
  FRAME_SECONDS,
  type SpeechRegion,
} from "@/lib/speech-align";
import {
  EXPORT_FORMATS,
  exportFormat,
  probeTarget,
  unavailableReason,
  type ExportTarget,
} from "@/lib/export-formats";
import { ExportHub } from "@/components/editor/export-hub";
import type { ExportTarget as ExportTargetSpec } from "@/components/editor/export-hub";
import { AssetLibrary } from "@/components/editor/asset-library";
import { useLibraryOpen } from "@/components/editor/library-toggle";
import type { Asset } from "@/lib/asset-library";
import {
  EXPORT_FPS,
  renderVideoToFile,
  throwIfCancelled,
  ExportCancelledError,
  VideoExportError,
  webCodecsProbe,
} from "@/lib/video-export";
import {
  DEFAULT_TIMELINE_ZOOM,
  TIMELINE_ZOOM_LEVELS,
  cutMarkers,
  formatTimelineTime,
  isTimelineZoom,
  rulerTicks,
  timelineScale,
  timeForX,
  xForTime,
  type TimelineZoom,
} from "@/lib/timeline-scale";

export type { VideoScene };

type VideoStudioProps = {
  /** Kept for compatibility; no longer used now that "From book" is gone. */
  bookTitle?: string;
  chapters: { id: string; title: string; markdown: string }[];
  /** Kept for compatibility; no longer used now that "From book" is gone. */
  sourceMarkdown?: string;
  images: Record<string, string>;
  /**
   * Adds an image to the shared pool. The parent owns the map so a dropped
   * image survives a reload and shows up in the manuscript editor too.
   */
  onAddImage?: (image: {
    key: string;
    dataUrl: string;
    aliasKey?: string;
  }) => void;
  /**
   * Adds many images in one go. A video can produce a dozen frames at once, and
   * writing the whole pool to localStorage per frame gets slow and can blow the
   * quota halfway through. Falls back to `onAddImage` when not supplied.
   */
  onAddImages?: (images: { key: string; dataUrl: string }[]) => void;
};

const STORE_KEY = "book-studio-video";

/**
 * The inspector's own width, in pixels, and where that preference is kept.
 *
 * The stage used to be whatever the `1fr` grid column left over, which made it
 * impossible to give the film more room without collapsing the inspector, and
 * impossible to see the whole export control without the window being wide
 * enough by luck. The author drags the divider instead, and the width survives
 * a reload so the layout they chose is the layout they get back.
 */
const INSPECTOR_WIDTH_KEY = "book-studio-video-inspector-width";
const INSPECTOR_WIDTH_DEFAULT = 320;
/** Narrower than the export control, which would clip instead of fit. */
const INSPECTOR_WIDTH_MIN = 260;
const INSPECTOR_WIDTH_MAX = 720;

/** JSON, by MIME type or by extension — some browsers report an empty type. */
function isJsonFile(file: File): boolean {
  return (
    file.type === "application/json" ||
    file.type === "text/json" ||
    /\.json$/i.test(file.name)
  );
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Reads a dropped audio file's length without decoding it.
 *
 * `loadedmetadata` is the cheap path, but some containers (notably streamed
 * webm/opus) report `Infinity` because they have no seekable duration in the
 * header. Those fall back to a full decode through an AudioContext, which is
 * slow but is the only way to learn the real length.
 */
function measureAudioDuration(
  file: File,
): Promise<{ duration: number; audio: HTMLAudioElement }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
    };
    const fail = () => {
      cleanup();
      reject(new Error(`"${file.name}" is not audio this browser can read.`));
    };

    el.addEventListener("error", fail, { once: true });
    el.addEventListener(
      "loadedmetadata",
      () => {
        const reported = el.duration;
        if (Number.isFinite(reported) && reported > 0) {
          cleanup();
          resolve({ duration: reported, audio: el });
          return;
        }
        // Keep the object URL: the decoder needs to read the same bytes.
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) {
          cleanup();
          reject(new Error("This browser cannot decode audio."));
          return;
        }
        const ctx = new Ctor();
        file
          .arrayBuffer()
          .then((buf) => ctx.decodeAudioData(buf))
          .then((decoded) => {
            const duration = decoded.duration;
            void ctx.close();
            cleanup();
            if (Number.isFinite(duration) && duration > 0) {
              resolve({ duration, audio: el });
            } else {
              reject(new Error(`"${file.name}" has no readable length.`));
            }
          })
          .catch(() => {
            void ctx.close();
            cleanup();
            fail();
          });
      },
      { once: true },
    );
    el.src = url;
  });
}

/**
 * Measures where the voice is talking inside a clip.
 *
 * Decodes the file down to one mono channel, reduces it to per-frame loudness,
 * and turns that into speech regions. Runs once when a file is attached; the
 * result is stored on the scene so a reload does not pay for the decode again.
 *
 * The analysis runs at the file's own sample rate: frame size follows
 * `FRAME_SECONDS`, so no resampling is needed and the energy stays comparable
 * to the real signal.
 *
 * Returns an empty list rather than throwing when the browser cannot decode, so
 * a failed analysis only costs the word highlight, never the attachment.
 */
async function analyzeClip(
  file: File,
): Promise<{ regions: SpeechRegion[]; peaks: number[] }> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return { regions: [], peaks: [] };
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    // Downmix to mono so a stereo take does not read as two different voices.
    const left = decoded.getChannelData(0);
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
    const samples = new Float32Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      const a = left[i] ?? 0;
      samples[i] = right ? (a + (right[i] ?? 0)) / 2 : a;
    }

    const frameSize = Math.max(
      1,
      Math.round(decoded.sampleRate * FRAME_SECONDS),
    );
    const energy = frameEnergy(samples, frameSize);
    return {
      regions: detectSpeechRegions(energy, FRAME_SECONDS, {
        totalSeconds: decoded.duration,
      }),
      // The same mono buffer that produced the regions, reduced to a shape the
      // timeline can draw. Measuring it here is what keeps attaching a clip to
      // a single decode; a second pass over the file would double the wait on
      // a long recording for a picture in the timeline.
      peaks: packPeaks(framePeaks(samples)),
    };
  } catch {
    return { regions: [], peaks: [] };
  } finally {
    void ctx.close().catch(() => {});
  }
}

const DEFAULT_SCENE = (): VideoScene => ({
  id: uid("scene-"),
  chapterId: null,
  group: null,
  // New scenes start blank so authors write their own copy; the render fills
  // in a fallback label only while a field is empty.
  kicker: "",
  title: "",
  subtitle: "",
  narration: "",
  notes: "",
  imageKey: null,
  imageFit: "contain",
  duration: 4,
  transition: "fade",
  volume: 1,
  muted: false,
  audio: null,
  code: null,
  terminal: null,
});

/**
 * Custom drag type for timeline reordering.
 *
 * A custom type rather than `text/plain` because a plain-text drag is also how
 * a URL or a selected word arrives from outside the page, and those must keep
 * hitting the file-drop path rather than being read as a scene id.
 */
const DRAG_SCENE_TYPE = "application/x-video-scene";

const TRANSITION_LABELS: Record<Transition, string> = {
  cut: "Cut",
  fade: "Fade",
  zoom: "Zoom",
  pan: "Pan",
};

const TRANSITIONS: { id: Transition; label: string }[] =
  TRANSITION_IDS.map((id) => ({ id, label: TRANSITION_LABELS[id] }));

const RESOLUTIONS: {
  id: string;
  label: string;
  short: string;
  width: number;
  height: number;
}[] = [
  { id: "720p", label: "HD (720p)", short: "1280×720", width: 1280, height: 720 },
  { id: "1080p", label: "Full HD (1080p)", short: "1920×1080", width: 1920, height: 1080 },
  { id: "1440p", label: "Quad HD (1440p)", short: "2560×1440", width: 2560, height: 1440 },
  { id: "2160p", label: "4K UHD (2160p)", short: "3840×2160", width: 3840, height: 2160 },
];

function loadScenes(): VideoScene[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const { scenes } = normalizeScenes(JSON.parse(raw));
    return scenes.length > 0 ? scenes : null;
  } catch {
    return null;
  }
}

function saveScenes(scenes: VideoScene[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(scenes));
  } catch {
    /* quota exceeded — ignore */
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [13, 148, 136];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      out.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * Which scene covers an absolute time, and how far into it we are.
 *
 * A time past the end of the timeline lands on the last scene at its final
 * frame, so the last thing on screen is the last thing that was set, rather than
 * a black frame after the video ends.
 *
 * Shared by the live preview and the file exporter: both need the same answer,
 * and two copies of this loop is how they would drift apart.
 */
/** Speeds offered by the preview rate picker. Exports always render at 1x. */
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/**
 * localStorage key for the selected scene id. Not versioned: an unknown id
 * resolves to no scene and every consumer treats that as "nothing selected".
 */
const SELECTED_SCENE_KEY = "book-studio-video-selected-scene";

function locateScene(
  scenes: readonly VideoScene[],
  time: number,
): { index: number; local: number } {
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    if (time < acc + scene.duration) {
      return {
        index: i,
        local: clamp01(
          Math.max(0, time - acc) / Math.max(0.0001, scene.duration),
        ),
      };
    }
    acc += scene.duration;
  }
  return { index: scenes.length - 1, local: 1 };
}

/**
 * How far into one specific scene an absolute time falls, as 0..1.
 *
 * `locateScene` answers this for whichever scene covers the time, which is the
 * wrong question during a crossfade: there the outgoing scene is sampled past
 * its own end and the incoming one before its own start, so neither covers the
 * instant and both have to be asked directly. Out-of-range times clamp to the
 * first or last frame.
 */
function localFor(scenes: readonly VideoScene[], index: number, time: number): number {
  const duration = Math.max(0, scenes[index]?.duration ?? 0);
  if (!(duration > 0)) return 0;
  const into = time - sceneStart(scenes, index);
  return clamp01(into / duration);
}

/**
 * A run of glyphs on one subtitle line, either plain or currently spoken.
 * Spaces are their own runs so the word colouring never bleeds into them.
 *
 * `wordIndex` is the position in the cue's word list, or -1 for a space, which
 * is what lets the painter look up a per-word animation without threading the
 * timing through the token list itself.
 */
type SubtitleToken = {
  text: string;
  highlight: boolean;
  wordIndex: number;
};

/** Width of a token list, matching how drawSubtitleTokens advances the pen. */
function measureSubtitleTokens(
  ctx: CanvasRenderingContext2D,
  tokens: SubtitleToken[],
  trackingPx: number,
): number {
  let total = 0;
  for (const token of tokens) {
    if (trackingPx > 0) {
      const chars = [...token.text];
      for (const ch of chars) total += ctx.measureText(ch).width + trackingPx;
      total -= trackingPx;
    } else {
      total += ctx.measureText(token.text).width;
    }
  }
  return total;
}

/**
 * Where a word stands right now, in the transform sense.
 *
 * Falls back to "already arrived and at rest" whenever the template does not
 * animate or the cue carries no measured timings, so the untimed path keeps
 * painting exactly what it painted before any of this existed.
 */
function wordTransformFor(
  token: SubtitleToken,
  style: SubtitleStyle,
  size: number,
  phase: WordPhase | null,
): WordTransform {

  const still = phase ?? { entranceP: 1, keywordP: 1, visible: true };
  if (style.entrance === "none" && style.keywordMotion === "none") return IDENTITY;

  const entrance =
    style.entrance === "none"
      ? IDENTITY
      : wordEntrance(style.entrance, still.entranceP, size);
  // The keyword beat only makes sense for the word actually being spoken.
  const keyword =
    token.highlight && style.keywordMotion !== "none"
      ? keywordMotion(style.keywordMotion, still.keywordP, size)
      : IDENTITY;
  return composeTransform(entrance, keyword);
}

/**
 * Fills a token, honouring the template's highlight treatment.
 *
 * The box and underline are painted behind the glyphs from the token's own
 * measured box, which is why the caller has to hand back the pen position: a
 * highlight has to know how wide the word it is behind actually is.
 */
function drawSubtitleToken(
  ctx: CanvasRenderingContext2D,
  token: SubtitleToken,
  cx: number,
  ty: number,
  tokenWidth: number,
  trackingPx: number,
  size: number,
  style: SubtitleStyle,
  transform: WordTransform,
): void {
  const highlighted = token.highlight;
  const plain = style.color;
  const accent = style.highlightColor ?? style.color;

  // Backings first, in the token's own space, so they move with the word.
  if (highlighted && style.highlight === "box") {
    const padX = size * 0.22;
    const padY = size * 0.1;
    ctx.save();
    ctx.fillStyle = accent;
    ctx.globalAlpha = transform.alpha;
    ctx.beginPath();
    ctx.roundRect(
      cx - padX,
      ty - size * 0.56 - padY,
      tokenWidth + padX * 2,
      size * 1.12 + padY * 2,
      size * 0.18,
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = transform.alpha;

  if (transform.scale !== 1 || transform.dx !== 0 || transform.dy !== 0) {
    // Scale around the token's own centre so the word grows in place. The pen
    // position is never advanced by the transform, which is the whole reason
    // the line does not re-flow while it is being read.
    const midX = cx + tokenWidth / 2;
    ctx.translate(midX, ty);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-midX, -ty);
  }

  // A gradient runs across the whole line rather than per token, so a two-stop
  // fill on a single word would just be that word's share of a ramp. One colour
  // per token keeps the intent readable at phone size.
  if (style.highlight === "gradient" && style.gradientTo && highlighted) {
    const grad = ctx.createLinearGradient(cx, 0, cx + tokenWidth, 0);
    grad.addColorStop(0, style.gradientTo);
    grad.addColorStop(1, accent);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = highlighted ? accent : plain;
  }

  if (style.strokeWidthRatio > 0) {
    ctx.strokeStyle = style.strokeColor ?? "transparent";
    ctx.lineWidth = size * style.strokeWidthRatio;
    ctx.lineJoin = "round";
  }

  // A hard drop shadow belongs to the template; a soft one keeps the highlight
  // readable over a bright photograph without boxing the word.
  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = size * style.shadow.blurRatio;
    ctx.shadowOffsetY = size * style.shadow.offsetRatio;
  } else if (highlighted && style.highlight === "glow") {
    ctx.shadowColor = accent;
    ctx.shadowBlur = Math.max(4, size * 0.3);
  } else {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  if (trackingPx > 0) {
    for (const ch of [...token.text]) {
      const cw = ctx.measureText(ch).width;
      if (style.strokeWidthRatio > 0) ctx.strokeText(ch, cx + cw / 2, ty);
      ctx.fillText(ch, cx + cw / 2, ty);
      cx += cw + trackingPx;
    }
  } else {
    if (style.strokeWidthRatio > 0) ctx.strokeText(token.text, cx + tokenWidth / 2, ty);
    ctx.fillText(token.text, cx + tokenWidth / 2, ty);
  }

  ctx.restore();

  if (highlighted && style.highlight === "underline") {
    ctx.save();
    ctx.globalAlpha = transform.alpha;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, size * 0.075);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.04, ty + size * 0.58);
    ctx.lineTo(cx + tokenWidth + size * 0.04, ty + size * 0.58);
    ctx.stroke();
    ctx.restore();
  }
}

/** Draws a line left to right from `cx`, returning where the pen ended up. */
function drawSubtitleTokens(
  ctx: CanvasRenderingContext2D,
  tokens: SubtitleToken[],
  cx: number,
  ty: number,
  trackingPx: number,
  size: number,
  style: SubtitleStyle,
  phaseFor: (wordIndex: number) => WordPhase | null,
  scope: EntranceScope,
): number {
  for (const token of tokens) {
    const tokenWidth =
      trackingPx > 0
        ? [...token.text].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) +
          trackingPx * Math.max(0, [...token.text].length - 1)
        : ctx.measureText(token.text).width;

    // Spaces carry no word of their own and must never animate or highlight.
    if (token.wordIndex < 0) {
      if (trackingPx > 0) {
        for (const ch of [...token.text]) {
          const cw = ctx.measureText(ch).width;
          ctx.fillText(ch, cx + cw / 2, ty);
          cx += cw + trackingPx;
        }
      } else {
        ctx.fillText(token.text, cx + tokenWidth / 2, ty);
        cx += tokenWidth;
      }
      continue;
    }

    const transform = wordTransformFor(token, style, size, phaseFor(token.wordIndex));

    // A word that has not been reached yet is left out entirely. Drawing it at
    // zero alpha would still cost the fill, and on a build of staggered words
    // that is most of the line for most of its life.
    if (!isWordVisible(token, style, scope, phaseFor(token.wordIndex))) {
      cx += tokenWidth;
      continue;
    }
    drawSubtitleToken(
      ctx,
      token,
      cx,
      ty,
      tokenWidth,
      trackingPx,
      size,
      style,
      transform,
    );
    cx += tokenWidth;
  }
  return cx;
}

function isWordVisible(
  token: SubtitleToken,
  style: SubtitleStyle,
  scope: EntranceScope,
  phase: WordPhase | null,
): boolean {
  if (style.entrance === "none" && style.keywordMotion === "none") return true;
  if (!phase) return true;
  if (token.highlight) return true;
  return scope === "line" || phase.visible;
}

export function paintSubtitle(

  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cue: SubtitleCue | null,
  style: SubtitleStyle = subtitleStyleById(DEFAULT_SUBTITLE_STYLE_ID),
  /**
   * The video clock at this instant, in seconds.
   *
   * Needed because the motion is timed: `paintScene` only knows scene-relative
   * `t`, and a cue lives on the absolute clock.
   */
  now: number = cue?.start ?? 0,
) {
  if (!cue || cue.lines.length === 0) return;

  const size = Math.round(Math.min(w * 0.042, h * 0.034) * style.sizeRatio);
  const lineH = size * 1.32;
  ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
  ctx.textBaseline = "middle";

  const trackingPx = size * style.tracking;
  const entranceSeconds = entranceSecondsFor(style);
  const scope = entranceScope(style.entrance);
  const timed = cue.words.length > 0;

  /**
   * Progress for a word, or null when this frame cannot be animated.
   *
   * With no measured timings the only honest answer is a single line-level
   * arrival, because there is no per-word clock to stagger against.
   */
  const phaseFor = (wordIndex: number): WordPhase | null => {
    if (!timed) return cuePhaseAt(cue.start, now, entranceSeconds);
    const word = cue.words[wordIndex];
    if (!word) return cuePhaseAt(cue.start, now, entranceSeconds);
    return wordPhaseAt(word.start, word.end, now, entranceSeconds);
  };
  // A line-scoped entrance is timed from the cue, not from each word.
  const linePhase = cuePhaseAt(cue.start, now, entranceSeconds);
  const scopedPhase = (wordIndex: number): WordPhase | null => {
    if (scope === "line" || !timed) return linePhase;
    return phaseFor(wordIndex);
  };

  // Build one token list per line. The words are taken from the line itself so
  // the painted glyphs always match the measured widths, and the cue's timing
  // supplies the highlight flag. Any inconsistency falls back to a plain line
  // rather than colouring the wrong word.
  const spoken = activeWordIndex(cue, now);
  const perLine: SubtitleToken[][] = cue.lines.map((line, li) => {
    const plain: SubtitleToken[] = [{ text: line, highlight: false, wordIndex: -1 }];
    if (!timed) return plain;
    const lineWords = splitWords(line);
    if (lineWords.length === 0) return plain;
    const offset = cue.lineStarts[li] ?? 0;
    if (offset < 0 || offset + lineWords.length > cue.words.length) {
      return plain;
    }
    const tokens: SubtitleToken[] = [];
    lineWords.forEach((text, k) => {
      if (k > 0) tokens.push({ text: " ", highlight: false, wordIndex: -1 });
      tokens.push({
        text,
        highlight: offset + k === spoken,
        wordIndex: offset + k,
      });
    });
    return tokens;
  });

  const widths = perLine.map((tokens) => measureSubtitleTokens(ctx, tokens, trackingPx));
  const maxW = Math.max(...widths);
  const padX = size * style.platePadding;
  const boxW = maxW + padX * 2;
  const boxH = cue.lines.length * lineH + size * style.platePadding;
  const boxX = (w - boxW) / 2;
  const boxY = h - boxH - h * style.bottomRatio;

  ctx.save();
  if (style.plate !== "none") {
    ctx.globalAlpha *= scopedPhase(0)?.entranceP ?? 1;
    ctx.fillStyle = style.plateColor;
    ctx.beginPath();
    const r = size * style.plateRadius;
    ctx.roundRect(boxX, boxY, boxW, boxH, r);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  let ty = boxY + boxH / 2 - ((cue.lines.length - 1) * lineH) / 2;
  perLine.forEach((tokens, li) => {
    const totalW = widths[li] ?? 0;
    let startX: number;
    if (style.align === "center") startX = w / 2 - totalW / 2;
    else if (style.align === "left") startX = boxX + padX;
    else startX = boxX + boxW - padX - totalW;
    ctx.textAlign = "center";
    drawSubtitleTokens(
      ctx,
      tokens,
      startX,
      ty,
      trackingPx,
      size,
      style,
      scopedPhase,
      scope,
    );
    ty += lineH;
  });
  ctx.restore();

  // The progress bar sits on the plate's own bottom edge, so it reads as part
  // of the lower third instead of floating over the footage.
  if (style.effects.includes("progress")) {
    const span = Math.max(0.001, cue.end - cue.start);
    const done = Math.max(0, Math.min(1, (now - cue.start) / span));
    const barH = Math.max(3, size * 0.1);
    const barY = boxY + boxH - barH;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(boxX, barY, boxW, barH);
    ctx.fillStyle = style.highlightColor ?? "#38bdf8";
    ctx.beginPath();
    ctx.roundRect(boxX, barY, boxW * done, barH, barH / 2);
    ctx.fill();
    ctx.restore();
  }

  // The rest of the renderer positions text from the top edge.
  ctx.textBaseline = "alphabetic";
}

/** Pure frame renderer shared by the live preview, thumbnails and PNG export. */
function paintScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: VideoScene,
  t: number,
  brand: string,
  image: HTMLImageElement | null,
  subtitle: SubtitleCue | null = null,
  subtitleStyle: SubtitleStyle = subtitleStyleById(DEFAULT_SUBTITLE_STYLE_ID),
  /**
   * The video clock at this instant, in seconds.
   *
   * Passed in rather than derived here because `t` is scene-relative while a cue
   * is on the absolute clock, and only the caller knows both. Word motion needs
   * the cue's own time, which is why this replaced a plain word index.
   */
  now: number = 0,
) {
  const [br, bg, bb] = hexToRgb(brand);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `rgb(${Math.min(255, br + 30)}, ${Math.min(255, bg + 26)}, ${Math.min(255, bb + 24)})`);
  grad.addColorStop(0.55, `rgb(${br}, ${bg}, ${bb})`);
  grad.addColorStop(1, `rgb(${Math.max(0, br - 40)}, ${Math.max(0, bg - 44)}, ${Math.max(0, bb - 42)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const transitionScale = (tick: number) => {
    if (scene.transition === "zoom") return 1 + tick * 0.14;
    if (scene.transition === "pan") return 1 + tick * 0.05;
    return 1;
  };

  if (image) {
    const scale = transitionScale(t);
    // Each fit answers a different question about a wrong aspect ratio, and the
    // scene chooses. The zoom factor multiplies the scale in all three: dividing
    // it instead shrank the picture below the canvas and exposed the brand
    // gradient as colored bands around it.
    const ratios = {
      // Smallest scale that still covers the frame: the overflow is cropped.
      cover: Math.max(w / image.width, h / image.height),
      // Largest scale that fits entirely: the remainder shows the gradient.
      contain: Math.min(w / image.width, h / image.height),
      // Neither - the image is stretched to the frame, aspect ratio and all.
      fill: 1,
    };
    const k = ratios[scene.imageFit] * scale;
    const dw = image.width * k;
    const dh = image.height * k;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2 + (scene.transition === "pan" ? t * dh * 0.22 : 0);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(image, dx, dy, dw, dh);
    const overlay = ctx.createLinearGradient(0, h * 0.55, 0, h);
    overlay.addColorStop(0, "rgba(0,0,0,0)");
    overlay.addColorStop(1, "rgba(2,8,20,0.78)");
    ctx.fillStyle = overlay;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    ctx.restore();
  }

  // Blank fields render nothing: a new scene is a clean frame with just the
  // background, no placeholder label burned into the middle of the render.
  const kickerText = scene.kicker.trim();
  const titleText = scene.title.trim();
  const subtitleText = scene.subtitle.trim();

  // A scene with a snippet is a different layout, not the same layout with more
  // on it: the code is the picture, so the words move out from under it and
  // stack above it where they can be read once and not re-read while the code is
  // on screen. An empty snippet is not a snippet, so the check is on the text:
  // the author pastes into the field, and the frame stays a title card until
  // there is something to read.
  if (scene.code && scene.code.source.trim()) {
    paintSceneCodeFrame(
      ctx,
      w,
      h,
      scene,
      t,
      { kickerText, titleText, subtitleText, subtitle, subtitleStyle, now },
    );
    return;
  }

  const kick = Math.round(Math.min(w * 0.045, h * 0.042));
  ctx.font = `700 ${kick}px "JetBrains Mono", monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "center";
  if (kickerText) ctx.fillText(kickerText.toUpperCase(), w / 2, h * 0.42);

  const titleSize = Math.round(Math.min(w * 0.075, h * 0.062));
  ctx.font = `800 ${titleSize}px Inter, "Inter", sans-serif`;
  ctx.fillStyle = "#ffffff";
  const titleLines = titleText ? wrapText(ctx, titleText, w * 0.86) : [];
  let y = h * 0.5;
  const lineH = titleSize * 1.16;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 24;
  for (const line of titleLines) {
    ctx.fillText(line, w / 2, y);
    y += lineH;
  }
  ctx.shadowBlur = 0;

  if (subtitleText) {
    const subSize = Math.round(Math.min(w * 0.033, h * 0.026));
    ctx.font = `500 ${subSize}px Inter, "Inter", sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    const subLines = wrapText(ctx, subtitleText, w * 0.72).slice(0, 4);
    let sy = y + subSize * 0.6;
    for (const line of subLines) {
      ctx.fillText(line, w / 2, sy);
      sy += subSize * 1.45;
    }
  }

  paintSubtitle(ctx, w, h, subtitle, subtitleStyle, now);
}

/** The frame text of a scene that carries a snippet. */
function paintSceneCodeFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: VideoScene,
  t: number,
  words: {
    kickerText: string;
    titleText: string;
    subtitleText: string;
    subtitle: SubtitleCue | null;
    subtitleStyle: SubtitleStyle;
    now: number;
  },
) {
  const { kickerText, titleText, subtitleText, subtitle, subtitleStyle, now } =
    words;

  // The card is centred in the space the burned-in subtitles leave, measured
  // the same way `paintSubtitle` places its own box, so the two can never
  // collide on a frame that has both.
  let reserved = 0;
  if (subtitle && subtitle.lines.length > 0) {
    const size = Math.round(
      Math.min(w * 0.042, h * 0.034) * subtitleStyle.sizeRatio,
    );
    reserved =
      subtitle.lines.length * size * 1.32 +
      size * subtitleStyle.platePadding +
      h * subtitleStyle.bottomRatio +
      h * 0.03;
  }

  let cardBottom = 0;
  paintCodePanel(ctx, w, h, {
    code: scene.code!,
    progress: t,
    reservedBottom: reserved,
    onLayout: (layout) => {
      cardBottom = layout.y + layout.h;
    },
  });

  // The terminal is the proof under the code: it paints only where it fits,
  // between the bottom of the code card and the top of the subtitle plate. A
  // card tall enough to leave no room quietly drops it rather than overlapping
  // either the code or the captions — and because it draws over the code
  // card's callout column, the captions are repainted on top when both are
  // on screen, keeping the same paint order as a frame without a terminal.
  const terminal = scene.terminal;
  if (terminal && terminal.output.some((line) => line.trim() !== "")) {
    paintTerminal(ctx, w, h, {
      terminal,
      progress: t,
      bottomLimit: h - reserved,
      topLimit: cardBottom,
    });
    if (subtitle && subtitle.lines.length > 0) {
      paintSubtitle(ctx, w, h, subtitle, subtitleStyle, now);
    }
  }

  // Words sit above the card, anchored to the top of the frame. Kicker, title
  // and subtitle are each optional, and the block grows downward from a fixed
  // top edge, so a scene with only a title does not leave a gap where the
  // kicker would have been.
  let y = h * 0.12;
  ctx.textAlign = "center";

  if (kickerText) {
    ctx.font = `700 ${Math.round(Math.min(w * 0.045, h * 0.042))}px "JetBrains Mono", monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(kickerText.toUpperCase(), w / 2, y);
    y += 0.09 * h;
  }

  if (titleText) {
    const titleSize = Math.round(Math.min(w * 0.058, h * 0.05));
    ctx.font = `800 ${titleSize}px Inter, "Inter", sans-serif`;
    ctx.fillStyle = "#ffffff";
    const lines = wrapText(ctx, titleText, w * 0.8);
    const lineH = titleSize * 1.16;
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 24;
    for (const line of lines) {
      ctx.fillText(line, w / 2, y);
      y += lineH;
    }
    ctx.shadowBlur = 0;
  }

  if (subtitleText) {
    const subSize = Math.round(Math.min(w * 0.028, h * 0.022));
    ctx.font = `500 ${subSize}px Inter, "Inter", sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    for (const line of wrapText(ctx, subtitleText, w * 0.66).slice(0, 3)) {
      y += subSize * 1.4;
      ctx.fillText(line, w / 2, y);
    }
  }

  paintSubtitle(ctx, w, h, subtitle, subtitleStyle, now);
}

function slugify(value: string): string {
  const out = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return out || "scene";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function TimelineThumb({
  scene,
  portrait,
  brand,
  imageSrc,
}: {
  scene: VideoScene;
  portrait: boolean;
  brand: string;
  imageSrc?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const tw = portrait ? 108 : 192;
    const th = portrait ? 192 : 108;
    canvas.width = tw;
    canvas.height = th;
    let alive = true;
    if (!imageSrc) {
      paintScene(ctx, tw, th, scene, 1, brand, null);
      return;
    }
    loadImage(imageSrc)
      .then((img) => {
        if (alive) paintScene(ctx, tw, th, scene, 1, brand, img);
      })
      .catch(() => {
        if (alive) paintScene(ctx, tw, th, scene, 1, brand, null);
      });
    return () => {
      alive = false;
    };
  }, [scene, portrait, brand, imageSrc]);
  return (
    <canvas
      ref={ref}
      className={cn(
        "size-full object-cover",
        portrait ? "aspect-[9/16]" : "aspect-video",
      )}
      aria-hidden
    />
  );
}

/**
 * The scene's voice-over drawn as a waveform under its thumbnail.
 *
 * A card shows the picture, the title and the length; none of that says where
 * the pauses are. The waveform does, and that is what an author cuts against:
 * the end of a sentence is the only honest place to put a cut, and hunting for
 * it by ear on every pass is the slowest part of editing narration.
 *
 * Drawn on a canvas rather than as one element per bucket: a long timeline is
 * dozens of cards, and 64 divs each is thousands of nodes for a decoration.
 * The strip is only as tall as a few pixels, so the canvas is sized to the
 * device pixel ratio and left to CSS otherwise.
 */
function ClipWaveform({
  peaks,
  audioDuration,
  sceneDuration,
  muted,
}: {
  peaks: readonly number[];
  /** Length of the clip, which may be longer than the scene that plays it. */
  audioDuration: number;
  /** Length of the scene; the clip is cut off at the end when shorter. */
  sceneDuration: number;
  muted: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 160;
    const h = canvas.clientHeight || 18;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (peaks.length === 0) return;

    // The lane is as wide as the scene, so the clip has to be drawn across the
    // share of it that is actually heard. Two cases matter and they are not the
    // same: a scene shorter than its clip plays only the opening, and a scene
    // longer than its clip goes quiet before the card ends. Either way the lane
    // is the scene, so the waveform is placed inside it rather than stretched
    // over it - a strip drawn edge to edge would claim audio plays where it
    // does not, which is exactly the mistake the author would cut on.
    const audible = Math.min(audioDuration, Math.max(sceneDuration, 0));
    const span = sceneDuration > 0 ? Math.max(0, Math.min(1, audible / sceneDuration)) : 1;
    const waveWidth = w * span;
    if (waveWidth <= 0) return;

    ctx.fillStyle = muted ? "rgba(120,120,130,0.5)" : "rgba(52,211,153,0.85)";
    const mid = h / 2;
    const barWidth = waveWidth / peaks.length;
    // Unpacked once, not per bar: this runs for every card in the strip, and
    // re-walking the array inside the loop would make it quadratic.
    const levels = unpackPeaks(peaks);
    for (let i = 0; i < levels.length; i++) {
      // A silent bucket still gets a hairline, so "quiet" reads as a flat
      // waveform rather than as missing data.
      const barHeight = Math.max(1, (levels[i] ?? 0) * (h - 2));
      ctx.fillRect(
        i * barWidth,
        mid - barHeight / 2,
        Math.max(1, barWidth - 0.5),
        barHeight,
      );
    }
  }, [peaks, audioDuration, sceneDuration, muted]);
  if (peaks.length === 0) return null;
  return <canvas ref={ref} className="h-[18px] w-full" aria-hidden />;
}

/** Row used by CalloutRows: which line is labelled, and what the label says. */
type CalloutRowData = { line: number; text: string; focused: boolean };

/**
 * Per-line teaching controls for a code scene.
 *
 * One row per snippet line: type a label and that line gets a callout pill in
 * the video; tap the dot and the line joins the spotlight while everything
 * else steps back. Rows live in the scene's `code.callouts` / `code.focus`,
 * so they survive round-trips through the JSON editor like every other field.
 */
function CalloutRows({
  callouts,
  focus,
  lineCount,
  onChange,
}: {
  callouts: Record<string, string>;
  focus: number[];
  lineCount: number;
  onChange: (callouts: Record<string, string>, focus: number[]) => void;
}) {
  const rows: CalloutRowData[] = [];
  for (let i = 1; i <= lineCount; i++) {
    rows.push({
      line: i,
      text: callouts[String(i)] ?? "",
      focused: focus.includes(i),
    });
  }

  const commit = (nextCallouts: Record<string, string>, nextFocus: number[]) =>
    onChange(nextCallouts, nextFocus);

  const setLabel = (line: number, text: string) => {
    const next = { ...callouts };
    if (text.trim() === "") delete next[String(line)];
    else next[String(line)] = text;
    commit(next, focus);
  };

  const toggleFocus = (line: number) => {
    const next = focus.includes(line)
      ? focus.filter((f) => f !== line)
      : [...focus, line].sort((a, b) => a - b);
    commit(callouts, next);
  };

  if (lineCount === 0) return null;
  return (
    <div
      className="mt-1 space-y-0.5"
      aria-label="Callouts and focus, one row per line"
    >
      {rows.map((row) => (
        <div key={row.line} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => toggleFocus(row.line)}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none",
              row.focused
                ? "border-amber-400 bg-amber-400/20 text-amber-300"
                : "border-foreground/25 text-muted-foreground hover:border-ring hover:text-foreground",
            )}
            title={
              row.focused
                ? "Line in the spotlight — click to release it"
                : "Spotlight this line; the rest steps back (for reveal: all)"
            }
            aria-pressed={row.focused}
            aria-label={`Spotlight line ${row.line}`}
          >
            {row.line}
          </button>
          <input
            value={row.text}
            onChange={(e) => setLabel(row.line, e.target.value)}
            placeholder={"Label…"}
            className="h-5 min-w-0 flex-1 rounded border bg-background px-1.5 text-[10px] outline-none focus:border-ring"
            aria-label={`Callout label for line ${row.line}`}
          />
        </div>
      ))}
    </div>
  );
}

export function VideoStudio({
  chapters,
  images,
  onAddImage,
  onAddImages,
}: VideoStudioProps) {
  // Undo/redo owns the timeline. `setScenes` keeps the same call shape as a
  // plain state setter, plus an optional mode telling the history whether this
  // write is a discrete action or another keystroke in a field already being
  // edited.
  const [history, setHistory] = useState<History<VideoScene[]>>(() => {
    const saved = loadScenes();
    return createHistory(
      saved && saved.length > 0
        ? saved
        : [DEFAULT_SCENE(), DEFAULT_SCENE(), DEFAULT_SCENE()],
    );
  });
  const scenes = history.present;
  const setScenes = useCallback(
    (
      update: VideoScene[] | ((prev: VideoScene[]) => VideoScene[]),
      mode: CommitMode = { kind: "commit" },
    ) => {
      setHistory((h) =>
        commit(h, typeof update === "function" ? update(h.present) : update, mode),
      );
    },
    [],
  );
  const undoScenes = useCallback(() => setHistory(undo), []);
  const redoScenes = useCallback(() => setHistory(redo), []);
  const canUndoScenes = canUndo(history);
  const canRedoScenes = canRedo(history);
  /**
   * The scene selected when the editor was last closed. The timeline is read
   * synchronously from storage (loadScenes), so the id can be hydrated right
   * here; a stale id from an older session matches nothing and is simply
   * ignored by everything that resolves it against `scenes`.
   */
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(SELECTED_SCENE_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      const persistable = scenes.some((s) => s.id === selectedId) ? selectedId : null;
      if (persistable === null) window.localStorage.removeItem(SELECTED_SCENE_KEY);
      else window.localStorage.setItem(SELECTED_SCENE_KEY, String(persistable));
    } catch {
      /* non-critical */
    }
  }, [scenes, selectedId]);
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [portrait, setPortrait] = useState(true);
  const [resolution, setResolution] = useState<string>("1080p");
  const resolutionRef = useRef(resolution);
  const [playing, setPlaying] = useState(false);
  // The shared export hub owns the busy state for every format, including the
  // two project files that finish instantly, so there is no `exporting` flag
  // here to keep in step with it.
  /** When on, an export covers only the selected scene's section. */
  const [sectionOnly, setSectionOnly] = useState(false);
  /**
   * What this browser can actually encode, probed once the canvas has a size.
   *
   * The probe cannot run during render: the server has no WebCodecs, and
   * consulting it there would make the first client render disagree with the
   * server HTML. Until it answers the UI stays optimistic rather than greying
   * out MP4 on every browser for a frame.
   */
  const [support, setSupport] = useState<{
    probed: boolean;
    webCodecs: boolean;
    can: Record<ExportTarget, boolean>;
  }>({
    probed: false,
    webCodecs: false,
    can: { mp4: false, webm: false, capcut: true, json: true },
  });

  const [status, setStatus] = useState<string>("");
  const [fileName, setFileName] = useState<string>("book-promo");
  const [playhead, setPlayhead] = useState(0); // seconds since playback start
  const [audioBusyId, setAudioBusyId] = useState<string | null>(null);
  // Inline JSON editor for the selected scene (replaces the demo generator).
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /** Scene being dragged along the timeline, dimmed while it is in the air. */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** Scene whose audio slot is being dragged over, for the dashed outline. */
  const [audioDropId, setAudioDropId] = useState<string | null>(null);
  /** Hidden file inputs, one per scene, so the picker opens the right one. */
  const audioInputRefs = useRef(new Map<string, HTMLInputElement>());
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [libraryOpen, setLibraryOpen] = useLibraryOpen();
  const [subtitleStyleId, setSubtitleStyleId] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_SUBTITLE_STYLE_ID;
    try {
      return window.localStorage.getItem("book-studio-subtitle-style") || DEFAULT_SUBTITLE_STYLE_ID;
    } catch {
      return DEFAULT_SUBTITLE_STYLE_ID;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("book-studio-subtitle-style", subtitleStyleId);
    } catch {
      /* non-critical */
    }
  }, [subtitleStyleId]);
  const subtitleStyle = useMemo(
    () => subtitleStyleById(subtitleStyleId),
    [subtitleStyleId],
  );
  /** Zoom of the timeline strip, in px per second. Persisted like the rest. */
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoom>(() => {
    if (typeof window === "undefined") return DEFAULT_TIMELINE_ZOOM;
    try {
      const raw = Number(window.localStorage.getItem("book-studio-timeline-zoom"));
      return isTimelineZoom(raw) ? raw : DEFAULT_TIMELINE_ZOOM;
    } catch {
      return DEFAULT_TIMELINE_ZOOM;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("book-studio-timeline-zoom", String(timelineZoom));
    } catch {
      /* non-critical */
    }
  }, [timelineZoom]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  /**
   * How wide the inspector is, and whether the divider is being dragged.
   *
   * `resizing` exists to keep the text selection and the pointer's own drag
   * behaviour out of the way while the pointer is down on the handle, which is
   * the difference between a divider that feels solid and one that selects the
   * whole studio.
   */
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    if (typeof window === "undefined") return INSPECTOR_WIDTH_DEFAULT;
    try {
      const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
      return Number.isFinite(stored) &&
        stored >= INSPECTOR_WIDTH_MIN &&
        stored <= INSPECTOR_WIDTH_MAX
        ? stored
        : INSPECTOR_WIDTH_DEFAULT;
    } catch {
      return INSPECTOR_WIDTH_DEFAULT;
    }
  });
  const [resizing, setResizing] = useState(false);
  const inspectorDrag = useRef<{ startX: number; startWidth: number } | null>(null);

  /**
   * Moves the divider, and only writes the width out on the last step of a drag.
   *
   * Persisting every pointermove would put a localStorage write in the middle of
   * the gesture that is supposed to be the smoothest part of the app.
   */
  const setInspector = useCallback((next: number, persist: boolean) => {
    const width = Math.min(
      INSPECTOR_WIDTH_MAX,
      Math.max(INSPECTOR_WIDTH_MIN, Math.round(next)),
    );
    setInspectorWidth(width);
    if (!persist) return;
    try {
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(width));
    } catch {
      /* non-critical: the width is a preference, not the project */
    }
  }, []);

  const onInspectorPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Keeps the browser from starting a text selection or an image drag
      // under the pointer while the divider moves.
      e.preventDefault();
      inspectorDrag.current = { startX: e.clientX, startWidth: inspectorWidth };
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizing(true);
    },
    [inspectorWidth],
  );

  const onInspectorPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = inspectorDrag.current;
      if (!drag) return;
      setInspector(drag.startWidth + (e.clientX - drag.startX), false);
    },
    [setInspector],
  );

  const onInspectorPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = inspectorDrag.current;
      if (!drag) return;
      inspectorDrag.current = null;
      setResizing(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setInspector(drag.startWidth + (e.clientX - drag.startX), true);
    },
    [setInspector],
  );

  /** Arrow keys move the divider too, so it is reachable without a pointer. */
  const onInspectorKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 64 : 16;
      if (e.key === "ArrowLeft") setInspector(inspectorWidth - step, true);
      else if (e.key === "ArrowRight") setInspector(inspectorWidth + step, true);
      else if (e.key === "Home") setInspector(INSPECTOR_WIDTH_MIN, true);
      else if (e.key === "End") setInspector(INSPECTOR_WIDTH_MAX, true);
      else return;
      e.preventDefault();
    },
    [inspectorWidth, setInspector],
  );

  const totalDuration = useMemo(
    () => scenes.reduce((acc, s) => acc + s.duration, 0),
    [scenes],
  );

  /** One shared time↔pixel mapping for the ruler, the cards and the needle. */
  const timeline = useMemo(() => timelineScale(scenes, timelineZoom), [scenes, timelineZoom]);
  const rulerTicksMemo = useMemo(
    () => rulerTicks(timeline),
    [timeline],
  );
  const cutMarks = useMemo(() => cutMarkers(timeline), [timeline]);
  /** Px from the left of the strip where the playhead sits. */
  const needleX = useMemo(() => xForTime(timeline, playhead), [timeline, playhead]);
  /** Drag state of the needle, so the pointer handlers can share one closure. */
  const draggingNeedle = useRef(false);

  /**
   * Narration is already written on every scene, so the cues only need the
   * scene order and durations. Recomputed whenever either changes.
   */
  const subtitleCues = useMemo(
    () =>
      buildTimelineCues(
        scenes.map((s) => ({
          narration: s.narration,
          duration: s.duration,
          regions: s.audio?.regions ?? null,
        })),
      ),
    [scenes],
  );
  const subtitleCuesRef = useRef(subtitleCues);
  useEffect(() => {
    subtitleCuesRef.current = subtitleCues;
  }, [subtitleCues]);

  // The keyboard handlers read `playhead` straight from state: their effect
  // re-subscribes on every change, so a closure always sees the current value
  // and there is no box to keep in sync.

  /** The cue visible at an absolute time, honouring the toggle. */
  const cueForTime = useCallback(
    (time: number): SubtitleCue | null =>
      subtitlesOn ? cueAt(subtitleCuesRef.current, time) : null,
    [subtitlesOn],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scenesRef = useRef(scenes);
  const brandRef = useRef(brand);
  const portraitRef = useRef(portrait);
  const rafRef = useRef<number | null>(null);
  const lastSpokenRef = useRef(-1);
  const imagesRef = useRef(images);
  const chaptersRef = useRef(chapters);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  /**
   * Decoded clips, keyed by IndexedDB key. Object URLs are built once and kept
   * for the session so scrubbing between scenes does not re-read storage.
   */
  const clipCacheRef = useRef<
    Map<string, { el: HTMLAudioElement; url: string }>
  >(new Map());
  /** The clip currently sounding, so a scene change or a seek can cut it. */
  const activeClipRef = useRef<HTMLAudioElement | null>(null);
  /** Clip keys already reported as missing, so the warning is not spammed. */
  const missingClipWarnedRef = useRef<Set<string>>(new Set());

  const selectedScene =
    scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null;

  const selectedSceneIndex =
    selectedScene ? scenes.findIndex((s) => s.id === selectedScene.id) : -1;


  useEffect(() => {
    scenesRef.current = scenes;
    saveScenes(scenes);
  }, [scenes]);
  useEffect(() => {
    brandRef.current = brand;
  }, [brand]);
  useEffect(() => {
    portraitRef.current = portrait;
  }, [portrait]);
  useEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);
  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);
  useEffect(() => {
    imagesRef.current = images;
    for (const src of Object.values(images)) {
      if (imageCacheRef.current.has(src)) continue;
      loadImage(src)
        .then((img) => {
          imageCacheRef.current.set(src, img);
        })
        .catch(() => {});
    }
  }, [images]);

  const applyToScene = useCallback(
    (
      id: string,
      patch: Partial<VideoScene>,
      mode: CommitMode = { kind: "commit" },
    ) => {
      setScenes(
        (prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        mode,
      );
    },
    [setScenes],
  );

  /** Field edits coalesce, so a run of keystrokes undoes as one step. */
  const editSceneField = useCallback(
    <K extends keyof VideoScene>(
      id: string,
      field: K,
      value: VideoScene[K],
    ) => {
      applyToScene(
        id,
        { [field]: value } as Partial<VideoScene>,
        { kind: "edit", key: `${id}:${field}` },
      );
    },
    [applyToScene],
  );

  /**
   * Edits one field of the selected scene's snippet, creating the snippet on
   * first keystroke.
   *
   * A separate writer rather than `editSceneField(scene.id, "code", {...})` so
   * each keystroke is one history entry keyed on the snippet's own field: undo
   * then steps back through `source` instead of jumping the whole snippet.
   */
  const editSceneCode = useCallback(
    (
      id: string,
      patch: Partial<SceneCode>,
      key?: string,
    ) => {
      const current = scenesRef.current.find((s) => s.id === id)?.code;
      const base: SceneCode = current ?? {
        language: "typescript",
        source: "",
        theme: DEFAULT_CODE_THEME,
        reveal: "all",
        scale: 1,
        callouts: {},
        focus: [],
      };
      applyToScene(
        id,
        { code: { ...base, ...patch } },
        { kind: "edit", key: key ?? `${id}:code` },
      );
    },
    [applyToScene],
  );

  /**
   * Edits the selected scene's terminal card, creating it on first keystroke.
   *
   * Its own history key, same reason as `editSceneCode`: undo walks back
   * through the terminal's text, not through the whole scene.
   */
  const editSceneTerminal = useCallback(
    (id: string, patch: Partial<SceneTerminal>) => {
      const current =
        scenesRef.current.find((s) => s.id === id)?.terminal ??
        { title: "", output: [] };
      const { terminal: next } = normalizeSceneTerminal({ ...current, ...patch });
      applyToScene(id, { terminal: next }, { kind: "edit", key: `${id}:terminal` });
    },
    [applyToScene],
  );

  /**
   * How long the selected scene's line should take, in whole scene units.
   *
   * Rounded to the slider's 0.5s step so the button does not offer a length the
   * slider cannot represent, and clamped to the same limits the editor enforces
   * everywhere else, so applying it can never produce a scene the schema would
   * have to repair on the next reload.
   */
  const narrationSeconds = useMemo(() => {
    const raw = estimateNarrationSeconds(selectedScene?.narration ?? "");
    if (raw <= 0) return 0;
    const stepped = Math.round(raw * 2) / 2;
    return Math.min(DURATION_MAX, Math.max(DURATION_MIN, stepped));
  }, [selectedScene?.narration]);

  /**
   * The previous scene's final code, usable as the "before" half of a diff.
   *
   * Chained scenes normally edit the same file, so scene N starts where scene
   * N-1 ended: its `source` (for diff scenes, the state AFTER the change) is
   * exactly the base this scene's diff should show. Null when there is no
   * previous scene or it has no code to reuse — the fill button disables then.
   */
  const previousSceneCodeSource = useMemo(() => {
    const i = selectedSceneIndex;
    if (i <= 0) return null;
    const source = scenes[i - 1]?.code?.source ?? "";
    return source.trim() === "" ? null : source;
  }, [scenes, selectedSceneIndex]);

  /**
   * Batch edit mode: a checkbox on every scene card and one bar that applies
   * a look to all of them at once. Selection lives outside the single-selected
   * scene on purpose — picking scenes to restyle should not drag the playhead
   * or swap the inspector out from under the author.
   */
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelection, setBatchSelection] = useState<Set<string>>(new Set());
  const toggleBatchMode = useCallback(() => {
    setBatchMode((on) => {
      if (on) setBatchSelection(new Set());
      return !on;
    });
  }, []);
  const toggleBatchScene = useCallback((id: string) => {
    setBatchSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Empty string means "leave this property alone", which is what makes the
  // bar a la carte: a pass that only recolours does not touch timings.
  const [batchTheme, setBatchTheme] = useState("");
  const [batchTransition, setBatchTransition] = useState("");
  const [batchDuration, setBatchDuration] = useState("");
  const applyBatchEdit = useCallback(() => {
    if (batchSelection.size === 0) return;
    setScenes(
      (prev) =>
        prev.map((s) => {
          if (!batchSelection.has(s.id)) return s;
          const patch: Partial<VideoScene> = {};
          if (batchTheme && s.code) patch.code = { ...s.code, theme: batchTheme };
          if (batchTransition) patch.transition = batchTransition as Transition;
          const duration = Number(batchDuration);
          if (batchDuration !== "" && Number.isFinite(duration) && duration > 0)
            patch.duration = Math.min(20, Math.max(1, duration));
          return Object.keys(patch).length > 0 ? { ...s, ...patch } : s;
        }),
      { kind: "commit" },
    );
    setStatus(`Applied to ${batchSelection.size} scene${batchSelection.size === 1 ? "" : "s"}`);
  }, [batchSelection, batchTheme, batchTransition, batchDuration, setScenes, setStatus]);

  const fitDurationToNarration = useCallback(() => {
    if (!selectedScene || narrationSeconds <= 0) return;
    const was = selectedScene.duration;
    // A committed edit, not a coalesced one: this is a deliberate jump, and
    // merging it into the field the author was typing in would make one undo
    // take both.
    applyToScene(selectedScene.id, { duration: narrationSeconds });
    setStatus(
      was === narrationSeconds
        ? `Scene is already ${narrationSeconds}s.`
        : `Scene set to ${narrationSeconds}s, estimated from the line. Check it against the voice-over.`,
    );
  }, [selectedScene, narrationSeconds, applyToScene, setStatus]);

  const openSceneJson = useCallback(() => {
    if (!selectedScene) {
      // An empty timeline still needs a way in. Without this the Scene JSON
      // button is dead on a new project, which leaves no way to paste a grouped
      // { scene, subscenes } file as the *first* section — the one case where
      // there is nothing to select yet. Seeded with a working example rather
      // than a blank object, so the first thing an author sees is the shape.
      const seed = sceneJsonTemplate(DEFAULT_SCENE_JSON_TEMPLATE_ID);
      setJsonDraft(seed?.json ?? "{\n  \"title\": \"New scene\"\n}");
      setJsonError(null);
      setJsonOpen(true);
      return;
    }
    // Strip runtime-only fields: the editable contract is the file format.
    const { id: _id, chapterId: _chapterId, ...rest } = selectedScene;
    void _id;
    void _chapterId;
    setJsonDraft(JSON.stringify(rest, null, 2));
    setJsonError(null);
    setJsonOpen(true);
  }, [selectedScene]);

  /**
   * Applies the Scene JSON draft.
   *
   * Four shapes reach this function, and telling them apart is the whole job:
   *
   * - A whole episode document (`{ episode, scenes: [...] }`). Handed straight to
   *   the importer and appended. It used to be wrapped as a single scene, which
   *   turned a 38-scene episode into one blank frame: the `scenes` key was
   *   discarded as an unknown field, the status line said it worked, and the
   *   content was simply gone.
   * - A grouped object (`{ scene, subscenes: [...] }`) is a *section*, so it is
   *   inserted as a run rather than squeezed into one scene. Taking only the
   *   first scene out of it would silently drop every other subscene.
   * - A flat scene object replaces the selected scene.
   * - With nothing selected, either shape appends, since an empty timeline has
   *   no scene to replace.
   */
  const applySceneJson = useCallback(() => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonDraft) as Record<string, unknown>;
    } catch {
      setJsonError("Invalid JSON — fix the syntax and apply again.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setJsonError("Expected a scene object or a document with a \"scenes\" array.");
      return;
    }

    // A `scenes` array means this is a document, not one scene. Anything else is
    // a single scene, which is the only shape that replaces what is selected.
    const isDocument = Array.isArray((parsed as { scenes?: unknown }).scenes);
    const isGrouped =
      Array.isArray((parsed as { subscenes?: unknown }).subscenes) &&
      ((parsed as { subscenes: unknown[] }).subscenes).length > 0;

    // Repair through the same pipeline used by file imports. `episode` and any
    // other unknown top-level key are not part of the scene model, so they are
    // ignored rather than reported: the importer is the contract.
    const { document, warnings } = normalizeSceneInput(parsed, {
      imageKeys: Object.keys(imagesRef.current),
      chapterIds: chaptersRef.current.map((c) => c.id),
    });
    const built = document?.scenes ?? [];
    if (built.length === 0) {
      setJsonError(
        warnings[0] ?? "That is not a scene object, so it could not be applied.",
      );
      return;
    }

    // A whole episode always appends: its scenes belong to a timeline of their
    // own, and splicing them around one selected scene would interleave two
    // unrelated stories.
    if (isDocument) {
      const sections = groupLabels(built);
      const run = built.map((s) => ({ ...s, id: uid("scene-") }));
      setScenes((prev) => [...prev, ...run]);
      requestAnimationFrame(() => setSelectedId(run[0]!.id));
      setJsonError(null);
      setJsonOpen(false);
      setStatus(
        `Added ${run.length} scenes${sections.length ? ` in ${sections.length} sections` : ""} to the timeline.`,
      );
      return;
    }

    if (!selectedScene) {
      const run = isGrouped ? built : built.slice(0, 1);
      const label = run[0]!.group;
      setScenes((prev) => [...prev, ...run]);
      const firstId = run[0]!.id;
      requestAnimationFrame(() => setSelectedId(firstId));
      setJsonError(null);
      setJsonOpen(false);
      setStatus(
        label
          ? `Added section "${label}" with ${run.length} scenes to the empty timeline.`
          : `Added ${run.length === 1 ? "a scene" : `${run.length} scenes`} to the empty timeline.`,
      );
      return;
    }

    if (isGrouped && built.length > 1) {
      const label = built[0]!.group ?? "Section";
      const at = scenes.findIndex((s) => s.id === selectedScene.id);
      setScenes((prev) => {
        const index = prev.findIndex((s) => s.id === selectedScene.id);
        if (index === -1) return prev;
        // Fresh id for the head of the run: reusing the selected scene's id
        // would make two React keys and two scenes answer to the same name.
        const run = built.map((s, i) => ({
          ...s,
          id: i === 0 ? uid("scene-") : s.id,
        }));
        const next = [...prev];
        next.splice(index + 1, 0, ...run);
        return next;
      });
      setJsonError(null);
      setJsonOpen(false);
      setStatus(
        `Inserted section "${label}" with ${built.length} scenes after scene ${at + 1}.`,
      );
      return;
    }

    const scene = built[0]!;
    // The id and the chapter link always stay the selected scene's own.
    applyToScene(selectedScene.id, {
      ...scene,
      id: selectedScene.id,
      chapterId: selectedScene.chapterId,
    });
    setJsonError(null);
    setJsonOpen(false);
    setStatus(`Scene JSON applied to scene ${scenes.findIndex((s) => s.id === selectedScene.id) + 1}.`);
  }, [jsonDraft, selectedScene, applyToScene, scenes, setScenes, setStatus]);

  /** One storage write for a whole batch, or a loop when the parent is older. */
  const addImages = useCallback(
    (images: { key: string; dataUrl: string }[]) => {
      if (images.length === 0) return;
      if (onAddImages) {
        onAddImages(images);
        return;
      }
      for (const image of images) onAddImage?.(image);
    },
    [onAddImage, onAddImages],
  );

  /**
   * Replaces the dropped-onto card with one scene per extracted frame. The
   * first new scene inherits the card's id and its copy, so the playhead, the
   * selection and anything the author already wrote there all stay put; the
   * rest are inserted after it as blank scenes holding just their frame.
   */
  const insertScenesFromFrames = useCallback(
    (targetId: string, keys: readonly string[], secondsEach: number) => {
      setScenes((prev) => {
        const idx = prev.findIndex((s) => s.id === targetId);
        if (idx === -1 || keys.length === 0) return prev;
        const base = prev[idx];
        const built: VideoScene[] = keys.map((key, i) => ({
          ...DEFAULT_SCENE(),
          id: i === 0 ? base.id : uid("scene-"),
          kicker: i === 0 ? base.kicker : "",
          title: i === 0 ? base.title : "",
          subtitle: i === 0 ? base.subtitle : "",
          narration: i === 0 ? base.narration : "",
          imageKey: key,
          duration: secondsEach,
        }));
        const next = [...prev];
        next.splice(idx, 1, ...built);
        return next;
      });
    },
    [setScenes],
  );

  /**
   * Turns a dropped video into scenes: one still per couple of seconds, sized
   * to the current render target so the frames land pixel-for-pixel on the
   * canvas. Nothing is uploaded — the frames go straight into the shared pool.
   */
  const splitVideoIntoScenes = useCallback(
    async (targetId: string, file: File) => {
      if (!onAddImage) {
        setStatus("This editor cannot store new images.");
        return;
      }

      const res =
        RESOLUTIONS.find((r) => r.id === resolutionRef.current) ??
        RESOLUTIONS[1];
      const target = portraitRef.current
        ? { width: res.height, height: res.width }
        : { width: res.width, height: res.height };

      setStatus(`Reading "${file.name}"…`);

      let result: Awaited<ReturnType<typeof extractVideoFrames>>;
      try {
        // One decode pass: the clip's own runtime decides how many scenes it
        // becomes, and the frames are sized to the current render target so
        // they land pixel-for-pixel on the canvas.
        result = await extractVideoFrames(file, {
          ...target,
          onProgress: (done, total) =>
            setStatus(`Extracting frames ${done}/${total}…`),
        });
      } catch (err) {
        setStatus(
          err instanceof Error ? err.message : "Could not read that video.",
        );
        return;
      }

      const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "clip";
      const keys = result.dataUrls.map((_, i) => frameKey(base, i));
      addImages(keys.map((key, i) => ({ key, dataUrl: result.dataUrls[i] })));
      insertScenesFromFrames(targetId, keys, result.secondsEach);
      setSelectedId(targetId);

      const kb = Math.round(
        result.dataUrls.reduce((sum, d) => sum + d.length, 0) / 1024,
      );
      setStatus(
        `${base}: ${result.dataUrls.length} scenes from ${result.durationSeconds.toFixed(1)}s ` +
          `(${target.width}×${target.height}, ${kb} KB of frames). ` +
          `Drop a JSON file on any card to reshape them.`,
      );
    },
    [onAddImage, addImages, insertScenesFromFrames, setStatus],
  );

  /**
   * Cuts whatever clip is sounding. Called on every scene change, seek and
   * stop so a voice-over never keeps talking over the next scene.
   */
  const stopClip = useCallback(() => {
    if (activeClipRef.current) {
      activeClipRef.current.pause();
      activeClipRef.current.currentTime = 0;
      activeClipRef.current = null;
    }
  }, []);

  /**
   * Returns a playable element for a clip, reading the blob from IndexedDB on
   * first use. Cached for the session so repeated seeks do not hit storage.
   */
  const getClip = useCallback(
    async (key: string): Promise<HTMLAudioElement | null> => {
      const cached = clipCacheRef.current.get(key);
      if (cached) return cached.el;
      const blob = await getAudioClip(key);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      el.preload = "auto";
      clipCacheRef.current.set(key, { el, url });
      return el;
    },
    [],
  );

  /**
   * Attaches a dropped file to a scene.
   *
   * The scene stretches to fit a longer clip (see `targetSceneDuration`) so the
   * tail is never cut, and the blob goes to IndexedDB under a fresh key every
   * time so replacing a clip cannot leave the old audio wired up.
   */
  const attachAudio = useCallback(
    async (sceneId: string, file: File) => {
      if (!isAudioStoreAvailable()) {
        setStatus(
          "This browser will not store audio files, so the clip would vanish on reload.",
        );
        return;
      }
      if (file.size > MAX_AUDIO_BYTES) {
        setStatus(
          `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(0)} MB; the limit is ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`,
        );
        return;
      }

      setAudioBusyId(sceneId);
      setStatus(`Reading "${file.name}"…`);
      let duration = 0;
      let regions: SpeechRegion[] = [];
      let peaks: number[] = [];
      let alignedByTranscript = false;
      try {
        duration = (await measureAudioDuration(file)).duration;
        // One more pass over the file: the pauses for the subtitles, and the
        // shape for the waveform. Both come out of the same decode, so the
        // second read buys both rather than one at a time.
        ({ regions, peaks } = await analyzeClip(file));
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : `Could not read "${file.name}".`,
        );
        return;
      }

      // Best path: ElevenLabs' forced aligner measures where each word is said.
      // Only worth a network call when the scene has a script to align against.
      const script = scenesRef.current.find((s) => s.id === sceneId)?.narration.trim() ?? "";
      if (script.length > 0) {
        setStatus(`Aligning "${file.name}" to its script…`);
        try {
          const body = new FormData();
          body.append("file", file);
          body.append("text", script);
          const res = await fetch("/api/align", { method: "POST", body });
          if (res.ok) {
            const data = (await res.json()) as {
              words?: { text: string; start: number; end: number }[];
            };
            const derived = regionsFromWords(data.words ?? []);
            if (derived.length > 0) {
              regions = derived;
              alignedByTranscript = true;
            }
          }
          // A failed align call silently keeps the energy regions: the
          // highlight degrades to estimated timings, never to nothing.
        } catch {
          /* keep the energy regions */
        }
      }
      setAudioBusyId(null);

      const key = uid("clip-");
      if (!(await putAudioClip(key, file))) {
        setStatus("This browser refused to store the audio file.");
        return;
      }

      const previous = scenesRef.current.find((s) => s.id === sceneId)?.audio;
      if (previous && previous.key !== key) {
        // Revoke the object URL as well as forgetting the entry. The blob stays
        // in IndexedDB, so the clip can be re-read on demand, but the URL keeps
        // the decoded file alive for as long as the page does.
        const stale = clipCacheRef.current.get(previous.key);
        clipCacheRef.current.delete(previous.key);
        missingClipWarnedRef.current.delete(previous.key);
        if (stale) {
          stale.el.pause();
          stale.el.src = "";
          URL.revokeObjectURL(stale.url);
        }
      }

      applyToScene(sceneId, {
        audio: {
          key,
          name: file.name,
          duration: Math.round(duration * 100) / 100,
          bytes: file.size,
          type: file.type || "audio/mpeg",
          regions,
          peaks,
        },
        duration: targetSceneDuration(
          scenesRef.current.find((s) => s.id === sceneId)?.duration ?? 4,
          duration,
        ),
      });

      pruneAudioClips(
        scenesRef.current
          .filter((s) => s.id !== sceneId)
          .map((s) => s.audio?.key)
          .filter((k): k is string => typeof k === "string")
          .concat(key),
      );

      // A clip longer than the longest scene the editor allows is kept whole in
      // storage but only its opening plays, because the scene is clamped to
      // DURATION_MAX. Say so with the number, rather than letting the author
      // discover the missing words in the finished video.
      const clipped = duration > DURATION_MAX;
      setStatus(
        `Audio "${file.name}" (${formatAudioDuration(duration)}) attached to scene ${scenesRef.current.findIndex((s) => s.id === sceneId) + 1} · subtitles ${alignedByTranscript ? "aligned to the recorded voice" : `${regions.length} pause${regions.length === 1 ? "" : "s"} estimated from the clip`}.${
          clipped
            ? ` Only the first ${DURATION_MAX}s will play — use Split to spread the rest across more scenes.`
            : ""
        }`,
      );
    },
    [applyToScene, setStatus],
  );

  /**
   * Sends a library asset to whichever flow matches what it is.
   *
   * A picture becomes the scene image, a clip becomes the scene audio, and a
   * video is split into scenes, which is the one path that already knows how to
   * turn a file into a timeline. The library itself stays out of it: it hands
   * back a plain File, exactly like a drop from the desktop would.
   */
  const useLibraryAsset = useCallback(
      (file: File, asset: Asset) => {
        const targetId = selectedId;
        if (!targetId) {
          // The trigger now lives in the shared header, so it is reachable with
          // nothing selected. Saying nothing here would look like the pick
          // failed.
          setStatus("Select a scene first, then pick from the library.");
          return;
        }

      if (asset.kind === "audio") {
        void attachAudio(targetId, file);
        return;
      }
      if (asset.kind === "video") {
        void splitVideoIntoScenes(targetId, file);
        return;
      }
      if (!onAddImage) {
        setStatus("This editor cannot store new images.");
        return;
      }
      const key = asset.name.toLowerCase();
      void fileToDataURL(file)
        .then((dataUrl) => {
          if (!dataUrl) {
            setStatus(`Could not read "${asset.name}".`);
            return;
          }
          onAddImage({ key, dataUrl });
          applyToScene(targetId, { imageKey: key });
          setStatus(`Scene image set to "${asset.name}" from the library.`);
        })
        .catch(() => setStatus(`Could not read "${asset.name}".`));
    },
    [
      applyToScene,
      attachAudio,
      onAddImage,
      selectedId,
      setStatus,
      splitVideoIntoScenes,
    ],
  );

  /** Detaches a scene's clip and drops the stored blob. */
  const detachAudio = useCallback(
    (sceneId: string) => {
      const scene = scenesRef.current.find((s) => s.id === sceneId);
      if (!scene?.audio) return;
      stopClip();
      clipCacheRef.current.delete(scene.audio.key);
      applyToScene(sceneId, { audio: null });
      void deleteAudioClip(scene.audio.key);
      setStatus(`Removed audio "${scene.audio.name}".`);
    },
    [applyToScene, setStatus, stopClip],
  );

  /**
   * Starts a scene's voice-over. Falls back to the browser's own speech
   * synthesis for a scene that has narration but no clip, so a draft still
   * makes noise before any file is recorded.
   */
  /**
   * Preview speed. Ref on purpose: the render frame computes the clock with it
   * every frame, and pausing must not be required to change speed.
   */
  const rateRef = useRef(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const setRate = useCallback((next: number) => {
    const clamped = Math.min(2, Math.max(0.5, next));
    rateRef.current = clamped;
    setPlaybackRate(clamped);
  }, []);
  /** Current shuttle gear (1 = parked). Lives with the rate it drives. */
  const shuttleRef = useRef(1);

  const playSceneAudio = useCallback(
    (idx: number) => {
      const scene = scenesRef.current[idx];
      if (!scene) return;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      stopClip();
      if (!scene.audio) {
        if (scene.narration && "speechSynthesis" in window) {
          const u = new SpeechSynthesisUtterance(scene.narration);
          // The voice-over rides the preview clock, so at 0.5x it plays
          // half-speed and at 2x it is rushed — anything else desyncs it
          // from the pictures it is narrating.
          u.rate = 1.02 * rateRef.current;
          window.speechSynthesis.speak(u);
        }
        return;
      }
      const audio = scene.audio;
      if (scene.muted) {
        setStatus("Scene muted — its clip stays attached but will not play.");
        return;
      }
      void getClip(audio.key).then((el) => {
        // The scene may have changed while the blob was being read.
        if (scenesRef.current[idx]?.audio?.key !== audio.key) return;
        if (!el) {
          // The descriptor survived a reload but the blob did not, which is
          // what clearing site data looks like. Say so instead of going quiet.
          if (!missingClipWarnedRef.current.has(audio.key)) {
            missingClipWarnedRef.current.add(audio.key);
            setStatus(
              `Audio "${audio.name}" is no longer in this browser's storage. Drop the file again.`,
            );
          }
          return;
        }
        el.currentTime = 0;
        // Same clock as the visuals: a clip left at 1x would run long past
        // its scene at 2x preview speed and stop early at 0.5x.
        el.playbackRate = rateRef.current;
        // The clip element is shared between scenes, so the volume is set on
        // every play rather than once at creation: a quieter scene must not
        // leave the louder setting behind for the next one.
        el.volume = Math.min(1, Math.max(0, scene.volume));
        el.play().catch(() => {});
        activeClipRef.current = el;
      });
    },
    [getClip, rateRef, setStatus, stopClip],
  );

  /** Releases every object URL; called when the editor unmounts. */
  useEffect(
    () => () => {
      for (const { url } of clipCacheRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      clipCacheRef.current.clear();
    },
    [],
  );

  /**
   * Drops clips no scene points at, so replacing or deleting audio does not
   * leave megabytes behind in IndexedDB forever.
   */
  useEffect(() => {
    const live = scenes
      .map((s) => s.audio?.key)
      .filter((k): k is string => typeof k === "string");
    pruneAudioClips(live);
  }, [scenes]);

  const dropSceneFile = useCallback(
    (targetId: string, file: File) => {
      const isImage =
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name);

      const isVideo =
        file.type.startsWith("video/") ||
        /\.(mp4|m4v|mov|webm|ogv|ogg|mkv)$/i.test(file.name);

      if (isAudioFile(file)) {
        void attachAudio(targetId, file);
        return;
      }

      if (isImage) {
        if (!onAddImage) {
          setStatus("This editor cannot store new images.");
          return;
        }
        const key = file.name.toLowerCase();
        const aliasKey = file.webkitRelativePath
          ? file.webkitRelativePath.replace(/\\/g, "/")
          : undefined;
        fileToDataURL(file)
          .then((dataUrl) => {
            if (!dataUrl) {
              setStatus(`Could not read "${file.name}".`);
              return;
            }
            onAddImage({ key, dataUrl, aliasKey });
            applyToScene(targetId, { imageKey: key });
            setStatus(`Scene image set to "${file.name}".`);
          })
          .catch(() => setStatus(`Could not read "${file.name}".`));
        return;
      }

      if (isVideo) {
        void splitVideoIntoScenes(targetId, file);
        return;
      }

      if (!isJsonFile(file)) {
        setStatus(
          `"${file.name}" is not something a scene can hold. Drop an image, a video, an audio file or a scene JSON.`,
        );
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(reader.result ?? ""));
        } catch {
          setStatus(`"${file.name}" is not valid JSON.`);
          return;
        }

        const { scene, totalScenes, warnings } = normalizeFirstScene(parsed, {
          imageKeys: Object.keys(imagesRef.current),
          chapterIds: chaptersRef.current.map((c) => c.id),
        });

        if (!scene) {
          setStatus(
            warnings.length > 0
              ? `Nothing applied. ${warnings[0]}`
              : `Nothing applied from "${file.name}".`,
          );
          return;
        }

        // Keep the target's id so position, selection and playhead stay put.
        applyToScene(targetId, { ...scene, id: targetId });
        setSelectedId(targetId);
        setStatus(
          warnings.length > 0
            ? `Scene updated from ${file.name} (first of ${totalScenes}) · ${warnings.slice(0, 2).join("; ")}`
            : `Scene updated from ${file.name}.`,
        );
      };
      reader.readAsText(file);
    },
    [
      applyToScene,
      attachAudio,
      onAddImage,
      setStatus,
      splitVideoIntoScenes,
    ],
  );

  const playStartRef = useRef(0);
  const frameFnRef = useRef<() => void>(() => {});
  const pausedAtRef = useRef<number | null>(null);
  const previewOnlyRef = useRef(false);
  const lastEmitMsRef = useRef(-1);

  /**
   * Puts the playhead on `seconds` of the timeline.
   *
   * The preview runs on one clock: `renderFrame` reads the elapsed time as
   * `(now - playStart) / 1000 * rate`, so the rate divides out when going the
   * other way. Every seek, pause and resume goes through here, because the
   * arithmetic was being open-coded in five places and four of them forgot the
   * rate - which is why scrubbing at 2x used to land the playhead at twice the
   * place the author clicked.
   *
   * `pause` is separate because it has to *read* the position rather than set
   * it, and reading it without the rate is the same mistake in the other
   * direction.
   */
  const seekClockTo = useCallback((seconds: number) => {
    const rate = rateRef.current || 1;
    playStartRef.current = performance.now() - (seconds / rate) * 1000;
    pausedAtRef.current = seconds;
    lastEmitMsRef.current = -1;
  }, []);

  /** Elapsed seconds on the shared clock, honouring the preview rate. */
  const readClock = useCallback(() => {
    const rate = rateRef.current || 1;
    return ((performance.now() - playStartRef.current) / 1000) * rate;
  }, []);
  /** Mirrors the playhead state for the rAF-driven step/shuttle helpers. */
  const playheadRef = useRef(0);
  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);
  /** Mirrors `playing` for the same helpers, without re-creating them. */
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  /** Ref on purpose: the render frame reads it without re-subscribing. */
  const loopRef = useRef(false);
  const [loop, setLoop] = useState(false);
  /** Horizontal strip the playhead rides; followed only while previewing. */
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  /** True while the strip should chase the needle, off the moment the author scrolls. */
  const [followPlayhead, setFollowPlayhead] = useState(true);
  /**
   * Marks a recenter performed by us rather than by the author, so the scroll
   * event it produces (and browsers fire one for programmatic scrolls too)
   * does not read as the author grabbing the strip.
   */
  const recenteredRef = useRef(false);

  /**
   * Keeps the playhead in view while the preview runs. The strip can scroll
   * far past the visible box on a long timeline, and a needle that walks off
   * the right edge is worse than useless — it stops being a needle. The strip
   * is followed only on the rAF clock (playing), so scrubbing the ruler or
   * stepping frames never yanks the scroll, and a manual scroll wins over the
   * follow until the next play starts.
   */
  useEffect(() => {
    if (!playing || !followPlayhead) return;
    const strip = timelineScrollRef.current;
    if (!strip) return;
    const box = strip.clientWidth;
    if (needleX < strip.scrollLeft || needleX > strip.scrollLeft + box) {
      recenteredRef.current = true;
      strip.scrollLeft = Math.max(
        0,
        Math.round(needleX - box / 2),
      );
      // The scroll event for a programmatic move fires synchronously, so the
      // flag can be dropped on the next frame without losing a real user drag.
      requestAnimationFrame(() => {
        recenteredRef.current = false;
      });
    }
  }, [playing, followPlayhead, needleX, timelineZoom]);
  const toggleLoop = useCallback(() => {
    setLoop((prev) => {
      loopRef.current = !prev;
      return !prev;
    });
  }, []);

  /**
   * The window the loop plays in, as absolute seconds.
   *
   * The whole video by default, but a section is the unit people actually
   * re-watch: "did that transition land?". So when the selected scene belongs
   * to a named run, the loop closes around that run — the playhead rewinds to
   * the first frame of the section and stops at its last, instead of running
   * the other seven sections to get back to it. An ungrouped selection has no
   * section to close around, so it loops the whole timeline.
   */
  const loopWindow = useMemo<{ start: number; end: number }>(() => {
    const whole = { start: 0, end: totalDuration };
    if (!loop || !selectedId) return whole;
    const run = runOfScene(scenes, selectedId);
    if (!run || run.group === null) return whole;
    const start = scenes
      .slice(0, run.start)
      .reduce((acc, s) => acc + s.duration, 0);
    return { start, end: start + run.duration };
  }, [loop, selectedId, scenes, totalDuration]);
  /** Mirrored for the rAF loop, which must not re-subscribe per frame. */
  const loopWindowRef = useRef(loopWindow);
  useEffect(() => {
    loopWindowRef.current = loopWindow;
  }, [loopWindow]);

  /**
   * Which section the loop is closed around, for the transport label.
   *
   * A loop that silently changes scope is worse than no section loop: the
   * author presses it expecting the selected section and instead watches the
   * whole video on repeat. So the button names the scope it will actually use.
   */
  const loopSection = useMemo(() => {
    if (!selectedId) return null;
    const run = runOfScene(scenes, selectedId);
    return run && run.group !== null ? run : null;
  }, [selectedId, scenes]);

  const addScene = useCallback(() => {
    let created: VideoScene | null = null;
    setScenes((prev) => {
      const next = [...prev, DEFAULT_SCENE()];
      created = next[next.length - 1] ?? null;
      return next;
    });
    // The scene id is assigned synchronously by createScene above.
    requestAnimationFrame(() => setSelectedId(created?.id ?? null));
  }, [setScenes]);

  const removeScene = useCallback(
    (id: string) => {
      setScenes((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        const next = prev.filter((s) => s.id !== id);
        if (id === selectedId) {
          const nextId = next[Math.min(idx, next.length - 1)]?.id ?? null;
          setSelectedId(nextId);
        }
        return next;
      });
    },
    [selectedId, setScenes],
  );

  const duplicateScene = useCallback(
    (id: string) => {
      let copyId: string | null = null;
      setScenes((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx === -1) return prev;
        const copy: VideoScene = {
          ...prev[idx],
          id: uid("scene-"),
          title: `${prev[idx].title} (copy)`,
        };
        copyId = copy.id;
        const next = [...prev];
        next.splice(idx + 1, 0, copy);
        return next;
      });
      requestAnimationFrame(() => setSelectedId(copyId));
    },
    [setScenes],
  );

  /**
   * Cuts the scene under the playhead in two.
   *
   * The tail starts silent, because the clip belongs to the head and a stored
   * clip cannot be sliced by a key reference. Saying so beats leaving the author
   * to discover a scene that mysteriously has no voice-over.
   */
  const splitSelectedScene = useCallback(() => {
    const id = selectedId;
    if (!id) return;
    const list = scenesRef.current;
    const index = list.findIndex((s) => s.id === id);
    if (index === -1) return;
    const start = list
      .slice(0, index)
      .reduce((acc, s) => acc + s.duration, 0);
    const at = playhead - start;
    const refused = at < 0.5 || at > list[index]!.duration - 0.5;
    if (refused) {
      setStatus(
        "Put the playhead inside the scene, clear of both edges, to split it.",
      );
      return;
    }
    let tailId: string | null = null;
    setScenes((prev) => [
      ...splitScene(prev, id, at, 0.5, () => {
        tailId = uid("scene-");
        return tailId;
      }),
    ]);
    // Land on the new half, since the next thing to do is give it a line.
    requestAnimationFrame(() => {
      if (tailId) setSelectedId(tailId);
    });
    setStatus(
      "Scene split. The second half is silent — attach its own voice-over.",
    );
  }, [selectedId, playhead, setScenes, setStatus]);

  /**
   * Moves the dragged scene's whole section so it starts at `to`.
   *
   * A card in a section drags the section, for the same reason the up/down
   * arrows do: a group is a run of adjacent scenes, and moving one of them by
   * itself would cut the section in half.
   */
  const reorderTo = useCallback(
    (id: string, to: number) => {
      setScenes((prev) => {
        const next = moveRunTo(prev, id, to);
        return next === prev ? prev : [...next];
      });
    },
    [setScenes],
  );

  const moveScene = useCallback((id: string, dir: -1 | 1) => {
    setScenes((prev) => {
      const next = moveSceneStep(prev, id, dir);
      if (next === prev) {
        // Refused rather than broken: a section will not be split, so the
        // button does nothing unless it says which rule stopped it.
        const run = runOfScene(prev, id);
        setStatus(
          run?.group
            ? `"${run.group}" is a section and moves as one block — it cannot go one step ${dir < 0 ? "up" : "down"}.`
            : "That scene cannot go one step that way without splitting a section.",
        );
        return prev;
      }
      return [...next];
    });
  }, [setScenes]);


  /**
   * Draws one scene, at one instant, into any 2D context of the same size.
   *
   * Split out of `paintTimelineAt` because a crossfade has to render the same
   * instant twice into two different buffers before either is visible.
   */
  const paintOne = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      scene: VideoScene,
      local: number,
      time: number,
    ) => {
      const cache = imageCacheRef.current;
      let image: HTMLImageElement | null = null;
      if (scene.imageKey) {
        const src = imagesRef.current[scene.imageKey];
        image = src ? (cache.get(src) ?? null) : null;
      }
      const frameCue = cueForTime(time);
      paintScene(
        ctx,
        w,
        h,
        scene,
        local,
        brand,
        image,
        frameCue,
        subtitleStyle,
        // The absolute clock, so word entrances and the keyword beat land where
        // the voice is. The preview and the export share this one painter, which
        // is the only way the exported file can match what was on screen.
        time,
      );

    },
    [brand, cueForTime, subtitleStyle],
  );

  /**
   * Two scratch buffers for the outgoing and incoming halves of a dissolve.
   *
   * Allocated once per canvas size and kept: a crossfade covers a fraction of
   * each scene, so allocating two full-size canvases per frame would mean
   * thousands of megabytes of garbage across an export, and the browser would
   * start dropping frames long before the encoder became the bottleneck.
   */
  const blendRef = useRef<{
    width: number;
    height: number;
    from: HTMLCanvasElement;
    to: HTMLCanvasElement;
  } | null>(null);

  const blendBuffers = useCallback(
    (width: number, height: number) => {
      const existing = blendRef.current;
      if (existing && existing.width === width && existing.height === height) {
        return existing;
      }
      const make = () => {
        const el = document.createElement("canvas");
        el.width = width;
        el.height = height;
        return el;
      };
      const next = { width, height, from: make(), to: make() };
      blendRef.current = next;
      return next;
    },
    [],
  );

  const paintTimelineAt = useCallback(
    (time: number, list: readonly VideoScene[] = scenesRef.current) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const scenes = list;
      if (scenes.length === 0) {
        ctx.fillStyle = "#0b1620";
        ctx.fillRect(0, 0, w, h);
        return;
      }

      const blend = crossfadeAt(scenes, time);
      if (!blend) {
        const { index, local } = locateScene(scenes, time);
        paintOne(ctx, w, h, scenes[index]!, local, time);
        return;
      }

      // The window straddles the cut, so each half is sampled outside its own
      // scene and clamped to that scene's first or last frame. Both are drawn
      // opaquely into scratch buffers first: `paintScene` sets its own alpha
      // while drawing an image, which would otherwise wipe out the blend factor
      // before the incoming frame had been composited.
      const from = scenes[blend.fromIndex]!;
      const to = scenes[blend.toIndex]!;
      const buffers = blendBuffers(w, h);
      const fromCtx = buffers.from.getContext("2d");
      const toCtx = buffers.to.getContext("2d");
      if (!fromCtx || !toCtx) {
        const { index, local } = locateScene(scenes, time);
        paintOne(ctx, w, h, scenes[index]!, local, time);
        return;
      }

      const fromTime = timeForScene(scenes, blend.fromIndex, time);
      const toTime = timeForScene(scenes, blend.toIndex, time);
      paintOne(
        fromCtx,
        w,
        h,
        from,
        localFor(scenes, blend.fromIndex, fromTime),
        fromTime,
      );
      paintOne(toCtx, w, h, to, localFor(scenes, blend.toIndex, toTime), toTime);

      ctx.globalAlpha = 1;
      ctx.drawImage(buffers.from, 0, 0);
      ctx.globalAlpha = blend.mix;
      ctx.drawImage(buffers.to, 0, 0);
      ctx.globalAlpha = 1;
    },
    [blendBuffers, paintOne],
  );

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const scenes = scenesRef.current;
    if (scenes.length === 0) {
      ctx.fillStyle = "#0b1620";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const total = scenes.reduce((acc, s) => acc + s.duration, 0);
    const elapsed = readClock();
    const emitMs = Math.floor(elapsed * 1000);
    if (emitMs !== lastEmitMsRef.current) {
      lastEmitMsRef.current = emitMs;
      setPlayhead(Math.min(elapsed, total));
    }
    const { index: sceneIdx } = locateScene(scenes, elapsed);

    // Speak narration at scene boundaries.
    if (sceneIdx !== lastSpokenRef.current) {
      lastSpokenRef.current = sceneIdx;
      playSceneAudio(sceneIdx);
    }

    paintTimelineAt(elapsed);

    const window = loopWindowRef.current;
    const stopAt = loopRef.current ? window.end : total;
    if (elapsed >= stopAt) {
      // Loop rides on this same clock: restarting is just rewinding the one
      // shared playStart, so preview and loop can never run two clocks that
      // drift apart. Audio stops anyway at the scene reads below, because the
      // reload makes locateScene report a new index from scene 0.
      if (loopRef.current) {
        // Rewind to the loop window's start, not 0: a section loop begins in
        // the middle of the timeline, so rewinding the shared clock to 0 would
        // replay everything before the section.
        const back = window.start;
        seekClockTo(back);
        setPlayhead(back);
      } else {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        previewOnlyRef.current = false;
        setPlaying(false);
      }
    } else if (previewOnlyRef.current) {
      previewOnlyRef.current = false;
    } else {
      rafRef.current = requestAnimationFrame(() => frameFnRef.current());
    }
  }, [loopRef, playSceneAudio, paintTimelineAt, readClock, seekClockTo]);

  useEffect(() => {
    frameFnRef.current = renderFrame;
  }, [renderFrame]);

  // Clamp the playhead when edits shrink the total duration, and repaint the
  // preview after any change while paused — without this the canvas keeps the
  // stale frame (e.g. "Scene 1" showing mid-video after a duration edit).
  //
  // Paints only. It used to rebase the shared clock on the selected scene's
  // start as well, which quietly destroyed the resume point: pausing mid-scene
  // left `pausedAt` on the scene's first frame, so Resume replayed from the top
  // of the scene instead of from where the author stopped. The clock belongs to
  // seekTo / play / pause and to nothing else, and the playhead this returns is
  // left where the author put it.
  useEffect(() => {
    if (playing) return;
    setPlayhead((prev) => {
      if (scenes.length === 0) return 0;
      const clamped = Math.min(prev, totalDuration);
      // Still-frame at the selected scene's start; the paused position follows.
      const offset =
        scenes
          .slice(0, Math.max(0, selectedSceneIndex))
          .reduce((acc, s) => acc + s.duration, 0);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx && scenes.length > 0) {
        const idx = Math.min(Math.max(selectedSceneIndex, 0), scenes.length - 1);
        const src = scenes[idx].imageKey
          ? imagesRef.current[scenes[idx].imageKey as string]
          : undefined;
        const img = src ? imageCacheRef.current.get(src) ?? null : null;
        const seekCue = cueForTime(offset);
        paintScene(
          ctx,
          canvas.width,
          canvas.height,
          scenes[idx],
          0,
          brand,
          img,
          seekCue,
          subtitleStyle,
          offset,
        );
      }
      return clamped;
    });
  }, [scenes, selectedSceneIndex, brand, playing, totalDuration, cueForTime, subtitleStyle]);

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastSpokenRef.current = -1;
    pausedAtRef.current = null;
    previewOnlyRef.current = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopClip();
    setPlayhead(0);
    lastEmitMsRef.current = -1;
    setPlaying(false);
  }, [stopClip]);

  const playFrom = useCallback(
    (sceneIndex: number) => {
      const canvas = canvasRef.current;
      if (!canvas || scenesRef.current.length === 0) return;
      stopPlayback();
      const offset =
        scenesRef.current
          .slice(0, sceneIndex)
          .reduce((acc, s) => acc + s.duration, 0);
      seekClockTo(offset);
      lastSpokenRef.current = sceneIndex - 1;
      setPlaying(true);
      rafRef.current = requestAnimationFrame(renderFrame);
    },
    [renderFrame, seekClockTo, stopPlayback],
  );

  const pause = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const at = Math.max(0, readClock());
    pausedAtRef.current = at;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopClip();
    setPlaying(false);
  }, [readClock, stopClip]);

  const resume = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || scenesRef.current.length === 0) {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      return;
    }
    const at = pausedAtRef.current ?? 0;
    setFollowPlayhead(true);
    let acc = 0;
    let idx = scenesRef.current.length - 1;
    for (let i = 0; i < scenesRef.current.length; i++) {
      if (at < acc + scenesRef.current[i].duration) {
        idx = i;
        break;
      }
      acc += scenesRef.current[i].duration;
    }
    lastSpokenRef.current = idx - 1;
    seekClockTo(at);
    pausedAtRef.current = null;
    setPlaying(true);
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame, seekClockTo]);

  const seekTo = useCallback(
    (t: number) => {
      const elapsed = Math.max(0, Math.min(t, totalDuration));
      seekClockTo(elapsed);
      let acc = 0;
      let idx = scenesRef.current.length - 1;
      for (let i = 0; i < scenesRef.current.length; i++) {
        if (elapsed < acc + scenesRef.current[i].duration) {
          idx = i;
          break;
        }
        acc += scenesRef.current[i].duration;
      }
      lastSpokenRef.current = idx - 1;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      stopClip();
      setPlayhead(elapsed);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (playing) {
        rafRef.current = requestAnimationFrame(renderFrame);
      } else {
        previewOnlyRef.current = true;
        frameFnRef.current();
      }
    },
    [playing, renderFrame, seekClockTo, stopClip, totalDuration],
  );

  /**
   * Dragging the ruler scrubs the playhead to the pointer. The needle barely
   * has to move to be useful, so the ruler row is the whole hit surface.
   */
  const onRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      const seekAt = (clientX: number) => {
        seekTo(timeForX(timeline, clientX - box.left));
      };
      seekAt(event.clientX);
      const onMove = (move: PointerEvent) => seekAt(move.clientX);
      const onUp = () => {
        draggingNeedle.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      draggingNeedle.current = true;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [seekTo, timeline],
  );

  /**
   * Moves the preview by exactly one export frame. Stepping is an inspection
   * gesture, so while playing it parks the video first — otherwise the next
   * rAF would immediately eat the frame that was just stepped to.
   */
  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      if (playingRef.current) pause();
      seekTo(playheadRef.current + dir * (1 / EXPORT_FPS));
    },
    [pause, seekTo],
  );

  /**
   * Shuttle: L plays forward at increasing speed (1x, 2x — the preview
   * picker's own ceiling), J scrubs backwards on the same ladder, and K parks
   * on the exact frame and hands the rate picker its value back. The chosen
   * preview speed is remembered only while parked, so shuttling never
   * overwrites it permanently.
   */
  const shuttleBackRef = useRef<number | null>(null);
  const preShuttleRateRef = useRef(1);
  /** Whether a shuttle run is in progress, as opposed to parked. */
  const shuttleActiveRef = useRef(false);
  const shuttleDirRef = useRef<1 | -1>(1);
  const stopShuttle = useCallback(() => {
    if (shuttleBackRef.current !== null) {
      window.clearInterval(shuttleBackRef.current);
      shuttleBackRef.current = null;
    }
    if (shuttleActiveRef.current) {
      shuttleActiveRef.current = false;
      shuttleRef.current = 1;
      setRate(preShuttleRateRef.current);
    }
  }, [setRate]);
  const shuttle = useCallback(
    (dir: 1 | -1) => {
      if (shuttleBackRef.current !== null) {
        window.clearInterval(shuttleBackRef.current);
        shuttleBackRef.current = null;
      }
      // Changing direction restarts the ladder at 1x, like every NLE: mashing
      // J then L scrubs back, then eases forward — it never jumps to 8x.
      const turning = shuttleActiveRef.current && shuttleDirRef.current !== dir;
      if (!shuttleActiveRef.current) {
        // Engaging: remember the speed the user had picked so K can restore it.
        preShuttleRateRef.current = rateRef.current;
      }
      const speed =
        !shuttleActiveRef.current || turning
          ? 1
          : Math.min(2, shuttleRef.current * 2);
      shuttleActiveRef.current = true;
      shuttleDirRef.current = dir;
      shuttleRef.current = speed;
      setRate(speed);
      if (dir === 1) {
        if (playingRef.current) {
          // Already rolling: rebase the one shared clock instead of
          // restarting, so the picture does not blink.
          seekClockTo(playheadRef.current);
          return;
        }
        stopPlayback();
        seekClockTo(0);
        lastSpokenRef.current = -1;
        setPlaying(true);
        rafRef.current = requestAnimationFrame(renderFrame);
        return;
      }
      // Backwards playback is not something the frame painter can do
      // honestly, so J walks the playhead back at the shuttle speed —
      // scrubbing, but timed like playback.
      if (playingRef.current) pause();
      const backward = () => {
        if (playingRef.current) {
          // A forward play took over; the scrub stands down.
          if (shuttleBackRef.current !== null) {
            window.clearInterval(shuttleBackRef.current);
            shuttleBackRef.current = null;
          }
          return;
        }
        const at = playheadRef.current - 0.1 * shuttleRef.current;
        if (at <= 0) {
          stopShuttle();
          seekTo(0);
          return;
        }
        seekTo(at);
      };
      backward();
      shuttleBackRef.current = window.setInterval(backward, 100);
    },
    [pause, renderFrame, seekClockTo, seekTo, setRate, stopPlayback, stopShuttle],
  );

  const formatTime = useCallback((t: number) => {
    const totalSec = Math.max(0, Math.floor(t));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);

  /**
   * Fullscreen for the preview stage.
   *
   * The browser API is prefixed on older Safari, and iOS refuses element
   * fullscreen outright (it only offers it for <video>), so every entry point
   * is feature-detected and failures surface as a status message rather than a
   * rejected promise nobody awaits.
   */
  const fsElement = () =>
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element | null })
      .webkitFullscreenElement ??
    null;

  const exitFullscreen = useCallback(async () => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    try {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch {
      setFullscreenBlocked(true);
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const el = stage as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) {
      setFullscreenBlocked(true);
      return;
    }
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch {
      setFullscreenBlocked(true);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (fsElement()) void exitFullscreen();
    else void enterFullscreen();
  }, [enterFullscreen, exitFullscreen]);

  // The user can also leave with Esc or F11, so the button has to follow the
  // document rather than only our own click handler.
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(fsElement() === stageRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener(
      "webkitfullscreenchange",
      onChange as EventListener,
    );
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        onChange as EventListener,
      );
    };
  }, []);


  const sumTo = useCallback(
    (index: number) =>
      scenes.slice(0, index).reduce((acc, s) => acc + s.duration, 0),
    [scenes],
  );

  /**
   * Nudges the selected scene's duration by half a second per press, or a
   * full second with Shift — the slider's own 0.5s grid, so a keyboard trim
   * is always visible on it too. The keyboard is for trimming by ear while
   * the preview loop runs; the slider still owns precise values.
   */
  const nudgeSceneDuration = useCallback(
    (delta: number) => {
      const scene = scenes[selectedSceneIndex];
      if (!scene) return;
      const next = Math.min(
        DURATION_MAX,
        Math.max(DURATION_MIN, Math.round((scene.duration + delta) * 2) / 2),
      );
      if (next === scene.duration) return;
      setScenes(
        scenes.map((s, i) => (i === selectedSceneIndex ? { ...s, duration: next } : s)),
        { kind: "commit" },
      );
    },
    [scenes, selectedSceneIndex, setScenes],
  );

  const activeSceneIndex = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (playhead < acc + scenes[i].duration) return i;
      acc += scenes[i].duration;
    }
    return scenes.length > 0 ? scenes.length - 1 : -1;
  }, [scenes, playhead]);

  const activeScene = useMemo(
    () => (activeSceneIndex >= 0 ? scenes[activeSceneIndex] ?? null : null),
    [scenes, activeSceneIndex],
  );

  /**
   * Renders the whole voice-over into one AudioBuffer, off the clock.
   *
   * The live mix is a MediaStream because MediaRecorder needs a real-time
   * source. The file exporter does not: it wants the finished samples, and an
   * OfflineAudioContext produces them faster than real time and lets the clips
   * be laid out at exact timeline positions, so the audio cannot drift against
   * the video the way a scheduled live graph can.
   *
   * Returns null when nothing has audio, or when the browser has no offline
   * context, which the caller treats as a silent export.
   */
  const buildMixBuffer = useCallback(
    async (list: readonly VideoScene[] = scenesRef.current): Promise<AudioBuffer | null> => {
    const slots = buildAudioSchedule(list);
    if (slots.length === 0) return null;
    const Ctor =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!Ctor) return null;

    const total = list.reduce((acc, s) => acc + s.duration, 0);
    if (!(total > 0)) return null;
    // 48 kHz is what both AAC and Opus are happiest with, and a video whose
    // audio is 48 kHz needs no resampling on the way out.
    const sampleRate = 48_000;
    const ctx = new Ctor(2, Math.ceil(total * sampleRate), sampleRate);

    const decoded: { buffer: AudioBuffer; slot: (typeof slots)[number] }[] = [];
    for (const slot of slots) {
      const blob = await getAudioClip(slot.key);
      if (!blob) continue;
      try {
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        decoded.push({ buffer, slot });
      } catch {
        continue; // a format the browser cannot decode is simply left silent
      }
    }
    if (decoded.length === 0) return null;

    for (const { buffer, slot } of decoded) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      if (slot.gain === 1) {
        node.connect(ctx.destination);
      } else {
        // A gain node rather than muting the node, so a muted scene keeps its
        // slot in the graph and a later unmute needs no rebuild. gain 0 is
        // linear silence; the browser's own limiter is not, so the sum below
        // still has to be watched for clipping.
        const gain = ctx.createGain();
        gain.gain.value = slot.gain;
        node.connect(gain).connect(ctx.destination);
      }
      // start(when, offset, duration) cuts the clip to the part of it the scene
      // actually uses, and places it at its absolute position on the timeline.
      node.start(Math.max(0, slot.start - slot.offset), slot.offset, slot.duration);
    }
    return ctx.startRendering();
    // getAudioClip only reads refs, so it never needs to retrigger this.
  }, []);

  /**
   * The scenes an export should cover.
   *
   * With "this section" on, the export is scoped to the run holding the
   * selection. `scenesOfRun` falls back to the whole timeline when the
   * selection is gone, so the toggle can never produce an empty export.
   */
  const scenesForExport = useMemo<readonly VideoScene[]>(
    () =>
      sectionOnly && selectedId
        ? scenesOfRun(scenes, selectedId)
        : scenes,
    [scenes, sectionOnly, selectedId],
  );

  /**
   * The export currently running, if any.
   *
   * An AbortController rather than a boolean. The render loop is a plain async
   * function with no way to be told to stop, so it gets a signal it can poll
   * between frames; `beginExport` hands out that signal's owner and `cancelExport`
   * is what fires it. State lives in a ref because nothing here re-renders on it:
   * the status line already reports progress through `setStatus`, and a re-render
   * per aborted frame would be its own kind of slowdown.
   */
  const exportAbortRef = useRef<AbortController | null>(null);

  /**
   * Claims the single export slot. Returns false when one is already running.
   *
   * The busy state that drives the Cancel button lives in the hub, which owns its
   * own spinner around the promise. Duplicating it here would mean two sources of
   * truth for the same fact, and they would disagree during the gap where the
   * encoder is already running but the hub has not yet painted.
   */
  const beginExport = useCallback(() => {
    if (exportAbortRef.current) return false;
    exportAbortRef.current = new AbortController();
    return true;
  }, []);

  /** Releases the slot. Always runs, including on the failure and cancel paths. */
  const endExport = useCallback(() => {
    exportAbortRef.current = null;
  }, []);

  /**
   * Stops a running export.
   *
   * Aborting is enough for the loop to notice; this only says so, because a
   * status line still reading "Encoding… 47%" after the user pressed Cancel is
   * how a cancel ends up looking like a hang.
   */
  const cancelExport = useCallback(() => {
    if (!exportAbortRef.current) return;
    exportAbortRef.current.abort();
    setStatus("Cancelling…");
  }, [setStatus]);

  /**
   * Encodes the timeline to a file and hands it to the browser as a download.
   *
   * No playback is involved: every frame is painted and encoded on demand, so
   * this finishes well before the video is over and the window stays responsive
   * enough to show progress.
   */
  const exportVideoFile = useCallback(
    async (target: ExportTarget) => {
    const canvas = canvasRef.current;
    // Scoped to the selected section when the toggle is on. Read from the ref
    // so an export started mid-render uses the same list every frame.
    const list = scenesForExport;
    if (!canvas || list.length === 0) {
      setStatus("There is nothing to export yet.");
      return;
    }
    const total = list.reduce((acc, s) => acc + s.duration, 0);
    if (!(total > 0)) {
      setStatus("The timeline is empty, so there is nothing to export.");
      return;
    }
    // False means an export is already running. The button is disabled for the
    // same reason, but a keyboard shortcut or a stale click can still land here,
    // and two encoders writing at once is worse than ignoring the second one.
    if (!beginExport()) return;

    stopPlayback();
    setStatus("Preparing the audio mix…");
    const signal = exportAbortRef.current?.signal;
    try {
      const audio = await buildMixBuffer(list);
      throwIfCancelled(signal);
      const format = exportFormat(target);
      setStatus(`Rendering .${format.extension}…`);
      const result = await renderVideoToFile({
        target,
        canvas,
        width: canvas.width,
        height: canvas.height,
        duration: total,
        audio,
        signal,
        paintFrame: (t) => paintTimelineAt(t, list),
        onProgress: (f) =>
          setStatus(`Rendering .${format.extension}… ${Math.round(f * 100)}%`),
      });

// Checked once more, because the gap between the last frame and this line
      // is where an abort lands that the loop never got to see.
      throwIfCancelled(signal);

      const scope = sectionOnly ? sectionSlug(scenes, selectedId) : "";
      const base = `${fileName.trim() || "book-promo"}${scope}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(result.blob);
      a.download = `${base}.${result.extension}`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(
        result.audioDropped
          ? `Saved .${format.extension} without audio: this browser cannot encode ${format.audioCodec}.`
          : `Saved .${format.extension}${audio ? " with audio" : ""}.`,
      );
    } catch (error) {
      setStatus(
        error instanceof ExportCancelledError
          ? "Export cancelled."
          : error instanceof VideoExportError
            ? error.message
            : "The export failed for an unknown reason.",
      );
    } finally {
      endExport();
    }
  },
  [
    beginExport,
    buildMixBuffer,
    endExport,
    fileName,
    paintTimelineAt,
    scenes,
    scenesForExport,
    sectionOnly,
    selectedId,
    setStatus,
    stopPlayback,
  ],
  );

  /**
   * Plays the timeline from the start.
   *
   * Only plays. Export used to ride on this function, capturing the canvas while
   * it ran; it now encodes each frame on demand in `exportVideoFile`, so the
   * transport has no export concern left to carry.
   *
   * The "start" is the loop window's start, not always 0. A section loop is a
   * rehearsal of one section, so pressing play should drop the author on that
   * section's first frame instead of making them sit through the sections
   * before it. Off the loop, that is the whole video as before.
   */
  const play = useCallback(async () => {
    if (scenesRef.current.length === 0) return;
    stopPlayback();
    setFollowPlayhead(true);
    const from = loopRef.current ? loopWindowRef.current.start : 0;
    seekClockTo(from);
    lastSpokenRef.current = -1;
    setPlayhead(from);
    setPlaying(true);
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame, seekClockTo, stopPlayback]);

  /**
   * Transport shortcuts. They are ignored while a form control has focus, or
   * typing narration would toggle playback on every space.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // `e.target` is only an Element when something in the page has focus.
      // A key event aimed at the document or the window reports those instead,
      // and `closest` does not exist on them - a throw here would take every
      // shortcut down with it, so the guard asks what it is before calling it.
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      // Undo/redo. Checked before the modifier bail-out below, because these
      // are the one shortcut that *is* a modifier combination. Inside a text
      // field the browser's own undo wins, which is what a writer expects.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redoScenes();
        else undoScenes();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redoScenes();
        return;
      }
      // Shuttle keys (J back, K park, L forward). Deliberately before the
      // alt/modifier bail-outs and usable no matter what has focus: shuttle is
      // exactly what you reach for while scrubbing with one hand on the keys.
      const lower = e.key.toLowerCase();
      if (lower === "j" || lower === "k" || lower === "l") {
        e.preventDefault();
        if (lower === "k") {
          if (playing) pause();
          stopShuttle();
        } else {
          shuttle(lower === "l" ? 1 : -1);
        }
        return;
      }
      // Trim the selected scene's duration with Alt+arrows, before the
      // generic alt bail-out below. Shift makes the step a full second.
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        nudgeSceneDuration((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 1 : 0.5));
        return;
      }
      if (e.altKey) {
        return;
      }

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        stopPlayback();
        stopShuttle();
        return;
      }
      if (e.key === " ") {
        e.preventDefault(); // otherwise the page scrolls behind the video
        if (playing) pause();
        else if (playhead > 0 && playhead < totalDuration)
          resume();
        else void play();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(playhead + 5);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(playhead - 5);
        return;
      }
      // Frame stepping. Period steps forward, comma steps back, at exactly
      // one export frame (1/EXPORT_FPS s) — the finest grain the finished
      // video actually has, so stepping never hides a frame from review.
      if (e.key === "," || e.key === ".") {
        e.preventDefault();
        stepFrame(e.key === "." ? 1 : -1);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        seekTo(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        seekTo(totalDuration);
        return;
      }
      // Delete/Backspace removes the selected scene. Deleting is destructive,
      // but undo covers it and the selection marks exactly what will go.
      if (e.key === "Delete" || e.key === "Backspace") {
        const id = selectedId;
        if (!id) return;
        e.preventDefault();
        removeScene(id);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    nudgeSceneDuration,
    playing,
    pause,
    play,
    playhead,
    redoScenes,
    removeScene,
    resume,
    seekTo,
    selectedId,
    shuttle,
    stepFrame,
    stopPlayback,
    stopShuttle,
    toggleFullscreen,
    totalDuration,
    undoScenes,
  ]);

  const exportJson = useCallback(() => {
    // Scoped to the selected section when the toggle is on, and named for it, so
    // a partial export is not mistaken for the whole timeline on reload.
    const list = scenesForExport;
    const doc: SceneDocument = {
      version: SCENE_FORMAT_VERSION,
      brand,
      portrait,
      scenes: [...list],
      subtitleStyleId,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const scope = sectionOnly ? sectionSlug(list, selectedId) : "";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName.trim() || "book-promo"}${scope}-scenes.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (sectionOnly) {
      setStatus(`Exported ${list.length} scenes from this section only.`);
    }
  }, [
    brand,
    portrait,
    scenesForExport,
    sectionOnly,
    selectedId,
    fileName,
    subtitleStyleId,
    setStatus,
  ]);

  const importJson = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(reader.result ?? ""));
        } catch {
          setStatus("Invalid scene JSON — the file is not valid JSON.");
          return;
        }

        const { document: imported, warnings } = normalizeSceneDocument(parsed, {
          imageKeys: Object.keys(imagesRef.current),
          chapterIds: chaptersRef.current.map((c) => c.id),
        });
        if (!imported) {
          setStatus(
            warnings.length > 0
              ? `Nothing imported. ${warnings[0]}`
              : "Nothing imported.",
          );
          return;
        }

        setBrand(imported.brand);
        setPortrait(imported.portrait);
        setScenes(imported.scenes);
        if (imported.subtitleStyleId) setSubtitleStyleId(imported.subtitleStyleId);
        setSelectedId(imported.scenes[0]?.id ?? null);
        setStatus(
          warnings.length > 0
            ? `Imported ${imported.scenes.length} scenes · ${warnings.length} field${warnings.length === 1 ? "" : "s"} repaired: ${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? "…" : ""}`
            : `Imported ${imported.scenes.length} scenes.`,
        );
      };
      reader.readAsText(file);
    },
    [setScenes, setStatus],
  );

  const currentResolution =
    RESOLUTIONS.find((r) => r.id === resolution) ?? RESOLUTIONS[1];
  const [w, h] = portrait
    ? [currentResolution.height, currentResolution.width]
    : [currentResolution.width, currentResolution.height];

  const resolutionLabel = portrait
    ? `${currentResolution.height}×${currentResolution.width}`
    : currentResolution.short;

  /**
   * Asks the browser which containers it can actually produce, before the user
   * presses export.
   *
   * Re-probed when the frame size or the presence of audio changes, because both
   * change what has to be supported: a browser can encode H.264 at 720p and
   * refuse it at 1080×1920, and a silent project never needs an audio encoder at
   * all. The answer is a promise, so a probe still in flight leaves the options
   * enabled rather than guessing.
   */
  useEffect(() => {
    let cancelled = false;
    const context = {
      width: w,
      height: h,
      frameRate: EXPORT_FPS,
      withAudio: scenes.some((s) => s.audio !== undefined),
    };
    const probe = webCodecsProbe();
    const ask = (target: ExportTarget) =>
      probeTarget(exportFormat(target), context, probe);

    Promise.all([ask("mp4"), ask("webm")])
      .then(([mp4, webm]) => {
        if (cancelled) return;
        setSupport({
          probed: true,
          webCodecs: probe.webCodecs,
          can: { mp4, webm, capcut: true, json: true },
        });
      })
      .catch(() => {
        // A probe that rejects knows nothing, so nothing gets disabled: the
        // export itself will report the real error if it turns out to be real.
        if (cancelled) return;
        setSupport({
          probed: true,
          webCodecs: probe.webCodecs,
          can: { mp4: true, webm: true, capcut: true, json: true },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [w, h, scenes]);

  /**
   * Why the CapCut pack is unavailable, phrased for the export list.
   *
   * The pack is a ZIP, and a ZIP needs no encoder. But it no longer holds
   * stills: it holds one MP4 per scene, so it inherits the MP4 encoder's
   * limits, and a disabled option with no explanation reads as a bug. This
   * lives here rather than in the container catalog because it is a fact about
   * what this editor puts in the pack, not about a container.
   */
  const packReason = useMemo<string | null>(() => {
    if (!support.probed) return null;
    if (!support.webCodecs) {
      return "Each scene is exported as an MP4, and this browser has no WebCodecs encoder.";
    }
    if (!support.can.mp4) {
      return "Each scene is exported as an MP4, and this browser cannot encode H.264 for one.";
    }
    return null;
  }, [support.probed, support.webCodecs, support.can.mp4]);

  const exportCapCutPack = useCallback(async () => {
    // Scoped to the selected section when the toggle is on: the pack is a
    // sequence of clips in order, and a pack that silently starts at scene 20
    // would be a sequence with a hole in it.
    const list = scenesForExport;
    if (list.length === 0) {
      setStatus("There is nothing to export yet.");
      return;
    }
    if (!beginExport()) return;
    const signal = exportAbortRef.current?.signal;
    stopPlayback();
    setStatus(`Encoding ${list.length} scene${list.length === 1 ? "" : "s"} as MP4…`);
    // Counted outside the try, so the cancel path can say how far it got. The
    // header row is in here too, which is why the message subtracts one.
    let encoded = 0;
    try {
    const zip = new JSZip();
    // Cues for the whole run, so each clip can be painted with the words that
    // belong to its own slice of the timeline.
    const cues = buildTimelineCues(
      list.map((s) => ({
        narration: s.narration,
        duration: s.duration,
        regions: s.audio?.regions ?? null,
      })),
    );
    const rows = [
      [
        "#",
        "File",
        "Kicker",
        "Title",
        "Subtitle",
        "Duration (s)",
        "Transition",
        "Narration",
        // The clip carries its own voice-over, already mixed at the scene's own
        // volume and mute state, so the editor has nothing left to do with it.
        "Audio in clip",
      ],
    ];
    let clipsWithAudio = 0;
    // One offscreen canvas for every clip: the frames are the same size, and a
    // fresh canvas per scene only buys the encoder a second to forget.
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setStatus("This browser would not give the exporter a canvas to draw on.");
      return;
    }

    for (let i = 0; i < list.length; i++) {
      // Once per scene, not once per frame: inside the encode the render loop
      // does this 30 times a second. This is the check for the work *around* the
      // encode - decoding an image, mixing audio - which is where a cancel would
      // otherwise have to wait for a whole scene to finish before it was seen.
      throwIfCancelled(signal);
      const scene = list[i];
      const fileBase = `${String(i + 1).padStart(2, "0")}_${slugify(scene.kicker)}`;
      const sceneStart = list
        .slice(0, i)
        .reduce((acc, s) => acc + s.duration, 0);
      let image: HTMLImageElement | null = null;
      const src = scene.imageKey ? images[scene.imageKey] : undefined;
      if (src) {
        try {
          image = await loadImage(src);
        } catch {
          image = null;
        }
      }

      // Only this scene's own clip, so the mix is the scene and not the run:
      // buildMixBuffer lays the clips out at absolute times, and a single
      // scene's slot starts at zero.
      const audio = await buildMixBuffer([scene]);
      throwIfCancelled(signal);
      if (audio) clipsWithAudio++;

      try {
        const clip = await renderVideoToFile({
          target: "mp4",
          canvas,
          width: w,
          height: h,
          duration: scene.duration,
          audio,
          signal,
          paintFrame: (t) => {
            paintScene(
              ctx,
              w,
              h,
              scene,
              t,
              brand,
              image,
              subtitlesOn ? cueAt(cues, sceneStart + t) : null,
              subtitleStyle,
              // The word-by-word motion runs on the absolute clock while the
              // scene's own transition runs on the local one, so both are passed
              // rather than one being derived from the other.
              sceneStart + t,
            );
          },
          onProgress: (f) =>
            setStatus(
              `Encoding scene ${i + 1} of ${list.length}… ${Math.round(f * 100)}%`,
            ),
        });
        // Stored, not deflated: the payload is already a compressed video, and
        // running DEFLATE over it would buy nothing for seconds of CPU.
        zip.file(`scenes/${fileBase}.mp4`, clip.blob, { compression: "STORE" });
        encoded++;
      } catch (error) {
        if (error instanceof ExportCancelledError) throw error;
        setStatus(
          error instanceof VideoExportError
            ? `Scene ${i + 1} could not be encoded: ${error.message}`
            : `Scene ${i + 1} could not be encoded for an unknown reason.`,
        );
        return;
      }

      rows.push([
        String(i + 1),
        `${fileBase}.mp4`,
        scene.kicker,
        scene.title,
        scene.subtitle,
        String(scene.duration),
        scene.transition,
        scene.narration,
        audio ? "yes" : "no",
      ]);
    }

    zip.file(
      "storyboard.csv",
      rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    );
    // An editable subtitle track: timings are estimated from the narration, so
    // check them against the voice-over before trusting the cut.
    if (cues.length > 0) {
      zip.file("subtitles.srt", toSrt(cues));
    }
    zip.file(
      "README.txt",
      [
        "CapCut import pack",
        "------------------",
        "",
        "1. Drag every MP4 inside scenes/ onto the CapCut timeline in numeric order.",
        "2. Each clip is already sized to the video aspect, already carries its own",
        "   voice-over, and is tagged in the storyboard.csv:",
        "   - Duration: the exact length of the clip",
        "   - Transition: which transition to put AFTER the scene",
        "   - Narration: the line this scene speaks",
        "   - Audio in clip: yes when the clip already has its voice-over, so do",
        "     not add the audio again on the timeline",
        ...(cues.length > 0
          ? [
              "3. subtitles.srt is an editable subtitle track. Import it, then check the",
              "   timings against the voice-over: they are estimated from the text,",
              "   not measured from the audio.",
            ]
          : []),
        `4. Export your CapCut project at ${w}x${h} to match the resolution used here.`,
        "",
      ].join("\n"),
    );
    setStatus("Zipping the clips…");
    // The zip is assembled even on the cancel path, so it gets its own check.
    // Deflating a pack of MP4s is CPU-bound work with no awaits of its own to
    // interrupt, and skipping it is the difference between a cancel that feels
    // instant and one that still costs the user several seconds.
    throwIfCancelled(signal);
    // The progress callback is the second argument, not a property of the options
    // object: that is JSZip 3.x's signature. Reporting percent from it turns a
    // silent ten-second wait into something the author can see, and it is also
    // the only signal that the zip stage is still alive.
    const blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE" },
      (meta) => {
        if (signal?.aborted) return;
        setStatus(`Zipping the clips… ${Math.round(meta.percent)}%`);
      },
    );
    throwIfCancelled(signal);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const scope = sectionOnly ? sectionSlug(list, selectedId) : "";
    a.download = `${fileName.trim() || "book-promo"}${scope}-capcut.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(
      `CapCut pack saved (${list.length} MP4 clips${
        clipsWithAudio > 0 ? `, ${clipsWithAudio} with voice-over` : ""
      }${cues.length > 0 ? `, ${cues.length} subtitles` : ""}${
        sectionOnly ? ", this section only" : ""
      }).`,
    );
    } catch (error) {
      // Only a cancel lands here now: every other failure already returned from
      // inside the loop. Anything else is treated as a cancel so the pack is
      // never left half-written on disk.
      if (!(error instanceof ExportCancelledError)) throw error;
      setStatus(
        encoded > 0
          ? `Export cancelled after ${encoded} of ${list.length} scenes. Nothing was saved.`
          : "Export cancelled. Nothing was saved.",
      );
    } finally {
      endExport();
    }
  }, [
    scenesForExport,
    sectionOnly,
    selectedId,
    brand,
    images,
    fileName,
    w,
    h,
    subtitlesOn,
    subtitleStyle,
    stopPlayback,
    buildMixBuffer,
    beginExport,
    endExport,
  ]);

  /**
   * Everything this editor can export, described once for the shared hub.
   *
   * The video targets carry the probe result, so an encoder this browser lacks
   * shows its reason in the list instead of failing after the click. The
   * project files are always available: they are written straight to disk and
   * need nothing from the browser but a download.
   */
  const hubTargets = useMemo<ExportTargetSpec[]>(
    () =>
      EXPORT_FORMATS.map((format) => ({
        id: format.id,
        label: format.label,
        extension: format.extension,
        hint: format.hint,
        isVideo: format.isVideo,
        // Gated on `probed` for the same reason the old button was: nothing
        // should be blocked on an answer that has not arrived yet.
        available:
          format.id === "capcut"
            ? packReason === null
            : !support.probed || support.can[format.id],
        reason:
          format.id === "capcut"
            ? packReason
            : unavailableReason(format.id, {
                webCodecs: support.webCodecs,
                probed: support.probed,
              }),
        run: () => {
          // One selector, one action. The project files are written straight to
          // disk; a video is encoded offline and downloaded, so none of them
          // needs the timeline to play.
          if (format.id === "json") {
            exportJson();
            return;
          }
          // The project files are instant, so they do not take the slot and are
          // not blocked by a running encode. Everything that reaches for the
          // encoder has to go through beginExport or two encodes race.
          if (format.id === "capcut") {
            return exportCapCutPack();
          }
          return exportVideoFile(format.id);
        },
        // Both video paths share one slot and one controller, so either of them
        // can stop the other. Without this the hub would offer Cancel for one
        // target and silently fail to stop it.
        cancel: format.isVideo || format.id === "capcut" ? cancelExport : undefined,
      })),
    [
      support.probed,
      support.webCodecs,
      support.can,
      packReason,
      cancelExport,
      exportJson,
      exportCapCutPack,
      exportVideoFile,
    ],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-muted/40 px-3">
        <div className="flex min-w-0 items-center gap-2" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            variant={libraryOpen ? "secondary" : "outline"}
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => setLibraryOpen(!libraryOpen)}
            title="Images, illustrations, logos, icons, audio and video you keep for both studios"
          >
            <LibraryBig className="size-3" />
            Library
          </Button>
          <div
            className="flex items-center gap-1.5"
            title="Brand accent color"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Accent
            </span>
            <input
              type="color"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="h-6 w-8 cursor-pointer rounded border bg-background p-0.5"
              aria-label="Brand accent color"
            />
          </div>
          <div className="flex items-center gap-1.5" title="Canvas resolution">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Res
            </span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="h-6 rounded border bg-background px-1.5 text-[11px] outline-none focus:border-ring"
              aria-label="Video resolution"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPortrait((p) => !p)}
            title="Toggle portrait / landscape"
            className="h-6 gap-1 px-2 text-[11px]"
          >
            <RotateCcw className="size-3" />
            {portrait ? "Vertical" : "Horizontal"}
          </Button>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="h-6 w-24 rounded border bg-background px-2 font-mono text-[11px] outline-none focus:border-ring"
            aria-label="Output filename"
            title="Output filename"
          />
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:flex"
        // The width is a CSS variable rather than an inline `width` so the
        // stacked layout below `lg` ignores it: there the two panes share the
        // height and a fixed width would leave a gap beside the stage.
        style={{ "--inspector-w": `${inspectorWidth}px` } as CSSProperties}
      >
        {/* Scene inspector */}
        <div className="flex min-h-0 flex-col border-b lg:w-[var(--inspector-w)] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Inspector
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant={jsonOpen ? "secondary" : "ghost"}
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => (jsonOpen ? setJsonOpen(false) : openSceneJson())}
                title={
                  selectedScene
                    ? "View and edit the selected scene as JSON"
                    : "Paste a scene or a { scene, subscenes } section to start the timeline"
                }
              >
                <Braces className="size-3.5" />
                Scene JSON
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={exportJson}
                title="Export scenes as JSON"
              >
                <Download className="size-3.5" />
                JSON
              </Button>
              <label className="inline-flex cursor-pointer items-center">
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importJson(f);
                    e.target.value = "";
                  }}
                />
                <span className="inline-flex h-6 items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
                  <Upload className="size-3.5" />
                </span>
              </label>
            </div>
          </div>

          {jsonOpen && (
            <div className="border-b bg-muted/20 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {selectedScene
                    ? `scene[${scenes.findIndex((s) => s.id === selectedScene.id)}]`
                    : "new scene"}
                </span>
                <div className="flex items-center gap-1">
                  <select
                    value=""
                    onChange={(e) => {
                      const t = sceneJsonTemplate(e.target.value);
                      if (!t) return;
                      setJsonDraft(t.json);
                      setJsonError(null);
                    }}
                    className="h-5 max-w-40 rounded border bg-background px-1 text-[10px] text-muted-foreground outline-none focus:border-ring"
                    aria-label="Insert a JSON example"
                    title="Replace the draft with a working example"
                  >
                    <option value="">Examples…</option>
                    {SCENE_JSON_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id} title={t.hint}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {selectedScene && (
                    <button
                      type="button"
                      onClick={() => setJsonDraft(JSON.stringify(selectedScene, null, 2))}
                      className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                      title="Reset to the scene as currently rendered (full object, runtime fields included)"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setJsonOpen(false)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
              </div>
              <textarea
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
                spellCheck={false}
                rows={14}
                aria-label="Scene JSON draft"
                className="w-full resize-y rounded border bg-background p-2 font-mono text-[11px] leading-4 outline-none focus:border-ring"
              />
              {jsonError && (
                <p className="mt-1 text-[10px] font-medium text-red-500">{jsonError}</p>
              )}
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button size="sm" className="h-6 px-2 text-xs" onClick={applySceneJson}>
                  {selectedScene ? "Apply" : "Add"}
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  {selectedScene
                    ? "id and chapter link are preserved · unknown fields are repaired on apply"
                    : 'adds to the timeline · a { "scene", "subscenes" } section adds all its scenes'}
                </span>
              </div>
            </div>
          )}

          {selectedScene ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Scene {selectedSceneIndex + 1} of {scenes.length}
                  {selectedScene.imageKey ? " · image" : ""}
                  {"/"}
                  {selectedScene.transition}
                </span>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock3 className="size-3" />
                  <span className="font-mono tabular-nums">{formatTime(sumTo(selectedSceneIndex))}–{formatTime(sumTo(selectedSceneIndex + 1))}</span>
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Kicker
                </label>
                <div className="flex items-center gap-1.5">
                  <CaseSensitive className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={selectedScene.kicker}
                    onChange={(e) =>
                      editSceneField(selectedScene.id, "kicker", e.target.value)
                    }
                    placeholder="Kicker"
                    className="h-7 w-full rounded border bg-background px-2 font-mono text-[11px] uppercase outline-none focus:border-ring"
                    aria-label="Selected scene kicker"
                  />
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Title
                </label>
                <div className="flex items-start gap-1.5">
                  <Type className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                  <textarea
                    value={selectedScene.title}
                    onChange={(e) =>
                      editSceneField(selectedScene.id, "title", e.target.value)
                    }
                    placeholder="Scene title"
                    rows={2}
                    className="w-full resize-none rounded border bg-background px-2 py-1 text-sm outline-none focus:border-ring"
                    aria-label="Selected scene title"
                  />
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Subtitle
                </label>
                <div className="flex items-start gap-1.5">
                  <AlignLeft className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                  <textarea
                    value={selectedScene.subtitle}
                    onChange={(e) =>
                      editSceneField(
                        selectedScene.id,
                        "subtitle",
                        e.target.value,
                      )
                    }
                    placeholder="Subtitle / takeaway"
                    rows={2}
                    className="w-full resize-none rounded border bg-background px-2 py-1 text-xs text-muted-foreground outline-none focus:border-ring"
                    aria-label="Selected scene subtitle"
                  />
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Image asset
                </label>
                <div className="flex items-center gap-1.5">
                  <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={selectedScene.imageKey ?? ""}
                    onChange={(e) =>
                      editSceneField(
                        selectedScene.id,
                        "imageKey",
                        e.target.value || null,
                      )
                    }
                    list="video-image-options"
                    placeholder="Asset name (optional)"
                    className="h-7 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-[11px] outline-none focus:border-ring"
                    aria-label="Selected scene image"
                  />
                  <datalist id="video-image-options">
                    {Object.keys(images).map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  {selectedScene.imageKey && images[selectedScene.imageKey] ? (
                    // Object URL from the file the author just picked: next/image
                    // has to fetch and measure a real URL, so it cannot help here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={images[selectedScene.imageKey]}
                      alt=""
                      className="size-7 shrink-0 rounded border object-cover"
                    />
                  ) : (
                    <span className="size-7 shrink-0 rounded border border-dashed bg-muted/40 text-[9px] grid place-items-center text-muted-foreground/50">
                      img
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Duration
                  </label>
                  <span className="font-mono text-[11px] tabular-nums text-foreground">
                    {selectedScene.duration.toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={0.5}
                  value={selectedScene.duration}
                    onChange={(e) =>
                      editSceneField(
                        selectedScene.id,
                        "duration",
                        Math.max(1, Number(e.target.value) || 1),
                      )
                    }

                  className="w-full accent-foreground"
                  aria-label="Selected scene duration slider"
                />
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>1s</span>
                  <select
                    value={selectedScene.imageFit}
                    onChange={(e) =>
                      editSceneField(
                        selectedScene.id,
                        "imageFit",
                        e.target.value as ImageFit,
                      )
                    }
                    className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
                    aria-label="How the scene image fills the frame"
                  >
                    {IMAGE_FITS.map((fit) => (
                      <option key={fit} value={fit}>
                        {fit}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedScene.transition}
                    onChange={(e) =>
                      editSceneField(
                        selectedScene.id,
                        "transition",
                        e.target.value as Transition,
                      )
                    }
                    className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
                    aria-label="Selected scene transition"
                  >
                    {TRANSITIONS.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.label}
                      </option>
                    ))}
                  </select>
                  <span>20s</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Mic className="size-3.5 text-primary" />
                  Narration
                </label>
                <div className="flex items-start gap-1.5">
                  <textarea
                    value={selectedScene.narration}
                    onChange={(e) =>
                      editSceneField(
                        selectedScene.id,
                        "narration",
                        e.target.value,
                      )
                    }
                    placeholder="The line this scene speaks, also used to time the subtitles"
                    rows={3}
                    className="w-full resize-none rounded border bg-background px-2 py-1 text-[11px] text-muted-foreground outline-none focus:border-ring"
                    aria-label="Selected scene narration"
                  />
                  {narrationSeconds > 0 && (
                    <button
                      type="button"
                      onClick={fitDurationToNarration}
                      className="mt-1 inline-flex shrink-0 items-center gap-1 rounded border bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:border-ring"
                      title={`Set this scene to ${narrationSeconds}s, the estimated length of the line plus a pause at each edge`}
                    >
                      <Wand2 className="size-3" />
                      Fit to {narrationSeconds}s
                    </button>
                  )}
                </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Braces className="size-3.5 text-primary" />
                    Code snippet
                  </label>
                  {selectedScene.code && (
                    <button
                      type="button"
                      onClick={() =>
                        editSceneField(selectedScene.id, "code", null)
                      }
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Remove the snippet and show the title card again"
                    >
                      <Trash2 className="size-3" />
                      Clear
                    </button>
                  )}
                </div>

                {selectedScene.code ? (
                  <>
                    <textarea
                      value={selectedScene.code.source}
                      onChange={(e) =>
                        editSceneCode(
                          selectedScene.id,
                          { source: e.target.value },
                          `${selectedScene.id}:code.source`,
                        )
                      }
                      placeholder="Paste the lines this scene shows"
                      rows={7}
                      spellCheck={false}
                      className="w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-ring"
                      aria-label="Selected scene code snippet"
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      <select
                        value={selectedScene.code.language}
                        onChange={(e) =>
                          editSceneCode(
                            selectedScene.id,
                            { language: e.target.value },
                            `${selectedScene.id}:code.language`,
                          )
                        }
                        className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
                        aria-label="Snippet language"
                      >
                        {CODE_LANGUAGES.map((language) => (
                          <option key={language} value={language}>
                            {language}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedScene.code.theme}
                        onChange={(e) =>
                          editSceneCode(
                            selectedScene.id,
                            { theme: e.target.value },
                            `${selectedScene.id}:code.theme`,
                          )
                        }
                        className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
                        aria-label="Snippet palette"
                      >
                        {CODE_PANEL_THEMES.map((theme) => (
                          <option key={theme.id} value={theme.id}>
                            {theme.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedScene.code.reveal}
                        onChange={(e) =>
                          editSceneCode(
                            selectedScene.id,
                            { reveal: e.target.value as CodeReveal },
                            `${selectedScene.id}:code.reveal`,
                          )
                        }
                        className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
                        aria-label="How the snippet appears"
                      >
                        {CODE_REVEALS.map((reveal) => (
                          <option key={reveal} value={reveal}>
                            {CODE_REVEAL_LABELS[reveal]}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedScene.code.mode ?? "single"}
                        onChange={(e) =>
                          editSceneCode(
                            selectedScene.id,
                            { mode: e.target.value as CodeMode },
                            `${selectedScene.id}:code.mode`,
                          )
                        }
                        className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
                        aria-label="Snippet mode"
                      >
                        {SCENE_CODE_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode === "diff" ? "Diff" : "Single"}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        Size
                        <input
                          type="range"
                          min={CODE_SCALE_MIN}
                          max={CODE_SCALE_MAX}
                          step={0.1}
                          value={selectedScene.code.scale}
                          onChange={(e) =>
                            editSceneCode(
                              selectedScene.id,
                              { scale: Number(e.target.value) },
                              `${selectedScene.id}:code.scale`,
                            )
                          }
                          className="h-1 w-16 accent-primary"
                          aria-label="Snippet font size"
                        />
                      </label>
                    </div>
                    {selectedScene.code.mode === "diff" && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          aria-label="Use previous scene code as base"
                          onClick={() => {
                            if (previousSceneCodeSource === null) return;
                            editSceneCode(
                              selectedScene.id,
                              { base: previousSceneCodeSource },
                              `${selectedScene.id}:code.base`,
                            );
                            setStatus(
                              `Diff base filled from scene ${selectedSceneIndex} — the code as it stood before this scene.`,
                            );
                          }}
                          disabled={previousSceneCodeSource === null}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                          title={
                            previousSceneCodeSource === null
                              ? "The previous scene has no code to reuse"
                              : `Copy scene ${selectedSceneIndex}'s code as the "before" half of this diff`
                          }
                        >
                          <CornerUpLeft className="size-3" />
                          Use previous scene code as base
                        </button>
                        <textarea
                          value={selectedScene.code.base ?? ""}
                          onChange={(e) =>
                            editSceneCode(
                              selectedScene.id,
                              { base: e.target.value },
                              `${selectedScene.id}:code.base`,
                            )
                          }
                          placeholder="Paste the code as it was BEFORE this scene's change"
                          rows={5}
                          spellCheck={false}
                          className="w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground outline-none focus:border-ring"
                          aria-label="Code before the change (diff base)"
                        />
                      </div>
                    )}
                    <CalloutRows
                      callouts={selectedScene.code.callouts ?? {}}
                      focus={selectedScene.code.focus ?? []}
                      lineCount={selectedScene.code.source.split("\n").length}
                      onChange={(callouts, focus) =>
                        editSceneCode(
                          selectedScene.id,
                          { callouts, focus },
                          `${selectedScene.id}:code.teach`,
                        )
                      }
                    />
                    {selectedScene.code.mode === "diff" && (
                      <p className="text-[10px] text-muted-foreground">
                        Callouts and focus target diff rows: added lines count
                        before removed ones.
                      </p>
                    )}
                    <div className="rounded border bg-muted/20 p-1.5">
                      <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <SquareTerminal className="size-3 text-primary" />
                        Terminal output
                      </label>
                      <input
                        type="text"
                        value={selectedScene.terminal?.title ?? ""}
                        onChange={(e) =>
                          editSceneTerminal(selectedScene.id, { title: e.target.value })
                        }
                        placeholder="node demo.ts"
                        className="mt-1 w-full rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground outline-none focus:border-ring"
                        aria-label="Terminal window title"
                      />
                      <textarea
                        value={(selectedScene.terminal?.output ?? []).join("\n")}
                        onChange={(e) =>
                          editSceneTerminal(selectedScene.id, {
                            output: e.target.value.split("\n"),
                          })
                        }
                        placeholder="One output line per row — printed one by one as the scene plays"
                        rows={4}
                        spellCheck={false}
                        className="mt-1 w-full resize-y rounded border bg-background px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-ring"
                        aria-label="Terminal output lines"
                      />
                      {selectedScene.terminal &&
                        selectedScene.terminal.output.some((l) => l.trim() !== "") && (
                          <button
                            type="button"
                            onClick={() =>
                              editSceneField(selectedScene.id, "terminal", null)
                            }
                            className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="Remove the terminal card from this scene's frame"
                          >
                            <Trash2 className="size-3" />
                            Clear terminal
                          </button>
                        )}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      // One commit, not two: showing code for the first time
                      // also resets any terminal remnant in the same step.
                      applyToScene(selectedScene.id, {
                        code: {
                          source: "",
                          language: "typescript",
                          theme: DEFAULT_CODE_THEME,
                          reveal: "all",
                          scale: 1,
                          callouts: {},
                          focus: [],
                          mode: "single",
                          base: "",
                        },
                        terminal: null,
                      })
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-foreground/20 px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                  >
                    <Braces className="size-3.5" />
                    Show code on this scene
                  </button>
                )}
              </div>

                <div className="rounded border bg-muted/30 p-1.5">
                  <div className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <AudioLines className="size-3 text-primary" />
                    Voice-over audio
                  </div>
                  <div
                    className={cn(
                      "mt-1.5 rounded border border-dashed px-2 py-2 text-center transition-colors",
                      audioDropId === selectedScene.id
                        ? "border-sky-500 bg-sky-500/10"
                        : "border-foreground/20",
                    )}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes("Files")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setAudioDropId(selectedScene.id);
                    }}
                    onDragLeave={() =>
                      setAudioDropId((id) => (id === selectedScene.id ? null : id))
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAudioDropId(null);
                      const file = e.dataTransfer.files?.[0];
                      if (file) void attachAudio(selectedScene.id, file);
                    }}
                  >
                    {selectedScene.audio ? (
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1 text-left">
                          <p className="truncate text-[11px] font-medium text-foreground">
                            {selectedScene.audio.name}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {formatAudioDuration(selectedScene.audio.duration)} ·{" "}
                            {(selectedScene.audio.bytes / 1024).toFixed(0)} KB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            editSceneField(
                              selectedScene.id,
                              "muted",
                              !selectedScene.muted,
                            )
                          }
                          className={cn(
                            "shrink-0 rounded border p-1 transition-colors hover:border-ring",
                            selectedScene.muted
                              ? "border-amber-500 bg-amber-500/10 text-amber-600"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          title={
                            selectedScene.muted
                              ? "Unmute this scene's clip"
                              : "Mute this scene's clip without removing it"
                          }
                          aria-label={
                            selectedScene.muted
                              ? "Unmute this scene's audio"
                              : "Mute this scene's audio"
                          }
                          aria-pressed={selectedScene.muted}
                        >
                          {selectedScene.muted ? (
                            <VolumeX className="size-3" />
                          ) : (
                            <Volume2 className="size-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => detachAudio(selectedScene.id)}
                          className="shrink-0 rounded border p-1 text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                          title="Remove this audio"
                          aria-label="Remove this audio"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">
                        {audioBusyId === selectedScene.id
                          ? "Reading file…"
                          : "Drop an audio file here, or pick one"}
                      </p>
                    )}
                    <input
                      type="file"
                      accept={AUDIO_ACCEPT}
                      className="hidden"
                      aria-label="Choose an audio file for this scene"
                      ref={(el) => {
                        if (el) audioInputRefs.current.set(selectedScene.id, el);
                        else audioInputRefs.current.delete(selectedScene.id);
                      }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void attachAudio(selectedScene.id, file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        audioInputRefs.current.get(selectedScene.id)?.click()
                      }
                      disabled={audioBusyId === selectedScene.id}
                      className="mt-1.5 inline-flex h-6 items-center gap-1 rounded border bg-primary/10 px-2 text-[10px] font-medium text-primary transition-colors hover:border-ring disabled:opacity-50"
                    >
                      <Upload className="size-3" />
                      {selectedScene.audio ? "Replace audio" : "Choose audio"}
                    </button>
                  </div>
                  {selectedScene.audio && !selectedScene.muted && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Volume2 className="size-3 shrink-0 text-muted-foreground" />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedScene.volume}
                        onChange={(e) =>
                          editSceneField(
                            selectedScene.id,
                            "volume",
                            Math.min(1, Math.max(0, Number(e.target.value))),
                          )
                        }
                        className="w-full accent-foreground"
                        aria-label="Selected scene voice-over volume"
                      />
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                        {Math.round(selectedScene.volume * 100)}%
                      </span>
                    </div>
                  )}
                  <p className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">
                    A clip longer than the scene stretches it to fit. MP3, WAV,
                    M4A, OGG, Opus or FLAC, up to 100 MB.
                  </p>
                </div>

                {/* Notes live at the end of the inspector, below the things
                    that change the video. They are the one field that changes
                    nothing, and putting them last is what keeps them from
                    being mistaken for a script field. */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <StickyNote className="size-3.5 text-primary" />
                    Notes
                    <span className="ml-auto font-mono text-[9px] font-normal normal-case text-muted-foreground/70">
                      {selectedScene.notes.length}/{NOTES_MAX}
                    </span>
                  </label>
                  <textarea
                    value={selectedScene.notes}
                    onChange={(e) =>
                      editSceneField(selectedScene.id, "notes", e.target.value)
                    }
                    placeholder="Cut notes, ideas, take numbers. Never spoken and never exported."
                    rows={3}
                    maxLength={NOTES_MAX}
                    className="w-full resize-none rounded border bg-background px-2 py-1 text-[11px] outline-none focus:border-ring"
                    aria-label="Selected scene notes"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              Add a scene below to start editing it here.
            </div>
          )}

          {/* Wraps on purpose. The export control is two buttons that refuse to
              shrink, so in a narrow inspector the row used to run past the edge
              and the download button was simply not there. A second line is
              cheaper than a control the author cannot find. */}
          <div className="flex flex-wrap items-center gap-1 border-t p-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1 text-xs"
              title="Add a new scene at the end"
              onClick={addScene}
            >
              <Plus className="size-3.5" />
              Add scene
            </Button>
            <Button
              variant={subtitlesOn ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => setSubtitlesOn((v) => !v)}
              disabled={subtitleCues.length === 0}
              title={
                subtitleCues.length === 0
                  ? "Add narration to a scene to get subtitles"
                  : subtitlesOn
                    ? "Hide the burned-in subtitles"
                    : "Show the burned-in subtitles"
              }
              aria-pressed={subtitlesOn}
            >
              <Captions className="size-3.5" />
              Subs
            </Button>
            <SubtitleStylePicker
              value={subtitleStyleId}
              onChange={setSubtitleStyleId}
              disabled={!subtitlesOn}
            />
            <ExportHub
              targets={hubTargets}
              defaultId="mp4"
              className="ml-1"
              onCancel={cancelExport}
            />
          </div>
        </div>

        {/* Divider. Only in the side-by-side layout: stacked, the two panes are
            already full width and there is nothing to divide. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the inspector"
          aria-valuenow={inspectorWidth}
          aria-valuemin={INSPECTOR_WIDTH_MIN}
          aria-valuemax={INSPECTOR_WIDTH_MAX}
          tabIndex={0}
          onPointerDown={onInspectorPointerDown}
          onPointerMove={onInspectorPointerMove}
          onPointerUp={onInspectorPointerUp}
          onPointerCancel={onInspectorPointerUp}
          onKeyDown={onInspectorKeyDown}
          onDoubleClick={() => setInspector(INSPECTOR_WIDTH_DEFAULT, true)}
          title="Drag to give the film more room, or double-click to reset"
          className={cn(
            "hidden w-1 shrink-0 touch-none items-center justify-center transition-colors hover:bg-foreground/20 lg:flex",
            resizing && "bg-foreground/30",
          )}
        >
          <span className="h-8 w-0.5 rounded-full bg-foreground/25" />
        </div>

        {/* Preview + transport. This is the fullscreen target so the scrubber
            and the play controls stay reachable while watching. */}
        <div
          ref={stageRef}
          className={cn(
            "flex min-h-0 flex-col bg-zinc-950 lg:min-w-0 lg:flex-1",
            isFullscreen && "video-fullscreen",
          )}
        >
          <div
            className={cn(
              "flex flex-1 items-center justify-center overflow-auto p-4",
              // The stage padding exists to breathe in the docked layout; in
              // fullscreen the canvas should own the whole viewport.
              isFullscreen && "p-0",
            )}
          >
            <div className="relative size-full min-h-0 max-w-full">
              {activeScene && (
                <span className="absolute top-2 left-2 z-10 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                  Scene {activeSceneIndex + 1} · {activeScene.kicker || `Clip ${activeSceneIndex + 1}`}
                </span>
              )}
              <span className="absolute top-2 right-2 z-10 rounded bg-black/60 px-2 py-0.5 font-mono text-[10px] text-zinc-300 shadow">
                {resolutionLabel} · {portrait ? "9:16" : "16:9"}
              </span>
              <canvas
                ref={canvasRef}
                width={w}
                height={h}
                className={cn(
                  "mx-auto block h-full max-h-full w-auto max-w-full border border-white/10 shadow-2xl",
                )}
              />
            </div>
          </div>

          <div className="border-t border-white/10 bg-zinc-900">
            <div className="flex items-center gap-3 px-4 pt-3">
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-300">
                {formatTime(playhead)}
              </span>              <input
                type="range"
                min={0}
                max={Math.max(0.1, totalDuration)}
                step={0.05}
                value={Math.min(playhead, totalDuration)}
                onChange={(e) => seekTo(Number(e.target.value))}
                onPointerDown={() => {
                  if (!pausedAtRef.current) pausedAtRef.current = playhead;
                }}
                className="video-scrub w-full"
                aria-label="Seek through the video"
              />
              <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-zinc-500">
                {formatTime(totalDuration)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="mr-auto flex items-center gap-2 text-xs text-zinc-400">
                <Clapperboard className="size-3.5" />
                <span>{scenes.length} scenes</span>
                <span aria-hidden>·</span>
                <span>{totalDuration.toFixed(1)}s total</span>
                {activeScene && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="flex items-center gap-1">
                      <span className="size-2 rounded-full bg-emerald-400" />
                      Scene {activeSceneIndex + 1}
                    </span>
                  </>
                )}
              </div>
              {/* Playback niceties. These live with the transport rather than
                  the inspector because they are things you flip while
                  watching, not settings you set once. */}
              <div className="flex items-center gap-1">
                <Button
                  onClick={toggleLoop}
                  variant={loop ? "secondary" : "ghost"}
                  size="sm"
                  className="text-zinc-300 hover:bg-white/10 hover:text-white"
                  disabled={scenes.length === 0}
                  title={
                    loopSection
                      ? `Loop: repeats the “${loopSection.group}” section (${formatTime(loopWindow.start)}–${formatTime(loopWindow.end)})`
                      : loop
                        ? "Loop: when the preview reaches the end it starts over"
                        : "Loop: repeats the selected section, or the whole timeline"
                  }
                  aria-pressed={loop}
                >
                  <Repeat className="size-3.5" />
                  Loop
                  {loop && loopSection && (
                    <span className="max-w-24 truncate font-mono text-[0.7rem] text-emerald-300">
                      {loopSection.group}
                    </span>
                  )}
                </Button>
                <select
                  value={playbackRate}
                  onChange={(e) => {
                    stopShuttle();
                    setRate(Number(e.target.value));
                  }}
                  className="h-7 rounded-md border border-white/10 bg-black/40 px-1.5 font-mono text-[0.8rem] text-zinc-200"
                  title="Preview speed — exports always render at 1x"
                  aria-label="Preview speed"
                >
                  {PLAYBACK_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}x
                    </option>
                  ))}
                </select>
              </div>
              {status && (
          // data-export-status so the cancel probe can read the line. The status
          // is the only place the export reports what it is doing, so anything
          // testing that behaviour needs a handle on it.
          <span data-export-status className="text-xs text-emerald-400">
            {status}
          </span>
        )}
              {playing ? (
                <Button onClick={pause} variant="secondary" size="sm">
                  {/* Bars, not a square: the filled square belongs to Stop, and
                      showing it on both made the pair impossible to tell apart. */}
                  <Pause className="size-3.5" />
                  Pause
                </Button>
              ) : playhead > 0 && playhead < totalDuration ? (
                <Button onClick={resume} size="sm">
                  <Play className="size-3.5" />
                  Resume
                </Button>
              ) : (
                <Button onClick={() => void play()} size="sm">
                  <Play className="size-3.5" />
                  Preview
                </Button>
              )}
              <div className="flex items-center gap-0.5">
                <Button
                  onClick={undoScenes}
                  variant="ghost"
                  size="sm"
                  className="text-zinc-300 hover:bg-white/10 hover:text-white"
                  disabled={!canUndoScenes}
                  title="Undo the last change to the timeline"
                  aria-label="Undo"
                >
                  <Undo2 className="size-3.5" />
                </Button>
                <Button
                  onClick={redoScenes}
                  variant="ghost"
                  size="sm"
                  className="text-zinc-300 hover:bg-white/10 hover:text-white"
                  disabled={!canRedoScenes}
                  title="Redo"
                  aria-label="Redo"
                >
                  <Redo2 className="size-3.5" />
                </Button>
              </div>
              <Button
                onClick={stopPlayback}
                variant="ghost"
                size="sm"
                // The ghost variant sets no colour of its own, so on this dark
                // bar it inherited the app's near-black foreground and vanished.
                // Its neighbours here all declare a colour; this one has to too.
                className="text-zinc-300 hover:bg-white/10 hover:text-white"
                disabled={!playing && playhead === 0}
              >
                <Square className="size-3.5" />
                Stop
              </Button>
              <Button
                onClick={splitSelectedScene}
                variant="ghost"
                size="sm"
                className="text-zinc-300 hover:bg-white/10 hover:text-white"
                disabled={!selectedScene}
                title="Cut the selected scene in two at the playhead. The second half starts silent."
              >
                <Scissors className="size-3.5" />
                Split
              </Button>
              <label
                className={cn(
                  "flex h-7 cursor-pointer select-none items-center gap-1.5 rounded px-2 text-[0.8rem]",
                  sectionOnly ? "text-zinc-100" : "text-zinc-400",
                )}
                title={
                  sectionOnly
                    ? `Exporting only "${selectedScene?.group ?? "this scene"}". Click to export the whole timeline.`
                    : "Export the whole timeline. Click to export only the selected scene's section."
                }
              >
                <input
                  type="checkbox"
                  checked={sectionOnly}
                  onChange={(e) => setSectionOnly(e.target.checked)}
                  className="size-3 accent-amber-500"
                />
                This section only
              </label>
              <Button
                onClick={toggleFullscreen}
                variant={isFullscreen ? "secondary" : "outline"}
                size="sm"
                className="ml-auto"
                title={
                  fullscreenBlocked
                    ? "This browser does not allow fullscreen here"
                    : isFullscreen
                      ? "Exit fullscreen (F or Esc)"
                      : "Fullscreen preview (F)"
                }
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize className="size-3.5" />
                ) : (
                  <Maximize className="size-3.5" />
                )}
                {isFullscreen ? "Exit" : "Fullscreen"}
              </Button>
            </div>
            {isFullscreen && (
              <p className="px-4 pb-2 text-[10px] text-zinc-500">
                <kbd className="font-mono">F</kbd> fullscreen ·{" "}
                <kbd className="font-mono">Space</kbd> play/pause ·{" "}
                <kbd className="font-mono">←</kbd>/
                <kbd className="font-mono">→</kbd> seek 5s ·{" "}
                <kbd className="font-mono">Esc</kbd> exit
              </p>
            )}
          </div>
        </div>
      </div>

      {/* CapCut-style timeline */}
      <div className="border-t bg-muted/30">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Timeline
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatTime(playhead)} / {formatTime(totalDuration)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleBatchMode}
              aria-pressed={batchMode}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                batchMode
                  ? "bg-amber-500 text-background"
                  : "border border-foreground/15 text-muted-foreground hover:text-foreground",
              )}
              aria-label="Batch edit scenes"
              title="Restyle several scenes at once — palettes, transitions, durations"
            >
              Batch edit
            </button>
            <span className="text-[11px] text-muted-foreground">
              Click a clip to edit · ↑/↓ reorder
            </span>
            <div
              className="flex items-center gap-0.5 rounded border border-foreground/15 bg-background p-0.5"
              role="group"
              aria-label="Timeline zoom"
            >
              {TIMELINE_ZOOM_LEVELS.map((zoom) => (
                <button
                  key={zoom}
                  type="button"
                  onClick={() => setTimelineZoom(zoom)}
                  aria-pressed={timelineZoom === zoom}
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors",
                    timelineZoom === zoom
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {zoom}px
                </button>
              ))}
            </div>
          </div>
        </div>
        {batchMode && (
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-amber-500/5 px-3 py-1.5">
            <span
              className="font-mono text-[10px] font-semibold tabular-nums text-foreground"
              aria-live="polite"
            >
              {batchSelection.size} selected
            </span>
            <button
              type="button"
              onClick={() =>
                setBatchSelection((prev) =>
                  prev.size === scenes.length
                    ? new Set()
                    : new Set(scenes.map((s) => s.id)),
                )
              }
              className="rounded border border-foreground/20 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Select all scenes for batch edit"
            >
              {batchSelection.size === scenes.length ? "Deselect all" : "Select all"}
            </button>
            <select
              value={batchTheme}
              onChange={(e) => setBatchTheme(e.target.value)}
              className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
              aria-label="Batch snippet palette"
            >
              <option value="">Theme (keep)</option>
              {CODE_PANEL_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
            <select
              value={batchTransition}
              onChange={(e) => setBatchTransition(e.target.value)}
              className="h-5 rounded border bg-background px-1 text-[10px] outline-none focus:border-ring"
              aria-label="Batch scene transition"
            >
              <option value="">Transition (keep)</option>
              {TRANSITIONS.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={batchDuration}
              onChange={(e) => setBatchDuration(e.target.value)}
              placeholder="Duration (s)"
              min={1}
              max={20}
              step={0.5}
              className="h-5 w-20 rounded border bg-background px-1 font-mono text-[10px] tabular-nums outline-none focus:border-ring"
              aria-label="Batch scene duration in seconds"
            />
            <button
              type="button"
              onClick={applyBatchEdit}
              disabled={batchSelection.size === 0}
              className="rounded bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background transition-opacity disabled:opacity-40"
              aria-label="Apply batch edit to selected scenes"
              title="One undo step covers the whole batch"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setBatchMode(false);
                setBatchSelection(new Set());
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Exit batch edit"
            >
              Done
            </button>
          </div>
        )}
        <div
          ref={timelineScrollRef}
          className="relative overflow-x-auto"
          onScroll={() => {
            // A manual scroll beats the follow: the author is looking at a
            // region, not chasing the needle. Skip the scroll our own
            // recenter causes, which would otherwise switch the follow off
            // one frame after every jump.
            if (recenteredRef.current) return;
            setFollowPlayhead(false);
          }}
        >
          <div className="relative min-w-max p-2">
            {/* Ruler: the whole row scrubs, the ticks are time marks and the
                cut markers jump to a boundary. */}
            <div
              data-ruler
              onPointerDown={onRulerPointerDown}
              className="relative h-5 cursor-col-resize touch-none select-none"
              role="slider"
              aria-label="Timeline ruler"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalDuration * 1000)}
              aria-valuenow={Math.round(playhead * 1000)}
              style={{ width: timeline.width }}
            >
              {rulerTicksMemo.map((tick) => (
                <div
                  key={tick.t}
                  className={cn(
                    "absolute bottom-0 -translate-x-1/2",
                    tick.major ? "h-3" : "h-1.5",
                  )}
                  style={{ left: tick.x }}
                >
                  <div
                    className={cn(
                      "w-px",
                      tick.major ? "bg-foreground/60" : "bg-foreground/25",
                    )}
                  />
                  {tick.label && (
                    <div className="absolute -top-1 -translate-x-1/2 font-mono text-[8px] tabular-nums text-muted-foreground">
                      {tick.label}
                    </div>
                  )}
                </div>
              ))}
              {cutMarks.map((mark) => (
                <button
                  key={mark.t}
                  type="button"
                  onClick={() => {
                    seekTo(mark.t);
                    setSelectedId(mark.id);
                  }}
                  className="group absolute bottom-0 z-10 -translate-x-1/2 px-0.5"
                  style={{ left: mark.x }}
                  aria-label={`Cut at ${formatTimelineTime(mark.t)}`}
                  title={`Cut at ${formatTimelineTime(mark.t)} · click to jump`}
                >
                  <div className="size-0 border-x-[3px] border-b-[5px] border-x-transparent border-b-amber-500 transition-transform group-hover:scale-125" />
                </button>
              ))}
            </div>
            {/* Playhead needle: rides the same scale as the cards below. */}
            <div
              data-needle
              className="pointer-events-none absolute top-0 bottom-0 z-20 flex -translate-x-1/2 flex-col items-center"
              style={{ left: needleX }}
            >
              <div className="h-2 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-emerald-500" />
              <div className="h-2" />
              <div className="w-px flex-1 bg-emerald-500" />
            </div>
            <div className="mt-0.5 flex items-stretch gap-0.5">
            {scenes.map((scene, i) => {
              const clip = timeline.clips[i]!;
              const start = clip.start;
              const width = clip.width;
              const isActive = i === activeSceneIndex;
              // Group header sits before the first scene of each run.
              const groupLabel = scene.group?.trim() || null;
              const startsGroup =
                groupLabel !== null &&
                (i === 0 || (scenes[i - 1]?.group?.trim() || null) !== groupLabel);
              return (
                <div
                  key={scene.id}
                  draggable
                  onDragStart={(e) => {
                    // Carries the scene id, not the group: moveRunTo resolves the
                    // run from it, so a card in a section drags the whole section.
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(DRAG_SCENE_TYPE, scene.id);
                    setDraggingId(scene.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropTargetId(null);
                  }}
                  onDragOver={(e) => {
                    const isSceneDrag = e.dataTransfer.types.includes(DRAG_SCENE_TYPE);
                    if (!isSceneDrag && !e.dataTransfer.types.includes("Files")) {
                      return;
                    }
                    e.preventDefault();
                    e.dataTransfer.dropEffect = isSceneDrag ? "move" : "copy";
                    setDropTargetId(scene.id);
                  }}
                  onDragLeave={() =>
                    setDropTargetId((id) => (id === scene.id ? null : id))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTargetId(null);
                    const dragged = e.dataTransfer.getData(DRAG_SCENE_TYPE);
                    if (dragged) {
                      // Dropping on the first half of a card means "before this
                      // scene"; on the second half, "after". The two halves are
                      // often the same scene, so position decides.
                      const rect = e.currentTarget.getBoundingClientRect();
                      const after = e.clientX > rect.left + rect.width / 2;
                      reorderTo(dragged, after ? i + 1 : i);
                      return;
                    }
                    const file = e.dataTransfer.files?.[0];
                  if (file) dropSceneFile(scene.id, file);
                }}
                className={cn(
                  "group relative flex shrink-0 flex-col overflow-hidden rounded border bg-background shadow-sm transition-colors",
                  draggingId === scene.id && "opacity-40",
                  dropTargetId === scene.id
                    ? "border-sky-500 ring-2 ring-sky-500"
                    : selectedScene?.id === scene.id
                      ? "border-amber-500 ring-1 ring-amber-500"
                      : isActive
                        ? "border-emerald-500"
                        : "border-transparent hover:border-foreground/30",
                )}
                style={{ width }}
              >
                {startsGroup && (
                  <span
                    // Pinned inside the card rather than hung above it with
                    // -translate-y-full: this strip scrolls inside an
                    // overflow-x-auto box, so anything that escapes the card's
                    // box gets clipped by the scroller and the label vanishes
                    // for exactly the runs that are long enough to scroll.
                    // Stops short of the action row on the right. The label
                    // outranks the buttons, so a long section name would
                    // otherwise paint over them and swallow the clicks meant
                    // for delete.
                    className="absolute top-0 left-0 z-10 max-w-[calc(100%-5.5rem)] truncate bg-foreground/85 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-background backdrop-blur-sm"
                    title={`Section: ${groupLabel}`}
                  >
                    {groupLabel}
                  </span>
                )}
                {dropTargetId === scene.id && (
                  <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-sky-500/90 text-[10px] font-semibold text-white">
                    <Upload className="size-4" />
                    Drop to apply
                  </div>
                )}
                {/* A dot, not the note itself. The card is the place you scan
                    to find the scene that still needs work, so the only thing
                    that has to be visible from the strip is *that* a scene has
                    a note; the text belongs in the inspector where there is
                    room to read it. */}
                {scene.notes.trim().length > 0 && (
                  <span
                    className="absolute top-1 left-1 z-10 size-1.5 rounded-full bg-amber-400 ring-1 ring-black/40"
                    title={`Notes: ${scene.notes.trim().slice(0, 120)}`}
                  />
                )}
                {batchMode && (
                  <button
                    type="button"
                    onClick={() => toggleBatchScene(scene.id)}
                    className="absolute top-1 right-1 z-10 grid size-4 place-items-center rounded-sm border border-foreground/30 bg-background/90 transition-colors hover:border-foreground/60"
                    style={
                      batchSelection.has(scene.id)
                        ? { borderColor: "transparent", backgroundColor: "#f59e0b" }
                        : undefined
                    }
                    aria-pressed={batchSelection.has(scene.id)}
                    aria-label={`Select scene ${i + 1} for batch edit`}
                    title="Toggle this scene in the batch selection"
                  >
                    {batchSelection.has(scene.id) ? (
                      <Check className="size-3 text-background" strokeWidth={3} />
                    ) : null}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(scene.id);
                    if (playing) playFrom(i);
                    else seekTo(start);
                  }}
                  className="flex flex-col items-stretch"
                  aria-label={`Select scene ${i + 1}`}
                >
                  <div className="h-16 shrink-0">
                    <div className="relative size-full">
                      <TimelineThumb
                        scene={scene}
                        portrait={portrait}
                        brand={brand}
                        imageSrc={
                          scene.imageKey ? images[scene.imageKey] : undefined
                        }
                      />
                      {isActive && playing && scene.duration > 0 && (
                        <div
                          className="absolute bottom-0 left-0 h-0.5 bg-emerald-400"
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(
                                100,
                                ((playhead - start) / scene.duration) * 100,
                              ),
                            )}%`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {scene.audio && scene.audio.peaks.length > 0 && (
                    <div className="border-t bg-background px-0 py-0.5">
                      <ClipWaveform
                        peaks={scene.audio.peaks}
                        audioDuration={scene.audio.duration}
                        sceneDuration={scene.duration}
                        muted={scene.muted}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-1 border-t bg-background px-2 py-1">
                    <GripVertical className="size-3 shrink-0 text-muted-foreground" />
                    {/* flex-1 min-w-0 is what makes the truncate bite: without
                        the min-w-0 this span keeps its intrinsic width and
                        shoves the duration off the end of the card instead. */}
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold uppercase text-foreground">
                      {scene.kicker || `Scene ${i + 1}`}
                    </span>
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                      {scene.duration.toFixed(0)}s
                    </span>
                  </div>
                  <div className="border-t bg-background px-2 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                    {formatTime(start)}–{formatTime(start + scene.duration)}
                    {isActive && (
                      <span className="ml-1 font-semibold text-emerald-500">
                        ◉
                      </span>
                    )}
                  </div>
                </button>
                <div className="absolute top-1 right-1 z-30 hidden gap-0.5 rounded bg-black/75 p-0.5 group-hover:flex group-focus-within:flex">
                  <button
                    type="button"
                    onClick={() => moveScene(scene.id, -1)}
                    disabled={!canMoveSceneStep(scenes, scene.id, -1)}
                    className="rounded p-0.5 text-zinc-300 hover:text-white disabled:opacity-30"
                    aria-label={
                      scene.group
                        ? `Move the ${scene.group} section left`
                        : "Move scene left"
                    }
                    title={
                      scene.group
                        ? `Moves the whole "${scene.group}" section`
                        : "Move this scene one step left"
                    }
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveScene(scene.id, 1)}
                    disabled={!canMoveSceneStep(scenes, scene.id, 1)}
                    className="rounded p-0.5 text-zinc-300 hover:text-white disabled:opacity-30"
                    aria-label={
                      scene.group
                        ? `Move the ${scene.group} section right`
                        : "Move scene right"
                    }
                    title={
                      scene.group
                        ? `Moves the whole "${scene.group}" section`
                        : "Move this scene one step right"
                    }
                  >
                    <ArrowDown className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateScene(scene.id)}
                    className="rounded p-0.5 text-zinc-300 hover:text-white"
                    aria-label="Duplicate scene"
                  >
                    <Copy className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeScene(scene.id)}
                    className="rounded p-0.5 text-zinc-300 hover:text-red-400"
                    aria-label="Delete scene"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addScene}
            className="flex w-32 shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed border-muted-foreground/40 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="size-4" />
            Add clip
          </button>
          </div>
          </div>
        </div>
      </div>
      {libraryOpen && (
        <AssetLibrary
          onClose={() => setLibraryOpen(false)}
          onUse={useLibraryAsset}
        />
      )}
    </div>
  );
}
