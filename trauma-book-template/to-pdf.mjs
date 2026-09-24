#!/usr/bin/env node
/**
 * trauma-book-template PDF exporter
 * ----------------------------------
 * html/book.html → output/final-book.pdf (6×9in, KDP-ready)
 *
 * Uses Chromium's one-shot CLI print (works with Chrome or Edge, no CDP):
 *   msedge --headless --print-to-pdf=... --no-pdf-header-footer file://...
 * The CSS `@page { size: 6in 9in }` controls the geometry
 * (verified: MediaBox [0 0 432 648] = 6×9in, 72dpi points).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = pathDirname(fileURLToPath(import.meta.url));

/* ---------------- 1. Build fresh HTML ---------------- */

console.log("→ Building HTML…");
try {
  execFileSync(process.execPath, [join(ROOT, "build.mjs")], { stdio: "inherit" });
} catch {
  console.error("✗ build.mjs failed");
  process.exit(1);
}

/* ---------------- 2. Locate a Chromium browser ---------------- */

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe")
    : null,
  // Microsoft Edge is Chromium and prints identically
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function findBrowser() {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  return null;
}

/* ---------------- 3. One-shot CLI print ---------------- */

function printViaCli(browser, htmlPath, pdfPath) {
  const url = "file:///" + htmlPath.replace(/\\/g, "/");
  const profile = join(ROOT, "output", ".print-profile");
  mkdirSync(profile, { recursive: true });
  execFileSync(
    browser,
    [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      // Isolated profile: prevents attaching to the user's running browser,
      // which would hand off the print job and exit without producing a PDF.
      `--user-data-dir=${profile}`,
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      "--virtual-time-budget=8000", // let web fonts + layout settle
      url,
    ],
    { stdio: "ignore", timeout: 120000 },
  );
}

/* ---------------- 4. Verify page size + count ---------------- */

function inspectPdf(pdfPath) {
  const buf = readFileSync(pdfPath);
  const text = buf.toString("latin1");
  const media = text.match(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const count = text.match(/\/Count\s+(\d+)/);
  let sizeNote = "unknown size";
  let pages = "?";
  if (media) {
    const w = Math.round(parseFloat(media[3]));
    const h = Math.round(parseFloat(media[4]));
    const wIn = (w / 72).toFixed(2);
    const hIn = (h / 72).toFixed(2);
    sizeNote = `${w}×${h} pt = ${wIn}×${hIn} in`;
  }
  if (count) pages = count[1];
  return { sizeNote, pages, bytes: buf.length };
}

/* ---------------- Main ---------------- */

function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error("✗ No Chrome/Edge found. Install Chrome or set CHROME_PATH.");
    process.exit(1);
  }
  console.log(`→ Browser: ${browser}`);

  const htmlPath = join(ROOT, "html", "book.html");
  const pdfPath = join(ROOT, "output", "final-book.pdf");
  mkdirSync(join(ROOT, "output"), { recursive: true });

  console.log("→ Printing (this can take ~10-30 s)…");
  printViaCli(browser, htmlPath, pdfPath);

  if (!existsSync(pdfPath) || statSync(pdfPath).size < 1000) {
    console.error("✗ PDF was not produced.");
    process.exit(1);
  }

  const { sizeNote, pages, bytes } = inspectPdf(pdfPath);
  console.log(`✔ output/final-book.pdf`);
  console.log(`  Pages: ${pages} · Size: ${sizeNote} · ${(bytes / 1024).toFixed(0)} KB`);
  if (sizeNote !== "432×648 pt = 6.00×9.00 in") {
    console.log("  ⚠ Page size differs from 6×9 — check @page rules in css/print.css");
  } else {
    console.log("  ✓ KDP trim size 6×9 confirmed");
  }
}

main();
