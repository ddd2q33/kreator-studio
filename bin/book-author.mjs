#!/usr/bin/env node
/**
 * book-author — headless build CLI for Kreator Studio v1.
 *
 * Renders Markdown (or a book.json manifest + chapters/*.md) into the same
 * outputs the web app produces, by importing the app's own engines:
 *
 *   lib/render-engine.ts   markdown → HTML (same renderer as the UI preview)
 *   lib/book-files.ts      git-friendly book format + standalone HTML assembly
 *   lib/docx-node.ts       HTML → .docx via lib/docx-export.ts (no canvas needed)
 *
 * Requires Node 22.6+ (native TypeScript type stripping; tested on Node 24).
 *
 * Commands:
 *   book-author build <input> [--out FILE] [--template ID] [--name NAME] [--no-docx]
 *       input: a .md file, or a folder with book.json and/or chapters/*.md
 *       outputs: <name>.html (always) + <name>.docx (unless --no-docx)
 *   book-author docx  <input> [-o FILE] [--template ID]
 *   book-author html  <input> [-o FILE] [--template ID]
 *   book-author pdf   <input> [-o FILE] [--template ID]
 *       Prints through headless Chrome/Edge (same detection as /api/export-pdf).
 *   book-author templates            List available book templates.
 *   book-author init [DIR]           Scaffold book.json + chapters/.
 *
 * Folder format (git-friendly: one .md per chapter, one diff per paragraph):
 *   my-book/
 *     book.json            { "name": "...", "templateId": "trauma" }
 *     chapters/01-intro.md
 *     chapters/02-building-safety.md
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/* ---------------- engines ---------------- */

const engines = await Promise.all([
  import(pathToFileURL(join(APP_ROOT, "lib", "book-files.ts")).href),
  import(pathToFileURL(join(APP_ROOT, "lib", "docx-node.ts")).href),
  import(pathToFileURL(join(APP_ROOT, "lib", "docx-export.ts")).href),
]);
const {
  renderBookHtml,
  bookFileFromJson,
  markdownFromBook,
  defaultTemplateId,
} = engines[0];
const { docxBlobFromHtml } = engines[1];
const { suggestedFilename } = engines[2];

/* ---------------- helpers ---------------- */

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" || arg === "-o") args.out = argv[++i];
    else if (arg === "--template" || arg === "-t") args.template = argv[++i];
    else if (arg === "--name" || arg === "-n") args.name = argv[++i];
    else if (arg === "--no-docx") args.noDocx = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else args._.push(arg);
  }
  return args;
}

/** Normalize any input (file or folder) into { path, markdown, book, name }. */
function loadInput(inputPath, args) {
  if (!existsSync(inputPath)) die(`Input not found: ${inputPath}`);
  const stat = statSync(inputPath);

  if (stat.isFile()) {
    if (!/\.(md|markdown|mdown)$/i.test(inputPath)) {
      die(`Unsupported input: ${inputPath} (use .md or a folder with book.json)`);
    }
    const markdown = readFileSync(inputPath, "utf8");
    const name =
      args.name ||
      suggestedFilename(markdown) ||
      basename(inputPath).replace(/\.(md|markdown|mdown)$/i, "");
    return { path: inputPath, markdown, book: null, name };
  }

  // Folder: book.json (optional) + chapters/*.md (optional but at least one source).
  const manifestPath = join(inputPath, "book.json");
  const chaptersDir = join(inputPath, "chapters");
  let book = existsSync(manifestPath)
    ? bookFileFromJson(readFileSync(manifestPath, "utf8"), basename(inputPath))
    : null;

  const chapterFiles = existsSync(chaptersDir)
    ? readdirSync(chaptersDir)
        .filter((f) => /\.(md|markdown|mdown)$/i.test(f))
        .sort()
    : [];
  if (chapterFiles.length > 0) {
    book = {
      name: book?.name ?? basename(inputPath),
      templateId: book?.templateId ?? null,
      presetId: book?.presetId ?? null,
      bookMode: true,
      chapters: chapterFiles.map((file, i) => {
        const md = readFileSync(join(chaptersDir, file), "utf8").trim();
        const m = /^#\s+(.+)$/m.exec(md);
        return {
          id: `ch-${i + 1}`,
          title: m ? m[1].trim() : `Chapter ${i + 1}`,
          markdown: md,
        };
      }),
    };
  }
  if (!book || book.chapters.length === 0) {
    die(
      `Folder input needs book.json with chapters[] or chapters/*.md files (run \`book-author init\`).`,
    );
  }
  return {
    path: inputPath,
    markdown: markdownFromBook(book),
    book,
    name: args.name || book.name || basename(inputPath),
  };
}

/** Default output path: next to the input, so sources stay together. */
function outDefault(input, name, ext) {
  return resolve(dirname(input.path), `${name}.${ext}`);
}

function templateOf(input, args) {
  return args.template || input.book?.templateId || defaultTemplateId();
}

/* ---------------- PDF printing (shared lib/browser-print.ts) ---------------- */

function printViaSharedLib(htmlPath, pdfPath) {
  return import(
    pathToFileURL(join(APP_ROOT, "lib", "browser-print.ts")).href
  ).then(({ printToPdf }) => printToPdf(htmlPath, pdfPath));
}

/* ---------------- commands ---------------- */

async function cmdBuild(input, args) {
  const templateId = templateOf(input, args);
  console.log(`→ Rendering "${input.name}" (template: ${templateId})…`);
  const rendered = renderBookHtml(input.markdown, { templateId });

  const htmlPath = args.out ? resolve(args.out) : outDefault(input, input.name, "html");
  writeFileSync(htmlPath, rendered.fullHtml, "utf8");
  console.log(`✔ ${htmlPath}`);

  if (!args.noDocx) {
    // Keep the .docx next to the .html (honors --out's directory).
    const docxPath = htmlPath.replace(/\.html?$/i, ".docx");
    const buffer = await docxBlobFromHtml(rendered.fullHtml, templateId);
    writeFileSync(docxPath, buffer);
    console.log(`✔ ${docxPath}`);
  }
}

async function cmdDocx(input, args) {
  const templateId = templateOf(input, args);
  const rendered = renderBookHtml(input.markdown, { templateId });
  const docxPath = args.out ? resolve(args.out) : outDefault(input, input.name, "docx");
  const buffer = await docxBlobFromHtml(rendered.fullHtml, templateId);
  writeFileSync(docxPath, buffer);
  console.log(`✔ ${docxPath}`);
}

async function cmdHtml(input, args) {
  const templateId = templateOf(input, args);
  const rendered = renderBookHtml(input.markdown, { templateId });
  const htmlPath = args.out ? resolve(args.out) : outDefault(input, input.name, "html");
  writeFileSync(htmlPath, rendered.fullHtml, "utf8");
  console.log(`✔ ${htmlPath}`);
}

async function cmdPdf(input, args) {
  const templateId = templateOf(input, args);
  const rendered = renderBookHtml(input.markdown, { templateId });
  // The .html is an intermediate; keep it next to the pdf (useful for QA).
  const htmlPath = outDefault(input, input.name, "html");
  writeFileSync(htmlPath, rendered.fullHtml, "utf8");
  const pdfPath = args.out ? resolve(args.out) : outDefault(input, input.name, "pdf");
  console.log("→ Printing (can take ~10-30 s)…");
  try {
    await printViaSharedLib(htmlPath, pdfPath);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  console.log(`✔ ${pdfPath}`);
}

function cmdTemplates() {
  return import(
    pathToFileURL(join(APP_ROOT, "components", "templates.ts")).href
  ).then(({ TEMPLATES }) => {
    console.log("Available templates:");
    for (const t of TEMPLATES) {
      console.log(`  ${t.id.padEnd(12)} ${t.label} — ${t.description}`);
    }
  });
}

function cmdInit(dir) {
  const target = resolve(dir || "my-book");
  if (existsSync(target)) die(`Folder already exists: ${target}`);
  mkdirSync(join(target, "chapters"), { recursive: true });
  writeFileSync(
    join(target, "book.json"),
    JSON.stringify(
      {
        name: basename(target),
        templateId: defaultTemplateId(),
        presetId: null,
        bookMode: true,
        chapters: [],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(
    join(target, "chapters", "01-intro.md"),
    "# Chapter 1. Introduction\n\nStart writing…\n",
    "utf8",
  );
  console.log(`✔ Scaffolded ${target}`);
  console.log("  Drop .md files into chapters/ (filename order = book order) and run");
  console.log("  `book-author build " + basename(target) + "`.");
}

/* ---------------- main ---------------- */

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const inputArg = args._[1] ? resolve(args._[1]) : null;

if (args.help || !command) {
  console.log(
    [
      "book-author — headless build CLI for Kreator Studio v1",
      "",
      "Usage:",
      "  book-author build <input.md | folder> [--out FILE] [--template ID] [--no-docx]",
      "  book-author docx  <input.md | folder> [-o FILE] [--template ID]",
      "  book-author html  <input.md | folder> [-o FILE] [--template ID]",
      "  book-author pdf   <input.md | folder> [-o FILE] [--template ID]",
      "  book-author templates",
      "  book-author init [DIR]",
      "",
      "Folder format: book.json + chapters/*.md (one .md per chapter).",
      "Node 22.6+ required (native TypeScript type stripping).",
    ].join("\n"),
  );
  process.exit(0);
}

if (command === "templates") {
  await cmdTemplates();
  process.exit(0);
}

if (command === "init") {
  cmdInit(inputArg ?? undefined);
  process.exit(0);
}

if (!["build", "docx", "html", "pdf"].includes(command)) {
  die(`Unknown command: ${command} (try --help)`);
}
if (!inputArg) {
  die(`Missing input for "${command}". Pass a .md file or a folder.`);
}

const input = loadInput(inputArg, args);
if (command === "build") await cmdBuild(input, args);
else if (command === "docx") await cmdDocx(input, args);
else if (command === "html") await cmdHtml(input, args);
else await cmdPdf(input, args);
