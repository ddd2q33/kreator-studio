"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clapperboard,
  Play,
  Square,
  Download,
  Package,
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Wand2,
  Upload,
  Image as ImageIcon,
  Film,
  Type,
  Mic,
  GripVertical,
} from "lucide-react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { uid } from "@/lib/projects";

type Transition = "cut" | "fade" | "zoom" | "pan";

export type VideoScene = {
  id: string;
  kicker: string;
  title: string;
  subtitle: string;
  narration: string;
  imageKey: string | null;
  duration: number;
  transition: Transition;
};

type VideoStudioProps = {
  bookTitle: string;
  chapters: { id: string; title: string; markdown: string }[];
  sourceMarkdown: string;
  images: Record<string, string>;
};

const STORE_KEY = "book-studio-video";

const DEFAULT_SCENE = (n: number): VideoScene => ({
  id: uid("scene-"),
  kicker: `SCENE ${n.toString().padStart(2, "0")}`,
  title: `Scene ${n} title`,
  subtitle: "Key takeaway for this chapter.",
  narration: `Scene ${n}. Key takeaway for this chapter.`,
  imageKey: null,
  duration: 4,
  transition: "fade",
});

const TRANSITIONS: { id: Transition; label: string }[] = [
  { id: "cut", label: "Cut" },
  { id: "fade", label: "Fade" },
  { id: "zoom", label: "Zoom" },
  { id: "pan", label: "Pan" },
];

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
    const parsed = JSON.parse(raw) as VideoScene[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.filter(
      (s) => !!s && typeof s.id === "string" && typeof s.title === "string",
    );
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

function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) =>
    Math.round(c + (amt > 0 ? 255 - c : c) * amt);
  const to = (c: number) =>
    Math.max(0, Math.min(255, amt > 0 ? mix(c) : c + amt)).toString(16).padStart(2, "0");
  return `#${to(r === undefined ? 0 : r)}${to(g === undefined ? 0 : g)}${to(b === undefined ? 0 : b)}`;
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

const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Pure frame renderer shared by the live preview, thumbnails and PNG export. */
function paintScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: VideoScene,
  progress: number,
  t: number,
  brand: string,
  image: HTMLImageElement | null,
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
    const zoom = Math.max(image.width / w, image.height / h) * scale;
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

  const kick = 0.34 * w;
  ctx.font = `700 ${Math.round(kick)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "center";
  ctx.fillText(scene.kicker.toUpperCase(), w / 2, h * 0.42);

  const titleSize = Math.round(Math.min(w * 0.075, h * 0.062));
  ctx.font = `800 ${titleSize}px Inter, "Inter", sans-serif`;
  ctx.fillStyle = "#ffffff";
  const titleLines = wrapText(ctx, scene.title, w * 0.86);
  let y = h * 0.5;
  const lineH = titleSize * 1.16;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 24;
  for (const line of titleLines) {
    ctx.fillText(line, w / 2, y);
    y += lineH;
  }
  ctx.shadowBlur = 0;

  if (scene.subtitle) {
    const subSize = Math.round(Math.min(w * 0.033, h * 0.026));
    ctx.font = `500 ${subSize}px Inter, "Inter", sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    const subLines = wrapText(ctx, scene.subtitle, w * 0.72).slice(0, 4);
    let sy = y + subSize * 0.6;
    for (const line of subLines) {
      ctx.fillText(line, w / 2, sy);
      sy += subSize * 1.45;
    }
  }

  const brandShade = shade(brand, 0.55);
  ctx.fillStyle = brandShade;
  ctx.globalAlpha = clamp01(easeInOut(Math.min(1, t * 2)));
  ctx.fillRect(0, 0, 6, h);
  ctx.globalAlpha = 1;

  if (progress >= 0.98) {
    ctx.fillStyle = "rgba(10, 22, 18, 0.35)";
    ctx.fillRect(0, 0, 6, h);
  }
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
      paintScene(ctx, tw, th, scene, 0.5, 1, brand, null);
      return;
    }
    loadImage(imageSrc)
      .then((img) => {
        if (alive) paintScene(ctx, tw, th, scene, 0.5, 1, brand, img);
      })
      .catch(() => {
        if (alive) paintScene(ctx, tw, th, scene, 0.5, 1, brand, null);
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
    />
  );
}

export function VideoStudio({
  bookTitle,
  chapters,
  sourceMarkdown,
  images,
}: VideoStudioProps) {
  const [scenes, setScenes] = useState<VideoScene[]>(() => {
    const saved = loadScenes();
    return saved && saved.length > 0
      ? saved
      : [DEFAULT_SCENE(1), DEFAULT_SCENE(2), DEFAULT_SCENE(3)];
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brand, setBrand] = useState("#0d9488");
  const [portrait, setPortrait] = useState(true);
  const [resolution, setResolution] = useState<string>("1080p");
  const resolutionRef = useRef(resolution);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [fileName, setFileName] = useState<string>("book-promo");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scenesRef = useRef(scenes);
  const brandRef = useRef(brand);
  const portraitRef = useRef(portrait);
  const rafRef = useRef<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastSpokenRef = useRef(-1);
  const imagesRef = useRef(images);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const selectedScene =
    scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null;

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

  const playStartRef = useRef(0);
  const frameFnRef = useRef<() => void>(() => {});

  const addScene = useCallback(() => {
    let created: VideoScene | null = null;
    setScenes((prev) => {
      const next = [...prev, DEFAULT_SCENE(prev.length + 1)];
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

  const generateFromBook = useCallback(() => {
    const shots: VideoScene[] = [];
    const title = bookTitle.trim() || "Untitled book";
    shots.push({
      id: uid("scene-"),
      kicker: "INTRO",
      title,
      subtitle: "A chapter-by-chapter journey.",
      narration: `${title}. A chapter by chapter journey.`,
      imageKey: null,
      duration: 4,
      transition: "fade",
    });

    const sources = chapters.length > 0 ? chapters
      : (sourceMarkdown
          .split(/\n#{1,2}\s+/)
          .map((raw, i) => {
            if (i === 0) return null;
            const lines = raw.split("\n")[0]?.trim() ?? "";
            return lines ? { title: lines, markdown: raw } : null;
          })
          .filter((c): c is { title: string; markdown: string } => !!c) ?? []);

    sources.forEach((ch) => {
      const lines = ch.markdown.split("\n");
      const firstPara =
        lines.find((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">"))
          ?.trim() ?? "";
      const bullet =
        lines
          .find((l) => /^\s*[-*]\s+/.test(l))
          ?.replace(/^\s*[-*]\s+/, "")
          .trim() ?? "";
      const subtitle = bullet || firstPara.slice(0, 90) || "In this chapter.";
      shots.push({
        id: uid("scene-"),
        kicker: "CHAPTER",
        title: ch.title.replace(/^\d+[.)\s]*/, ""),
        subtitle,
        narration: `${ch.title}. ${subtitle}`,
        imageKey: null,
        duration: 4,
        transition: "fade",
      });
    });

    if (shots.length > 1) {
      shots.push({
        id: uid("scene-"),
        kicker: "OUTRO",
        title: "Thanks for watching",
        subtitle: "Read the full book for the complete story.",
        narration: "Thanks for watching. Read the full book for the complete story.",
        imageKey: null,
        duration: 3,
        transition: "fade",
      });
    }
    setScenes(shots);
    setSelectedId(shots[0]?.id ?? null);
    setStatus(`Generated ${shots.length} scenes from the book.`);
  }, [bookTitle, chapters, sourceMarkdown]);

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
      const narration = scenes[sceneIdx]?.narration;
      if (narration && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(narration);
        u.rate = 1.02;
        window.speechSynthesis.speak(u);
      }
    }

    const brand = brandRef.current;
    const cache = imageCacheRef.current;
    const imageFor = (s: VideoScene) => {
      if (!s.imageKey) return null;
      const src = imagesRef.current[s.imageKey];
      return src ? (cache.get(src) ?? null) : null;
    };

    // Crossfade from the previous scene unless the transition is "cut".
    if (sceneIdx > 0 && scenes[sceneIdx].transition !== "cut") {
      paintScene(ctx, w, h, scenes[sceneIdx - 1], 0, 1, brand, imageFor(scenes[sceneIdx - 1]));
      ctx.save();
      ctx.globalAlpha = easeInOut(clamp01(local / 0.45));
      paintScene(ctx, w, h, scenes[sceneIdx], local, local, brand, imageFor(scenes[sceneIdx]));
      ctx.restore();
    } else {
      paintScene(ctx, w, h, scenes[sceneIdx], local, local, brand, imageFor(scenes[sceneIdx]));
    }

    if (elapsed >= total) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setPlaying(false);
      if (recRef.current && recRef.current.state !== "inactive") {
        setTimeout(() => {
          recRef.current?.stop();
          setRecording(false);
          setStatus("Rendering webm…");
        }, 150);
      }
    } else {
      rafRef.current = requestAnimationFrame(() => frameFnRef.current());
    }
  }, []);

  useEffect(() => {
    frameFnRef.current = renderFrame;
  }, [renderFrame]);

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastSpokenRef.current = -1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(false);
    setRecording(false);
  }, []);

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
      setPlaying(true);
      rafRef.current = requestAnimationFrame(renderFrame);
    },
    [renderFrame, stopPlayback],
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
      setPlaying(true);
      rafRef.current = requestAnimationFrame(renderFrame);
    },
    [renderFrame, stopPlayback, fileName],
  );

  const totalDuration = useMemo(
    () => scenes.reduce((acc, s) => acc + s.duration, 0),
    [scenes],
  );

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify({ brand, portrait, scenes }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName.trim() || "book-promo"}-scenes.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [brand, portrait, scenes, fileName]);

  const importJson = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? "")) as {
          brand?: string;
          portrait?: boolean;
          scenes?: VideoScene[];
        };
        if (Array.isArray(data.scenes) && data.scenes.length > 0) {
          if (typeof data.brand === "string") setBrand(data.brand);
          if (typeof data.portrait === "boolean") setPortrait(data.portrait);
          setScenes(data.scenes);
          setSelectedId(data.scenes[0]?.id ?? null);
          setStatus("Scenes imported.");
        }
      } catch {
        setStatus("Invalid scene JSON.");
      }
    };
    reader.readAsText(file);
  }, []);

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
      paintScene(ctx, w, h, scene, 0.5, 1, brand, image);
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
        "3. Export your CapCut project at ${w}x${h} to match the resolution used here.",
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
    setStatus(`CapCut pack saved (${scenes.length} PNGs).`);
  }, [scenes, brand, images, fileName, w, h]);

  const selectedSceneIndex =
    selectedScene ? scenes.findIndex((s) => s.id === selectedScene.id) : -1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 overflow-x-auto border-b bg-muted/40 px-3">
        <div className="flex items-center gap-2">
          <Clapperboard className="size-4 text-muted-foreground" />
          <h2 className="hidden text-sm font-semibold lg:block">Video Editor — chapter promos</h2>
          <Badge>canvas/webm</Badge>
          <Badge>capcut pack</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Accent
              <input
                type="color"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="h-7 w-9 cursor-pointer rounded border bg-background"
                aria-label="Brand accent color"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Resolution
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="h-7 rounded border bg-background px-2 text-xs outline-none focus:border-ring"
                aria-label="Video resolution"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} — {r.short}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPortrait((p) => !p)}
              title="Toggle portrait / landscape"
            >
              <Film className="size-3.5" />
              {portrait ? "Vertical" : "Horizontal"} {resolutionLabel}
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Filename
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="h-7 w-36 rounded border bg-background px-2 font-mono text-xs outline-none focus:border-ring"
              aria-label="Output filename"
            />
          </label>
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
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={generateFromBook}
                title="Generate scenes from the current book"
              >
                <Wand2 className="size-3.5" />
                From book
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

          {selectedScene ? (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Scene {selectedSceneIndex + 1} of {scenes.length}
                  {selectedScene.imageKey ? " · image" : ""}
                  {"/"}
                  {selectedScene.transition}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {selectedScene.duration.toFixed(1)}s
                </span>
                <span
                  className="mx-1 h-1 flex-1 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${brand}, transparent)`,
                  }}
                />
              </div>
              <input
                value={selectedScene.kicker}
                onChange={(e) =>
                  applyToScene(selectedScene.id, { kicker: e.target.value })
                }
                placeholder="Kicker"
                className="h-7 w-full rounded border bg-background px-2 font-mono text-[11px] uppercase outline-none focus:border-ring"
                aria-label="Selected scene kicker"
              />
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
              <div className="flex items-center gap-1.5">
                <input
                  value={selectedScene.imageKey ?? ""}
                  onChange={(e) =>
                    applyToScene(selectedScene.id, {
                      imageKey: e.target.value || null,
                    })
                  }
                  list="video-image-options"
                  placeholder="Image asset (optional)"
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
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedScene.transition}
                  onChange={(e) =>
                    applyToScene(selectedScene.id, {
                      transition: e.target.value as Transition,
                    })
                  }
                  className="h-7 min-w-0 flex-1 rounded border bg-background text-[11px] outline-none focus:border-ring"
                  aria-label="Selected scene transition"
                >
                  {TRANSITIONS.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  Secs
                  <input
                    type="number"
                    min={1}
                    max={20}
                    step={0.5}
                    value={selectedScene.duration}
                    onChange={(e) =>
                      applyToScene(selectedScene.id, {
                        duration: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="h-7 w-14 rounded border bg-background px-1 text-center text-[11px] outline-none focus:border-ring"
                    aria-label="Selected scene duration"
                  />
                </label>
              </div>
              <div className="flex items-start gap-1.5">
                <Mic className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <textarea
                  value={selectedScene.narration}
                  onChange={(e) =>
                    applyToScene(selectedScene.id, {
                      narration: e.target.value,
                    })
                  }
                  placeholder="Narration (spoken via browser TTS)"
                  rows={3}
                  className="w-full resize-none rounded border bg-background px-2 py-1 text-[11px] text-muted-foreground outline-none focus:border-ring"
                  aria-label="Selected scene narration"
                />
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
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={exportCapCutPack}
              title="Export a ZIP with one PNG per scene plus a storyboard CSV for CapCut"
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
              <canvas
                ref={canvasRef}
                width={w}
                height={h}
                className={cn(
                  "mx-auto block border border-white/10 shadow-2xl",
                  portrait ? "h-full w-auto max-w-full" : "w-full max-h-full",
                )}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-zinc-900 px-4 py-3">
            <div className="mr-auto flex items-center gap-2 text-xs text-zinc-400">
              <Type className="size-3.5" />
              <span>{scenes.length} scenes</span>
              <span aria-hidden>·</span>
              <span>{totalDuration.toFixed(0)}s total</span>
              <span aria-hidden>·</span>
              <span>{portrait ? "vertical" : "horizontal"}</span>
              <span aria-hidden>·</span>
              <span>{resolutionLabel}</span>
            </div>
            {status && <span className="text-xs text-emerald-400">{status}</span>}
            {playing ? (
              <Button onClick={stopPlayback} variant="secondary" size="sm">
                <Square className="size-3.5" />
                Stop
              </Button>
            ) : (
              <Button onClick={() => play(false)} size="sm">
                <Play className="size-3.5" />
                Preview
              </Button>
            )}
            <Button
              onClick={() => play(true)}
              disabled={recording}
              variant={recording ? "secondary" : "default"}
              size="sm"
              className={recording ? "text-red-500" : ""}
            >
              <Square className="size-3.5" />
              {recording ? "Recording…" : "Record .webm"}
            </Button>
          </div>
        </div>
      </div>

      {/* CapCut-style timeline */}
      <div className="border-t bg-muted/30">
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Timeline
          </span>
          <span className="text-[11px] text-muted-foreground">
            Click a clip to inspect it · drag order with ↑/↓
          </span>
        </div>
        <div className="flex items-stretch gap-1.5 overflow-x-auto p-2">
          {scenes.map((scene, i) => (
            <div
              key={scene.id}
              className={cn(
                "group relative flex w-36 shrink-0 flex-col overflow-hidden rounded border bg-background shadow-sm transition-colors",
                selectedScene?.id === scene.id
                  ? "border-amber-500 ring-1 ring-amber-500"
                  : "border-transparent hover:border-foreground/30",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedId(scene.id);
                  if (playing) playFrom(i);
                }}
                className="flex flex-col items-stretch"
                aria-label={`Select scene ${i + 1}`}
              >
                <div className="min-h-0 flex-1">
                  <TimelineThumb
                    scene={scene}
                    portrait={portrait}
                    brand={brand}
                    imageSrc={
                      scene.imageKey ? images[scene.imageKey] : undefined
                    }
                  />
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
          ))}
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