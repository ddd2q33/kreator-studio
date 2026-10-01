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
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";

import { ExportCancelledError, throwIfCancelled } from "./export-cancel.ts";
import { hasWebCodecs, exportFormat, type EncodeProbe, type ExportTarget } from "./export-formats.ts";

/** Default frame rate of the exported file. */
export const EXPORT_FPS = 30;

/**
 * Bitrate target, in bits per second.
 *
 * Roughly 0.1 bits per pixel per frame, which lands near 8 Mbps for 1080p30.
 * That is generous for flat graphic slides and subtitles, which is what this
 * editor renders, and a still frame costs almost nothing to encode anyway.
 *
 * Passed as a plain number rather than wrapped in `Quality`. `Quality` takes a
 * qualitative *level* in its constructor, not a bitrate, so wrapping a bitrate in
 * it produced a config with no bitrate at all - the encoder was then told
 * "quantizer 0", which is the highest quality a codec can be asked for, and every
 * export came out far larger than this file's comment claimed.
 */
const bitsPerPixelPerFrame = 0.1;

function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * bitsPerPixelPerFrame);
}

/**
 * Audio bitrate target, in bits per second.
 *
 * 128 kbps, which is a normal target for speech. The audio track here is
 * narration over a flat graphic, never music, so anything higher would be spent
 * on information the picture does not contain.
 */
const audioBitrate = 128_000;

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
  /**
   * Aborts the render. Checked once per frame, which at 30fps means the export
   * reacts inside a frame's work rather than at the end of the scene.
   */
  signal?: AbortSignal;
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

/** Re-exported so callers get the encoder and its cancel contract from one place. */
export { ExportCancelledError, throwIfCancelled } from "./export-cancel.ts";

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

  // Before the capability probe, which is itself an await: an abort during it
  // would otherwise wait out the probe and then start encoding anyway.
  throwIfCancelled(options.signal);

  if (!(await canEncodeVideo(videoCodec, { width, height }))) {
    throw new VideoExportError(
      `This browser cannot encode ${videoCodec.toUpperCase()}, so a .${format.extension} cannot be produced here.`,
    );
  }

  // Everything that can still go wrong is inside this one try, including the
  // setup. It used to wrap only the frame loop, which meant a failure while
  // building the output - an audio encoder that throws when asked, a source the
  // container rejects - escaped as a raw exception and reached the UI as "the
  // export failed for an unknown reason", with the actual cause thrown away. The
  // audio half is where that happens: a project with no voice-over never touches
  // the audio encoder at all, so the bug only ever appeared on the projects that
  // had one.
  let started = false;
  let output: Output | null = null;
  try {
    // Audio is worth keeping, but not worth failing the whole export over: a
    // silent .mp4 still opens everywhere, so a missing encoder drops the track.
    let includeAudio = options.audio !== null;
    if (includeAudio) {
      const encodable = await canEncodeAudio(audioCodec);
      if (!encodable) includeAudio = false;
    }

    const outputFormat =
      format.id === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
    output = new Output({
      format: outputFormat,
      target: new BufferTarget(),
    });

    const videoSource = new CanvasSource(options.canvas, {
      codec: videoCodec,
      bitrate: videoBitrate(width, height, fps),
    });
    output.addVideoTrack(videoSource);

    let audioSource: AudioBufferSource | null = null;
    if (includeAudio && options.audio) {
      // The bitrate is required, not optional. A compressed audio codec with no
      // target is rejected with "config.quality must be provided", a refusal that
      // only ever happens on a project that has audio - so it read as "exporting
      // with sound is broken" rather than as a missing argument.
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: audioBitrate });
      output.addAudioTrack(audioSource);
    }

    await output.start();
    started = true;
    throwIfCancelled(options.signal);

    if (audioSource && options.audio) {
      // Added before the frames: the encoder needs to know the track exists
      // while the output is open, and one contiguous buffer needs no scheduling.
      await audioSource.add(options.audio);
      throwIfCancelled(options.signal);
    }

    const totalFrames = Math.max(1, Math.round(options.duration * fps));
    const frameDuration = 1 / fps;
    for (let i = 0; i < totalFrames; i++) {
      // Checked per frame, not per scene. At 30fps a four-second scene is 120
      // checks, so an abort is honoured inside one frame of work. Checking once
      // per scene would mean waiting out a scene that is already encoding, which
      // is precisely the wait someone hitting Cancel is trying to avoid.
      throwIfCancelled(options.signal);
      const time = i * frameDuration;
      await options.paintFrame(time);
      await videoSource.add(time, frameDuration);
      options.onProgress?.((i + 1) / totalFrames);
    }

    // finalize() resolves with nothing; the container's own mime type is the one
    // to label the file with, and it matches what was actually written.
    throwIfCancelled(options.signal);
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
  } catch (error) {
    // Cancelling releases the encoder resources instead of leaving them alive
    // after a failed export. Only safe once the output exists, and pointless
    // once it has been finalized, so both are checked rather than assumed.
    if (output && started) await output.cancel().catch(() => {});
    // A deliberate abort is passed through as itself: wrapping it would report
    // "the export failed" for something the user asked to stop, and the caller
    // needs the type to tell the two apart.
    if (error instanceof ExportCancelledError) throw error;
    throw new VideoExportError(
      error instanceof Error
        ? `The export failed: ${error.message}`
        : "The export failed for an unknown reason.",
    );
  }
}
