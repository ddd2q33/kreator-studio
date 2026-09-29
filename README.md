# Kreator Studio v1

Studio de escritura y publicación en una sola página (one-page app). Convierte **Markdown / JSON → HTML**, con exportación profesional a **DOCX, PDF, EPUB y Markdown**, y además genera **videos promocionales de capítulos** en la misma herramienta.

> Nombre interno (package.json): `book-studio` · CLI: `book-author`.

---

## Qué es

Una aplicación web (Next.js 16, App Router, React 19, TypeScript, Tailwind v4) con cuatro espacios de trabajo separados:

1. **Book Editor** — escribir el libro en Markdown (o capítulos sueltos / JSON), con estilos de plantilla, revisión, proyectos, notas y exportación de calidad profesional.
2. **Video Editor** — crear un "promo" por capítulo como un video animado de escenas (canvas/webm) y exportar un pack listo para editar en CapCut, con resoluciones HD/Full HD/4K.
3. **Code Video** — explicar código como vídeo: cada toma guarda el archivo entero y las líneas que se muestran, y el vídeo las va revelando mientras se scrolls o se escribe.
4. **Post Editor** — redactar un post y copiarlo ya adaptado a Instagram, Facebook, TikTok, Threads, X y LinkedIn, con plantillas pensadas para libros de trauma.

Todo cabe en una pantalla (layout `h-dvh` + `overflow-hidden`), estilo software de escritorio: app-bar superior con tabs Book Editor/Video Editor/Code Video/Post Editor, toolbar contextual y panel preview/editor.

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
- El botón de exportar vídeo (MP4/WebM) comparte `lib/video-export.ts` con el Code Video: `renderVideoToFile()` codifica con WebCodecs a través de Mediabunny, nunca con `MediaRecorder`.

**Code Video (`/code-editor`):**
- Una **toma** guarda el archivo de código entero y los **índices de las líneas que se enseñan**. El archivo completo es lo que se edita y lo que se exporta; las líneas marcadas son la selección, y la UI muestra los números reales del archivo para no contar a mano.
- Un **scroll automático** lleva el cursor por el bloque revealing líneas marcadas, o la **máquina de escribir** las teclea a la velocidad elegida. Un **rango** (p. ej. 3–8) añade líneas de golpe.
- **Una toma sin líneas no es un error**: se puede preparar a medias, y la lista de tomas la marca como *sin líneas todavía* y la deja fuera del vídeo. La duración, el scrubber y la exportación cuentan solo las que tienen contenido, así que el vídeo nunca tiene un hueco vacío en medio.
- **El preview es el export**: los dos llaman a `paintCodeFrame()`, así que lo que se ve en el canvas es literalmente lo que se codifica, y el canvas se pinta ya al tamaño final (1920×1080) y se escala con CSS.
- **Narración opcional**: se adjunta un audio, se mide su duración y se guarda en IndexedDB (`lib/audio-store.ts`); al exportar se mezcla con `OfflineAudioContext` sobre la pista de voz. Si el navegador no puede codificar el códec, el vídeo sale sin sonido en vez de fallar, y el botón lo dice.
- **MP4 y WebM**: el formato se elige abajo. Si el navegador no puede codificar el que has elegido, el botón de descarga se desactiva y explica por qué en vez de fallar tres minutos después con un error de encoder. Chrome y Edge llevan H.264, así que el MP4 es el que se puede volver a editar en cualquier parte.
- Persistencia propia en `localStorage` bajo `book-studio-code-projects`, con el audio en IndexedDB. No comparte estado con el Book, el Video ni el Post Editor.

**Post Editor:**
- `components/editor/social-studio.tsx` — un solo post en Markdown/JSON y seis tarjetas de red en paralelo, cada una con su propio botón **Copy**. Nada se publica automáticamente: la app solo pone el texto en el portapapeles.
- Cada red mide su propio límite sobre el **texto plano** (el Markdown se aplana: `**negrita*` → `negrita`), no sobre lo que se teclea, para que el contador y el portapapeles no discrepen.
- Tres estados de contador: dentro del objetivo suave (nada), pasado el objetivo (ámbar, el post se publica pero la plataforma lo pliega detrás de "ver más") y pasado el tope duro (rojo, la plataforma lo corta y **Copy se niega**).
- Dos denominadores a propósito, y conviene no confundirlos: el número grande es el **tope duro** (lo que la plataforma acepta) y la barra es el **objetivo suave** (lo que se lee sin "ver más"). El tooltip de cada tarjeta lo aclara.
- Vista por red: cualquier campo en blanco cae al post compartido; solo se guarda el override si escribe algo.
- `lib/social-templates.ts` trae 11 plantillas de libros de trauma (chapter quote, myth vs reality, reflection prompt, glossary, case note, support resources, book launch…). La de recursos de crisis no inventa teléfonos: deja un `REPLACE` con la línea local del autor.
- Persistencia propia en `localStorage` bajo `book-studio-social-drafts`, autosave con debounce de 600 ms y aviso si el navegador llena el cuota. No comparte estado con el Book ni el Video Editor.

**Del post a la imagen (pestaña Image):**
- La pestaña **Image** convierte el mismo post en una imagen lista para publicar, y la **Text** sigue ahí para copiar. Nada se publica solo: la app entrega el PNG en el disco.
- **El mismo HTML para la vista previa y para el PNG.** `buildPostHtml()` es la única implementación del diseño; la vista previa es un `iframe` de ese string y `/api/export-png` lo fotografía con un navegador headless. Si se dibujara el post en React, la vista previa dejaría de ser una prueba de nada.
- Seis formatos exactos, porque es lo que aceptan las plataformas: Instagram `1080×1080`, Story/Reel/TikTok `1080×1920`, Facebook `1200×630`, X `1600×900`, LinkedIn `1200×1200`.
- **Handle** editable y con su propio tamaño (`0.5`–`3`), para que la firma se lea de verdad en un story en vez de ser una nota al pie.
- **Fondo opcional**: al soltar la foto se reescala a 1600 px por el lado largo y se guarda como `data:` URL en el navegador, así que el post sigue funcionando sin conexión. Los layouts con color plano avisan de que no hay hueco para foto en vez de dejar un control muerto.
- **Elementos decorativos** (asterisco, flecha, anillo, marco, regla, barra de color, esquina): se añaden con un clic, se arrastran sobre la imagen y se afinan con los botones de nudge, con las flechas del teclado o con Supr. Cada marca puede sangrar hasta un 25 % del lienzo, para que un marco pueda salirse a propósito, pero no desaparecer.
- La capa de arrastre es invisible y no dibuja nada: solo responde «qué marca hay bajo el puntero» y «dónde quedó». Posiciona sus blancos con el mismo `elementBox()` que usó el render, a tamaño de lienzo y con la misma transformación, así que una posición en píxeles de lienzo es el mismo número en los dos sitios y no hay forma de que se desincronicen.
- **Nada de IA en el diseño.** Las marcas se eligen a mano de una lista corta y sin adornos automáticos: una cita decorativa o un destello generados por máquina se leen como IA y rompen la conexión con quien lee. El texto y el criterio siguen siendo del autor.
- Fuentes del sistema y fotos locales. Sin Google Fonts, sin peticiones de red: el PNG de una laptop sin señal tiene que salir igual.

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
  code-editor/               ← /code-editor
  social-editor/             ← /social-editor
components/
  markdown-converter.tsx    ← app principal (app-bar, rail de paneles, editor, preview)
  studio-header.tsx          ← app-bar con los cuatro tabs (derivados de la URL)
  templates.ts              ← plantillas de libro (style CSS por tema)
  editor/                   ← writer-toolbar, panels, project-manager, video-studio…
  editor/code-studio.tsx    ← Code Video: rail de tomas, editor de líneas, export
  editor/shot-editor.tsx    ← editor de una toma (selección de líneas, rango, hold)
  editor/preview-canvas.tsx ← canvas de preview (mismo pintor que la exportación)
  editor/use-code-studio.ts ← estado + persistencia de los proyectos de código
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
  code-art.ts               ← CodeProject/CodeShot, tomas, línea base, timeline, reveal
  code-frames.ts            ← pintor de fotogramas compartido por preview y export
  code-highlight.ts         ← tokenizador y gramáticas de código (highlight.js)
  code-templates.ts         ← plantillas de proyecto (bug/fix, tour,Comparativa…)
  code-store.ts             ← persistencia aislada de los proyectos de código
  social-networks.ts        ← redes, topes de caracteres, aplanado a texto plano, hashtags
  social-draft.ts           ← SocialDraft: JSON sin pérdida ↔ Markdown con fences
  social-templates.ts       ← 11 plantillas de posts para libros de trauma
  social-store.ts           ← persistencia aislada de los borradores de posts
  book-zip.ts / book-files.ts / image-size.ts / diff.ts / utils.ts
bin/
  book-author.mjs           ← CLI headless (build/html/docx/pdf/templates/init)
tests/                      ← tests node:test (render-engine, book-files, book-zip, image-size, code-art, code-frames)
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