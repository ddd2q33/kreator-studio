/**
 * Shared headless Chrome/Edge printing, used by /api/export-pdf and the
 * book-author CLI (`book-author pdf`). One-shot CLI print with an isolated
 * profile — the same technique trauma-book-template/to-pdf.mjs proved out.
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe")
    : null,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Microsoft\\Edge\\Application\\msedge.exe")
    : null,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => Boolean(p));

export function findBrowser(): string | null {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForPdf(pdfPath: string, timeoutMs = 20000): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (existsSync(pdfPath) && statSync(pdfPath).size > 1000) return true;
    } catch {
      // ignore transient fs errors while the browser flushes
    }
    sleepSync(250);
  }
  return existsSync(pdfPath) && statSync(pdfPath).size > 1000;
}

/**
 * Print a local .html file to .pdf through headless Chromium.
 * `profileDir` defaults to an OS temp dir; pass a stable dir for repeated CLI
 * runs. Throws with the browser's stderr on failure.
 */
export function printToPdf(
  htmlPath: string,
  pdfPath: string,
  profileDir: string = join(tmpdir(), "book-print-profile"),
): void {
  const browser = findBrowser();
  if (!browser) {
    throw new Error("No Chrome/Edge installation found on this machine.");
  }
  const url =
    "file:///" + htmlPath.replace(/\\/g, "/").replace(/^\/+/, "");
  try {
    execFileSync(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--user-data-dir=" + profileDir,
        "--no-pdf-header-footer",
        "--print-to-pdf=" + pdfPath,
        "--virtual-time-budget=8000",
        url,
      ],
      { stdio: "pipe", timeout: 120000 },
    );
  } catch (error) {
    const err = error as { stderr?: Buffer; message?: string };
    throw new Error(
      `Browser did not produce a PDF (${browser}). ${
        err.stderr?.toString().trim() || err.message || "unknown error"
      }`,
    );
  }
  if (!waitForPdf(pdfPath)) {
    throw new Error("Browser did not produce a PDF file.");
  }
}
