"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Braces,
  Captions,
  CaseSensitive,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  GripVertical,
  Image as ImageIcon,
  Mic,
  Maximize,
  Minimize,
  LibraryBig,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  Redo2,
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
  SCENE_FORMAT_VERSION,
  TRANSITIONS as TRANSITION_IDS,
  normalizeFirstScene,
  normalizeScenes,
  normalizeSceneDocument,
  normalizeSceneInput,
} from "@/lib/scene-schema";
import type {
  ImageFit,
  SceneDocument,
  Transition,
  VideoScene,
} from "@/lib/scene-schema";
import { crossfadeAt, sceneStart, timeForScene } from "@/lib/scene-transition";
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
  SUBTITLE_STYLES,
  SUBTITLE_STYLE_GROUPS,
  DEFAULT_SUBTITLE_STYLE_ID,
  subtitleStyleById,
  entranceSecondsFor,
} from "@/lib/subtitles";
import type { SubtitleCue, SubtitleStyle } from "@/lib/subtitles";
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
  splitWords,
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
import type { Asset } from "@/lib/asset-library";
import {
  EXPORT_FPS,
  renderVideoToFile,
  VideoExportError,
  webCodecsProbe,
} from "@/lib/video-export";

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
 * The extension to give a clip inside the export ZIP.
 *
 * Taken from the original name where possible so the file still opens in a
 * desktop editor; the descriptor's MIME type is the fallback for a dropped
 * file whose name has no extension.
 */
function audioExtension(audio: { name: string; type: string }): string {
  const fromName = /\.[a-z0-9]{1,5}$/i.exec(audio.name)?.[0];
  if (fromName) return fromName.toLowerCase();
  const fromType = audio.type.split("/")[1]?.split(";")[0];
  if (fromType) return `.${fromType === "mpeg" ? "mp3" : fromType}`;
  return ".bin";
}

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
async function analyzeSpeech(file: File): Promise<SpeechRegion[]> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return [];
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
    return detectSpeechRegions(energy, FRAME_SECONDS, {
      totalSeconds: decoded.duration,
    });
  } catch {
    return [];
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
  imageKey: null,
  imageFit: "contain",
  duration: 4,
  transition: "fade",
  volume: 1,
  muted: false,
  audio: null,
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

function paintSubtitle(

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

  const kick = 0.34 * w;
  ctx.font = `700 ${Math.round(kick)}px "JetBrains Mono", monospace`;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [libraryOpen, setLibraryOpen] = useState(false);
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const totalDuration = useMemo(
    () => scenes.reduce((acc, s) => acc + s.duration, 0),
    [scenes],
  );

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
      let alignedByTranscript = false;
      try {
        duration = (await measureAudioDuration(file)).duration;
        // Decode a second time to find the pauses. Worth it: it is what lets
        // the subtitles follow the real voice instead of a guess.
        regions = await analyzeSpeech(file);
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
      if (!targetId) return;
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
  const playSceneAudio = useCallback(
    (idx: number) => {
      const scene = scenesRef.current[idx];
      if (!scene) return;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      stopClip();
      if (!scene.audio) {
        if (scene.narration && "speechSynthesis" in window) {
          const u = new SpeechSynthesisUtterance(scene.narration);
          u.rate = 1.02;
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
        // The clip element is shared between scenes, so the volume is set on
        // every play rather than once at creation: a quieter scene must not
        // leave the louder setting behind for the next one.
        el.volume = Math.min(1, Math.max(0, scene.volume));
        el.play().catch(() => {});
        activeClipRef.current = el;
      });
    },
    [getClip, setStatus, stopClip],
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
    const elapsed = (performance.now() - playStartRef.current) / 1000;
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

    if (elapsed >= total) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      previewOnlyRef.current = false;
      setPlaying(false);
    } else if (previewOnlyRef.current) {
      previewOnlyRef.current = false;
    } else {
      rafRef.current = requestAnimationFrame(() => frameFnRef.current());
    }
  }, [playSceneAudio, paintTimelineAt]);

  useEffect(() => {
    frameFnRef.current = renderFrame;
  }, [renderFrame]);

  // Clamp the playhead when edits shrink the total duration, and repaint the
  // preview after any change while paused — without this the canvas keeps the
  // stale frame (e.g. "Scene 1" showing mid-video after a duration edit).
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
      playStartRef.current = performance.now() - offset * 1000;
      pausedAtRef.current = offset;
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
          .reduce((acc, s) => acc + s.duration, 0) * 1000;
      playStartRef.current = performance.now() - offset;
      lastSpokenRef.current = sceneIndex - 1;
      lastEmitMsRef.current = -1;
      setPlaying(true);
      rafRef.current = requestAnimationFrame(renderFrame);
    },
    [renderFrame, stopPlayback],
  );

  const pause = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const at = Math.max(
      0,
      (performance.now() - playStartRef.current) / 1000,
    );
    pausedAtRef.current = at;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopClip();
    setPlaying(false);
  }, [stopClip]);

  const resume = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || scenesRef.current.length === 0) {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      return;
    }
    const at = pausedAtRef.current ?? 0;
    pausedAtRef.current = null;
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
    playStartRef.current = performance.now() - at * 1000;
    setPlaying(true);
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame]);

  const seekTo = useCallback(
    (t: number) => {
      const elapsed = Math.max(0, Math.min(t, totalDuration));
      pausedAtRef.current = elapsed;
      playStartRef.current = performance.now() - elapsed * 1000;
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
    [playing, renderFrame, stopClip, totalDuration],
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

    stopPlayback();
    setStatus("Preparing the audio mix…");
    try {
      const audio = await buildMixBuffer(list);
      const format = exportFormat(target);
      setStatus(`Rendering .${format.extension}…`);
      const result = await renderVideoToFile({
        target,
        canvas,
        width: canvas.width,
        height: canvas.height,
        duration: total,
        audio,
        paintFrame: (t) => paintTimelineAt(t, list),
        onProgress: (f) =>
          setStatus(`Rendering .${format.extension}… ${Math.round(f * 100)}%`),
      });

      const scope = sectionOnly ? sectionSlug(scenes, selectedId) : "";
      const base = `${fileName.trim() || "book-promo"}${scope}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(result.blob);
      a.download = `${base}.${result.extension}`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(
        result.audioDropped
          ? `Saved .${result.extension} without audio: this browser cannot encode ${format.audioCodec}.`
          : `Saved .${result.extension}${audio ? " with audio" : ""}.`,
      );
    } catch (error) {
      setStatus(
        error instanceof VideoExportError
          ? error.message
          : "The export failed for an unknown reason.",
      );
    }
  },
  [
    buildMixBuffer,
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
   */
  const play = useCallback(async () => {
    if (scenesRef.current.length === 0) return;
    stopPlayback();
    playStartRef.current = performance.now();
    lastSpokenRef.current = -1;
    setPlayhead(0);
    lastEmitMsRef.current = -1;
    setPlaying(true);
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame, stopPlayback]);

  /**
   * Transport shortcuts. They are ignored while a form control has focus, or
   * typing narration would toggle playback on every space.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
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
      if (e.key === "Home") {
        e.preventDefault();
        seekTo(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    playing,
    pause,
    play,
    playhead,
    redoScenes,
    resume,
    seekTo,
    stopPlayback,
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

  const exportCapCutPack = useCallback(async () => {
    // Scoped to the selected section when the toggle is on: the pack is a
    // sequence of stills in order, and a pack that silently starts at scene 20
    // would be a sequence with a hole in it.
    const list = scenesForExport;
    setStatus("Rendering scene frames…");
    const zip = new JSZip();
    // One still per scene, so each frame shows the first cue of its scene.
    const cues = buildTimelineCues(
      list.map((s) => ({
        narration: s.narration,
        duration: s.duration,
        regions: s.audio?.regions ?? null,
      })),
    );
    const firstCueOfScene = (index: number): SubtitleCue | null => {
      const start = list
        .slice(0, index)
        .reduce((acc, s) => acc + s.duration, 0);
      return cueAt(cues, start);
    };
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
        "Audio file",
        "Audio start (s)",
        "Audio length (s)",
        // CapCut has both a volume slider and a mute toggle per clip, so the
        // pack carries both rather than baking a decision the user cannot undo.
        "Audio volume",
        "Audio muted",
      ],
    ];
    /** Filenames of the clips actually written, so the CSV cannot point at nothing. */
    const audioFiles = new Map<number, string>();
    for (let i = 0; i < list.length; i++) {
      const scene = list[i];
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      let image: HTMLImageElement | null = null;
      const src = scene.imageKey ? images[scene.imageKey] : undefined;
      if (src) {
        try {
          image = await loadImage(src);
        } catch {
          image = null;
        }
      }
      const stillCue = subtitlesOn ? firstCueOfScene(i) : null;
      paintScene(
        ctx,
        w,
        h,
        scene,
        1,
        brand,
        image,
        stillCue,
        subtitleStyle,
        // A still has no running clock, so it has to be sampled at a moment
        // rather than at zero: the cue's own start would catch every word
        // mid-entrance and print a half-built line into the PNG. Half a second
        // in, the line is fully arrived and the first words are already being
        // spoken, which is the frame worth keeping.
        stillCue ? stillCue.start + 0.5 : 0,
      );
      const fileBase = `${String(i + 1).padStart(2, "0")}_${slugify(scene.kicker)}`;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (blob) zip.file(`scenes/${fileBase}.png`, blob);

      // The dropped clip travels with the pack so CapCut can lay it on the
      // timeline; the CSV carries its name and where it starts.
      let audioCell = "";
      let audioStart = "";
      let audioLength = "";
      if (scene.audio) {
        const clip = await getAudioClip(scene.audio.key);
        if (clip) {
          const ext = audioExtension(scene.audio);
          const audioName = `${fileBase}_${slugify(scene.audio.name)}${ext}`;
          zip.file(`audio/${audioName}`, clip);
          audioFiles.set(i, `audio/${audioName}`);
          audioCell = `audio/${audioName}`;
          audioStart = String(
            Math.round(
              list.slice(0, i).reduce((acc, s) => acc + s.duration, 0) * 100,
            ) / 100,
          );
          audioLength = String(
            Math.round(Math.min(scene.duration, scene.audio.duration) * 100) /
              100,
          );
        }
      }

      rows.push([
        String(i + 1),
        `${fileBase}.png`,
        scene.kicker,
        scene.title,
        scene.subtitle,
        String(scene.duration),
        scene.transition,
        scene.narration,
        audioCell,
        audioStart,
        audioLength,
        String(Math.round(scene.volume * 100) / 100),
        scene.muted ? "yes" : "no",
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
        "1. Drag every PNG inside scenes/ onto the CapCut timeline in numeric order.",
        "2. Each clip is already sized to the video aspect and tagged in the storyboard.csv:",
        "   - Duration: seconds to set for the clip",
        "   - Transition: which transition to put AFTER the scene",
        "   - Narration: the line this scene speaks",
        "   - Audio volume / Audio muted: the level and mute state to set on the clip",
        ...(audioFiles.size > 0
          ? [
              "3. Every voice-over you dropped is in audio/. Put each file on the",
              "   timeline at the start given in the storyboard.csv (Audio start),",
              "   trimmed to Audio length. They line up with the PNGs by construction.",
            ]
          : []),
        `4. Export your CapCut project at ${w}x${h} to match the resolution used here.`,
        ...(cues.length > 0
          ? [
              "5. subtitles.srt is an editable subtitle track. Import it, then check the",
              "   timings against the voice-over: they are estimated from the text,",
              "   not measured from the audio.",
            ]
          : []),
        "",
      ].join("\n"),
    );
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const scope = sectionOnly ? sectionSlug(list, selectedId) : "";
    a.download = `${fileName.trim() || "book-promo"}${scope}-capcut.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(
      `CapCut pack saved (${list.length} PNGs${
        audioFiles.size > 0 ? `, ${audioFiles.size} audio files` : ""
      }${cues.length > 0 ? `, ${cues.length} subtitles` : ""}${
        sectionOnly ? ", this section only" : ""
      }).`,
    );
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
        available: !support.probed || support.can[format.id],
        reason: unavailableReason(format.id, {
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
          if (format.id === "capcut") {
            return exportCapCutPack();
          }
          return exportVideoFile(format.id);
        },
      })),
    [
      support.probed,
      support.webCodecs,
      support.can,
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(280px,340px)_1fr]">
        {/* Scene inspector */}
        <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
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
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              Add a scene below to start editing it here.
            </div>
          )}

          <div className="flex items-center gap-1 border-t p-2">
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
            <select
              value={subtitleStyleId}
              onChange={(e) => setSubtitleStyleId(e.target.value)}
              disabled={!subtitlesOn}
              className="h-6 max-w-28 rounded border bg-background px-1 text-[11px] outline-none focus:border-ring disabled:opacity-40"
              aria-label="Subtitle style template"
              // The description is the reason to pick one over another, and a
              // native tooltip is the only place to put it without pushing the
              // toolbar around.
              title={
                subtitleStyle
                  ? `${subtitleStyle.label} - ${subtitleStyle.description}`
                  : "Subtitle style template"
              }
            >
              {/* Grouped so the seven designed templates read as the current
                  set and the originals sit underneath as the familiar ones. */}
              {SUBTITLE_STYLE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {SUBTITLE_STYLES.filter((s) => s.category === group.label).map(
                    (s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                        {s.recommended ? " - recommended" : ""}
                      </option>
                    ),
                  )}
                </optgroup>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => setLibraryOpen(true)}
              disabled={!selectedId}
              title={
                selectedId
                  ? "Pick an image, clip or video you already keep in the library"
                  : "Select a scene first"
              }
            >
              <LibraryBig className="size-3.5" />
              Library
            </Button>
            <ExportHub
              targets={hubTargets}
              defaultId="mp4"
              className="ml-1"
            />
          </div>
        </div>

        {/* Preview + transport. This is the fullscreen target so the scrubber
            and the play controls stay reachable while watching. */}
        <div
          ref={stageRef}
          className={cn(
            "flex min-h-0 flex-col bg-zinc-950",
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
              {status && <span className="text-xs text-emerald-400">{status}</span>}
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
          <span className="text-[11px] text-muted-foreground">
            Click a clip to edit · ↑/↓ reorder
          </span>
        </div>
        <div className="flex items-stretch gap-0.5 overflow-x-auto p-2">
          {scenes.map((scene, i) => {
            const start = scenes
              .slice(0, i)
              .reduce((acc, s) => acc + s.duration, 0);
            const width = Math.max(72, (scene.duration / totalDuration) * 240);
            const isActive = i === activeSceneIndex;
            // A group header sits before the first scene of each run of
            // equal group labels (imported { scene, subscenes } sections).
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
                    className="absolute top-0 left-0 z-10 max-w-full truncate bg-foreground/85 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-background backdrop-blur-sm"
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
                  <div className="flex items-center gap-1 border-t bg-background px-2 py-1">
                    <GripVertical className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold uppercase text-foreground">
                      {scene.kicker || `Scene ${i + 1}`}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
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
                <div className="absolute top-1 right-1 hidden gap-0.5 rounded bg-black/60 p-0.5 group-hover:flex">
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
      {libraryOpen && (
        <AssetLibrary
          onClose={() => setLibraryOpen(false)}
          onUse={useLibraryAsset}
        />
      )}
    </div>
  );
}
