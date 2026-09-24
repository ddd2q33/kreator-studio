# Run doc — book-studio

## Reproduce the artifacts

A fresh checkout needs dependencies installed (Next.js 16 + Tailwind 4 + marked + docx):

```bash
npm install
```

No `.env.local` or other secret env files are required — the app is fully client-side with no external services.

## Run the server

```bash
npm run dev
```

Notes:

- Next.js 16 (Turbopack) picks the default port **3000**, but if another dev server for this directory is already running it refuses to start and prints the existing server's URL + PID (check `.next/dev/logs/next-development.log` or the stderr log for it). Prefer reusing the already-running server before starting a new one.
- To force a specific port: `npm run dev -- -p 50130`.
- Windows detached start (from the repo root):

  ```powershell
  powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
  ```

- Useful scripts: `npm run build` (production build), `npm run typecheck` (tsc --noEmit), `npm run lint` (eslint), `npm run book:build` / `book:pdf` (trauma-book-template pipeline, needs Edge/Chrome).
