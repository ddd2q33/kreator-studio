/**
 * What the editor can export, and how each container is encoded.
 *
 * The export controls used to be two unrelated buttons — one that recorded a
 * .webm in real time and one that zipped a CapCut pack — which made the choices
 * feel like separate features. They are all the same decision, "where does this
 * go", so they live behind one selector here.
 *
 * Video is encoded offline, frame by frame, through WebCodecs and packaged with
 * Mediabunny, rather than captured live with MediaRecorder. That is what makes
 * it a download: the export does not play back in real time, so it finishes far
 * sooner than the clip is long, and the container is chosen by the page instead
 * of by whichever encoder the browser happens to expose to MediaRecorder. It
 * also means MP4 no longer depends on the Chrome 126+ MediaRecorder limitation.
 *
 * The codec pair is a property of the container, not a preference: H.264 and AAC
 * in MP4, VP9 and Opus in WebM. Choosing anything else produces a file players
 * reject, so the pairs are fixed here and the browser is only asked whether it
 * can encode them.
 *
 * The availability probe is passed in as an async function, so the whole
 * decision is unit tested without a browser or an encoder.
 */

/** Where an export goes. */
export type ExportTarget = "webm" | "mp4" | "capcut" | "json";

/**
 * Codec identifiers as Mediabunny names them. Kept as plain strings so this
 * module stays importable in a plain Node test run; the values are checked
 * against the library's own union where they are used.
 */
export type VideoCodecId = "avc" | "vp9" | "vp8" | "av1" | "hevc";
export type AudioCodecId = "aac" | "opus";

export type ExportFormat = {
  id: ExportTarget;
  /** Shown in the selector. */
  label: string;
  /** File extension the download gets, without the dot. */
  extension: string;
  /** Codecs fixed by the container. Null for a non-video target. */
  videoCodec: VideoCodecId | null;
  audioCodec: AudioCodecId | null;
  /** One line explaining what comes out. */
  hint: string;
  /** True when the target renders a video file. */
  isVideo: boolean;
};

/**
 * One entry per container, each pinned to the codecs that container is defined
 * to carry. The order here is the order shown in the selector: MP4 first,
 * because it is the one that plays everywhere.
 */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: "mp4",
    label: "MP4 video (.mp4)",
    extension: "mp4",
    // H.264 + AAC-LC: the pair every phone, browser and NLE accepts.
    videoCodec: "avc",
    audioCodec: "aac",
    hint: "H.264 with AAC audio. Plays everywhere, uploads anywhere.",
    isVideo: true,
  },
  {
    id: "webm",
    label: "WebM video (.webm)",
    extension: "webm",
    // WebM is defined to carry VP8, VP9 and AV1 with Opus or Vorbis.
    videoCodec: "vp9",
    audioCodec: "opus",
    hint: "VP9 with Opus audio. Small files, plays in every browser.",
    isVideo: true,
  },
  {
    id: "capcut",
    label: "CapCut pack (.zip)",
    extension: "zip",
    videoCodec: null,
    audioCodec: null,
    hint: "An MP4 per scene with its own voice-over, plus subtitles.srt and a storyboard CSV.",
    isVideo: false,
  },
  {
    id: "json",
    label: "Scene JSON (.json)",
    extension: "json",
    videoCodec: null,
    audioCodec: null,
    hint: "The timeline as data, re-importable by dropping it back on a card.",
    isVideo: false,
  },
];

/** The container offered first when nothing has been chosen yet. */
export const DEFAULT_EXPORT_TARGET: ExportTarget = "mp4";

export function exportFormat(id: ExportTarget): ExportFormat {
  return (
    EXPORT_FORMATS.find((f) => f.id === id) ??
    EXPORT_FORMATS.find((f) => f.id === DEFAULT_EXPORT_TARGET)!
  );
}

/** Whether WebCodecs is present at all; without it nothing can be encoded. */
export function hasWebCodecs(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.VideoEncoder === "function" &&
    typeof window.VideoFrame === "function"
  );
}

export type ProbeContext = {
  width: number;
  height: number;
  frameRate: number;
  /** Whether the project has any audio to put in the file. */
  withAudio: boolean;
};

/** What the browser says about its encoders. Injected so it can be tested. */
export type EncodeProbe = {
  /** Whether WebCodecs exists at all; without it nothing can be encoded. */
  webCodecs: boolean;
  /**
   * Codec callbacks are given the context because support is not a property of
   * the codec alone: a browser that encodes H.264 at 720p can still refuse it
   * at 1080×1920, and the frame size is what decides.
   */
  canEncodeVideo: (
    codec: VideoCodecId,
    context: ProbeContext,
  ) => Promise<boolean>;
  canEncodeAudio?: (
    codec: AudioCodecId,
    context: ProbeContext,
  ) => Promise<boolean>;
};

/**
 * Asks the browser whether it can encode a format's codecs.
 *
 * The audio half is skipped when the project is silent: asking would report a
 * missing audio encoder for a file that has no audio track at all, which is a
 * false negative. An unknown answer is treated as yes, because refusing to
 * export on an inconclusive capability query would be worse than letting the
 * encoder fail with a real error.
 */
export async function probeTarget(
  format: ExportFormat,
  context: ProbeContext,
  probe: EncodeProbe,
): Promise<boolean> {
  if (!format.isVideo) return true;
  if (!probe.webCodecs) return false;
  if (!(await probe.canEncodeVideo(format.videoCodec!, context))) return false;
  if (!format.audioCodec || !context.withAudio || !probe.canEncodeAudio) {
    return true;
  }
  return probe.canEncodeAudio(format.audioCodec, context);
}

/**
 * Why a target is unavailable, phrased for the UI.
 *
 * A disabled option with no explanation reads as a bug, so the reason travels
 * with it. The project files are never blocked: they are written locally and
 * need no encoder. The WebCodecs answer is passed in rather than read from the
 * globals, so both branches are reachable from a test.
 */
export function unavailableReason(
  target: ExportTarget,
  options: { webCodecs: boolean; probed?: boolean } = { webCodecs: false },
): string | null {
  if (!exportFormat(target).isVideo) return null;
  // Before the probe answers, nothing is blocked; greying out a container for a
  // frame on every browser would be a lie.
  if (options.probed === false) return null;
  if (!options.webCodecs) return "This browser has no WebCodecs encoder.";
  return target === "mp4"
    ? "This browser cannot encode H.264 or AAC for MP4."
    : "This browser cannot encode VP9 or Opus for WebM.";
}
