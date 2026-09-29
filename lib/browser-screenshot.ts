/**
 * Screenshotting through the same local headless Chrome/Edge that
 * /api/export-pdf uses, found by lib/browser-print.ts.
 *
 * This is the whole trick behind WYSIWYG for the Post Editor. There is no
 * canvas-drawing library and no server-side image library: the browser that
 * draws the preview is the browser that draws the PNG, on the same machine, with
 * the same system fonts. There is no second renderer to disagree with the first.
 *
 * `--window-size` with `--screenshot` yields exactly that many pixels, so a
 * 1200x630 Facebook preview really is 1200x630 rather than a rounded viewport.
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { findBrowser } from "./browser-print.ts";

/**
 * Chrome will not paint anything that has not had a layout pass, and a document
 * that only resolves after load (fonts, the fit loop) needs its budget spent
 * actually waiting. 8s is far more than a local file needs and far less than the
 * 120s a hung browser would otherwise cost.
 */
const VIRTUAL_TIME_BUDGET = "8000";

/**
 * Headless refuses absurd window sizes, and a silently clamped canvas would
 * produce a PNG that does not match the preview — the exact failure this module
 * exists to prevent. So the bounds are enforced here and reported, not absorbed.
 */
export const MIN_EDGE = 64;
export const MAX_EDGE = 8000;

export type CaptureSize = { width: number; height: number };

export type CaptureResult = { ok: true } | { ok: false; error: string };

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForPng(pngPath: string, timeoutMs = 20000): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (existsSync(pngPath) && statSync(pngPath).size > 0) return true;
    } catch {
      // ignore transient fs errors while the browser flushes
    }
    sleepSync(250);
  }
  return false;
}

export function validateSize(size: CaptureSize): string | null {
  for (const [label, value] of [
    ["width", size.width],
    ["height", size.height],
  ] as const) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return `The ${label} must be a whole number of pixels.`;
    }
    if (value < MIN_EDGE || value > MAX_EDGE) {
      return `The ${label} must be between ${MIN_EDGE} and ${MAX_EDGE} pixels.`;
    }
  }
  return null;
}

/** Turns a Windows path into the file:/// URL a browser will accept. */
export function fileUrl(path: string): string {
  return "file:///" + path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Renders a local .html file to a .png of exactly `size` pixels.
 *
 * Returns a result rather than throwing: a failed render is a thing the author
 * can be told about in plain words, and the route turns that into a toast, not a
 * stack trace.
 */
export function captureToPng(
  htmlPath: string,
  pngPath: string,
  size: CaptureSize,
  profileDir: string = join(tmpdir(), "book-shot-profile"),
): CaptureResult {
  const invalid = validateSize(size);
  if (invalid) return { ok: false, error: invalid };

  const browser = findBrowser();
  if (!browser) {
    return {
      ok: false,
      error:
        "No Chrome or Edge found on this machine, so the image cannot be rendered. /api/export-pdf needs the same browser.",
    };
  }

  try {
    execFileSync(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        `--user-data-dir=${profileDir}`,
        "--hide-scrollbars",
        // Without this a display-scaled machine hands back a scaled PNG, and the
        // author gets an image twice the size they asked for.
        "--force-device-scale-factor=1",
        "--disable-lcd-text",
        // Anything that is not this exact size is a bug in the caller, and a
        // screenshot would hide it rather than surface it.
        `--window-size=${size.width},${size.height}`,
        `--screenshot=${pngPath}`,
        `--virtual-time-budget=${VIRTUAL_TIME_BUDGET}`,
        fileUrl(htmlPath),
      ],
      { stdio: "pipe", timeout: 120000 },
    );
  } catch (error) {
    const err = error as { stderr?: Buffer; message?: string };
    return {
      ok: false,
      error: `The browser did not produce a PNG. ${
        err.stderr?.toString().trim() || err.message || "unknown error"
      }`,
    };
  }

  if (!waitForPng(pngPath)) {
    return { ok: false, error: "The browser started but never wrote the image." };
  }
  return { ok: true };
}
