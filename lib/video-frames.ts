/**
 * Pulls stills out of a video file, entirely in the browser.
 *
 * There is no server round-trip on purpose: the file never leaves the machine
 * and the frames come back as data URLs that drop straight into the existing
 * shared image pool.
 *
 * The caller is responsible for storage. A 1080p JPEG still is ~300 KB, and
 * localStorage caps out around 5 MB for the whole origin, so a dozen frames is
 * already a large share of the budget.
 */

import { coverRect, frameCountForDuration, frameTimestamps, secondsPerFrame } from "./frame-sampling.ts";

export type ExtractFramesOptions = {
  /**
   * How many stills to take. Left out, the clip's own runtime decides it, which
   * is why the count does not have to be known before the file is opened.
   */
  count?: number;
  /** Output size; frames are cover-cropped to fill it, never stretched. */
  width: number;
  height: number;
  /** JPEG quality, 0-1. */
  quality?: number;
  onProgress?: (done: number, total: number) => void;
};

export type ExtractedFrames = {
  dataUrls: string[];
  /** The moments actually sampled, in order. */
  timestamps: number[];
  /** Duration the browser reported, which may differ from what we asked for. */
  durationSeconds: number;
  /** Suggested scene length once the runtime is shared across the frames. */
  secondsEach: number;
  sourceWidth: number;
  sourceHeight: number;
};

const METADATA_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 15_000;

export async function extractVideoFrames(
  file: File,
  options: ExtractFramesOptions,
): Promise<ExtractedFrames> {
  if (typeof document === "undefined") {
    throw new Error("Frame extraction needs a browser.");
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForEvent(video, "loadedmetadata", METADATA_TIMEOUT_MS, (el) =>
      el.error ? decodeError(el.error) : null,
    );

    const durationSeconds = video.duration;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("That file has no readable duration.");
    }
    if (!sourceWidth || !sourceHeight) {
      throw new Error("That file has no readable video track.");
    }

    // The browser's own duration wins over any requested count, so a long clip
    // is not sampled more densely than a short one.
    const count = options.count ?? frameCountForDuration(durationSeconds);
    const times = frameTimestamps(durationSeconds, count);
    if (times.length === 0) {
      throw new Error("Could not work out where to take frames from.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(options.width));
    canvas.height = Math.max(1, Math.round(options.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser blocked the 2D canvas.");

    const quality = options.quality ?? 0.85;
    const dataUrls: string[] = [];

    for (const [i, t] of times.entries()) {
      await seekTo(video, t);
      const r = coverRect(
        sourceWidth,
        sourceHeight,
        canvas.width,
        canvas.height,
      );
      ctx.drawImage(video, r.x, r.y, r.width, r.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (!dataUrl.startsWith("data:image/jpeg")) {
        throw new Error("This browser could not encode the frame as JPEG.");
      }
      dataUrls.push(dataUrl);
      options.onProgress?.(i + 1, times.length);
    }

    return {
      dataUrls,
      timestamps: times,
      durationSeconds,
      secondsEach: secondsPerFrame(durationSeconds, times.length),
      sourceWidth,
      sourceHeight,
    };
  } finally {
    // Drop the decoder so a long clip does not keep a buffer alive.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.001) {
      resolve();
      return;
    }
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(decodeError(video.error));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking to ${time.toFixed(2)}s.`));
    }, SEEK_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

function waitForEvent(
  el: HTMLVideoElement,
  event: string,
  timeoutMs: number,
  precheck: (el: HTMLVideoElement) => Error | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = precheck(el);
    if (fail) {
      reject(fail);
      return;
    }
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(precheck(el) ?? new Error(`The browser could not open that file.`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out opening the video."));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
    };
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

function decodeError(err: MediaError | null): Error {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return new Error(
        "This browser cannot decode that video. Try MP4 (H.264) or WebM.",
      );
    case MediaError.MEDIA_ERR_DECODE:
      return new Error("That video is corrupt or uses an unsupported codec.");
    case MediaError.MEDIA_ERR_ABORTED:
      return new Error("Reading the video was interrupted.");
    case MediaError.MEDIA_ERR_NETWORK:
      return new Error("The video could not be read from disk.");
    default:
      return new Error("This browser cannot decode that video.");
  }
}
