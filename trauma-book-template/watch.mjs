#!/usr/bin/env node
// trauma-book-template dev watcher
// Rebuilds html/ whenever manuscript/ or css/ change.
import { watch } from "node:fs";
import { join, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = pathDirname(fileURLToPath(import.meta.url));

function build() {
  try {
    execFileSync(process.execPath, [join(ROOT, "build.mjs")], { stdio: "inherit" });
  } catch {
    /* keep watching; errors are shown by build output */
  }
}

build();

for (const dir of ["manuscript", "css"]) {
  watch(join(ROOT, dir), { recursive: true }, () => {
    console.log("↻ change detected — rebuilding…");
    build();
  });
}

console.log(" Watching manuscript/ and css/ — Ctrl+C to stop.");
