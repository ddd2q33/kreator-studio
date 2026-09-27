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
  Circle,
  Clapperboard,
  Clock3,
  Copy,
  Cpu,
  Download,
  GripVertical,
  Image as ImageIcon,
  Mic,
  Package,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Upload,
  Wand2,
} from "lucide-react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { uid } from "@/lib/projects";
import {
  DEFAULT_BRAND,
  ELEVEN_MODEL_IDS,
  SCENE_FORMAT_VERSION,
  TRANSITIONS as TRANSITION_IDS,
  defaultVoiceConfig,
  normalizeFirstScene,
  normalizeScenes,
  normalizeSceneDocument,
} from "@/lib/scene-schema";
import type { SceneDocument, SceneVoiceConfig, Transition, VideoScene } from "@/lib/scene-schema";
import { frameKey } from "@/lib/frame-sampling";
import { extractVideoFrames } from "@/lib/video-frames";
import { buildTimelineCues, cueAt, toSrt } from "@/lib/subtitles";
import type { SubtitleCue } from "@/lib/subtitles";

export type { SceneVoiceConfig, VideoScene };

type ElevenVoiceCategory = "narrators" | "female" | "male" | "podcast";

type ElevenVoice = {
  id: string;
  name: string;
  tag: string;
  category: ElevenVoiceCategory;
};

// ElevenLabs' well-known default voices, categorized for quick picking.
const ELEVEN_VOICES: ElevenVoice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", tag: "Classic narrator", category: "narrators" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", tag: "Audiobook calm", category: "narrators" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", tag: "Laid-back", category: "podcast" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", tag: "Upbeat female", category: "female" },
  { id: "AZnzlk1WvdMhXNfEa66q", name: "Domi", tag: "Calm female", category: "female" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", tag: "Emotional", category: "female" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", tag: "Engaging male", category: "male" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", tag: "Upbeat male", category: "male" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", tag: "Tough deep", category: "male" },
];

const ELEVEN_CATEGORY_LABELS: Record<ElevenVoiceCategory, string> = {
  narrators: "Narrators",
  female: "Female voices",
  male: "Male voices",
  podcast: "Podcast",
};

const ELEVEN_CATEGORY_ORDER: ElevenVoiceCategory[] = [
  "narrators",
  "female",
  "male",
  "podcast",
];

const ELEVEN_MODELS: { id: string; label: string }[] = [
  { id: ELEVEN_MODEL_IDS.multilingual, label: "Multilingual v2" },
  { id: ELEVEN_MODEL_IDS.flash, label: "Flash v2.5 · fast" },
  { id: ELEVEN_MODEL_IDS.turbo, label: "Turbo v2.5" },
];

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
  duration: 4,
  transition: "fade",
  voice: defaultVoiceConfig(),
});

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
 * Paints the narration of the current cue as a burned-in subtitle: a dark
 * plate behind the text so it stays readable over a bright photo, the lines
 * centred in the lower safe area.
 */
function paintSubtitle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cue: SubtitleCue | null,
) {
  if (!cue || cue.lines.length === 0) return;

  const size = Math.round(Math.min(w * 0.042, h * 0.034));
  const lineH = size * 1.32;
  ctx.font = `600 ${size}px Inter, "Inter", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const widths = cue.lines.map((l) => ctx.measureText(l).width);
  const boxW = Math.max(...widths) + size * 1.1;
  // Sit above the very bottom edge so phone UI and platform overlays do not
  // cover the text.
  const boxH = cue.lines.length * lineH + size * 0.7;
  const boxX = (w - boxW) / 2;
  const boxY = h - boxH - h * 0.055;

  ctx.save();
  ctx.fillStyle = "rgba(2, 6, 14, 0.62)";
  ctx.beginPath();
  const r = Math.min(boxH * 0.22, size * 0.4);
  ctx.roundRect(boxX, boxY, boxW, boxH, r);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  let ty = boxY + boxH / 2 - ((cue.lines.length - 1) * lineH) / 2;
  for (const line of cue.lines) {
    ctx.fillText(line, w / 2, ty);
    ty += lineH;
  }
  ctx.restore();

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
    // Cover fit: scale >= 1 must grow the image, so it divides the zoom factor.
    // Multiplying it here shrank the frame below the canvas and exposed the
    // brand gradient as colored bands around the picture.
    const zoom = Math.max(image.width / w, image.height / h) / scale;
    const dw = image.width / zoom;
    const dh = image.height / zoom;
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

  paintSubtitle(ctx, w, h, subtitle);
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
  const [scenes, setScenes] = useState<VideoScene[]>(() => {
    const saved = loadScenes();
    return saved && saved.length > 0
      ? saved
      : [DEFAULT_SCENE(), DEFAULT_SCENE(), DEFAULT_SCENE()];
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [portrait, setPortrait] = useState(true);
  const [resolution, setResolution] = useState<string>("1080p");
  const resolutionRef = useRef(resolution);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [fileName, setFileName] = useState<string>("book-promo");
  const [playhead, setPlayhead] = useState(0); // seconds since playback start
  const [ttsBusy, setTtsBusy] = useState<string | null>(null);
  const [ttsReady, setTtsReady] = useState<Set<string>>(new Set());
  // Inline JSON editor for the selected scene (replaces the demo generator).
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [subtitlesOn, setSubtitlesOn] = useState(true);

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
        scenes.map((s) => ({ narration: s.narration, duration: s.duration })),
      ),
    [scenes],
  );
  const subtitleCuesRef = useRef(subtitleCues);
  useEffect(() => {
    subtitleCuesRef.current = subtitleCues;
  }, [subtitleCues]);

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
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastSpokenRef = useRef(-1);
  const imagesRef = useRef(images);
  const chaptersRef = useRef(chapters);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const ttsAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const activeTtsAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const applyToScene = useCallback((id: string, patch: Partial<VideoScene>) => {
    setScenes((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }, []);

  const openSceneJson = useCallback(() => {
    if (!selectedScene) return;
    // Strip runtime-only fields: the editable contract is the file format.
    const { id: _id, chapterId: _chapterId, voice, ...rest } = selectedScene;
    void _id;
    void _chapterId;
    setJsonDraft(
      JSON.stringify({ ...rest, voice }, null, 2),
    );
    setJsonError(null);
    setJsonOpen(true);
  }, [selectedScene]);

  const applySceneJson = useCallback(() => {
    if (!selectedScene) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonDraft) as Record<string, unknown>;
    } catch {
      setJsonError("Invalid JSON — fix the syntax and apply again.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setJsonError("Expected a single scene object, not an array.");
      return;
    }
    // Repair through the same pipeline used by file imports; the id and the
    // chapter link always stay the selected scene's own.
    const { document } = normalizeSceneDocument(
      { scenes: [parsed] },
      {
        imageKeys: Object.keys(imagesRef.current),
        chapterIds: chaptersRef.current.map((c) => c.id),
        newId: () => selectedScene.id,
      },
    );
    const scene = document?.scenes[0];
    if (!scene) {
      setJsonError("That is not a scene object, so it could not be applied.");
      return;
    }
    applyToScene(selectedScene.id, {
      ...scene,
      id: selectedScene.id,
      chapterId: selectedScene.chapterId,
    });
    setJsonError(null);
    setJsonOpen(false);
    setStatus(`Scene JSON applied to scene ${scenes.findIndex((s) => s.id === selectedScene.id) + 1}.`);
  }, [jsonDraft, selectedScene, applyToScene, scenes, setStatus]);

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
    [],
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

  const dropSceneFile = useCallback(
    (targetId: string, file: File) => {
      const isImage =
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name);

      const isVideo =
        file.type.startsWith("video/") ||
        /\.(mp4|m4v|mov|webm|ogv|ogg|mkv)$/i.test(file.name);

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
          `"${file.name}" is not something a scene can hold. Drop an image, a video or a scene JSON file.`,
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
      onAddImage,
      setStatus,
      splitVideoIntoScenes,
    ],
  );

  const stopTtsAudio = useCallback(() => {
    if (activeTtsAudioRef.current) {
      activeTtsAudioRef.current.pause();
      activeTtsAudioRef.current = null;
    }
  }, []);

  const generateTts = useCallback(
    async (scene: VideoScene) => {
      const text = scene.narration.trim();
      if (!text) {
        setStatus("Write narration first, then generate the voice.");
        return;
      }
      const voice = scene.voice;
      setTtsBusy(scene.id);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voiceId: voice.voiceId,
            modelId: voice.modelId,
            outputFormat: "mp3_44100_128",
            stability: voice.stability,
            similarity: voice.similarity,
            style: voice.style,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? `TTS failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const prev = ttsAudioRef.current.get(scene.id);
        if (prev) {
          prev.pause();
          URL.revokeObjectURL(prev.src.split("?")[0]);
        }
        const audio = new Audio(url);
        audio.preload = "auto";
        ttsAudioRef.current.set(scene.id, audio);
        setTtsReady((prev) => new Set(prev).add(scene.id));
        const voiceName =
          ELEVEN_VOICES.find((v) => v.id === voice.voiceId)?.name ??
          voice.voiceId.slice(0, 8);
        setStatus(
          `Voice "${voiceName}" rendered for "${scene.kicker || `Scene ${ttsAudioRef.current.size}`}" (${(blob.size / 1024).toFixed(0)} KB).`,
        );
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "ElevenLabs request failed.",
        );
      } finally {
        setTtsBusy(null);
      }
    },
    [],
  );

  const playSceneNarration = useCallback((idx: number) => {
    const scene = scenesRef.current[idx];
    if (!scene) return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopTtsAudio();
    const audio = ttsAudioRef.current.get(scene.id);
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      activeTtsAudioRef.current = audio;
    } else if (scene.narration && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(scene.narration);
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    }
  }, [stopTtsAudio]);

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
  }, []);

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
    [selectedId],
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
    [],
  );

  const moveScene = useCallback((id: string, dir: -1 | 1) => {
    setScenes((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const to = idx + dir;
      if (idx === -1 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);


  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const scenes = scenesRef.current;
    if (scenes.length === 0) {
      ctx.fillStyle = "#0b1620";
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const total = scenes.reduce((acc, s) => acc + s.duration, 0);
    const elapsed = (performance.now() - playStartRef.current) / 1000;
    const emitMs = Math.floor(elapsed * 1000);
    if (emitMs !== lastEmitMsRef.current) {
      lastEmitMsRef.current = emitMs;
      setPlayhead(Math.min(elapsed, total));
    }
    let acc = 0;
    let sceneIdx = scenes.length - 1;
    let local = 1;
    for (let i = 0; i < scenes.length; i++) {
      if (elapsed < acc + scenes[i].duration) {
        sceneIdx = i;
        local = clamp01(Math.max(0, elapsed - acc) / Math.max(0.0001, scenes[i].duration));
        break;
      }
      acc += scenes[i].duration;
    }
    // Speak narration at scene boundaries.
    if (sceneIdx !== lastSpokenRef.current) {
      lastSpokenRef.current = sceneIdx;
      playSceneNarration(sceneIdx);
    }

    const brand = brandRef.current;
    const cache = imageCacheRef.current;
    const imageFor = (s: VideoScene) => {
      if (!s.imageKey) return null;
      const src = imagesRef.current[s.imageKey];
      return src ? (cache.get(src) ?? null) : null;
    };

    // Hard cut between scenes: no crossfade, no blend with the previous scene.
    paintScene(
      ctx,
      w,
      h,
      scenes[sceneIdx],
      local,
      brand,
      imageFor(scenes[sceneIdx]),
      cueForTime(acc + local * scenes[sceneIdx].duration),
    );

    if (elapsed >= total) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      previewOnlyRef.current = false;
      setPlaying(false);
      if (recRef.current && recRef.current.state !== "inactive") {
        setTimeout(() => {
          recRef.current?.stop();
          setRecording(false);
          setStatus("Rendering webm…");
        }, 150);
      }
    } else if (previewOnlyRef.current) {
      previewOnlyRef.current = false;
    } else {
      rafRef.current = requestAnimationFrame(() => frameFnRef.current());
    }
  }, [playSceneNarration, cueForTime]);

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
        paintScene(
          ctx,
          canvas.width,
          canvas.height,
          scenes[idx],
          0,
          brand,
          img,
          cueForTime(offset),
        );
      }
      return clamped;
    });
  }, [scenes, selectedSceneIndex, brand, playing, totalDuration, cueForTime]);

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastSpokenRef.current = -1;
    pausedAtRef.current = null;
    previewOnlyRef.current = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopTtsAudio();
    setPlayhead(0);
    lastEmitMsRef.current = -1;
    setPlaying(false);
    setRecording(false);
  }, [stopTtsAudio]);

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
    stopTtsAudio();
    setPlaying(false);
  }, [stopTtsAudio]);

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
      if (pausedAtRef.current === null) pausedAtRef.current = elapsed;
      else pausedAtRef.current = elapsed;
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
      stopTtsAudio();
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
    [playing, renderFrame, stopTtsAudio, totalDuration],
  );

  const formatTime = useCallback((t: number) => {
    const totalSec = Math.max(0, Math.floor(t));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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

  const play = useCallback(
    (withRecording: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas || scenesRef.current.length === 0) return;
      stopPlayback();
      const mime =
        withRecording &&
        typeof window !== "undefined" &&
        "MediaRecorder" in window
          ? ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
              (m) => MediaRecorder.isTypeSupported(m),
            )
          : undefined;
      if (withRecording) {
        chunksRef.current = [];
        try {
          const stream = canvas.captureStream(30);
          const rec = new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: 9_000_000,
          });
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          rec.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: "video/webm" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${fileName.trim() || "book-promo"}.webm`;
            a.click();
            URL.revokeObjectURL(a.href);
            setStatus("Video saved.");
          };
          recRef.current = rec;
          rec.start();
          setRecording(true);
          setStatus("Recording…");
        } catch {
          setStatus("Recording is not supported in this browser.");
          return;
        }
      }
      playStartRef.current = performance.now();
      lastSpokenRef.current = -1;
      setPlayhead(0);
      lastEmitMsRef.current = -1;
      setPlaying(true);
      rafRef.current = requestAnimationFrame(renderFrame);
    },
    [renderFrame, stopPlayback, fileName],
  );

  const exportJson = useCallback(() => {
    const doc: SceneDocument = {
      version: SCENE_FORMAT_VERSION,
      brand,
      portrait,
      scenes,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName.trim() || "book-promo"}-scenes.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [brand, portrait, scenes, fileName]);

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
        setSelectedId(imported.scenes[0]?.id ?? null);
        setStatus(
          warnings.length > 0
            ? `Imported ${imported.scenes.length} scenes · ${warnings.length} field${warnings.length === 1 ? "" : "s"} repaired: ${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? "…" : ""}`
            : `Imported ${imported.scenes.length} scenes.`,
        );
      };
      reader.readAsText(file);
    },
    [setStatus],
  );

  const currentResolution =
    RESOLUTIONS.find((r) => r.id === resolution) ?? RESOLUTIONS[1];
  const [w, h] = portrait
    ? [currentResolution.height, currentResolution.width]
    : [currentResolution.width, currentResolution.height];

  const resolutionLabel = portrait
    ? `${currentResolution.height}×${currentResolution.width}`
    : currentResolution.short;

  const exportCapCutPack = useCallback(async () => {
    setStatus("Rendering scene frames…");
    const zip = new JSZip();
    // One still per scene, so each frame shows the first cue of its scene.
    const cues = buildTimelineCues(
      scenes.map((s) => ({ narration: s.narration, duration: s.duration })),
    );
    const firstCueOfScene = (index: number): SubtitleCue | null => {
      const start = scenes
        .slice(0, index)
        .reduce((acc, s) => acc + s.duration, 0);
      return cueAt(cues, start);
    };
    const rows = [
      ["#", "File", "Kicker", "Title", "Subtitle", "Duration (s)", "Transition", "Narration"],
    ];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
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
      paintScene(
        ctx,
        w,
        h,
        scene,
        1,
        brand,
        image,
        subtitlesOn ? firstCueOfScene(i) : null,
      );
      const fileBase = `${String(i + 1).padStart(2, "0")}_${slugify(scene.kicker)}`;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (blob) zip.file(`scenes/${fileBase}.png`, blob);
      rows.push([
        String(i + 1),
        `${fileBase}.png`,
        scene.kicker,
        scene.title,
        scene.subtitle,
        String(scene.duration),
        scene.transition,
        scene.narration,
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
        "   - Narration: the line to record or voice over for that scene",
        `3. Export your CapCut project at ${w}x${h} to match the resolution used here.`,
        ...(cues.length > 0
          ? [
              "4. subtitles.srt is an editable subtitle track. Import it, then check the",
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
    a.download = `${fileName.trim() || "book-promo"}-capcut.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(
      `CapCut pack saved (${scenes.length} PNGs${cues.length > 0 ? `, ${cues.length} subtitles` : ""}).`,
    );
  }, [scenes, brand, images, fileName, w, h, subtitlesOn]);


  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-muted/40 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Clapperboard className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="hidden shrink-0 text-sm font-semibold lg:block">
            Video Editor
          </h2>
          <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:block">
            chapter promos
          </span>
          <Badge>canvas/webm</Badge>
          <Badge>capcut pack</Badge>
        </div>
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
                disabled={!selectedScene}
                title="View and edit the selected scene as JSON"
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

          {jsonOpen && selectedScene && (
            <div className="border-b bg-muted/20 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  scene[{scenes.findIndex((s) => s.id === selectedScene.id)}]
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setJsonDraft(JSON.stringify(selectedScene, null, 2))}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    title="Reset to the scene as currently rendered (full object, runtime fields included)"
                  >
                    Reset
                  </button>
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
                aria-label="Selected scene JSON"
                className="w-full resize-y rounded border bg-background p-2 font-mono text-[11px] leading-4 outline-none focus:border-ring"
              />
              {jsonError && (
                <p className="mt-1 text-[10px] font-medium text-red-500">{jsonError}</p>
              )}
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button size="sm" className="h-6 px-2 text-xs" onClick={applySceneJson}>
                  Apply
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  id and chapter link are preserved · unknown fields are repaired on apply
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
                      applyToScene(selectedScene.id, { kicker: e.target.value })
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
                      applyToScene(selectedScene.id, { title: e.target.value })
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
                      applyToScene(selectedScene.id, {
                        subtitle: e.target.value,
                      })
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
                      applyToScene(selectedScene.id, {
                        imageKey: e.target.value || null,
                      })
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
                    applyToScene(selectedScene.id, {
                      duration: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="w-full accent-foreground"
                  aria-label="Selected scene duration slider"
                />
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>1s</span>
                  <select
                    value={selectedScene.transition}
                    onChange={(e) =>
                      applyToScene(selectedScene.id, {
                        transition: e.target.value as Transition,
                      })
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
                  Narration (TTS)
                </label>
                <div className="flex items-start gap-1.5">
                  <textarea
                    value={selectedScene.narration}
                    onChange={(e) =>
                      applyToScene(selectedScene.id, {
                        narration: e.target.value,
                      })
                    }
                    placeholder="Spoken narration via ElevenLabs or browser TTS"
                    rows={3}
                    className="w-full resize-none rounded border bg-background px-2 py-1 text-[11px] text-muted-foreground outline-none focus:border-ring"
                    aria-label="Selected scene narration"
                  />
                </div>

                <div className="rounded border bg-muted/30 p-1.5">
                  <label className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <AudioLines className="size-3 text-primary" />
                    Voice
                  </label>
                  <select
                    value={
                      ELEVEN_VOICES.some((v) => v.id === selectedScene.voice.voiceId)
                        ? selectedScene.voice.voiceId
                        : "custom"
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && v !== "custom") {
                        applyToScene(selectedScene.id, {
                          voice: {
                            ...selectedScene.voice,
                            voiceId: v,
                          },
                        });
                      }
                    }}
                    className="mt-1 w-full rounded border bg-background px-2 py-1 text-[11px] outline-none focus:border-ring"
                    aria-label="ElevenLabs voice"
                  >
                    {ELEVEN_CATEGORY_ORDER.map((cat) => (
                      <optgroup
                        key={cat}
                        label={ELEVEN_CATEGORY_LABELS[cat]}
                      >
                        {ELEVEN_VOICES.filter((v) => v.category === cat).map(
                          (v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} — {v.tag}
                            </option>
                          ),
                        )}
                      </optgroup>
                    ))}
                    <option value="custom">Custom voice ID…</option>
                  </select>
                  <div
                    className={`mt-1 ${ELEVEN_VOICES.some((v) => v.id === selectedScene.voice.voiceId) ? "hidden" : ""}`}
                  >
                    <input
                      value={selectedScene.voice.voiceId}
                      onChange={(e) =>
                        applyToScene(selectedScene.id, {
                          voice: {
                            ...selectedScene.voice,
                            voiceId: e.target.value.trim(),
                          },
                        })
                      }
                      placeholder="Paste a custom voice ID (e.g. your cloned voice)"
                      className="w-full rounded border bg-background px-2 py-1 font-mono text-[10px] outline-none focus:border-ring"
                      aria-label="Custom ElevenLabs voice ID"
                    />
                  </div>

                  <label className="mt-2 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Cpu className="size-3 text-primary" />
                    Model
                  </label>
                  <select
                    value={selectedScene.voice.modelId}
                    onChange={(e) =>
                      applyToScene(selectedScene.id, {
                        voice: {
                          ...selectedScene.voice,
                          modelId: e.target.value,
                        },
                      })
                    }
                    className="mt-1 w-full rounded border bg-background px-2 py-1 text-[11px] outline-none focus:border-ring"
                    aria-label="ElevenLabs model"
                  >
                    {ELEVEN_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded border bg-muted/30 p-1.5">
                  <label className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <SlidersHorizontal className="size-3 text-primary" />
                    Style
                  </label>
                  {[
                    {
                      key: "stability",
                      label: "Stability",
                      hint: "Steadier = more consistent",
                      low: "Flexible",
                      high: "Steady",
                    } as const,
                    {
                      key: "similarity",
                      label: "Similarity",
                      hint: "How close to the source voice",
                      low: "Original",
                      high: "Cloned",
                    } as const,
                    {
                      key: "style",
                      label: "Exaggeration",
                      hint: "Amplify the speaker's style",
                      low: "Neutral",
                      high: "Dramatic",
                    } as const,
                  ].map((f) => (
                    <div key={f.key} className="mt-2 px-1">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] font-medium text-foreground">
                          {f.label}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                          {Math.round(selectedScene.voice[f.key] * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedScene.voice[f.key]}
                        onChange={(e) =>
                          applyToScene(selectedScene.id, {
                            voice: {
                              ...selectedScene.voice,
                              [f.key]: Number(e.target.value),
                            },
                          })
                        }
                        className="video-scrub mt-0.5 w-full"
                        aria-label={`${f.label} slider`}
                      />
                      <div className="flex justify-between text-[9px] text-muted-foreground/70">
                        <span>{f.low}</span>
                        <span>{f.hint}</span>
                        <span>{f.high}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => generateTts(selectedScene)}
                    disabled={ttsBusy === selectedScene.id}
                    className="flex h-6 shrink-0 items-center gap-1 rounded border bg-primary/10 px-2 text-[10px] font-medium text-primary transition-colors hover:border-ring disabled:opacity-50"
                    title={`Synthesize "${selectedScene.narration.trim() || "…"}" with ElevenLabs`}
                  >
                    <Wand2 className="size-3" />
                    {ttsBusy === selectedScene.id
                      ? "Generating…"
                      : ttsReady.has(selectedScene.id)
                        ? "Regenerate"
                        : "Generate"}
                  </button>
                  <span
                    className={`ml-auto text-[10px] ${ttsReady.has(selectedScene.id) ? "text-emerald-600" : "text-muted-foreground"}`}
                  >
                    {ttsReady.has(selectedScene.id) ? "Audio ready" : "Not generated"}
                  </span>
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
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={exportCapCutPack}
              title="Export a ZIP with one PNG per scene, subtitles.srt and a storyboard CSV for CapCut"
            >
              <Package className="size-3.5" />
              CapCut pack
            </Button>
          </div>
        </div>

        {/* Preview + transport */}
        <div className="flex min-h-0 flex-col bg-zinc-950">
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
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
                  <Square className="size-3.5" />
                  Pause
                </Button>
              ) : playhead > 0 && playhead < totalDuration ? (
                <Button onClick={resume} size="sm">
                  <Play className="size-3.5" />
                  Resume
                </Button>
              ) : (
                <Button onClick={() => play(false)} size="sm">
                  <Play className="size-3.5" />
                  Preview
                </Button>
              )}
              <Button
                onClick={stopPlayback}
                variant="ghost"
                size="sm"
                disabled={!playing && playhead === 0}
              >
                <Square className="size-3.5" />
                Stop
              </Button>
              <Button
                onClick={() => play(true)}
                disabled={recording}
                variant={recording ? "secondary" : "default"}
                size="sm"
                className={recording ? "text-red-500" : ""}
              >
                <Circle className="size-3 fill-red-500 text-red-500" />
                {recording ? "Recording…" : "Record .webm"}
              </Button>
            </div>
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
            return (
              <div
                key={scene.id}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDropTargetId(scene.id);
                }}
                onDragLeave={() =>
                  setDropTargetId((id) => (id === scene.id ? null : id))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTargetId(null);
                  const file = e.dataTransfer.files?.[0];
                  if (file) dropSceneFile(scene.id, file);
                }}
                className={cn(
                  "group relative flex shrink-0 flex-col overflow-hidden rounded border bg-background shadow-sm transition-colors",
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
                    disabled={i === 0}
                    className="rounded p-0.5 text-zinc-300 hover:text-white disabled:opacity-30"
                    aria-label="Move scene left"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveScene(scene.id, 1)}
                    disabled={i === scenes.length - 1}
                    className="rounded p-0.5 text-zinc-300 hover:text-white disabled:opacity-30"
                    aria-label="Move scene right"
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
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-zinc-900/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:bg-zinc-100/10">
      {children}
    </span>
  );
}