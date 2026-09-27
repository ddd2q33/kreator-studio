/**
 * Turns a painted canvas into a downloadable video file.
 *
 * The scene renderer already knows how to draw any frame of the timeline, so
 * this module does not know anything about scenes. It is handed a callback that
 * paints one instant in time, and it walks the timeline as fast as the encoder
 * will go, handing each result to a muxer that writes a real MP4 or WebM.
 *
 * That is the whole difference from the old approach. MediaRecorder could only
 * capture a canvas while it was being played back live, so exporting took as
 * long as the video and the container was whatever the browser offered. Here the
 * timestamps are supplied directly, so nothing has to play in real time, and the
 * codec pair is decided by the container rather than by the browser.
 *
 * Every frame is awaited. An encoder queue left to run free will grow without
 * bound on a long timeline and take the tab down with it, and the backpressure
 * this returns is also what keeps the progress bar honest.
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";

import { hasWebCodecs, exportFormat, type EncodeProbe, type ExportTarget } from "./export-formats";

/** Default frame rate of the exported file. */
export const EXPORT_FPS = 30;

/**
 * Bitrate target, in bits per second.
 *
 * Roughly 0.1 bits per pixel per frame, which lands near 8 Mbps for 1080p30.
 * That is generous for flat graphic slides and subtitles, which is what this
 * editor renders, and a still frame costs almost nothing to encode anyway.
 */
const bitsPerPixelPerFrame = 0.1;

function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * bitsPerPixelPerFrame);
}

export type RenderVideoOptions = {
  target: ExportTarget;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Total length in seconds. */
  duration: number;
  fps?: number;
  /**
   * The mixed voice-over for the whole timeline, already laid out at absolute
   * times. Null renders a silent file.
   */
  audio: AudioBuffer | null;
  /**
   * Paints the frame for a given time. Must be complete before it resolves,
   * because the next call reads the same canvas.
   */
  paintFrame: (time: number) => void | Promise<void>;
  /** Called with a 0..1 value as the render advances. */
  onProgress?: (fraction: number) => void;
};

export type RenderVideoResult = {
  blob: Blob;
  extension: string;
  /**
   * True when audio was requested but left out because the browser could not
   * encode the container's audio codec. Reported so the UI can say so rather
   * than handing over a silently mute file.
   */
  audioDropped: boolean;
};

export class VideoExportError extends Error {}

/**
 * The browser's real answer about its encoders, for the export selector.
 *
 * Built on Mediabunny's capability checks, which ask the browser about a
 * concrete configuration rather than about a codec name. That distinction is
 * the point: a browser can expose WebCodecs and still refuse H.264 at 1080×1920
 * on the current machine, and only the configured answer knows that. Finding it
 * out up front is the difference between a disabled option that explains itself
 * and an export that fails ten minutes in.
 *
 * A factory rather than a constant because `hasWebCodecs` must be read when the
 * probe runs: a module-level value would be captured during the server render,
 * where the globals do not exist, and would then be wrong on the client forever.
 */
export function webCodecsProbe(): EncodeProbe {
  return {
    webCodecs: hasWebCodecs(),
    canEncodeVideo: async (codec, context) => {
      if (!hasWebCodecs()) return false;
      try {
        return await canEncodeVideo(codec as VideoCodec, {
          width: context.width,
          height: context.height,
        });
      } catch {
        return false;
      }
    },
    canEncodeAudio: async (codec) => {
      if (typeof AudioEncoder !== "function") return false;
      try {
        return await canEncodeAudio(codec as AudioCodec);
      } catch {
        return false;
      }
    },
  };
}

/**
 * Encodes the timeline and returns the finished file.
 *
 * Throws VideoExportError with a message meant for the status line, rather than
 * letting a WebCodecs error surface as an opaque rejection.
 */
export async function renderVideoToFile(
  options: RenderVideoOptions,
): Promise<RenderVideoResult> {
  const format = exportFormat(options.target);
  if (!format.isVideo) {
    throw new VideoExportError(`${format.label} is not a video export.`);
  }

  const fps = options.fps ?? EXPORT_FPS;
  const width = options.width;
  const height = options.height;
  if (!(width > 0 && height > 0)) {
    throw new VideoExportError("The canvas has no size to export.");
  }
  if (!(options.duration > 0)) {
    throw new VideoExportError("The timeline is empty, so there is nothing to export.");
  }

  const videoCodec = format.videoCodec as VideoCodec;
  const audioCodec = format.audioCodec as AudioCodec;

  if (!(await canEncodeVideo(videoCodec, { width, height }))) {
    throw new VideoExportError(
      `This browser cannot encode ${videoCodec.toUpperCase()}, so a .${format.extension} cannot be produced here.`,
    );
  }

  // Audio is worth keeping, but not worth failing the whole export over: a
  // silent .mp4 still opens everywhere, so a missing encoder drops the track.
  let includeAudio = options.audio !== null;
  if (includeAudio) {
    const encodable = await canEncodeAudio(audioCodec);
    if (!encodable) includeAudio = false;
  }

  const outputFormat =
    format.id === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({
    format: outputFormat,
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(options.canvas, {
    codec: videoCodec,
    bitrate: new Quality(videoBitrate(width, height, fps)),
  });
  output.addVideoTrack(videoSource);

  let audioSource: AudioBufferSource | null = null;
  if (includeAudio && options.audio) {
    audioSource = new AudioBufferSource({ codec: audioCodec });
    output.addAudioTrack(audioSource);
  }

  await output.start();

  try {
    if (audioSource && options.audio) {
      // Added before the frames: the encoder needs to know the track exists
      // while the output is open, and one contiguous buffer needs no scheduling.
      await audioSource.add(options.audio);
    }

    const totalFrames = Math.max(1, Math.round(options.duration * fps));
    const frameDuration = 1 / fps;
    for (let i = 0; i < totalFrames; i++) {
      const time = i * frameDuration;
      await options.paintFrame(time);
      await videoSource.add(time, frameDuration);
      options.onProgress?.((i + 1) / totalFrames);
    }
  } catch (error) {
    // Leaves the output in a clean state so the encoder resources are released
    // instead of lingering after a failed export.
    await output.cancel().catch(() => {});
    throw new VideoExportError(
      error instanceof Error
        ? `The export failed: ${error.message}`
        : "The export failed for an unknown reason.",
    );
  }

  // finalize() resolves with nothing; the container's own mime type is the one
  // to label the file with, and it matches what was actually written.
  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) {
    throw new VideoExportError("The export produced no data.");
  }

  return {
    blob: new Blob([buffer], { type: outputFormat.mimeType }),
    extension: format.extension,
    audioDropped: options.audio !== null && !includeAudio,
  };
}
