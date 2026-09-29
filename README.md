# Kreator Studio v1

Studio de escritura y publicación en una sola página (one-page app). Convierte **Markdown / JSON → HTML**, con exportación profesional a **DOCX, PDF, EPUB y Markdown**, y además genera **videos promocionales de capítulos** en la misma herramienta.

> Nombre interno (package.json): `book-studio` · CLI: `book-author`.

---

## Qué es

Una aplicación web (Next.js 16, App Router, React 19, TypeScript, Tailwind v4) con dos espacios de trabajo separados:

1. **Book Editor** — escribir el libro en Markdown (o capítulos sueltos / JSON), con estilos de plantilla, revisión, proyectos, notas y exportación de calidad profesional.
2. **Video Editor** — crear un "promo" por capítulo como un video animado de escenas (canvas/webm) y exportar un pack listo para editar en CapCut, con resoluciones HD/Full HD/4K.

Todo cabe en una pantalla (layout `h-dvh` + `overflow-hidden`), estilo software de escritorio: app-bar superior con tabs Book Editor/Video Editor, toolbar contextual y panel preview/editor.

---

## Getting Started

Requisitos: **Node 22.6+** (necesario para el CLI por type stripping; recommend 24). Chrome/Edge instalado para export PDF.

```bash
npm install
npm run dev        # → http://localhost:3000
```

Scripts útiles:

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Servir el build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Tests (node:test, `tests/*.test.ts`) |
| `node bin/book-author.mjs --help` | CLI headless de build (ver abajo) |

> Lint actual: 0 errores, 3 warnings preexistentes (directivas `eslint-disable` sin uso y una constante sin usar, todas del Post Editor).

---

## Cómo funciona

**Pipeline de renderizado** (un solo motor compartido, `lib/render-engine.ts`):

```
Markdown (con directivas ::: ) ──► marked + highlight.js + processDirectives ──► HTML
                                      │
                ┌─────────────────────┼──────────────────────┐
                ▼                     ▼                      ▼
  UI preview (navegador)    API /api/preview       CLI book-author
                              API /api/convert-docx
```

El motor es **isomórfico a propósito**: sin DOM y sin builtins de Node para que el mismo render lo usen la UI, las APIs y el CLI sin divergir.

**Flujo de edición:**
- El usuario escribe Markdown (o JSON) → se renderiza HTML en vivo.
- La pestaña **HTML** permite editar el HTML generado a mano (toma control del preview y de los exports; `Regenerate from Markdown` vuelve al generado).
- Stats de caracteres/palabras/líneas, autosave, vista "Página" (A4/Letter/Legal/A5 con cortes de página y conteo).

**Flujo de exportación:**
- DOCX → `lib/docx-export.ts` (generación server, ver `/api/convert-docx`).
- PDF → `/api/export-pdf` (Chrome headless vía DevTools, `lib/browser-print.ts`).
- EPUB → `lib/epub-export.ts` (JSZip).
- Multi-capítulo ("Compile book") une todos los capítulos con TOC y estructura.

**Video Editor:**
- `components/editor/video-studio.tsx` — escenas pintadas en canvas (`paintScene`), timeline horizontal tipo CapCut con miniaturas, play/preview, orientación Vertical/Horizontal y resoluciones 720p/1080/1440p/2160p.
- **Export CapCut pack** → ZIP (JSZip) con un PNG por escena + `storyboard.csv` + `README.txt` para reensamblar el promocional en CapCut.
- El botón de exportar vídeo (MP4/WebM) codifica con `lib/video-export.ts`: `renderVideoToFile()` usa WebCodecs a través de Mediabunny, nunca `MediaRecorder`.

---

## Estructura del proyecto

```
app/
  page.tsx                  ← one-page shell (h-dvh)
  layout.tsx                ← metadata, tema (next-themes), tooltips, toaster
  globals.css               ← Tailwind v4 + estilos
  api/
    preview/route.ts        ← POST Markdown → HTML (mismo motor que la UI)
    convert-docx/route.ts   ← POST HTML → .docx
    export-pdf/route.ts     ← POST HTML → .pdf (Chrome headless)
  manuscript-editor/         ← /manuscript-editor (redirect de la raíz)
  video-editor/              ← /video-editor
components/
  markdown-converter.tsx    ← app principal (app-bar, rail de paneles, editor, preview)
  studio-header.tsx          ← app-bar con los dos tabs (derivados de la URL)
  templates.ts              ← plantillas de libro (style CSS por tema)
  editor/                   ← writer-toolbar, panels, project-manager, video-studio…
  ui/                       ← shadcn components (button, badge, select, tabs, tooltip…)
lib/
  render-engine.ts          ← motor Markdown→HTML compartido (isomórfico)
  directives.ts             ← directivas ::: (train callouts, boxes, tables…)
  book-files.ts             ← formato libro git-friendly (book.json + chapters/*.md)
  docx-export.ts            ← export DOCX profesional
  docx-node.ts              ← DOCX sin canvas (para Node/CLI)
  epub-export.ts            ← export EPUB (JSZip)
  browser-print.ts          ← impresión PDF headless
  quality-check.ts          ← validadores de calidad (heading hierarchy, tables, links, boxes, figuras)
  json-to-markdown.ts       ← conversor JSON del editor
  projects.ts               ← persistencia de proyectos (localStorage)
  video-export.ts           ← export de vídeo (Mediabunny + WebCodecs, con audio)
  export-formats.ts         ← MP4/WebM: sondeo del encoder y motivo de rechazo
  book-zip.ts / book-files.ts / image-size.ts / diff.ts / utils.ts
bin/
  book-author.mjs           ← CLI headless (build/html/docx/pdf/templates/init)
tests/                      ← tests node:test (render-engine, book-files, book-zip, image-size, scene-*)
trauma-book-template/       ← plantilla independiente (workbook terapeútico → PDF 6×9 KDP)
```

### Paneles del editor (rail izquierdo)

| Icono | Panel | Descripción |
|---|---|---|
| 📁 Projects | `project-manager.tsx` | Crear/renombrar/duplicar/borrar proyectos con revisiones |
| 🎨 Presets | `presets-panel.tsx` | Aplicar presets de estilo/plantilla |
| 🧱 Blocks | `blocks-panel.tsx` | Insertar bloques de contenido (biblioteca `block-library.tsx`) |
| 🕘 Revisions | `revisions-panel.tsx` | Guardar/restaurar revisiones del documento |
| 💬 Notes | `comments-panel.tsx` | Notas por capítulo con resolved |
| 🛡 Quality | `quality-panel.tsx` | Check de calidad automático + LanguageTool (ortografía/gramática) |

---

## Directivas y formatos soportados

Además de Markdown estándar (**negrita**, *cursiva*, `código`, links, listas, tablas, `##`–`####`, `==highlight==`), el motor entiende **directivas de bloque**:

```md
::: box insight
Contenido de la caja…
:::
```

Bloques disponibles: `titlepage`, `copyright`, `disclaimer`, `dedication`, `page`, `chapter`, `tool`, `box` (insight/science/reflection/therapist/important), `worksheet`, `reflection`, `summary`, `quote`, `diagram`, `figure`, `table`, `resources`. Los bloques se pueden **anidar**.

API de preview: `POST /api/preview` con `{ markdown, templateId?, themeCss?, images? }`; query `?raw=1` devuelve solo el fragmento HTML y `?chapters=1` envuelve cada capítulo en `<section class="book-chapter">`.

---

## CLI headless (`book-author`)

Builds de libros sin interfaz, reutilizando los mismos motores de la app:

```bash
node node_modules/.bin/book-author build ./mi-libro        # → mi-libro.html + .docx
node node_modules/.bin/book-author build libro.md --out out.html
node node_modules/.bin/book-author pdf libro.md -o book.pdf
node node_modules/.bin/book-author templates
node node_modules/.bin/book-author init ./nuevo-libro      # scaffold book.json + chapters/
```

Formato "libro" (git-friendly): una carpeta con `book.json` + `chapters/*.md` (un .md por capítulo).
Requiere Node 22.6+ (type stripping). Ver `bin/book-author.mjs` para flags completos.

---

## Ideas para mejorar (roadmap)

- [ ] Extender la biblioteca de bloques y preset sheets (`components/editor/block-library.tsx`, `book-presets.tsx`).
- [ ] Más plantillas de libro en `components/templates.ts`.
- [ ] Export PDF "tipográfico" (sin print-to-pdf básico) y soporte KDP 6×9 en la app.
- [ ] Integrar LanguageTool con API own (ahora usa `https://api.languagetool.org/v2/check` sin key).
- [ ] Video Editor: export .mp4 directamente (webm → mp4), audio/narración, más transiciones.
- [ ] Post Editor: previsualización por red más parecida al resultado real (portada, perfil, ajuste de línea) y exportar el pack de los seis posts de golpe.
- [ ] Tests: ampliar `tests/` y añadir coverage.
- [ ] Persistencia en backend (hoy localStorage vía `lib/projects.ts`).
- [ ] Multi-idioma en la UI.