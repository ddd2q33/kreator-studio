/**
 * Turning a dropped photo into something a draft can carry.
 *
 * A modern phone camera hands over six megabytes and 4000 pixels. Carrying that
 * into a localStorage draft, into an 8MB request body, and into a headless
 * render is wasteful at every step, and the canvas is at most 1600 pixels wide
 * — so a 4000px original buys nothing but latency. The image is reduced once,
 * here, and everything downstream works with the small one.
 */

export type ResizeOutcome =
  | { ok: true; dataUrl: string; width: number; height: number; bytes: number }
  | { ok: false; error: string };

/**
 * The widest canvas in the studio is X at 1600px, and a `cover` crop never
 * benefits from more source pixels than the frame it fills.
 */
export const MAX_SOURCE_EDGE = 1600;

/**
 * JPEG at this quality is indistinguishable from the original on a phone screen
 * and roughly a fifth of the bytes. PNG is kept only for images that actually
 * have transparency, where JPEG would put a black box behind a logo.
 */
const JPEG_QUALITY = 0.82;

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file could not be read as an image."));
    img.src = dataUrl;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

export function isAcceptedImage(file: File): boolean {
  // A .heic from an iPhone reports a MIME type Chrome cannot decode, so the
  // extension is checked too and the decode itself is the real gate.
  return ACCEPTED.includes(file.type) || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name);
}

export async function prepareBackground(file: File): Promise<ResizeOutcome> {
  if (!isAcceptedImage(file)) {
    return { ok: false, error: "Drop a PNG, JPEG, WebP or GIF file." };
  }

  let original: HTMLImageElement;
  let raw: string;
  try {
    raw = await readAsDataUrl(file);
    original = await loadImage(raw);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "That image could not be decoded by this browser.",
    };
  }

  const { naturalWidth: w, naturalHeight: h } = original;
  if (!w || !h) {
    return { ok: false, error: "That image has no readable dimensions." };
  }

  // Never upscale: a 400px image blown up to 1600px is not more detail, it is
  // the same pixels with more memory behind them.
  const scale = Math.min(1, MAX_SOURCE_EDGE / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { ok: false, error: "This browser refused a 2D canvas for the image." };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(original, 0, 0, width, height);

  // Transparency is only meaningful if the source actually has some; probing a
  // single pixel is enough to choose the format, because a photo that happens to
  // be transparent in one corner still has to keep an alpha channel.
  let mime = "image/jpeg";
  if (file.type === "image/png" || file.type === "image/gif" || file.type === "image/webp") {
    const probe = ctx.getImageData(0, 0, 1, 1).data;
    if (probe[3] < 255) mime = "image/png";
  }

  const dataUrl =
    mime === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  if (!dataUrl || dataUrl === "data:,") {
    return { ok: false, error: "This browser could not re-encode the image." };
  }

  return { ok: true, dataUrl, width, height, bytes: Math.round((dataUrl.length * 3) / 4) };
}

/** A short, human-readable size for the label under the thumbnail. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
