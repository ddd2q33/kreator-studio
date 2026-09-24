import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function findBrowser(): string | null {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
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

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeWorkdir(workdir: string, attempts = 10): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(workdir, { recursive: true, force: true });
      return;
    } catch {
      sleepSync(300);
    }
  }
}

function printViaCli(
  browser: string,
  htmlPath: string,
  pdfPath: string,
  profileDir: string,
): void {
  const url = "file:///" + htmlPath.replace(/\\/g, "/");
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
  waitForPdf(pdfPath);
}

export async function POST(request: Request): Promise<Response> {
  let html = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") {
      const candidate = (body as { html?: unknown }).html;
      if (typeof candidate === "string") html = candidate;
    }
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  if (!html.trim()) return new Response("No HTML content provided.", { status: 400 });
  if (html.length > 20_000_000) {
    return new Response("HTML too large to export.", { status: 413 });
  }

  const browser = findBrowser();
  if (!browser) {
    return new Response(
      "No Chrome/Edge installation found on the server.",
      { status: 500 },
    );
  }

  const workdir = mkdtempSync(join(tmpdir(), "pdf-export-"));
  const htmlPath = join(workdir, "book.html");
  const pdfPath = join(workdir, "book.pdf");
  const profileDir = join(workdir, "profile");

  try {
    writeFileSync(htmlPath, html, "utf8");
    printViaCli(browser, htmlPath, pdfPath, profileDir);
    if (!existsSync(pdfPath) || statSync(pdfPath).size < 1000) {
      throw new Error("Browser did not produce a PDF file.");
    }
  } catch (error) {
    console.error("PDF export failed:", error);
    removeWorkdir(workdir);
    const message =
      error instanceof Error ? error.message : "PDF generation failed.";
    return new Response(message, { status: 500 });
  }

  const data = readFileSync(pdfPath);
  removeWorkdir(workdir);

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="document.pdf"',
      "Cache-Control": "no-store",
    },
  });
}